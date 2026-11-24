# CLAUDE.md — Fab Pack Catalogue

Context for Claude working in this repo.

## Purpose
Students browse the department's Fab packs, search and filter them, add packs to
"My list", then copy or email the list to a lecturer. The Fab listing page is the
detail view: there is no in-site detail page. Only lecturers add packs.

## Agreed decisions
- Static GitHub Pages site. Plain HTML/CSS/JS, no framework, no build step,
  so other lecturers can maintain it.
- Mobile-first. Grid: 1 column on phones, 2 at ≥640px, 3 at ≥1024px.
- Card: swipeable gallery on top; name, creator, type badge, genre and setting chips,
  notes; buttons "View on Fab" and "Add to list".
- Filters: bottom sheet on phones, inline bar on desktop. OR within a group, AND between.
- Tags (vocabulary in `data/config.json`):
  - genre (multi): Medieval, Fantasy, Sci-Fi, Modern / Urban, Post-Apocalyptic, Horror, Stylised, Nature
  - setting (multi): Interior, Exterior
  - type (single): Environment, Asset Pack, Character, Gameplay System, Tool/Plugin, Game Template
  - subtype (multi, Asset Pack only): Props, Materials, VFX, Audio/SFX, Animation, UI, Sprites, Foliage
  - keywords: free text for search. The sub-type filter only shows once Asset Pack is selected.
- My list: stored in localStorage; student name + project; copy, or mailto
  (falls back to copy-and-paste when the link would be too long).
- Images are NOT downloaded: we link to Fab's pre-sized 960px copies (media.fab.com).
- Fab blocks automated browsers, so data comes from a console snippet run in Dale's own
  browser (fetches /i/listings/<uid>) -> data/fab-details.json -> scripts/import_fab_details.py,
  which auto-categorises from Fab's listingType + category path.
- Source of truth is a spreadsheet (CSV in the repo). `data/packs.json` is generated
  from it — never hand-edit packs.json once the converter exists.

## Planned next steps
1. Done: `scripts/build_packs.py` (CSV -> packs.json with validation).
2. GitHub Issue Form ("Add a pack": Fab URL + tag dropdowns) and a GitHub Action that
   captures the listing, downloads images, appends the CSV row and rebuilds packs.json.
3. Optional weekly Action that checks Fab links still work.

## Working preferences
Explain the approach before writing code. Keep the code readable for teaching.
