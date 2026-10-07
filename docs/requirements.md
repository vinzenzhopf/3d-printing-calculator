# 3D Printing Calculator – Requirements (Draft v0.1)

Status: draft v0.2, all questions answered · 2026-10-01
Background: replaces `3DPrintingCalc.xlsx`. See [excel-analysis.md](excel-analysis.md) for the current model and its gaps.

Priorities: **M** = must (MVP), **S** = should (soon after), **C** = could (later / nice to have).

---

## 1. Goals

1. Quote requested print jobs quickly, reproducibly, and with a deliberate pricing strategy per customer type.
2. Keep a proper filament inventory: product lines with history, spools, remaining stock, real €/kg.
3. Know real machine costs (hours, wear parts, amortization) instead of guessed constants.
4. No spreadsheets: a static web app on GitHub Pages, usable on desktop and phone, no server to maintain.

Non-goals (for now): multi-user/team operation, a customer-facing shop, accounting/tax bookkeeping.

---

## 2. Data storage

GitHub Pages only serves static files, so the data has to live in the browser or in an external service.

| Option | Pros | Cons |
|---|---|---|
| **A. IndexedDB + JSON export/import** | zero setup, offline, fast | data is tied to one browser profile; clearing the cache loses it; manual backups |
| **B. A + File System Access API** ("open/save data file") | data is a real JSON file you own, e.g. in OneDrive/Nextcloud, which gives sync and backup for free; autosave possible | **Chromium only, not available in Firefox** (primary browser), so it's a bonus at most |
| **C. Sync to a private GitHub repo / Gist** via GitHub API + fine-grained token | versioned history (every save = commit), multi-device, fits "GitHub Pages" | token lives in the browser (scope it to one private repo); conflict handling needed |
| **D. Hosted backend** (Supabase / Firebase / PocketBase self-hosted) | real DB, auth, multi-device, concurrent use | external service/account, more moving parts; customer data at a third party (GDPR) |

**Recommendation (Firefox is the primary browser):** **A** for the MVP (IndexedDB as working store,
`navigator.storage.persist()` (Firefox asks once), one-click JSON export/import). Then **C** as the real sync and backup
solution: a private GitHub data repo works in every browser, gives version history, and syncs PC ↔ phone. Put
storage behind a small sync-adapter interface so a WebDAV/Nextcloud adapter or **B** (for Chromium users) can be added
later. Consider **D** only if multiple people need to use it.

Requirements:
- **ST-1 (M)** All data is stored locally in IndexedDB and survives reloads. Request persistent storage.
- **ST-2 (M)** Full export/import as one versioned JSON document (`schemaVersion`), with migrations on import.
- **ST-3 (M)** Import the Excel seed data (`data/seed/*.json`) once.
- **ST-4 (C)** Link a data file on disk (File System Access API, Chromium only) with autosave. Firefox keeps export/import.
- **ST-5 (S)** Backup reminder when the last export is older than N days.
- **ST-6 (S)** Sync to a private GitHub repo with a fine-grained PAT (contents read/write on that one repo only).
  Manual "sync now" plus optional sync on change. Detect conflicts via the file SHA and offer *keep mine / take theirs*.
  Each sync is a commit, which gives history and restore.
- **ST-7 (M)** Never commit real data to the public app repo (GitHub Pages on a free plan needs a public repo). `data/` is git-ignored.

---

## 3. Domain model (overview)

```
Settings (business mode, VAT) ─ PricingProfile[]
Printer(status) ─ PrinterMaterialProfile (power) ─ UsageSnapshot[]   MachineCost (investment | wear | maintenance)
Manufacturer ─ ProductLine(aliases, successor) ─ Filament(color) ─ Spool ← PurchaseLine ← Purchase(order)
SpoolTarePreset                                   Spool ─ StockMovement[] (purchase, print, weigh-in, adjust, discard)
Customer(group, contact, default profile) ─ Quote ─ Plate[] ─ PlatePart[] / PlateFilament[]
                 └ Extra[] (hardware, design time, packaging, shipping)
Quote → PrintJob (actual runs, actual time/weight, failures) → stock deduction
```

