"""Extract the legacy 3DPrintingCalc.xlsx into normalized JSON seed data.

Usage:  python tools/extract_excel.py [path/to/3DPrintingCalc.xlsx]
Output: data/seed/*.json

The workbook is read twice: once with cached values (inputs + legacy results,
used as regression fixtures for the new calc engine) and once with formulas
(only to document them). Nothing is recalculated here.
"""
import datetime
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "3DPrintingCalc.xlsx"
OUT = ROOT / "data" / "seed"
EXCEL_EPOCH = datetime.datetime(1899, 12, 30)


def slug(s):
    s = s.lower().replace("+", " plus ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def iso(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()[:10]
    return v


def minutes(v):
    """Excel durations: time (<24h), datetime (>=24h, offset from 1899-12-30) or timedelta."""
    if v is None:
        return None
    if isinstance(v, datetime.time):
        return v.hour * 60 + v.minute + round(v.second / 60)
    if isinstance(v, datetime.datetime):
        return round((v - EXCEL_EPOCH).total_seconds() / 60)
    if isinstance(v, datetime.timedelta):
        return round(v.total_seconds() / 60)
    if isinstance(v, (int, float)):
        return round(v * 24 * 60)
    raise ValueError(f"unexpected duration {v!r}")


def table_rows(ws, table_name):
    rows = list(ws[ws.tables[table_name].ref])
    hdr = [c.value for c in rows[0]]
    for r in rows[1:]:
        yield dict(zip(hdr, (c.value for c in r)))


def yes_no_or_number(v):
    """Legacy 'Account Labor' / 'Apply Margin' cells: 'Yes', 'No' or a numeric override."""
    if v == "Yes":
        return {"mode": "default"}
    if isinstance(v, (int, float)):
        return {"mode": "override", "value": v}
    return {"mode": "off"}


# ---------------------------------------------------------------------------
# Normalization tables for the filament inventory
# ---------------------------------------------------------------------------
MANUFACTURER = {
    "Prusa": "Prusa Research",
    "Prusament": "Prusa Research",
    "Prusa / easyABS": "Prusa Research",
    "Fillamentum Extrafill": "Fillamentum",
}
# (legacy manufacturer, legacy material type) -> product line
PRODUCT_LINE = {
    ("Prusa", "PETG"): "Prusament PETG",
    ("Prusament", "PETG"): "Prusament PETG",
    ("Prusa", "PLA"): "Prusament PLA",
    ("Prusament", "PLA"): "Prusament PLA",
    ("Prusa / easyABS", "ABS"): "easyABS",
    ("Fillamentum Extrafill", "ASA"): "Extrafill ASA",
    ("Fillamentum", "PLA"): "Extrafill PLA",
    ("Fillamentum", "TPU"): "Flexfill 98A",
    ("SUNLU", "PLA+2.0"): "PLA+ 2.0",
    ("SUNLU", "MetaPLA"): "PLA Meta",
    ("SUNLU", "HighSpeedPLA"): "HS-PLA",
    ("Spectrum", "CarbonPETG"): "PETG Carbon",
    ("eSUN", "eASA"): "eASA",
    ("3DJake", "ecoPLA"): "ecoPLA",
}
BASE_MATERIAL = {
    "PLA": "PLA", "PLA+": "PLA", "PLA+2.0": "PLA", "MetaPLA": "PLA", "ecoPLA": "PLA",
    "HighSpeedPLA": "PLA", "PETG": "PETG", "CarbonPETG": "PETG", "ABS": "ABS",
    "ASA": "ASA", "eASA": "ASA", "TPU": "TPU", "Other": "Other",
}
# legacy color -> (color, finish)
COLOR = {
    "CLear": ("Clear", None),
    "Blau Flexfill 98A": ("Blue", None),
    "Lila": ("Purple", None),
    "Shiny Silk Silver": ("Silver", "silk"),
    "Silk Copper": ("Copper", "silk"),
    "ColorShiftBlueGreen": ("Blue-Green", "color-shift"),
    "Pearl Ruby": ("Pearl Ruby", "pearl"),
    "Carbon Black": ("Black", "carbon-fiber"),
    "None": ("Unknown", None),
}


# Vendor/retailer information gathered 2026-10-01 (store.sunlu.com blog, retailer
# listings). SUNLU's own claims are inconsistent between pages (e.g. PLA+ 2.0 max
# speed 300 vs 600 mm/s), so these are hints, not specs.
PRODUCT_LINE_META = {
    ("SUNLU", "PLA"): {
        "aliases": ["SUNLU PLA"],
        "notes": "Basic PLA, 200-240 C, up to ~200 mm/s. The 2020 purchases were plain "
                 "'PLA Filament' (confirmed by owner), not PLA+.",
    },
    ("SUNLU", "PLA+"): {
        "aliases": ["SUNLU PLA Plus", "SUNLU PLA+"],
        "successorId": "sunlu-pla-plus-2-0",
        "notes": "Toughened PLA, 205-245 C. Succeeded by PLA+ 2.0 (SUNLU calls 2.0 the "
                 "'upgraded evolution' of PLA+); both are still sold.",
    },
    ("SUNLU", "PLA+ 2.0"): {
        "aliases": ["PLA Plus 2.0", "PLA+2.0", "High Speed PLA+2.0", "PLA2.0"],
        "predecessorId": "sunlu-pla-plus",
        "notes": "Successor of PLA+, 195-230 C, rated for high-speed printing. "
                 "'High Speed PLA+2.0' listings appear to be the same product - verify.",
    },
    ("SUNLU", "PLA Meta"): {
        "aliases": ["PLA Meta", "Meta PLA", "High Speed PLA Meta"],
        "notes": "Matte-ish high-flow PLA, 185-225 C, up to ~250 mm/s. Amazon sells it as "
                 "'High Speed PLA Meta' (ASINs B0BFGTJG53, B0B1ZX58DR) - not the same as HS-PLA.",
    },
    ("SUNLU", "HS-PLA"): {
        "aliases": ["Rapid HS-PLA", "HS-PLA", "High Speed PLA"],
        "notes": "Separate high-speed line (vendor claims up to 500-600 mm/s). Sold e.g. as "
                 "4x1kg 'High Speed PLA' (ASIN B0D4LQW7K8). Beware: 'High Speed PLA Meta' is PLA Meta.",
    },
}

# Empty-spool (tare) weights. SUNLU values from SpoolmanDB (community data,
# github.com/Donkie/SpoolmanDB) - verify by weighing an empty spool.
TARE_PRESETS = [
    {"manufacturer": "SUNLU", "productLine": None, "spoolType": "plastic", "emptyWeightG": 130,
     "source": "SpoolmanDB", "verified": False},
    {"manufacturer": "SUNLU", "productLine": "PETG", "spoolType": "plastic", "emptyWeightG": 209,
     "source": "SpoolmanDB", "verified": False},
    {"manufacturer": "SUNLU", "productLine": None, "spoolType": "refill", "emptyWeightG": 0,
     "source": "refills ship without spool - tare is whatever reusable spool you mount them on",
     "verified": False},
]


# Filaments that only exist after the owner's corrections (2026-10-01).
EXTRA_FILAMENTS = [
    {"Name": "SUNLU HighSpeedPLA Black", "Manufacturer": "SUNLU", "Material-Type": "HighSpeedPLA",
     "Color": "Black", "Link": "https://www.amazon.de/dp/B0D4LQW7K8"},
    *({"Name": f"SUNLU PLA {c}", "Manufacturer": "SUNLU", "Material-Type": "PLA", "Color": c}
      for c in ("Black", "White", "Grey")),
    *({"Name": f"SUNLU PLA+2.0 {c}", "Manufacturer": "SUNLU", "Material-Type": "PLA+2.0", "Color": c}
      for c in ("Green", "Yellow", "Grey", "Black")),
]
# Legacy filament rows replaced by the corrections below.
DROPPED_FILAMENTS = {"SUNLU PLA+2.0 Colored", "Other Other None"}
FILAMENT_LINKS = {"ERYONE TPU Grey": "https://www.amazon.de/dp/B07WQ2144X"}
# Spools that were not bought: they cost nothing and never feed price averages.
GIFTED_FILAMENTS = {"HATCHBOX PLA Red", "HATCHBOX PLA Green"}
# Catalog entries never bought - kept as "to buy" candidates.
WISHLIST_FILAMENTS = {"Prusament PLA Jet Black"}

# Owner-confirmed corrections of Fillament-Log rows, keyed by (date, description).
PURCHASE_FIXES = {
    ("2025-11-13", "SUNLU PLA+ 2.0 Black 4kg 4 Spools"): {
        "type": "SUNLU HighSpeedPLA Black",
        "listingTitle": "SUNLU High Speed PLA (Rapid HS-PLA) 4x1kg Black", "asin": "B0D4LQW7K8",
        "resolution": "Was booked as PLA+ Black; actually SUNLU Rapid HS-PLA."},
    ("2024-10-31", "SUNLU High Speed PLA"): {
        "listingTitle": "SUNLU High Speed PLA Meta", "asin": "B0BFGTJG53",
        "resolution": "Confirmed PLA Meta."},
    ("2025-09-11", "SUNLU High Speed PLA Meta Weiß"): {
        "asin": "B0B1ZX58DR", "resolution": "Confirmed PLA Meta."},
    ("2023-12-23", "GEETECH PLA 1kg Grün"): {
        "description": "GEETECH PETG 1kg Grün",
        "resolution": "Confirmed PETG; original description said PLA."},
    ("2020-07-27", "SUNLU PLA 1kg Grau"): {
        "type": "SUNLU PLA Grey",
        "resolution": "Plain 'PLA Filament' at the time, not PLA+ (same era/listing as the 2020-09 rolls)."},
    ("2020-09-07", "SUNLU PLA 1kg Schwarz"): {
        "type": "SUNLU PLA Black", "resolution": "Plain 'PLA Filament', not PLA+ (confirmed)."},
    ("2020-09-07", "SUNLU PLA 1kg Weiß"): {
        "type": "SUNLU PLA White", "resolution": "Plain 'PLA Filament', not PLA+ (confirmed)."},
    ("2020-02-06", "Filament TPU Eryone"): {
        "type": "ERYONE TPU Grey", "asin": "B07WQ2144X",
        "listingTitle": "Eryone TPU Filament 1.75mm, 0.5kg 1 Spool, Grau",
        "resolution": "Was booked as 'Other'."},
    ("2025-02-14", "SUNLU PLA+ 2.0 Grün, Gelb, Grau, Schwarz 4kg 4 Spools"): {
        "split": [f"SUNLU PLA+2.0 {c}" for c in ("Green", "Yellow", "Grey", "Black")],
        "resolution": "4-color bundle split into 4 x 1 kg, price split evenly."},
}


def asin_from(link):
    m = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", link or "")
    return m.group(1) if m else None


def machine_kind(description):
    """investment = the printer itself or a major upgrade; everything else wears out."""
    if description == "Versandkosten":
        return "shipping"
    if re.search(r"Bausatz|Upgrade|Hotend$", description):
        return "investment"
    return "wear-part"


def purchase_flags(p, fil, already_split):
    """Rule-based review hints: where the legacy type assignment looks doubtful."""
    if "resolution" in p:
        return []
    d = p["description"] or ""
    flags = []
    if "2.0" in d and fil["productLine"] != "PLA+ 2.0":
        flags.append("Description says 'PLA+ 2.0' but booked on product line "
                     f"'{fil['productLine']}'.")
    if "High Speed" in d:
        flags.append("Description says 'High Speed PLA' - booked as PLA Meta. "
                     "Same product, renamed, or a separate line?")
    if fil["baseMaterial"] == "PETG" and "PETG" not in d and "PLA" in d:
        flags.append("Description says PLA but booked on a PETG filament.")
    if fil["manufacturer"] == "SUNLU" and fil["productLine"] == "PLA+" \
            and "PLA+" not in d and p["date"] < "2021-01-01":
        flags.append("Old SUNLU purchase described as plain 'PLA' but booked as PLA+.")
    if ("," in d or fil["color"].startswith("Mixed")) and not already_split:
        flags.append("Multi-color bundle - should be split into one purchase per color.")
    if fil["legacyName"] == "Other Other None":
        flags.append("Booked as 'Other'; an 'ERYONE TPU Grey' filament exists - likely that one.")
    return flags


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    OUT.mkdir(parents=True, exist_ok=True)

    # --- settings (Overview sheet, key/value in A:B) ------------------------
    ov = {r[0]: r[1] for r in wb["Overview"].iter_rows(values_only=True) if r[0]}
    get = lambda prefix: next(v for k, v in ov.items() if k.startswith(prefix))
    settings = {
        "currency": "EUR",
        "energyPricePerKwh": get("Energy Cost"),
        "purgeWastePerPlateG": get("Fillament Usage per Job"),
        "runtimeDaysPerYear": get("Est. Runtime / Year"),
        "runtimeHoursPerDay": get("Est. Daily Runtime"),
        "laborPerPlateMin": minutes(get("Labor per Job")),
        "hourlyRate": get("Hourly Rate"),
        "firstHourPhaseMin": minutes(get("Warm Up Time")),
        "defaultMarkup": get("Margin"),
        "_legacyComputed": {
            "runtimeHoursPerYear": get("Est. Runtime (h)"),
            "amortizationPerYear": get("Amortization / Y"),
            "amortizationPerHour": get("Amortization / h"),
        },
    }

    # --- material profiles; their power figures belong to a printer ---------
    material_rows = [r for r in table_rows(wb["Material-Types"], "MaterialTypes") if r["Type"]]
    materials = [{
        "id": slug(r["Type"]),
        "name": r["Type"],
        "baseMaterial": BASE_MATERIAL.get(r["Type"], "Other"),
    } for r in material_rows]
    mat_id = {m["name"]: m["id"] for m in materials}

    # --- printers -------------------------------------------------------------
    # The workbook only knows the MK3S+; usage figures are the OctoPrint
    # statistics as of 2026-10-01 (collection started 2024-08-26).
    mk3 = {
        "id": "prusa-mk3s-plus",
        "name": "Prusa i3 MK3S+",
        "technology": "FDM",
        "status": "active",
        "paidOff": True,                     # decided 2026-10-01: no further amortization
        "toolheads": 1,
        "toolType": "single",
        "purgeWastePerPlateG": settings["purgeWastePerPlateG"],
        "purgePerFilamentChangeG": None,
        "firstHourPhaseMin": settings["firstHourPhaseMin"],
        "powerProfiles": {
            mat_id[r["Type"]]: {
                "heatupMin": r["Heatup Time (min)"],
                "heatupPowerW": r["Heatup Power"],
                "powerFirstHourW": r["Power First Hour"],
                "powerFollowingHoursW": r["Power Next Hours"],
            } for r in material_rows
        },
        "usageStats": [{
            "source": "OctoPrint",
            "asOf": "2026-10-01",
            "since": "2024-08-26",
            "prints": 600, "printsFinished": 568,
            "printHours": 2779.73, "printHoursFinished": 2667.89,
        }, {
            "source": "OctoPrint",
            "asOf": "2026-10-01",
            "since": "2026-01-01",
            "prints": 214, "printsFinished": 208,
            "printHours": 864.29, "printHoursFinished": 858.64,
        }, {
            "source": "Printer LCD statistics (total)",
            "asOf": "2026-10-01",
            "since": None,
            "printHours": 10245.12,          # 426d 21h 07m
            "filamentUsedM": 11560.96,
            "reliability": "lower bound - counters were wiped by a firmware upgrade at some point; "
                           "filament length (~34 kg PLA) is far below the ~130 kg bought",
        }],
    }
    printers = [mk3, {
        "id": "prusa-core-one-indx",
        "name": "Prusa CORE One + INDX",
        "technology": "FDM",
        "status": "planned",
        "purchasePrice": 2000,               # working assumption until the tool count is decided
        "toolheads": None,                   # INDX ships as 4- or 8-tool kit
        "toolType": "toolchanger",
        "purgeWastePerPlateG": None,
        "purgePerFilamentChangeG": 0.015,    # vendor claim: ~13-15 mg priming pellet per tool change
        "firstHourPhaseMin": None,
        "powerProfiles": {},
        "usageStats": [],
    }, {
        "id": "anycubic-photon",
        "name": "Anycubic Photon",
        "technology": "resin",
        "status": "retired",
        "toolheads": None,
        "toolType": None,
        "powerProfiles": {},
        "usageStats": [],
    }]

    # --- filaments ----------------------------------------------------------
    filaments = []
    by_legacy = {}
    for r in [*table_rows(wb["Fillament-Types"], "FillamentTypes"), *EXTRA_FILAMENTS]:
        if not (r["Manufacturer"] and r["Material-Type"]) or r["Name"] in DROPPED_FILAMENTS:
            continue
        link = FILAMENT_LINKS.get(r["Name"], r.get("Link"))
        man_l, mat_l = r["Manufacturer"], r["Material-Type"]
        color, finish = COLOR.get(r["Color"], (r["Color"], None))
        if r["Color"] == "Colored":
            color = "Mixed (Green, Yellow, Grey, Black)"
        manufacturer = MANUFACTURER.get(man_l, man_l)
        line = PRODUCT_LINE.get((man_l, mat_l), mat_l)
        f = {
            "id": slug(" ".join(filter(None, [manufacturer, line, finish, color]))),
            "manufacturer": manufacturer,
            "productLine": line,
            "baseMaterial": BASE_MATERIAL.get(mat_l, "Other"),
            "materialProfileId": mat_id.get(mat_l),
            "color": color,
            "finish": finish,
            "link": link,
            "asin": asin_from(link),
            "acquisition": "gift" if r["Name"] in GIFTED_FILAMENTS else "purchase",
            "status": "wishlist" if r["Name"] in WISHLIST_FILAMENTS else "owned",
            "legacyName": r["Name"],
        }
        if "kg Bought" in r:
            f["_legacyComputed"] = {
                "kgBought": r["kg Bought"],
                "avgPricePerKg": r["Price / kg"] or None,
                "lastBuy": iso(r["Last Buy"]),
            }
        filaments.append(f)
        by_legacy[r["Name"]] = f

    # --- product lines ------------------------------------------------------
    lines = {}
    for f in filaments:
        key = (f["manufacturer"], f["productLine"])
        lines.setdefault(key, {
            "id": slug(f"{key[0]} {key[1]}"),
            "manufacturer": key[0],
            "name": key[1],
            "baseMaterial": f["baseMaterial"],
            "materialProfileId": f["materialProfileId"],
            "diameterMm": 1.75,
            **PRODUCT_LINE_META.get(key, {}),
        })
    product_lines = list(lines.values())
    for f in filaments:
        f["productLineId"] = lines[(f["manufacturer"], f["productLine"])]["id"]

    # --- filament purchases -------------------------------------------------
    log = [r for r in table_rows(wb["Fillament-Log"], "FillamentLog") if r["Date"]]
    bundle_rows = {}
    for r in log:
        key = (iso(r["Date"]), (r["Description"] or "").strip())
        bundle_rows[key] = bundle_rows.get(key, 0) + 1

    purchases = []
    for r in log:
        key = (iso(r["Date"]), (r["Description"] or "").strip())
        fix = PURCHASE_FIXES.get(key, {})
        parts = fix.get("split") or [fix.get("type", r["Type"])]
        n = len(parts)
        for legacy_type in parts:
            fil = by_legacy[legacy_type]
            p = {
                "date": key[0],
                "store": r["Store"],
                "description": fix.get("description", key[1]),
                "listingTitle": fix.get("listingTitle"),
                "asin": fix.get("asin"),
                "filamentId": fil["id"],
                "legacyType": r["Type"],
                "spoolType": "refill" if "Refill" in key[1] else None,
                "packageWeightKg": r["Weight"] / n,
                "quantity": r["Amount"],
                "unitPrice": round(r["Price"] / n, 4),
                "totalPrice": round(r["Total Price"] / n, 4),
                "totalKg": r["Total Weight"] / n,
            }
            p["pricePerKg"] = round(p["totalPrice"] / p["totalKg"], 4) if p["totalKg"] else None
            if "resolution" in fix:
                p["resolution"] = fix["resolution"]
            flags = purchase_flags(p, fil, bundle_rows[key] > 1)
            if flags:
                p["review"] = flags
            purchases.append(p)
    unused = set(PURCHASE_FIXES) - set(bundle_rows)
    assert not unused, f"corrections that match no log row: {unused}"
    for f in filaments:
        if f["acquisition"] == "purchase" and f["status"] != "wishlist" and not any(p["filamentId"] == f["id"] for p in purchases):
            f["review"] = ["No purchases logged - wishlist entry or missing purchase?"]

    # --- machine investments -----------------------------------------------
    machine = [{
        "date": iso(r["Date"]),
        "store": r["Store"],
        "description": r["Description"],
        "quantity": r["Amount"],
        "unitPrice": r["Price"],
        "total": round(r["Total"], 4),
        "amortizationYears": r["Amortisation (Y)"],
        "kind": machine_kind(r["Description"]),
        "printerId": mk3["id"],
    } for r in table_rows(wb["Machine-Investments"], "MachineCosts") if r["Date"]]

    # --- quotes (one per "Print Cost" sheet) --------------------------------
    quotes = []
    for ws in wb.worksheets:
        if not ws.title.startswith("Print Cost"):
            continue
        m = re.match(r"Print Cost #(\d+)(?: - (.*))?", ws.title)
        items = []
        for r in table_rows(ws, next(iter(ws.tables))):
            if not r["Name"]:
                continue
            items.append({
                "name": r["Name"],
                "printerId": mk3["id"],
                "filaments": [{"filamentId": by_legacy[r["Material"]]["id"], "weightG": r["Weight (g)"]}],
                "labor": yes_no_or_number(r["Account Labor"]),
                "markup": yes_no_or_number(r["Apply Margin"]),
                "runs": r["Amount"],
                "printTimeMin": minutes(r["Print Time"]),
                "_legacyComputed": {
                    "filamentCost": r["Fillament Cost Used"] or 0,
                    "energyWh": r["Power Usage Total (Wh)"],
                    "powerCost": r["Power Cost"],
                    "amortization": r["Amortization"],
                    "labor": r["Labor"] or 0,
                    "costPrice": r["Cost Prize"] or 0,
                    "price": r["Cost"] or 0,
                },
            })
        quotes.append({
            "legacySheet": ws.title,
            "number": int(m.group(1)),
            "title": m.group(2) or f"Calculation #{m.group(1)}",
            "items": items,
            "_legacyComputed": {
                "costPrice": round(sum(i["_legacyComputed"]["costPrice"] for i in items), 4),
                "price": round(sum(i["_legacyComputed"]["price"] for i in items), 4),
            },
        })

    # Sheet #5 carries an ad-hoc "required parts vs. parts per print" planner.
    gf = next(q for q in quotes if q["number"] == 5)
    ws = wb[gf["legacySheet"]]
    plan = []
    for r in ws.iter_rows(min_row=33, max_row=40, values_only=True):
        if r[2]:
            plan.append({"part": r[2], "required": r[3],
                         "perPrint": [v for v in r[4:10]], "planned": r[10], "diff": r[11]})
    gf["partPlanner"] = plan

    def dump(name, data):
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {name}: {len(data) if isinstance(data, list) else 'object'}")

    dump("settings.json", settings)
    dump("material-profiles.json", materials)
    dump("printers.json", printers)
    dump("product-lines.json", product_lines)
    dump("filaments.json", filaments)
    dump("spool-tare-presets.json", TARE_PRESETS)
    dump("filament-purchases.json", purchases)
    dump("machine-investments.json", machine)
    dump("planned-investments.json", [{
        "id": "reserve-core-one-indx",
        "name": "Prusa CORE One + INDX",
        "printerId": "prusa-core-one-indx",
        "targetAmount": 2000,
        # Continuous mode: amount / expected lifetime hours, charged on every print hour
        # (before the purchase as reserve, afterwards as amortization) until recovered.
        # 5 years x ~1,250 h/yr (OctoPrint average) = 6,250 h -> 0.32 EUR/h.
        "mode": "lifetime",
        "usefulLifeYears": 5,
        "expectedHoursPerYear": 1250,
        "targetDate": None,
        "alreadyReserved": 0,
    }])
    dump("quotes.json", quotes)
    write_legacy_fixture(settings, mk3, filaments, quotes)
    write_app_document(settings, materials, printers, product_lines, filaments, purchases, machine, quotes)
    print("purchases flagged for review:", sum(1 for p in purchases if "review" in p))


def write_legacy_fixture(settings, printer, filaments, quotes):
    """Anonymized regression fixture for the TS calc engine (tests/fixtures, committed).

    Contains only numbers and part names - no quote titles (they name customers),
    no purchase history. Every item carries the Excel results to compare against.
    """
    by_id = {f["id"]: f for f in filaments}
    items = []
    for qi, q in enumerate(quotes):
        for it in q["items"]:
            f = by_id[it["filaments"][0]["filamentId"]]
            items.append({
                "quote": qi + 1,
                "name": it["name"],
                "printTimeMin": it["printTimeMin"],
                "runs": it["runs"],
                "weightG": it["filaments"][0]["weightG"],
                "pricePerKg": f["_legacyComputed"]["avgPricePerKg"],
                "power": printer["powerProfiles"].get(f["materialProfileId"]),
                "labor": it["labor"],
                "markup": it["markup"],
                "expected": it["_legacyComputed"],
            })
    fixture = {
        "source": "3DPrintingCalc.xlsx, extracted by tools/extract_excel.py",
        "settings": {
            "energyPricePerKwh": settings["energyPricePerKwh"],
            "purgeWastePerPlateG": settings["purgeWastePerPlateG"],
            "laborPerPlateMin": settings["laborPerPlateMin"],
            "hourlyRate": settings["hourlyRate"],
            "firstHourPhaseMin": settings["firstHourPhaseMin"],
            "defaultMarkup": settings["defaultMarkup"],
            "amortizationPerHour": settings["_legacyComputed"]["amortizationPerHour"],
        },
        "items": items,
    }
    out = ROOT / "tests" / "fixtures" / "legacy-quotes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(items)} items")


