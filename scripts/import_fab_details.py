#!/usr/bin/env python3
"""
import_fab_details.py - turn the fab-details.json saved from the browser console
into the tagging spreadsheet data/packs-capture.csv.

    python scripts/import_fab_details.py              # reads data/fab-details.json
    python scripts/import_fab_details.py --fresh      # re-suggest ALL tags (see below)
    python scripts/import_fab_details.py other.json

What it does
- Takes name, creator, Fab category, Fab tags and a short description from each pack.
- Links up to MAX_IMAGES gallery images at Fab's pre-sized copy closest to IMAGE_WIDTH
  (Fab stores 144/160/320/640/960/1280 px versions). Nothing is downloaded.
- Auto-categorises each pack:
    type     from Fab's own listing type and category (reliable)
    subtype  for Asset Packs, from the same (reliable)
    genre    from keywords in the title, category and seller tags (a good guess)
    setting  from keywords, for Environments and Props only (a good guess)
    keywords the seller's Fab tags
- Re-running keeps anything you have typed in type/subtype/genre/setting/keywords/notes.
  --fresh throws away type/subtype/genre/setting/keywords and suggests them again
  (notes are always kept). Use it after changing the rules below.

Multi-value cells use | as the separator, e.g.  Medieval|Fantasy
"""

import argparse
import csv
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "data" / "fab-details.json"
CSV_FILE = ROOT / "data" / "packs-capture.csv"

MAX_IMAGES = 5
IMAGE_WIDTH = 960          # pick the smallest Fab size at least this wide
DESCRIPTION_LIMIT = 300    # characters
SEP = "|"

# Column order in the spreadsheet: the ones you edit first, Fab reference data after.
COLUMNS = ["id", "name", "type", "subtype", "genre", "setting", "keywords", "notes",
           "creator", "fabType", "fabCategory", "fabTags", "description", "fabUrl", "images", "uid"]

# =================================================================== categorising rules
# Values must match data/config.json exactly.

# Fab's listingType -> (type, subtype). None means "decide from the category instead".
LISTING_TYPE_MAP = {
    "game-template":         ("Game Template", ""),
    "tutorials-examples":    ("Game Template", ""),
    "tool-and-plugin":       ("Tool/Plugin", ""),
    "game-system":           ("Gameplay System", ""),
    "audio":                 ("Asset Pack", "Audio/SFX"),
    "material":              ("Asset Pack", "Materials"),
    "vfx":                   ("Asset Pack", "VFX"),
    "animation":             ("Asset Pack", "Animation"),
    "ui":                    ("Asset Pack", "UI"),
    "sprites-and-flipbooks": ("Asset Pack", "Sprites"),
    "3d-model":              None,
}

# For 3D models: first part of Fab's category path -> (type, subtype)
CATEGORY_MAP = {
    "environments":         ("Environment", ""),
    "characters-creatures": ("Character", ""),
    "nature-plants":        ("Asset Pack", "Foliage"),
}
DEFAULT_TYPE = ("Asset Pack", "Props")

# Genre: substring match on title + category + tags (lower case)
GENRE_HINTS = {
    "Medieval":         ["medieval", "castle", "knight", "tavern", "viking", "middle ages"],
    "Fantasy":          ["fantasy", "magic", "dungeon", "dragon", "wizard", "elven", "rpg", "spell"],
    "Sci-Fi":           ["sci-fi", "scifi", "science fiction", "futuristic", "cyberpunk", "spaceship",
                         "space station", "robot", "alien"],
    "Modern / Urban":   ["modern", "urban", "city", "cities", "street", "office", "apartment", "suburb",
                         "industrial", "commercial", "construction", "military", "warzone", "police"],
    "Post-Apocalyptic": ["apocalyp", "wasteland", "abandoned", "ruin", "zombie"],
    "Horror":           ["horror", "creepy", "haunted", "asylum", "scary", "undead"],
    "Stylised":         ["stylized", "stylised", "cartoon", "toon", "hand-painted", "handpainted"],
    "Nature":           ["nature", "forest", "jungle", "foliage", "tree", "landscape", "island",
                         "mountain", "desert", "aquatic", "cliff", "grass"],
}
NO_GENRE_TYPES = {"Tool/Plugin", "Gameplay System"}
NO_GENRE_SUBTYPES = {"Audio/SFX", "UI"}

INTERIOR_HINTS = ["interior", "indoor", "room", "office", "corridor", "warehouse", "bedroom", "kitchen",
                  "hospital", "bunker", "dungeon", "furniture", "tavern", "house", "laboratory",
                  "factory", "prison", "library", "church", "bathroom"]
EXTERIOR_HINTS = ["exterior", "outdoor", "landscape", "street", "city", "cities", "forest", "jungle",
                  "terrain", "courtyard", "village", "town", "island", "mountain", "desert", "nature", "road"]


