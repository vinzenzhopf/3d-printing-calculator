# Implementation Plan

Status: v0.1 · 2026-10-01 · based on [requirements.md](requirements.md) v0.2

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript 7** (strict) | Types for a domain with many numbers and units. TS 7 is the fast native compiler |
| UI components | **Lit 3** | Class components with decorators (Angular-like), ~6 KB, web standards, no framework lock-in |
| Styling | **Bootstrap 5.3 CSS** (no Bootstrap JS) | Familiar, covers forms/tables/cards. Dialogs use native `<dialog>` |
| Build / dev server | **Vite 8** | Zero-config TS, instant reload, small static output |
| Tests | **Vitest 5** (+ `fake-indexeddb`) | Same transform pipeline as the app, fast |
| Browser storage | **IndexedDB** via `idb` (~1 KB) | Persistent, larger than localStorage, transactional |
| Hosting | **GitHub Pages** via GitHub Actions | Free, static. Also runs from any web server (VPS) |

Notes:
- **Decorators** run in TypeScript's *legacy* mode (`experimentalDecorators: true`, `useDefineForClassFields: false`).
  Vite 8's transformer passes TC39 standard decorators through untransformed, and browsers can't run them yet.
  Lit supports both modes. We can switch once browsers support decorators natively.
- **Light DOM:** components render into the page (`createRenderRoot() { return this; }`) instead of an
  isolated shadow DOM, so global Bootstrap styles apply.
- **No runtime CDN:** all dependencies are bundled. The Content-Security-Policy in `index.html` allows only the app's own
  origin and `api.github.com`. That protects sync tokens and keeps the app working offline.

Measured on the skeleton: the whole JS is ~10 KB gzipped, plus ~31 KB gzipped of Bootstrap CSS. CSS size can be
reduced later by importing only the Bootstrap parts in use.

## 2. Architecture

```
┌──────────────────────── ui/ (Lit components, pages, router) ────────────────────────┐
│  read state from AppStore, call store.update(...), call core/ for derived numbers   │
└───────────────┬────────────────────────────────────────────────┬────────────────────┘
                │                                                │
        state/AppStore                                     core/ (pure TS, no DOM)
   one AppDocument in memory,                   model · document defaults · duration
   change events, save via adapter              calc/plate-cost · calc/filament-price
                │                               calc/pricing · (later) policy, migrations
                ▼
   storage/StorageAdapter ── BrowserAdapter (IndexedDB, always on)
                          └─ GitHubAdapter, WebDAVAdapter, ... (sync, later)
```

Rules:
1. `core/` has **no** imports from `ui/`, `state/`, or browser APIs. Everything in it is unit-testable in Node.
2. Components contain no business math. They call `core/` functions and render the results.
3. All writes go through `store.update(doc => …)`. One code path means one place for persistence, `updatedAt`, and
   later undo/sync.
4. Entities reference each other by **id** (`crypto.randomUUID()` for new entities, slugs for seeded ones), never by
   display name.

## 3. Project structure

