# Analysis of the current Excel model (`3DPrintingCalc.xlsx`)

Snapshot taken 2026-10-01. Extracted data lives in [`data/seed/`](../data/seed/), produced by
[`tools/extract_excel.py`](../tools/extract_excel.py). Every seed record keeps the
Excel results under `_legacyComputed`, so the new calc engine can be regression-tested
against the old numbers.

## 1. Workbook structure

| Sheet | Excel table | Purpose | Seed file |
|---|---|---|---|
| `Overview` | – | Global settings (energy price, labor rate, margin, …) | `settings.json` |
| `Material-Types` | `MaterialTypes` | Power profile per material (heat-up, W 1st hour, W after) | `material-profiles.json` (names) + `printers.json` (power figures, now per printer) |
| `Fillament-Types` | `FillamentTypes` | One row per filament (manufacturer + material + color); kg bought, avg €/kg, last buy are array formulas over the log | `filaments.json` |
| `Fillament-Log` | `FillamentLog` | Purchase history (91 rows, 2019-09 → 2026-01, 130.5 kg, ≈ €2,439) | `filament-purchases.json` |
| `Machine-Investments` | `MachineCosts` | Printer + spare parts with amortization years (30 rows, €1,195.93) | `machine-investments.json` |
| `Print Cost #1 … #9` | one table per sheet | One quote/calculation per sheet, up to 20 rows | `quotes.json` |

Sheet notes: `#1` and `#2` are identical (template copies), there are two sheets numbered `#7`, there is no `#8`.
Sheet `#5` has an extra hand-made planner block (required Gridfinity parts vs. parts per print), extracted as `partPlanner`.

## 2. Settings (`Overview`)

| Setting | Value | Used as |
|---|---|---|
| Energy cost | 0.30 €/kWh | power cost |
| Filament usage per job | 10 g | purge/waste added **per print run** |
| Est. runtime / year | 280 d × 14 h = **3,920 h** | divisor for amortization €/h |
| Labor per job | 10 min | labor **per print run** |
| Hourly rate | 15 €/h | labor |
| Warm-up time | 1 h | boundary between "first hour" and "following hours" power |
| Margin | 20 % | markup on cost |
| Amortization / year | 333.96 € | sum over **all** machine items |
| Amortization / h | 0.0852 €/h | 333.96 / 3,920 |

## 3. Calculation per row (one row = one print file, run `Amount` times)

```
weightPerRun   = weight_g + purgeWaste_g                         (10 g)
filamentCost   = weightPerRun × runs / 1000 × avgPricePerKg(filament)
energyPerRun   = heatupMin × heatupW / 60                         [Wh]
               + min(t, 1 h) × W_firstHour
               + max(t − 1 h, 0) × W_following
energyCost     = energyPerRun × runs / 1000 × €/kWh
amortization   = t × runs × amortizationPerHour
labor          = laborPerRun × runs × rate     (rate: "Yes" → 15 €/h, number → override, "No" → 0)
costPrice      = filament + energy + amortization + labor
price          = costPrice × (1 + markup)     (markup: "Yes" → 20 %, number → override, "No" → 0)
```

Worked check, quote #1 "Brio Tracks" (SUNLU PLA+ Burly Wood, 7:23 h, 190 g, 1 run):
filament 200 g × 19.09 €/kg = 3.818 · energy (10 + 85 + 6.38 h × 80 W) = 605.7 Wh → 0.182 ·
machine 7.38 h × 0.0852 = 0.629 · labor 2.50 → **cost 7.13 €**, **price 8.55 €** ✔ matches Excel.

## 4. Findings: errors, weak spots, and missing pieces

### Calculation logic
0. **All-time average price.** Filament €/kg is averaged over purchases going back to 2019, while prices have
   dropped a lot (SUNLU PLA+ Black: 15.44 €/kg all-time vs. 11.25 €/kg in the last 12 months). Quotes overstate
   filament cost by up to ~30 %. The requirements switch to a recent/replacement price (FI-10).
1. **Quotes are not frozen.** Filament €/kg is a live average over the whole purchase log. Every new purchase
   silently changes the totals of all old quotes. Past quotes can't be reproduced.
2. **The amortization base is questionable.**
   - All machine items count forever. The printer (2019, 5 y) and most parts are past their amortization period.
     Counting only active items gives 37 €/yr instead of 334 €/yr.
   - The 3,920 h/yr assumption (280 d × 14 h) is about **3× too high**. OctoPrint (since 2024-08-26) shows
     2,780 h in 2.1 years ≈ **1,325 h/yr**; 2026 so far is 864 h in 9 months ≈ **1,150 h/yr**.
   - Both effects pull in opposite directions. The Excel method with real hours gives 334 € / 1,200 h ≈ 0.28 €/h,
     but that counts items that are long paid off. The actual history: the printer LCD shows **≥ 10,245 h** total
     (426 d 21 h; a lower bound, since a firmware upgrade wiped the counters at some point). Everything ever spent on
     the machine (1,196 €) / 10,245 h ≈ **≤ 0.12 €/h**. So today's 0.085 €/h is somewhat low but in the right
     range. The bigger question going forward is a reserve for the next printer (CORE One + INDX).
   - A more robust model: machine €/h = (purchase price + expected maintenance) / expected lifetime hours, plus a
     separate **wear-parts rate** (nozzles, PTFE, fans, sheets are consumables, not investments). Calibrate it with
     the real hour counter.
