"""Import OctoPrint's per-file print history into the app's print log.

OctoPrint keeps every print of an uploaded file in `~/.octoprint/uploads/.metadata.json`
(`history`: end timestamp, print time, success), plus the slicer analysis with the filament
volume. This turns each history entry into a print log entry of the data file:

- name: the model name from the file name (same rules as the app's parseFileName)
- date / print time / result (OctoPrint has no "failed" vs "cancelled": unsuccessful = cancelled)
- filament: grams from the analysed volume and the material in the file name, stored as
  "filament of unknown color" (successful prints only)

Prints already in the log are skipped (imported before, or logged otherwise with the same date,
name and time within 2 minutes), so it can be run again with a newer metadata file.

    python tools/import_octoprint_history.py .metadata.json path/to/3d-printing-calculator.json \\
        --printer prusa-mk3s-plus [--tz Europe/Berlin] [--dry-run]

Without --tz, dates use this computer's local time zone.
"""

import argparse
import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DENSITY = {"PLA": 1.24, "PETG": 1.27, "ABS": 1.04, "ASA": 1.07, "TPU": 1.21}
TOKEN = re.compile(r"^(\d+(\.\d+)?g|(\d+d)?(\d+h)?(\d+m)?(\d+s)?|(\d*\.\d+|\d+)mm|(\d*\.\d+|\d+)n)$", re.I)


def model_name(file: str) -> str:
    name = re.sub(r"(\.gcode)?\.(b?gcode|gco|3mf)$", "", file.split("/")[-1], flags=re.I)
    tokens = name.split("_")
    first = next((i for i, t in enumerate(tokens) if t and TOKEN.match(t) and re.search(r"\d", t)), -1)
    return "_".join(tokens[:first]) if first > 0 else name


def material(file: str) -> str | None:
    tokens = {t.upper() for t in re.split(r"[_.]", file)}
    return next((m for m in DENSITY if m in tokens), None)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("metadata")
    ap.add_argument("data")
    ap.add_argument("--printer", required=True, help="printer id in the data file")
    ap.add_argument("--tz", help="time zone for the log dates (default: local; IANA names need tzdata on Windows)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    tz = ZoneInfo(args.tz) if args.tz else None
    with open(args.metadata, encoding="utf8") as f:
        metadata = json.load(f)
    with open(args.data, encoding="utf8") as f:
        doc = json.load(f)
    if not any(p["id"] == args.printer for p in doc["printers"]):
        raise SystemExit(f"Unknown printer {args.printer!r}: {[p['id'] for p in doc['printers']]}")

    ids = {j["id"] for j in doc["printJobs"]}
    logged = [(j["date"], j["name"], j.get("printTimeMin", 0)) for j in doc["printJobs"]]
    added = skipped = 0
    for file, meta in metadata.items():
        file_name = meta.get("display", file)
        name = model_name(file_name)
        volume = sum(t.get("volume", 0) for t in (meta.get("analysis", {}).get("filament") or {}).values())
        mat = material(file_name)
        for h in meta.get("history", []):
            end = datetime.fromtimestamp(h["timestamp"], timezone.utc).astimezone(tz)
            minutes = round(h["printTime"] / 60) if h.get("printTime") else 0
            date = end.date().isoformat()
            job_id = f"octoprint-{int(h['timestamp'])}"
            if job_id in ids or any(d == date and n == name and abs(m - minutes) <= 2 for d, n, m in logged):
                skipped += 1
                continue
            job = {
                "id": job_id,
                "date": date,
                "printerId": args.printer,
                "name": name,
                "printTimeMin": minutes,
                "result": "success" if h.get("success") else "cancelled",
                "filaments": [],
                "note": f"Imported from OctoPrint history · ended {end.strftime('%H:%M')} · file {file_name}",
            }
            if h.get("success") and volume > 0:
                job["untrackedFilament"] = {"grams": round(volume * DENSITY.get(mat or "PLA", 1.24), 1), **({"material": mat} if mat else {})}
            doc["printJobs"].append(job)
            ids.add(job_id)
            added += 1

    doc["printJobs"].sort(key=lambda j: (j["date"], j["id"]))
    # Strictly newer than the last save, so syncing devices pull it.
    doc["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    print(f"{added} prints added, {skipped} already in the log")
    if not args.dry_run:
        with open(args.data, "w", encoding="utf8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
            f.write("\n")


if __name__ == "__main__":
    main()