def pick(d, *keys):
    return {k: d[k] for k in keys if k in d}


def write_app_document(settings, materials, printers, product_lines, filaments, purchases, machine, quotes):
    """data/seed/document.json in the app's AppDocument format (schema 1), ready for Import.

    Pricing profiles and unset settings are filled with defaults by the app on import.
    """
    plans = json.loads((OUT / "planned-investments.json").read_text(encoding="utf-8"))
    for pr in printers:
        for key in ("purgeWastePerPlateG", "purgePerFilamentChangeG", "firstHourPhaseMin"):
            pr.setdefault(key, None)
    doc = {
        "schemaVersion": 1,
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "settings": {
            "currency": settings["currency"],
            "energyPricePerKwh": settings["energyPricePerKwh"],
            "hourlyRate": settings["hourlyRate"],
            "laborPerPlateMin": settings["laborPerPlateMin"],
            "filamentPriceWindowMonths": 12,
        },
        "materialProfiles": materials,
        "printers": printers,
        "productLines": product_lines,
        "filaments": [pick(f, "id", "productLineId", "color", "finish", "link", "asin", "acquisition", "status")
                      for f in filaments],
        "purchases": [{"id": f"p{i:04d}", **pick(x, "date", "store", "description", "listingTitle", "asin",
                                                 "filamentId", "spoolType", "packageWeightKg", "quantity",
                                                 "totalPrice", "totalKg")}
                      for i, x in enumerate(purchases, 1)],
        "machineCosts": [{"id": f"m{i:03d}", **pick(x, "date", "store", "description", "quantity", "total",
                                                    "amortizationYears", "kind", "printerId")}
                         for i, x in enumerate(machine, 1)],
        "plannedInvestments": plans,
        "customers": [],
        "quotes": [{
            "id": f"q{i:03d}",
            "number": i,
            "title": q["title"],
            "pricingProfileId": "standard" if any(it["markup"]["mode"] != "off" for it in q["items"])
                                else "friends-family",
            "status": "delivered",
            "notes": f"Imported from Excel sheet '{q['legacySheet']}'. Excel totals: cost "
                     f"{q['_legacyComputed']['costPrice']:.2f} EUR, price {q['_legacyComputed']['price']:.2f} EUR.",
            "plates": [{
                "id": f"q{i:03d}-{j}",
                "name": it["name"],
                "printerId": it["printerId"],
                "printTimeMin": it["printTimeMin"],
                "runs": it["runs"],
                "filaments": it["filaments"],
            } for j, it in enumerate(q["items"], 1)],
        } for i, q in enumerate(quotes, 1)],
    }
    out = OUT / "document.json"
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
