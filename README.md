# Fab Pack Catalogue

A searchable catalogue of the department's Fab asset packs. Students browse,
filter and build a list of packs, then copy or email that list to a lecturer.
Clicking **View on Fab** opens the original listing.

Static site: plain HTML, CSS and JavaScript, with no build step. Hosted on GitHub Pages.

## Run it locally

The page loads its data with `fetch`, so it must be served, not opened as a file:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. (VS Code's Live Server extension also works.)

## Project layout

```
index.html            page structure
css/styles.css        mobile-first styles (1 / 2 / 3 columns)
js/app.js             search, filters, galleries, My list
data/config.json      site title, contact email, filter vocabulary
data/packs.json       the packs (generated from the spreadsheet; currently sample data)
img/packs/<id>/       gallery images, 01.webp, 02.webp ...
scripts/fab_capture.py  one-off capture of the Fab library into data/packs-capture.csv
```

## Settings — `data/config.json`

- `contactEmail`: where the **Email** button sends requests. Empty means the student fills in the address.
- `filters`: the allowed values for **genre**, **setting** and **type**. The filter
  buttons are built from this list, so it is the single source of truth for tags.

## Pack format — `data/packs.json`

```json
{
  "id": "medieval-tavern-interior",
  "name": "Medieval Tavern Interior",
  "fabUrl": "https://www.fab.com/listings/…",
  "creator": "Studio Name",
  "description": "Short description…",
  "genre": ["Medieval", "Fantasy"],
  "setting": ["Interior"],
  "type": "Environment",
  "subtype": [],
  "keywords": ["tavern", "inn", "barrels"],
  "notes": "UE5.3+",
  "images": ["img/packs/medieval-tavern-interior/01.webp"]
}
```

- `genre`, `setting`, `type` and `subtype` values must match `config.json`. `subtype` only applies to Asset Packs.
- Search looks at name, creator, description, notes, tags and keywords. Every word typed must match.
- Filters combine as OR within a group and AND between groups.
- `id` must never change once published: students' saved lists use it.

## Publish on GitHub Pages

Repo **Settings → Pages → Deploy from a branch → `main` / root**.
The `.nojekyll` file stops GitHub processing the site with Jekyll.

## Updating the pack data

The spreadsheet `data/packs-capture.csv` is the source of truth. `data/packs.json` is generated from it.

1. **Get the Fab data**: run the two snippets in `scripts/console-snippets.js` in your browser on fab.com
   and save `fab-details.json` into `data/` (git-ignored, ~14 MB).
2. **Build the spreadsheet**: `python scripts/import_fab_details.py`
   - type and sub-type come from Fab's own data; genre and setting are suggestions to check
   - re-running keeps your edits; `--fresh` re-suggests all tags (notes kept)
3. **Tag in Excel**: multi-value cells use `|`, e.g. `Medieval|Fantasy`. Keywords are comma separated.
4. **Build the site data**: `python scripts/build_packs.py`
   - checks every value against `data/config.json` and lists anything to fix