```
index.html                      CSP, <app-shell>
src/
  main.ts                       creates store + adapter, then loads the UI
  styles.css
  core/
    model.ts                    AppDocument and all entity types (schemaVersion 1)
    document.ts                 empty document + default pricing profiles (PP-2)
    migrations.ts               loadDocument: version check, migration chain, defaults, reference warnings
    transfer.ts                 export/import (JSON), summaries
    duration.ts                 "7:23" / "7h23m" / "31:05" parsing and formatting
    calc/plate-cost.ts          cost formula per plate (filament, energy, machine, labor)
    calc/filament-price.ts      "recent lots covering the need" (FI-10)
    calc/pricing.ts             markup / margin
    calc/machine-rate.ts        machine €/h per printer: investment, wear, shared, reserve (MC-3, MC-8)
    calc/price-resolution.ts    current €/kg: manual → own purchases → line purchases (FI-10, FI-11)
    orders.ts                   split a (bundle) order into purchases (FI-4)
    calc/quote.ts               quote pricing: policy layer + order of operations (section 5)
    quotes.ts                   numbering, creation with customer defaults, status + freezing (QC-5)
  state/
    app-store.ts                AppStore + StoreController (Lit reactive controller)
    store-instance.ts
  storage/
    adapter.ts                  StorageAdapter contract
    browser-adapter.ts          IndexedDB
    memory-adapter.ts           tests / reference
  ui/
    app-shell.ts                navbar, status badge, page switch
    router.ts                   hash routing (#/quotes ...), so no 404 tricks on GitHub Pages
    fields.ts                   Bootstrap form-field template helpers
    pages/dashboard-page.ts
    pages/settings-page.ts      settings, business/VAT, export/import/reset
    pages/printers-page.ts      printers, power tables, hour counters, machine costs, reserves
    pages/filaments-page.ts     tabs: catalog, purchases, price list (pages/filaments/*)
    pages/quotes-page.ts        quote list; quotes/quote-editor.ts, quotes/quote-offer.ts (print view)
    pages/customers-page.ts     customers with defaults, quote history, revenue
    pricing-profiles-editor.ts  pricing profiles (on the settings page)
tests/
  legacy-replay.test.ts         all 30 Excel rows through the new engine (6 decimals)
  filament-price.test.ts
  duration.test.ts
  storage-adapters.test.ts      one contract suite, run against every adapter
  fixtures/legacy-quotes.json   anonymized (numbers + part names only, no customers)
tools/extract_excel.py          Excel → data/seed/*.json (private) + test fixture
.github/workflows/pages.yml     test → build → deploy on push to main
```

## 4. Data document

- One JSON document (`AppDocument`, see `src/core/model.ts`) holds everything. It's ~134 KB for 7 years of data.
- The **same format** is used for IndexedDB, export/import files, and remote sync.
- `schemaVersion` + a migration chain (`migrations.ts`, M1): every load runs `migrate(doc)` up to the current version.
  Import refuses documents from a newer app version.
- Money is stored as plain numbers (EUR) and only rounded for display and in final pricing (profile rounding).
  Dates are ISO `YYYY-MM-DD`, timestamps ISO 8601.
- Seed data: `tools/extract_excel.py` also writes `data/seed/document.json` in AppDocument format. Importing it
  (Settings → Import data) is the go-live step for the original Excel data. Imported Excel quotes keep their Excel
  totals in the notes and get the *Standard* or *Friends & family* profile depending on whether a markup was applied.

## 5. Calculation engine

Two layers:

1. **Formula** (`computePlateCost`, done): pure math per plate, given a `CostContext`.
   - Filament: (model g + waste share) × runs × €/kg. Waste = printer per-run waste + plate purge, split by weight.
   - Energy: heat-up + first phase + following hours. On mixed plates, the most power-hungry material profile is used.
   - Machine: hours × runs × machine €/h. Labor: minutes per run × runs × rate.
   - Returns a breakdown plus warnings (e.g. missing power profile) instead of throwing.
2. **Policy** (`policy.ts`, M2/M3): builds the `CostContext` from the document and the pricing profile.
   - €/kg: manual price (filament → product line) → `recentLotsPrice` → product-line fallback (FI-10/FI-11).
   - Machine €/h: remaining investment + wear-part rate + shared costs + reserve rate × profile reserve share
     (MC-3/MC-8).
   - Labor/markup/failure/min price/rounding/VAT from the profile and settings.

Quote total, in this order (fixed and documented, so numbers are reproducible):
`Σ plate costs → + extras → × (1 + failure allowance) on material/energy/machine → × (1 + markup) on
marked-up components → − customer discount → max(minimum price) → round up to profile step → VAT (if enabled)`.

Finalized quotes store a **snapshot** of every resolved input (QC-5). Re-opening one never recalculates silently.