def categorise(d: dict) -> dict:
    lt = d.get("listingType") or ""
    path = ((d.get("category") or {}).get("path") or "")
    top = path.split("/")[0]

    mapped = LISTING_TYPE_MAP.get(lt)
    if mapped is None:
        mapped = CATEGORY_MAP.get(top, DEFAULT_TYPE)
    kind, subtype = mapped

    tags = [t.get("name") for t in d.get("tags") or [] if t.get("name")]
    strong = " ".join([d.get("title") or "", (d.get("category") or {}).get("name") or "", path]).lower()
    text = " ".join([strong, *tags]).lower()

    # Genre: trust the title and Fab category first. Sellers tag packs with lots of genres,
    # so tags are only used when the title/category say nothing - and then only the top 2.
    genre = []
    if kind not in NO_GENRE_TYPES and subtype not in NO_GENRE_SUBTYPES:
        genre = [g for g, words in GENRE_HINTS.items() if any(w in strong for w in words)]
        if not genre:
            lowered = [t.lower() for t in tags]
            scores = {g: sum(any(w in t for w in words) for t in lowered) for g, words in GENRE_HINTS.items()}
            genre = [g for g, s in sorted(scores.items(), key=lambda kv: -kv[1]) if s > 0][:2]

    setting = []
    if kind == "Environment" or subtype == "Props":
        if any(w in text for w in INTERIOR_HINTS):
            setting.append("Interior")
        if any(w in text for w in EXTERIOR_HINTS):
            setting.append("Exterior")

    return {
        "type": kind,
        "subtype": subtype,
        "genre": SEP.join(genre),
        "setting": SEP.join(setting),
        "keywords": ", ".join(t.lower() for t in tags),
    }


# =================================================================== helpers
def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:60] or "pack"


def plain_text(raw_html: str, limit: int) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw_html or ""))
    text = re.sub(r"\b(documentation|docs|discord|youtube|video|preview|website)\s*:?\s*https?://\S+", " ", text, flags=re.I)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -:|")
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def sized_url(media: dict) -> str:
    sizes = sorted((i for i in media.get("images") or [] if i.get("url")), key=lambda i: i.get("width") or 0)
    for img in sizes:
        if (img.get("width") or 0) >= IMAGE_WIDTH:
            return img["url"]
    return sizes[-1]["url"] if sizes else media.get("mediaUrl") or ""


def pick_images(listing: dict) -> list:
    """Cover thumbnail first, then gallery images in Fab's order. Videos skipped."""
    medias = list(listing.get("thumbnails") or [])
    gallery = [m for m in listing.get("medias") or [] if m.get("type") == "image"]
    medias += sorted(gallery, key=lambda m: m.get("position") if m.get("position") is not None else 999)
    urls, seen = [], set()
    for m in medias:
        key = m.get("previewUid") or m.get("uid")
        url = sized_url(m)
        if url and key not in seen:
            seen.add(key)
            urls.append(url)
        if len(urls) >= MAX_IMAGES:
            break
    return urls


def load_vocab() -> dict:
    """Allowed values per column, from data/config.json (lower-cased, spaces ignored)."""
    config = json.loads((ROOT / "data" / "config.json").read_text(encoding="utf-8"))
    return {f["key"]: {o.lower().replace(" ", "") for o in f["options"]} for f in config["filters"]}


def is_valid(col: str, cell: str, vocab: dict) -> bool:
    if col not in vocab:                       # e.g. keywords: free text
        return True
    values = [v.strip().lower().replace(" ", "") for v in cell.split(SEP) if v.strip()]
    return all(v in vocab[col] for v in values)


def read_csv() -> dict:
    if not CSV_FILE.exists():
        return {}
    with CSV_FILE.open(newline="", encoding="utf-8-sig") as f:
        return {row["uid"]: row for row in csv.DictReader(f) if row.get("uid")}


# =================================================================== main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("--fresh", action="store_true",
                    help="re-suggest type/subtype/genre/setting/keywords for every pack (notes are kept)")
    args = ap.parse_args()

    if not args.input.exists():
        sys.exit(f"Can't find {args.input}. Save fab-details.json into the data folder, or pass its path.")
    listings = json.loads(args.input.read_text(encoding="utf-8"))

    vocab = load_vocab()
    existing = read_csv()
    used_ids = {row["id"] for row in existing.values()}
    rows, no_images = [], []

    for uid, d in listings.items():
        row = dict(existing.get(uid, {}))
        title = d.get("title") or ""

        if not row.get("id"):                      # new pack: stable id from its name
            base = pid = slugify(title)
            n = 2
            while pid in used_ids:
                pid, n = f"{base}-{n}", n + 1
            used_ids.add(pid)
            row["id"] = pid

        images = pick_images(d)
        if not images:
            no_images.append(title or uid)
        row.update({
            "uid": uid,
            "name": title,
            "fabUrl": f"https://www.fab.com/listings/{uid}",
            "creator": (d.get("user") or {}).get("sellerName") or "",
            "fabType": d.get("listingType") or "",
            "fabCategory": (d.get("category") or {}).get("name") or "",
            "fabTags": ", ".join(t.get("name") for t in d.get("tags") or [] if t.get("name")),
            "description": plain_text(d.get("description"), DESCRIPTION_LIMIT),
            "images": SEP.join(images),
        })

        for col, value in categorise(d).items():
            # Re-suggest when empty, when --fresh, or when the cell holds a value that is
            # no longer in config.json (e.g. the old type "Assets").
            if args.fresh or not row.get(col) or not is_valid(col, row[col], vocab):
                row[col] = value
        row.setdefault("notes", "")
        rows.append(row)

    rows += [r for u, r in existing.items() if u not in listings]   # never drop rows
    rows.sort(key=lambda r: (r.get("type", ""), r.get("name", "").lower()))

    CSV_FILE.parent.mkdir(parents=True, exist_ok=True)
    with CSV_FILE.open("w", newline="", encoding="utf-8-sig") as f:   # -sig: opens cleanly in Excel
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} packs to {CSV_FILE.relative_to(ROOT)}")
    if no_images:
        print(f"{len(no_images)} packs have no images: " + "; ".join(no_images[:10]))
    print("Type and subtype come from Fab's own data. Genre and setting are guesses - please check them.")


if __name__ == "__main__":
    main()
