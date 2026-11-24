/* =========================================================
   Fab Pack Catalogue
   Plain JavaScript, no build step. Reads:
     data/config.json  – site text, contact email, filter vocabulary
     data/packs.json   – the packs (generated from the spreadsheet)
   ========================================================= */
(() => {
  'use strict';

  const STORE_KEY = 'fabCatalogue.v1';
  const MAILTO_LIMIT = 1900; // longer mailto links get cut off by some mail apps

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    config: null,
    packs: [],
    byId: new Map(),
    cards: new Map(),          // id -> card element (built once, reused)
    query: '',
    selected: {},              // filter key -> Set of chosen values
    list: [],                  // ids in "My list", in the order added
    student: { name: '', project: '' },
  };

  /* ---------- storage (fails quietly in private modes) ---------- */
  function loadStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (Array.isArray(saved.list)) state.list = saved.list;
      if (saved.student) state.student = { ...state.student, ...saved.student };
    } catch (e) { /* ignore */ }
  }
  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ list: state.list, student: state.student }));
    } catch (e) { /* ignore */ }
  }

  /* ---------- helpers ---------- */
  const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    asArray(children).forEach((c) => c && node.append(c));
    return node;
  }

  const ICON_X = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_PLUS = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
  const ICON_TICK = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
  const ICON_BIN = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';

  /* ---------- data loading ---------- */
  async function load() {
    try {
      const [config, data] = await Promise.all([
        fetch('data/config.json', { cache: 'no-cache' }).then((r) => r.json()),
        fetch('data/packs.json', { cache: 'no-cache' }).then((r) => r.json()),
      ]);
      state.config = config;
      state.packs = (Array.isArray(data) ? data : data.packs || []).map(prepPack);
      state.packs.forEach((p) => state.byId.set(p.id, p));
      config.filters.forEach((f) => { state.selected[f.key] = new Set(); });
      state.list = state.list.filter((id) => state.byId.has(id)); // drop packs that were removed
    } catch (err) {
      $('#grid').replaceChildren(el('p', {
        class: 'empty',
        text: 'The catalogue could not load. If you opened index.html straight from your computer, run it through a local web server instead (see README).',
      }));
      console.error(err);
      return;
    }
    applyConfig();
    buildFilters();
    readUrl();
    bindUi();
    render();
    updateListUi();
  }

  function prepPack(p) {
    const pack = {
      ...p,
      genre: asArray(p.genre),
      setting: asArray(p.setting),
      type: p.type || '',
      subtype: asArray(p.subtype),
      keywords: asArray(p.keywords),
      images: asArray(p.images),
    };
    pack._haystack = norm([
      pack.name, pack.creator, pack.description, pack.notes, pack.type, ...pack.subtype,
      ...pack.genre, ...pack.setting, ...pack.keywords, ...asArray(p.fabTags),
    ].join(' '));
    return pack;
  }

  function applyConfig() {
    const c = state.config;
    if (c.title) { $('#site-title').textContent = c.title; document.title = c.title; }
    if (c.subtitle) $('#site-subtitle').textContent = c.subtitle;
  }

  /* ---------- filters ---------- */
  function buildFilters() {
    const wrap = $('#filter-groups');
    wrap.replaceChildren();
    state.config.filters.forEach((f) => {
      const options = el('div', { class: 'filter-options' });
      f.options.forEach((opt) => {
        const count = state.packs.filter((p) => asArray(p[f.key]).includes(opt)).length;
        const btn = el('button', {
          type: 'button', class: 'filter-option', 'aria-pressed': 'false',
          'data-key': f.key, 'data-value': opt,
          onclick: () => toggleFilter(f.key, opt),
        });
        btn.append(opt, el('span', { class: 'count', text: String(count) }));
        options.append(btn);
      });
      f._group = el('fieldset', { class: 'filter-group' }, [
        el('legend', { text: f.label }), options,
      ]);
      wrap.append(f._group);
    });
  }

  /* A group with "showWhen" (e.g. sub-type) only appears once its parent value
     is chosen (e.g. type = Asset Pack). When hidden, its choices are cleared. */
  function updateConditionalGroups() {
    state.config.filters.forEach((f) => {
      if (!f.showWhen) return;
      const visible = state.selected[f.showWhen.key].has(f.showWhen.value);
      f._group.hidden = !visible;
      if (!visible) state.selected[f.key].clear();
    });
  }

  function toggleFilter(key, value) {
    const set = state.selected[key];
    set.has(value) ? set.delete(value) : set.add(value);
    render();
  }

  function clearFilters() {
    Object.values(state.selected).forEach((s) => s.clear());
    state.query = '';
    $('#search').value = '';
    render();
  }

  function activeFilters() {
    return state.config.filters.flatMap((f) => [...state.selected[f.key]].map((v) => ({ key: f.key, value: v })));
  }

  /* Search: every word must appear somewhere in the pack.
     Filters: OR inside a group, AND between groups. */
  function matches(p) {
    const words = norm(state.query).split(/\s+/).filter(Boolean);
    if (words.some((w) => !p._haystack.includes(w))) return false;
    return state.config.filters.every((f) => {
      const chosen = state.selected[f.key];
      if (!chosen.size) return true;
      return asArray(p[f.key]).some((v) => chosen.has(v));
    });
  }

  /* ---------- URL (so a filtered view can be shared as a link) ---------- */
  function readUrl() {
    const params = new URLSearchParams(location.search);
    state.query = params.get('q') || '';
    $('#search').value = state.query;
    state.config.filters.forEach((f) => {
      (params.get(f.key) || '').split(',').filter(Boolean)
        .forEach((v) => f.options.includes(v) && state.selected[f.key].add(v));
    });
  }
  function writeUrl() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    state.config.filters.forEach((f) => {
      if (state.selected[f.key].size) params.set(f.key, [...state.selected[f.key]].join(','));
    });
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  /* ---------- rendering ---------- */
  function render() {
    updateConditionalGroups();
    const visible = state.packs.filter(matches);
    $('#grid').replaceChildren(...visible.map(getCard));
    $('#empty').hidden = visible.length > 0;

    const n = visible.length;
    const filtered = n !== state.packs.length;
    const summary = $('#result-summary');
    summary.replaceChildren(el('strong', { text: `${n} ${n === 1 ? 'pack' : 'packs'}` }),
      filtered ? ` of ${state.packs.length} match` : ' in the library');
    $$('[data-result-count]').forEach((e) => { e.textContent = n; });

    // filter buttons + active chips
    $$('.filter-option').forEach((b) => {
      b.setAttribute('aria-pressed', state.selected[b.dataset.key].has(b.dataset.value) ? 'true' : 'false');
    });
    const active = activeFilters();
    const badge = $('#filter-count');
    badge.hidden = active.length === 0;
    badge.textContent = active.length;
    $('#clear-all-inline').hidden = active.length === 0 && !state.query;
    $('#active-chips').replaceChildren(...active.map(({ key, value }) => {
      const chip = el('button', {
        type: 'button', class: 'active-chip', 'aria-label': `Remove filter ${value}`,
        onclick: () => toggleFilter(key, value),
      });
      chip.textContent = value;
      chip.insertAdjacentHTML('beforeend', ICON_X);
      return chip;
    }));
    writeUrl();
  }

  function getCard(pack) {
    if (!state.cards.has(pack.id)) state.cards.set(pack.id, buildCard(pack));
    return state.cards.get(pack.id);
  }

  function buildCard(pack) {
    const card = $('#card-template').content.firstElementChild.cloneNode(true);
    card.dataset.id = pack.id;

    $('.card-title', card).textContent = pack.name;
    $('.card-creator', card).textContent = pack.creator ? `by ${pack.creator}` : '';

    const chips = $('.chips', card);
    if (pack.type) {
      const slug = norm(pack.type).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      chips.append(el('span', { class: `chip chip-type type-${slug}`, text: pack.type }));
    }
    pack.subtype.forEach((s) => chips.append(el('span', { class: 'chip chip-sub', text: s })));
    pack.genre.forEach((g) => chips.append(el('span', { class: 'chip', text: g })));
    pack.setting.forEach((s) => chips.append(el('span', { class: 'chip chip-setting', text: s })));

    if (pack.notes) {
      const notes = $('.card-notes', card);
      notes.textContent = pack.notes;
      notes.hidden = false;
    }

    const link = $('.fab-link', card);
    link.href = pack.fabUrl || '#';
    link.setAttribute('aria-label', `View ${pack.name} on Fab (opens in a new tab)`);

    $('.add-btn', card).addEventListener('click', () => toggleList(pack.id));
    paintAddButton(card, pack);
    buildGallery(card, pack);
    return card;
  }

  function placeholder(pack) {
    return el('div', { class: 'gallery-placeholder', text: pack.name });
  }

  function buildGallery(card, pack) {
    const track = $('.gallery-track', card);
    const dots = $('.gallery-dots', card);
    const prev = $('.prev', card);
    const next = $('.next', card);
    const total = pack.images.length;

    track.setAttribute('aria-label', `${pack.name} images`);
    if (!total) track.append(placeholder(pack));
    pack.images.forEach((src, i) => {
      const img = el('img', {
        src, alt: `${pack.name} – image ${i + 1} of ${total}`,
        loading: 'lazy', decoding: 'async', width: '800', height: '500',
      });
      img.addEventListener('error', () => img.replaceWith(placeholder(pack)), { once: true });
      track.append(img);
      dots.append(el('span', { class: i === 0 ? 'on' : '' }));
    });

    if (total <= 1) { prev.hidden = true; next.hidden = true; dots.hidden = true; return; }

    const current = () => Math.round(track.scrollLeft / track.clientWidth);
    const go = (dir) => {
      const target = (current() + dir + total) % total; // wraps round
      track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
    };
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    });
    let raf = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = current();
        [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      });
    }, { passive: true });
  }

  function paintAddButton(card, pack) {
    const btn = $('.add-btn', card);
    const added = state.list.includes(pack.id);
    btn.className = `btn add-btn ${added ? 'btn-added' : 'btn-primary'}`;
    btn.innerHTML = added ? `${ICON_TICK} Added` : `${ICON_PLUS} Add to list`;
    btn.setAttribute('aria-pressed', added ? 'true' : 'false');
    btn.setAttribute('aria-label', added ? `Remove ${pack.name} from my list` : `Add ${pack.name} to my list`);
  }

  /* ---------- my list ---------- */
  function toggleList(id) {
    const i = state.list.indexOf(id);
    i === -1 ? state.list.push(id) : state.list.splice(i, 1);
    saveStore();
    const card = state.cards.get(id);
    if (card) paintAddButton(card, state.byId.get(id));
    updateListUi();
  }

  function updateListUi() {
    const n = state.list.length;
    $$('[data-list-count]').forEach((e) => { e.textContent = n; });
    $('.list-bar').hidden = n === 0;
    if ($('#list-dialog').open) renderList();
  }

  function buildMessage() {
    const { name, project } = state.student;
    const lines = [
      'Fab pack request',
      `Name: ${name || '[your name]'}`,
      `Project: ${project || '[project or module]'}`,
      '',
    ];
    state.list.forEach((id, i) => {
      const p = state.byId.get(id);
      lines.push(`${i + 1}. ${p.name}`, `   ${p.fabUrl}`);
    });
    return lines.join('\n');
  }

  function renderList() {
    const items = state.list.map((id) => {
      const p = state.byId.get(id);
      const thumb = p.images[0]
        ? el('img', { src: p.images[0], alt: '', loading: 'lazy' })
        : el('span', { class: 'thumb-ph', 'aria-hidden': 'true' });
      const remove = el('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `Remove ${p.name}`,
        onclick: () => toggleList(id),
      });
      remove.innerHTML = ICON_BIN;
      return el('li', { class: 'list-item' }, [
        thumb,
        el('div', { class: 'list-item-text' }, [
          el('span', { class: 'list-item-name', text: p.name }),
          el('span', { class: 'list-item-meta', text: [p.type, ...p.subtype, ...p.genre, ...p.setting].filter(Boolean).join(' · ') }),
        ]),
        remove,
      ]);
    });
    $('#list-items').replaceChildren(...items);
    $('#list-empty').hidden = items.length > 0;
    $('#copy-list').disabled = items.length === 0;
    $('#email-list').toggleAttribute('aria-disabled', items.length === 0);
    refreshMessage();
  }

  function refreshMessage() {
    const message = buildMessage();
    $('#message-preview').textContent = message;
    setCopied(false);

    const to = state.config.contactEmail || '';
    const subject = `${state.config.emailSubject || 'Fab pack request'}${state.student.name ? ` – ${state.student.name}` : ''}`;
    let href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    const tooLong = href.length > MAILTO_LIMIT;
    if (tooLong) {
      // Long lists: copy the full text and ask the student to paste it.
      href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent('My list has been copied to your clipboard. Please paste it here.\n\n')}`;
    }
    const email = $('#email-list');
    email.href = href;
    email.dataset.copyFirst = tooLong ? '1' : '';
  }

  function setCopied(on) {
    $('#copy-label').textContent = on ? 'Copied' : 'Copy list';
    $('#copy-list').classList.toggle('copied', on);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for older browsers / non-secure contexts
      const ta = el('textarea', { readonly: '', style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ---------- sheet + dialog ---------- */
  function openFilters() {
    $('#filters').classList.add('open');
    $('#filters-backdrop').hidden = false;
    $('#filters-open').setAttribute('aria-expanded', 'true');
    $('#filters-close').focus();
  }
  function closeFilters() {
    $('#filters').classList.remove('open');
    $('#filters-backdrop').hidden = true;
    $('#filters-open').setAttribute('aria-expanded', 'false');
  }

  function openList() {
    $('#student-name').value = state.student.name;
    $('#student-project').value = state.student.project;
    renderList();
    $('#list-dialog').showModal();
  }

  /* ---------- events ---------- */
  function bindUi() {
    let t = 0;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = e.target.value.trim(); render(); }, 120);
    });

    $('#filters-open').addEventListener('click', openFilters);
    $('#filters-close').addEventListener('click', closeFilters);
    $('#filters-apply').addEventListener('click', () => { closeFilters(); $('#results').focus(); });
    $('#filters-backdrop').addEventListener('click', closeFilters);
    $('#filters-clear').addEventListener('click', clearFilters);
    $('#clear-all-inline').addEventListener('click', clearFilters);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#filters').classList.contains('open')) closeFilters();
    });

    $$('[data-open-list]').forEach((b) => b.addEventListener('click', openList));
    $$('[data-close-list]').forEach((b) => b.addEventListener('click', () => $('#list-dialog').close()));
    $('#list-dialog').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.close(); // click on backdrop
    });

    ['name', 'project'].forEach((field) => {
      $(`#student-${field}`).addEventListener('input', (e) => {
        state.student[field] = e.target.value.trim();
        saveStore();
        refreshMessage();
      });
    });

    $('#copy-list').addEventListener('click', async () => {
      if (await copyText(buildMessage())) setCopied(true);
    });
    $('#email-list').addEventListener('click', (e) => {
      if (!state.list.length) { e.preventDefault(); return; }
      if (e.currentTarget.dataset.copyFirst) copyText(buildMessage());
    });
  }

  loadStore();
  document.addEventListener('DOMContentLoaded', load);
})();
