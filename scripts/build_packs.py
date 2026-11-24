#!/usr/bin/env python3
"""
build_packs.py - convert the tagging spreadsheet into the site's data file.

    python scripts/build_packs.py                 # data/packs-capture.csv -> data/packs.json
    python scripts/build_packs.py my-sheet.csv

The spreadsheet is the source of truth; never edit packs.json by hand.

Checks every pack against the vocabulary in data/config.json:
- genre / setting / type / subtype values must match the filter options exactly
  (case and spacing are forgiven, e.g. "sci-fi" becomes "Sci-Fi")
- unknown values are dropped from that pack and listed as warnings
- subtype is only kept for packs whose type allows it (config "showWhen")
Rows with no name or no Fab URL are skipped. Use --strict to stop on any warning.
"""

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "config.json"
DEFAULT_CSV = ROOT / "data" / "packs-capture.csv"
OUTPUT = ROOT / "data" / "packs.json"
SEP = "|"


def split(cell: str, sep: str = SEP) -> list:
    return [v.strip() for v in (cell or "").split(sep) if v.strip()]


def main() -> None:
    ap = argparse.ArgumentParser(description="Build data/packs.json from the spreadsheet.")
    ap.add_argument("csv", nargs="?", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--strict", action="store_true", help="fail if anything needs fixing")
    args = ap.parse_args()

    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    filters = {f["key"]: f for f in config["filters"]}
    # lookup that forgives case/spacing: "sci-fi" -> "Sci-Fi"
    canon = {key: {o.lower().replace(" ", ""): o for o in f["options"]} for key, f in filters.items()}

    with args.csv.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    packs, warnings, seen_ids = [], [], set()
    for line, row in enumerate(rows, start=2):           # line 1 is the header
        name = (row.get("name") or "").strip()
        url = (row.get("fabUrl") or "").strip()
        pid = (row.get("id") or "").strip()
        label = f"row {line} ({name or pid or '?'})"
        if not name or not url or not pid:
            warnings.append(f"{label}: missing name, id or fabUrl - skipped")
            continue
        if pid in seen_ids:
            warnings.append(f"{label}: duplicate id '{pid}' - skipped")
            continue
        seen_ids.add(pid)

        pack = {"id": pid, "name": name, "fabUrl": url, "creator": (row.get("creator") or "").strip()}
        for key, f in filters.items():
            values = []
            for raw in split(row.get(key, "")):
                value = canon[key].get(raw.lower().replace(" ", ""))
                if value:
                    values.append(value)
                else:
                    warnings.append(f"{label}: unknown {key} '{raw}' - dropped")
            # conditional groups, e.g. subtype only when type is Asset Pack
            cond = f.get("showWhen")
            if cond and values:
                parent = split(row.get(cond["key"], ""))
                if cond["value"] not in [canon[cond["key"]].get(p.lower().replace(" ", ""), p) for p in parent]:
                    warnings.append(f"{label}: {key} '{SEP.join(values)}' ignored - only used when "
                                    f"{cond['key']} is {cond['value']}")
                    values = []
            if f.get("single"):
                if len(values) > 1:
                    warnings.append(f"{label}: {key} should have one value - kept '{values[0]}'")
                pack[key] = values[0] if values else ""
            else:
                pack[key] = values

        pack["keywords"] = split(row.get("keywords", ""), ",")
        pack["notes"] = (row.get("notes") or "").strip()
        pack["description"] = (row.get("description") or "").strip()
        pack["fabTags"] = split(row.get("fabTags", ""), ",")
        pack["images"] = split(row.get("images", ""))
        packs.append(pack)

    packs.sort(key=lambda p: p["name"].lower())
    OUTPUT.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "count": len(packs),
        "packs": packs,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {len(packs)} packs to {OUTPUT.relative_to(ROOT)}")
    if warnings:
        print(f"\n{len(warnings)} things to check in the spreadsheet:")
        for w in warnings:
            print("  -", w)
        if args.strict:
            sys.exit(1)


if __name__ == "__main__":
    main()