Regression: `tests/legacy-replay.test.ts` reproduces all 30 Excel rows exactly through the formula layer, and
`tests/quote.test.ts` reproduces them through the full quote pipeline (legacy settings expressed as app data) (filament, energy, amortization, labor,
cost, price). Any engine change that breaks it is either a bug or a deliberate, documented model change.

## 6. Storage and sync

- Contract (`StorageAdapter`): `load()` returns document + opaque version. `save(doc, expectedVersion)` either succeeds with
  a new version or returns the newer stored document as a **conflict**. The same test suite runs against every adapter.
- `BrowserAdapter` is the always-on working copy: every change is saved immediately, inside one IndexedDB
  transaction (safe across tabs). `navigator.storage.persist()` is requested at start.
- **Sync (M5)**: a `SyncService` pairs the browser copy with one optional remote adapter:
  - pull on start and on focus; push debounced (~30 s idle), on page hide, and via "Sync now"
  - conflict → dialog: keep mine / take theirs / view diff (per collection)
  - settings store adapter config. Tokens are optional to remember and never leave the device except to the provider.
- `GitHubAdapter`: Contents API on a user-owned private repo (`GET/PUT /repos/{o}/{r}/contents/{path}`, version = blob
  `sha`, fine-grained token with *Contents: read & write* on that repo only).

## 7. Testing and quality

- `npm test`: Vitest unit tests for `core/` and the storage contract. Every calculation rule gets a test with the numbers
  from the requirements.
- `npm run build`: `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) + production bundle. CI runs both on every
  push and pull request.
- UI: manual testing in the browser per milestone. Browser end-to-end tests (Playwright) only if the UI gets complex enough to justify them.

## 8. Milestones

| # | Scope (requirement ids) | Done when |
|---|---|---|
| **M0** ✔ | Skeleton: stack, store, browser adapter, router, dashboard, engine formula, FI-10 function, Excel replay, CI workflow | `npm test` 57/57, build + browser smoke test OK |
| **M1** ✔ | Data foundation: full schema + migrations, export/import JSON, seed `document.json` import, settings page incl. business/VAT toggles (ST-1/2/3, PP-4) | own data imported. Export → import round-trips losslessly |
| **M2** ✔ | Catalog: printers + power profiles + machine costs + reserve (MC-1/2/3/4/8), product lines with aliases, filaments, purchases with bundles/gifts (FI-1/2/4/4a), **price list page** (FI-10/11) | machine €/h and filament €/kg shown with their derivation, matching the requirements' examples |
| **M3** ✔ | Quotes: plates (multi-printer, multi-filament, purge), extras, pricing profiles editor, policy layer, breakdown, freeze/snapshot, print view, customers (QC-1/2/4/5/6, PP-1/2/3, QO-1, JR-3) | an Excel quote re-entered by hand gives the same result with a legacy profile, and a plausible one with *Standard* |
| **M4** | Stock: spools, ledger, weigh-in with tare presets, start at 0 (FI-5/6/6a/6b) | weigh-in on the phone works. Ledger sums are correct |
| **M5** | Sync + offline: SyncService, GitHubAdapter, conflict dialog, PWA manifest + service worker (ST-6, NF-1) | two devices edit and sync via a private repo. App works offline |
| **M6** | Extras: print log + stock deduction (JR-2), low stock (FI-7), price history (FI-8), part planner (QC-3), slicer file import (QC-8), DE translation, dashboard stats (JR-4) | as needed |

## 9. Conventions

- One component per file, tag name = file name (`quote-editor.ts` → `<quote-editor>`). Pages live in `ui/pages/`.
- No `any`. Narrow with types from `model.ts`.
- User-visible numbers are formatted through one helper (`Intl.NumberFormat`, currency from settings).
- No personal data in the repo: real data lives in `data/` (git-ignored). Fixtures are anonymized.

## 10. Publishing

License: MIT. To publish: create the GitHub repo, push `main`, and set *Settings → Pages → Source* to
"GitHub Actions".
