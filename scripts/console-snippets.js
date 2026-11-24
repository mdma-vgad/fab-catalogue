/* =========================================================================
   Fab console snippets - run these in your own browser on fab.com.
   (Fab blocks automated browsers, so the data is gathered from a normal,
   signed-in browser tab instead.)

   How to run: open fab.com, press F12, open the Console tab, paste ONE
   snippet and press Enter. Firefox/Chrome may ask you to type
   "allow pasting" the first time.

   Use the same tab for both steps - step 2 reads the list step 1 made.
   ========================================================================= */


/* ---- STEP 1 - collect the pack list --------------------------------------
   Open your Fab library first. The snippet scrolls and collects every pack.
   If the count stops climbing early, scroll down yourself while it runs.
   When it says Done, you can optionally run:  copy(fabList)
   to paste a name/URL list into Excel.                                    */

(async () => {
  const re = /\/listings\/([0-9a-f-]{36})/, found = (window.fabFound ||= new Map());
  let stale = 0;
  while (stale < 8) {
    const before = found.size;
    document.querySelectorAll('a[href*="/listings/"]').forEach(a => {
      const m = a.href.match(re); if (!m) return;
      const name = (a.innerText || a.getAttribute('aria-label') || '').trim().split('\n')[0];
      if (!found.has(m[1]) || name.length > found.get(m[1]).length) found.set(m[1], name);
    });
    stale = found.size === before ? stale + 1 : 0;
    console.log(`Found ${found.size} packs...`);
    window.scrollBy(0, 2000);
    await new Promise(r => setTimeout(r, 1200));
  }
  window.fabList = [...found].map(([uid, n]) => `${n}\thttps://www.fab.com/listings/${uid}`).join('\n');
  console.log(`Done: ${found.size} packs. Now run step 2 (or copy(fabList) for a list).`);
})();


/* ---- STEP 2 - download each pack's details ------------------------------
   Fetches each pack's data (1.5 s apart, ~12 min for 450 packs) and saves
   fab-details.json to your Downloads. Put it in the repo's data/ folder,
   then run:  python scripts/import_fab_details.py
   Change the number at the end to test on a few packs first.
   Re-running in the same tab skips packs it already has.
   If no file downloads, run:  copy(JSON.stringify(fabDetails))
   and paste into a text file called fab-details.json.                     */

(async (limit) => {
  const ids = (window.fabList || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [];
  const uids = [...new Set(ids)].slice(0, limit);
  if (!uids.length) return console.log('No list found - run step 1 first');
  window.fabDetails ||= {};
  for (const [i, uid] of uids.entries()) {
    if (fabDetails[uid]) continue;
    try {
      const r = await fetch(`/i/listings/${uid}`, { headers: { accept: 'application/json' } });
      if (r.ok) fabDetails[uid] = await r.json();
      else console.warn(`${uid}: HTTP ${r.status}`);
    } catch (e) { console.warn(uid, e); }
    console.log(`${i + 1}/${uids.length}`);
    await new Promise(r => setTimeout(r, 1500));
  }
  const blob = new Blob([JSON.stringify(fabDetails)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'fab-details.json' });
  document.body.append(a); a.click(); a.remove();
  console.log(`Saved ${Object.keys(fabDetails).length} packs to fab-details.json`);
})(1000);