---

## 4. Filament inventory

### 4.1 Catalog
- **FI-1 (M)** Hierarchy **Manufacturer → Product line → Filament (color variant)**.
  - Product line: name, base material (PLA, PETG, ASA, ABS, TPU, …), material profile, diameter, density,
    nozzle/bed temperature range, max speed (vendor claim), default spool type, notes.
  - Filament: color name, color swatch (hex), finish (matte, silk, color-shift, carbon, pearl, …), SKU/**ASIN**,
    shop links. The ASIN is the most stable identity for Amazon listings whose titles keep changing.
- **FI-2 (M)** **Product line history** (the SUNLU problem). A product line can have:
  - *aliases* (listing names like "High Speed PLA", "PLA Meta", "PLA+ 2.0"),
  - *predecessor/successor* links with a date ("PLA+ → PLA+ 2.0 from 2024-xx"),
  - *available from/to* dates and free-text notes ("old PLA was sold as PLA, effectively PLA+").
  Purchases keep the **original listing title** and point to the product line that was valid at purchase time.
  Reports can group by "line family". On entry, the listing title is matched against aliases to suggest the line.
  Seeded SUNLU knowledge (vendor/retailer pages, 2026-10): see `data/seed/product-lines.json`:

  | SUNLU line | What it is (vendor claims, which are not consistent across pages) | Aliases seen |
  |---|---|---|
  | PLA | basic PLA, 200–240 °C, ≤ ~200 mm/s | "SUNLU PLA" |
  | PLA+ | toughened PLA, 205–245 °C | "PLA Plus" |
  | PLA+ 2.0 | **successor of PLA+** ("upgraded evolution"), 195–230 °C, rated for high speed | "PLA Plus 2.0", "High Speed PLA+2.0" *(likely same product, verify)* |
  | PLA Meta | high-flow, slightly matte, 185–225 °C, ≤ ~250 mm/s | "Meta PLA", "High Speed PLA Meta" |
  | HS-PLA / "Rapid" | separate high-speed line (≤ 500–600 mm/s claimed) | "High Speed PLA", "Rapid HS-PLA" (Black 4×1 kg, 2025-11) |
- **FI-2b (M)** **Catalog cleanup**, chosen per case:
  - *Deprecate* (renamed or replaced products): a filament or product line is marked old. Its history (purchases,
    spools, prints, quotes, statistics) stays; it's hidden from filament pickers, the color overview and the to-buy
    list, and shown greyed in the catalog behind "Show deprecated". Warns while spools are sealed/open. An optional
    successor link lets the new entry's price fall back to the predecessor's purchases.
  - *Merge* (duplicates, typos like "Grey"/"Grau"): all references (purchases, spools, print jobs, quote plates) move
    to the kept entry, which takes over fields it lacks (manual price, low-stock threshold, …); the duplicate is deleted.
    Frozen quote snapshots stay as they are and resolve the old id via `mergedIds`. Merging product lines moves their
    colors and, if confirmed, merges colors that exist in both. A preview shows what moves before anything changes.
- **FI-3a (S)** Optional import of manufacturer/product-line data (density, spool weight) from the community
  [SpoolmanDB](https://github.com/Donkie/SpoolmanDB) JSON.
- **FI-3 (S)** Search/filter by manufacturer, material, color, finish, in-stock status. Show filaments as color swatches.

### 4.2 Purchases and stock
- **FI-4 (M)** A purchase (order) has date, store, order no., shipping cost, and **line items**. A bundle
  ("4 kg, Green/Yellow/Grey/Black") is entered as one order with several lines. Price is split evenly or manually,
  and shipping is allocated proportionally.
- **FI-4a (M)** Acquisition type per purchase/spool: *purchase*, *gift*, *sample*. Gifts and samples cost
  0 € in stock value and are **excluded from price averages**. When they're used in a quote, the price comes
  from the price list or the fallback chain (FI-10), because what matters is the replacement cost, not what you paid.
  Seed: HATCHBOX PLA Red/Green are gifts.
- **FI-5 (M)** Each purchase line creates **spools** (net weight, spool type: plastic / cardboard / refill, tare
  weight). Spool status: sealed → open → empty → discarded. Optional location and opened/dried date.
- **FI-6 (M)** **Stock ledger per spool**: every change is a movement (purchase +, print −, weigh-in correction ±,
  manual adjust, discard) with date and reason. Remaining stock = sum of movements.
  - **Go-live starts at 0 / "unknown":** imported historic purchases don't create stock. Spools are added
    when they're found on the shelf, or stock is set by a weigh-in. Unweighed spools show "unknown".
  - **Weigh-in:** pick a spool (or a filament plus "new spool"), enter the gross weight from the kitchen scale.
    The app subtracts the tare and books the difference as a correction movement. Phone-friendly.
- **FI-6a (M)** **Empty spools**: a list of empty-spool kinds (name, brand, weight), e.g. "SUNLU plastic +
  cardboard" or "TPU 500 g spool". Every spool points to one; a spool's own measured tare overrides it. New spools
  suggest the kind used last for the same product line, then the same brand, then the brand's kind, then a generic
  one. Refills are switched by hand when mounted. "Spool is empty → weigh it" updates the kind's weight. Seeded from
  SpoolmanDB (SUNLU plastic spool 130 g) and rough generic values.
- **FI-6b (S)** Length ↔ weight conversion via density and diameter (slicer meters, printer counters).
- **FI-7 (S)** Low-stock threshold per filament with a "to buy" list (including the last shop link and price).
- **FI-8 (S)** Price history per filament/product line (chart) and average/last/min price.
- **FI-10 (M)** **Current filament price (€/kg) for quoting.** Quotes use what it costs to *re-buy* the filament
  (replacement cost), not the all-time average. The method is a global setting that a pricing profile can override:
  - **Recent lots covering the need (default):** take purchases newest-first until they cover at least the
    quantity the quote needs (and at least the purchases of the last *N* months, default 12), and use their
    kg-weighted average. If the last 12 months cover the need, this is the 12-month average. For rarely bought
    colors the window stretches back automatically until enough kg are covered; the last lot counts only
    partially. Not enough ever bought → all-time average + warning (and a stock warning).
    *Example:* 1.5 kg SUNLU PLA+ Silver → 1 kg @ 17.99 (2024-07) + 0.5 kg @ 23.99 (2023-04) = 19.99 €/kg.
    1.7 kg PLA+ Black → covered by the last 12 months → 11.25 €/kg.
  - **Recent average:** kg-weighted average of purchases in the last *N* months, without stretching.
  - **Exponentially weighted:** all purchases, weight halves every *H* months. Smooth, but slow for rarely bought colors.
  - **Last purchase**, **all-time average** (legacy, kept for the Excel regression tests), **FIFO** (actual cost of the
    spools used, once stock tracking runs), **manual current price** (a shop price entered by hand, with a date).
  - **Resolution order:** manual price for the filament (FI-11) → manual price for the product line + pack-size class
    → computed method above → product line computed (no purchases of this color at all, e.g. gifts) → *stale*
    warning. A profile can force "computed only".
  - **Pack size matters:** SUNLU 4 kg bundles cost ~10.7 €/kg, 1 kg spools 15–17 €/kg. Purchases carry a
    pack-size class (1 kg / multi-pack / bulk), and pooling across a product line only mixes the same class.
  - The UI always shows where a price comes from ("PLA+ line, 3 purchases, last 12 months: 11.25 €/kg") and
    warns when the price is stale. Finalized quotes freeze the value used (QC-5).

  Effect on the current data (2026-10-01):

  | Filament | all-time avg (Excel) | last 12 months | last purchase |
  |---|---|---|---|
  | SUNLU PLA+ Black | 15.44 | **11.25** | 11.25 |
  | SUNLU PLA+ White | 14.46 | **10.71** | 10.75 |
  | SUNLU PLA+ Grey | 20.28 | **15.18** | 15.18 |
  | SUNLU PLA+ Silver | 19.29 | – → line fallback | 17.99 (2024, stale) |
  | Prusament PETG Jet Black | 28.18 | – → line fallback | 28.49 (2024, stale) |

  For SUNLU black/white, the Excel method overstates filament cost by ~30 %.
- **FI-11 (M)** **Price list page.** Most calculators simply use a manually maintained price per filament, and that's
  the most predictable option for rarely bought colors. One table per product line (rows: pack-size class, optionally
  colors with their own price) with these columns:
  - computed price from FI-10, and how it was computed
  - last purchase (date, €/kg)
  - **manual price** + "as of" date
  - deviation in % and an age warning (e.g. > 12 months)

  Actions: "accept computed price" (single or bulk) and "clear manual price". Optionally paste a current shop price
  from a link. It's one editable table, no extra workflow. It also gives the planned printer what-ifs a stable
  basis.
- **FI-9 (M)** A review queue for imported records with `review` flags (see analysis). Allow re-assigning a purchase line
  to another filament and merging duplicate filaments.

---

## 5. Machines and costs

Fleet: Prusa i3 MK3S+ (*active*), Anycubic Photon resin (*retired*), Prusa CORE One + **INDX** toolchanger (*planned*).
**Multiple printers and multi-filament plates are part of the MVP.**

- **MC-1 (M)** **Printer profiles** (any number, status *planned / active / retired*; planned printers can be
  used in what-if quotes, e.g. "what would this cost on the CORE One"): name, model, technology (FDM; resin reserved,
  see MC-6), purchase price and date, expected lifetime hours, build volume, nozzle size(s).
  - **Multi-material setup:** number of toolheads/slots and type (*single*, *MMU/AMS-style single nozzle*,
    *toolchanger*), default purge per filament change (single-nozzle MMU: grams per change; INDX: ~0.015 g per
    tool change according to vendor info, so purge is close to irrelevant there),
    default base waste per plate (priming/skirt; 10 g on the MK3S+ today).
  - **Power profile per printer × material profile** (heat-up time/W, first-phase W, following W, first-phase
    length). New printers can copy from an existing printer and adjust.
  - Default printer per quote; every plate can override it.
- **MC-2 (M)** Machine cost entries typed as **investment** (amortized over years or lifetime hours, with a
  computed **amortization end date / end hours**, after which it costs 0 €/h; a printer can also be marked
  *paid off* manually), **wear part** (nozzle, PTFE, sheet, fan), or **maintenance**. Each entry belongs to one
  printer or is **shared** (e.g. OctoPrint Pi, dryer, tools) and allocated by print hours. Shipping is attached to an order, not a standalone "item".
- **MC-3 (M)** Machine €/h **per printer** is derived and transparent. Default model:
  `remaining investment / remaining hours (0 if paid off) + wear-part rate + share of shared costs + replacement reserve (MC-8)`.
  The wear-part rate is historic wear-part spend / print hours (MK3S+: 286 € / 10,245 h ≈ **0.03 €/h**). A per-year model
  (`active investments/yr / hours/yr`) is available as an alternative. The UI shows each component and which hours
  basis it uses: assumed, OctoPrint-imported, or logged jobs.
- **MC-4 (M)** Print hour counter per printer: manual entries/imports (e.g. an OctoPrint statistics snapshot: prints,
  finished, hours) + logged jobs (JR-2). This feeds the machine rate (MC-3) and the measured failure rate (PP-1). Seed: MK3S+
  ≈ 2,780 h since 2024-08-26 (≈ 1,150–1,325 h/yr), with lifetime hours before that estimated.
- **MC-8 (M)** **Replacement reserve for a future investment** (cost accounting: *kalkulatorische Abschreibung
  auf den Wiederbeschaffungswert* / sinking fund; the German tax counterpart is the *Investitionsabzugsbetrag*,
  §7g EStG, which only matters with a real business). A planned investment has a name, target amount, linked
  (planned) printer, and a mode:
  - **Lifetime (default):** `amount / (useful life years × expected hours/yr)`, charged on **every** print hour, own
    prints included (they wear the printer too, even if the *Own use* profile doesn't bill it). It runs before the
    purchase as a reserve and afterwards as amortization, until the amount is recovered. One rate, no jump on purchase day.
  - **Target date:** `(target − already reserved) / expected print hours until the date`.
  - **Fixed €/h.**
  - The reserve is charged per print hour on the printers it's assigned to (default: all active printers).
    Progress shows two numbers: **billed** (sum of reserve shares in accepted quotes, i.e. money actually
    collected) and **worn** (all print hours × full rate, i.e. what the printer "used up"). From both it projects
    the date when 2,000 € are collected (e.g. "640 € of 2,000 € billed, at this pace ≈ 2029-03").
  - **On purchase**, the accumulated reserve is offset against the real price: the new printer only amortizes the
    remainder, so customers don't pay for it twice.
  - Each pricing profile sets its own **reserve share** in % of the rate (0 % = not charged, 100 % = full rate,
    > 100 % allowed, e.g. Rush), or a fixed €/h override. Lower shares only slow down the billed progress.
    The rate itself stays the same for everyone.
  - Seed: "Prusa CORE One + INDX", 2,000 €, **5 years** × 1,250 h/yr = 6,250 h → **0.32 €/h**
    (a 7.4 h print: +2.36 €). 5 years matches common useful-life assumptions for workshop machines and
    is conservative next to the MK3S+'s real life (7 years, > 10,000 h, still running). Other lives:
    4 yrs → 0.40 €/h, 7 yrs → 0.23 €/h, 10,000 h → 0.20 €/h.
- **MC-5 (S)** Maintenance reminders per printer (e.g. lubricate every 200 h, nozzle every 500 h).
- **MC-6 (C)** Resin printers (ml instead of g, resin €/l, IPA/FEP/screen wear, washing/curing). Only the
  `technology` field is reserved in the MVP so the model doesn't need breaking changes later.
- **MC-7 (C)** OctoPrint/PrusaLink/Prusa Connect API import of jobs and hours (needs CORS/LAN access, so it
  may require a small proxy; to be evaluated).

---

## 6. Quote calculation

### 6.1 Structure
- **QC-1 (M)** A quote has number, title, customer (optional; the customer's default profile and discount are
  pre-filled), date, pricing profile, status, notes.
- **QC-2 (M)** A quote contains **plates** (one slicer file/print run). Each plate has printer, print time,
  **number of runs**, **parts per plate** (part name × quantity), and a **list of filaments** (filament + grams in
  the part). Multi-material waste per plate is either
  - the slicer-reported total (wipe tower + flush, preferred), or
  - estimated as `filament changes × printer purge per change`,
  and is allocated to the filaments proportionally (or to a selected "purge filament").
  Single-filament plates stay a one-line input.
- **QC-3 (S)** **Part planner:** enter required parts (e.g. 15× 1x1 bin, 8× 2x2). The app shows coverage by
  plates × runs (missing/surplus), replacing the hand-made table in sheet #5.
- **QC-4 (M)** Extras per quote: design/CAD time, post-processing time per part, hardware items (magnets, inserts,
  screws) with unit cost, packaging, shipping, flat fees.
- **QC-5 (M)** **Freeze on finalize:** when a quote is marked *sent/accepted*, all inputs (filament €/kg, energy price, machine rate, profile) are snapshotted. Drafts keep using live values, with a "refresh prices" action and a diff.

### 6.2 Cost components (per plate run, then summed)
| Component | Formula |
|---|---|
| Filament | Σ per filament (grams + base waste + purge share) × €/kg. €/kg from FI-10 (default: recent 12-month average with fallback chain) |
| Energy | heat-up Wh + first-phase W × min(t, phase) + following W × rest × €/kWh (printer × material profile; for mixed plates the profile with the highest power wins) |
| Machine | print hours × machine €/h **of the plate's printer** (investment + wear + shared) |
| Labor | setup per plate run + post-processing per part + design time per quote, × hourly rate |
| Failure allowance | material + energy + machine × failure rate (per profile, optionally per material, e.g. TPU higher) |
| Extras | hardware, packaging, shipping, fees |

- **QC-6 (M)** Show a **cost breakdown** (stacked bar + table) per plate and for the whole quote, plus **cost per part**.
- **QC-7 (S)** **What-if:** switch profile/filament/printer and compare prices side by side.
- **QC-8 (C)** Import print time and grams from slicer output (G-code/3MF comments from PrusaSlicer/OrcaSlicer/Bambu
  Studio: `estimated printing time`, `filament used [g]`) via file drop. The file is parsed locally and not uploaded.

### 6.3 Pricing profiles (the "margin configurations")
- **PP-1 (M)** Pricing profiles are named, reusable parameter sets, selectable per quote and overridable per quote.
  Parameters:
  - included components (filament / energy / machine / labor / extras) as toggles,
  - filament price method override (FI-10), e.g. *all-time average* or a shorter window,
  - hourly rate (override), labor minutes per plate, post-processing default,
  - failure allowance % (default from the measured rate; MK3S+ OctoPrint: 4 % of print time cancelled overall,
    0.65 % in 2026),
  - **markup %** *or* **target margin %** (both shown: 20 % markup = 16.7 % margin), with the option to apply it only to
    some components (e.g. not to pass-through hardware/shipping),
  - minimum price per quote, rounding (e.g. up to 0.50 €/1 €), quantity tiers (e.g. −10 % from 10 parts),
  - surcharges (rush/priority ×1.25, special material),
  - VAT is handled through global settings (see PP-4).
- **PP-2 (M)** Ship with these starting profiles (editable):

| Profile | Components | Reserve share (MC-8) | Failure | Markup | Min / rounding | Replaces in Excel |
|---|---|---|---|---|---|---|
| **Own use** | filament + energy | 0 % | 0 % | 0 % | – | – |
| **Friends & family** | filament + energy + machine (wear) | 0 % | 5 % | 0 % | round 0.50 | Labor *No*, Margin *No* |
| **Standard** | all incl. labor | 100 % | 5 % | 20 % | min 5 €, round 0.50 | Labor *Yes*, Margin *Yes* |
| **Commercial** | all + design time + post-processing | 100 % | 10 % | 35–50 % | min 10–15 €, round 1 €, VAT mode | – |
| **Rush** | like Standard | 100 % | 5 % | 20 % ×1.25 | min 10 € | – |

All values are editable. The reserve share can be any %, e.g. a "Friends & family+" profile with 50 %.

- **PP-4 (M)** **Global business settings** (all off by default, since this is a private/family use case today):
  - *Business mode* toggle: shows business name, address and quote/invoice numbering, and hides "family" wording.
  - *VAT* toggle: off (default; with an optional small-business note text such as §19 UStG on quotes) or on with rate
    (19 %) and prices shown net or gross. *(Configuration only, not tax advice.)*
- **PP-3 (S)** Margin sanity indicators: effective €/print-hour, margin %, and a warning when price < full cost
  (e.g. friends profile on a 40 h job).

### 6.4 Output
- **QO-1 (M)** Printable quote/offer view (browser print → PDF): customer, parts list, price, validity date, optional
  breakdown. Internal cost details can be hidden.
- **QO-2 (S)** Copy-to-clipboard summary for messenger/e-mail.

---

## 7. Jobs, customers, reporting

- **JR-1 (S)** Quote status: draft → sent → accepted → printing → delivered → paid (+ rejected).
- **JR-2 (S)** Print log per plate run: actual time, actual grams, spool used, success/failure. This drives stock
  deduction (FI-6), the printer hour counter (MC-4), and the measured failure rate.
- **JR-3 (M)** **Customers:** name, short tag (e.g. initials), group (family, friends,
  colleagues, business; free tags), contact (e-mail, phone, messenger handle), optional address (shipping/invoice),
  **default pricing profile**, personal discount %, payment preference (cash, PayPal, transfer, "on the house"),
  notes and preferences (favorite colors/materials). The customer page shows quote history, total revenue, and open
  payments. All fields except name are optional. Data only lives locally or in the user's private sync repo.
- **JR-4 (C)** Dashboard: revenue vs. cost per month, filament usage by material/manufacturer, print hours, top
  customers, inventory value.

---

## 8. Non-functional

- **NF-1 (M)** Static SPA on GitHub Pages, deployed via GitHub Actions. Works offline (PWA, installable on phone).
- **NF-2 (M)** Responsive: desktop for data entry, phone for quick quote checks and spool weighing.
- **NF-3 (M)** The calc engine is a pure, unit-tested module. Regression tests reproduce the Excel results from
  `data/seed/quotes.json` (`_legacyComputed`) when run with a "legacy" profile.
- **NF-4 (M)** Units and locale: EUR, grams/kg, hours:minutes input (`7:23`, `7h23m`, and > 24 h), German number
  formatting optional. UI language English (DE optional later).
- **NF-5 (S)** Schema-versioned data with migrations. IDs are stable UUIDs or slugs, never display names (avoid the Excel VLOOKUP-by-name trap).
- **NF-6 (M)** Stack (decided): Lit + TypeScript + Vite + Bootstrap CSS, IndexedDB via `idb`, pluggable storage
  adapters, no backend. See [implementation-plan.md](implementation-plan.md).

---

## 9. MVP cut

1. Data layer (ST-1/2/3/7) + seed import + review queue (FI-9) + global settings incl. business/VAT toggles (PP-4)
2. Filament catalog with product lines and aliases (FI-1/2), purchases (FI-4), current-price methods (FI-10)
3. Multiple printer profiles with per-printer power profiles, multi-material settings, machine costs, hour counter,
   and transparent €/h (MC-1/2/3/4)
4. Quotes with plates (per-plate printer, multi-filament + purge), extras, pricing profiles, breakdown, freeze,
   print view (QC-1/2/4/5/6, PP-1/2, QO-1)
5. Customers (JR-3)
6. Spools, stock ledger starting at 0, weigh-in with empty-spool kinds (FI-5/6/6a)
7. Legacy regression tests (NF-3)

Then: GitHub sync (ST-6), print log with stock deduction (JR-2), low stock (FI-7), part planner (QC-3), slicer import (QC-8).

---

## 10. Decisions and open questions

Decided (2026-10-01):
- *Printers:* MK3S+ active, Anycubic Photon retired (resin later, MC-6), CORE One + INDX planned → multi-printer +
  multi-filament in the MVP.
- *Print hours:* OctoPrint since 2024-08-26: 600 prints / 2,780 h (≈ 1,150–1,325 h/yr). Printer LCD total
  426 d 21 h = 10,245 h / 11,561 m filament, which is only a **lower bound** (counters were wiped by a firmware upgrade).
- *VAT/business:* private and family use, no business today. Business mode and VAT are toggles, both off (PP-4).
- *Customers:* full customer records with defaults (JR-3, MVP).
- *Browser:* Firefox first → IndexedDB + export/import, then private GitHub repo sync. File System Access is not used.
- *Data cleanup:* all flagged purchases resolved (see excel-analysis.md). SUNLU now has 5 lines: PLA, PLA+,
  PLA+ 2.0, PLA Meta, HS-PLA.
- *Stock:* starts at 0/unknown, corrected by weigh-ins with empty-spool kinds (FI-6/6a).
- *Machine cost:* MK3S+ is paid off (wear parts only, ≈ 0.03 €/h). CORE One + INDX is budgeted at 2,000 € (tool count
  open) and pre-financed through a replacement reserve (MC-8).

- *Reserve:* CORE One + INDX 2,000 € over 5 years / 6,250 h = 0.32 €/h, lifetime mode (MC-8).
- *Filament price:* recent lots covering the need (FI-10) + manual price list (FI-11). HATCHBOX spools were gifts,
  Prusament PLA Jet Black is a wishlist entry (filament status *owned / wishlist*).
- *Reserve per profile:* share in % per pricing profile: Own use 0 %, Friends & family 0 %, Standard / Commercial /
  Rush 100 % (PP-2, MC-8).

No open questions left. Requirements are ready for implementation planning.