3. **"Margin" is really a markup.** +20 % on cost is a 16.7 % margin on price. The app should label it clearly or
   offer both.
4. **Labor is only "10 min per plate".** No design/CAD time, slicing, post-processing per part (support removal,
   sanding, inserts), assembly, packaging, or customer communication.
5. **No failure/reprint allowance.** Failed prints cost real material and time. OctoPrint: 32 of 600 prints
   cancelled (5.3 %), but only 112 of 2,780 h (4.0 %) of print time; in 2026, 2.8 % of prints and 0.65 % of time
   (cancels happen early). Prints that "finish" badly aren't counted, so a 3–5 % default allowance is reasonable.
6. **No other cost types:** hardware (magnets, heat-set inserts, screws), packaging, shipping, extra
   printer/nozzle setup (e.g. hardened nozzle for CF).
7. **No price policy:** no minimum order value, rounding (e.g. to 0.50 €), quantity tiers, rush surcharge, or VAT
   handling (Kleinunternehmer vs. VAT).
8. **One filament per row.** Multi-material/multi-color plates (MMU) can't be modeled. Purge waste is a flat 10 g.
9. **Power profile hangs on the material, not on printer × material.** That's fine with one printer, but it breaks
   with a second one.
10. **Plates and parts are mixed together.** `Amount` = number of print runs. "I need 15× 1x1 bins, 8× 2x2 …" is
    worked out by hand in sheet #5. The app needs plate → parts-per-plate → required parts.

### Excel mechanics
11. Print times ≥ 24 h show up as `1900-01-01` in the totals row (time format overflow).
12. Each quote is a copied sheet with its own table name (`Tabelle578911`, …), which is error-prone to maintain.
13. Filament dropdowns depend on the exact display string (`"SUNLU PLA+ Black"`), so renaming breaks lookups.
14. No customer, date, status, or payment tracking on quotes.

### Filament inventory and data quality
The model is `Manufacturer + MaterialType + Color`, so product lines get squeezed into "material type"
(`PLA+2.0`, `MetaPLA`, `HighSpeedPLA`, `eASA`, `CarbonPETG`). The extraction normalizes this into
**manufacturer → product line → color/finish** and flagged doubtful purchases with a `review` field. All of them were **resolved with the owner on 2026-10-01**
and are recorded as explicit corrections (`PURCHASE_FIXES` in the script). Every corrected purchase carries a
`resolution` note. Totals are unchanged (130.47 kg, 2,439.06 €).

| Issue in Excel | Resolution |
|---|---|
| SUNLU 2020 "PLA 1kg" Grey/Black/White booked as PLA+ | plain **SUNLU PLA** (owner: "just PLA Filament" back then) |
| "SUNLU PLA+ 2.0 Black 4kg" (2025-11-13) booked on PLA+ Black | actually **SUNLU Rapid HS-PLA** Black 4×1 kg (new product line *HS-PLA*, ASIN B0D4LQW7K8) |
| "SUNLU High Speed PLA" (2024-10-31, 2025-09-11) booked as PLA Meta | confirmed **PLA Meta**, sold as "High Speed PLA Meta" (ASINs B0BFGTJG53, B0B1ZX58DR) |
| "GEETECH PLA 1kg Grün" booked on PETG | confirmed **PETG**; the description was wrong |
| PLA+ 2.0 "Colored" 4 kg bundle (2025-02-14) | split into Green / Yellow / Grey / Black, 1 kg each |
| Eryone TPU booked as "Other Other None" | **ERYONE TPU Grey** 0.5 kg (ASIN B07WQ2144X) |
| Refills not distinguished | `spoolType: "refill"` on the two refill purchases |
| Mixed-color packs (2023-09-02, 2024-02-09) | already split per color in Excel, so no change |

Note the trap these cases expose: "High Speed PLA **Meta**" (PLA Meta) and "High Speed PLA" / "Rapid HS-PLA"
(HS-PLA) are different SUNLU products with nearly identical listing titles. That's why the ASIN is stored.

Other normalizations: `Prusa` / `Prusament` / `Prusa / easyABS` → manufacturer *Prusa Research* with product lines
*Prusament PLA/PETG*, *easyABS*. `Fillamentum Extrafill` → *Fillamentum* / *Extrafill ASA*. Typos (`CLear`),
German colors (`Lila`, `Blau`), and finishes (silk, color-shift, carbon) are moved into their own `finish` field.
HATCHBOX Red/Green were gifts (`acquisition: "gift"`). Prusament PLA Jet Black was a wishlist entry (`status: "wishlist"`).

**No stock tracking:** the sheet knows what was *bought*, not what is *left*. There is no consumption, no spool
weights, no low-stock warning.
