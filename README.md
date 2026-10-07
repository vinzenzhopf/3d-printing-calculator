# 3D Printing Calculator

**▶ Open the app: https://vinzenzhopf.github.io/3d-printing-calculator/** (on first open, *Load demo data* shows it with a fictional workshop)\
Short link, better for QR codes on spool labels: https://3dp.hopfs.eu/

> [!WARNING]
> **This is a vibe-coded app.** It was built largely with an AI coding assistant, with a human steering the
> requirements and reviewing the results. The calculations are covered by tests, but expect rough edges. Check the
> numbers before you send a quote, and keep backups of your data (export). Use at your own risk.

Quote calculator and filament inventory for 3D printing: cost per print (filament, energy, machine wear,
labor), pricing profiles from "own use" to "commercial", and a filament inventory that tracks product lines,
purchases and spools.

It runs entirely in the browser. Your data stays on your device unless you connect storage you own, such as a
private GitHub repository.

## Status

Beta: in daily use for a small print workshop, with real data, sync and print detection. The data format can still
change; updates migrate it automatically, but keep backups. Open: a German UI. See the
[milestones](docs/implementation-plan.md#8-milestones).

## Features

- Quotes with multiple plates, printers and filaments per plate, extras, a part planner, and a printable offer
- Transparent calculation: every cost with its formula and inputs, a bar of the cost shares, profit and margin
- Import print time and grams from slicer files (PrusaSlicer, OrcaSlicer, Bambu Studio, Cura; G-code, binary G-code, 3MF)
- Compare a quote across pricing profiles and printers
- Pricing profiles: components, failure allowance, markup, quantity discounts, minimum price, rounding, optional VAT;
  or set a target price and see the resulting profit
- Filament price based on recent purchases or a manual price list
- Machine cost per hour, including a reserve for your next printer (with progress and forecast); maintenance reminders by print hours
- Filament price history per product line
- Inventory: manufacturers, product lines, colors, purchases (incl. bundles and big spools), spools with their kind of
  empty spool, weigh-ins, low-stock list, and a color overview for picking filament
- Printable QR spool labels (PDF for common A4 label sheets): scan a spool with the phone camera to set it up or weigh it
- Print log: deducts filament from spools, tracks printer hours and your real failure rate; prints can be detected
  [automatically via Home Assistant](docs/import-prints.md) (OctoPrint, PrusaLink, Bambu Lab), and past prints
  [imported](docs/import-prints.md#past-prints) from OctoPrint, Klipper/Moonraker or any CSV
- Statistics: spend, prints, hours and filament per month, by material, color and brand, next to the printers' own counters
- Demo data to try everything without entering your own
- Local-first storage (IndexedDB) with JSON export/import and optional sync (GitHub, more adapters later)
- Works offline and can be installed as an app

## Your data

Everything is stored in your browser (IndexedDB). Use **Settings → Data & sync → Export** for backups. To use the app
on several devices, connect it there to a private GitHub repository you own:

1. Create an empty **private** repository.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to only that
   repository and the permission *Contents: Read and write*.
3. Enter owner, repository and token in the app, test, connect.

The token stays on your device and is only sent to `api.github.com`. Every sync is a commit, so older versions can be
restored from the repository history. When two devices changed the data, the app asks which version to keep.

## Getting started

Requires Node.js 24 or later.

```bash
npm install
npm run dev     # http://localhost:5173
```

| Command | Description |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Type check and production build into `dist/` |
| `npm run preview` | Serve the production build locally |

Every push to `main` is tested and deployed to GitHub Pages by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## Documentation

- [Requirements](docs/requirements.md)
- [Implementation plan](docs/implementation-plan.md)
- [Analysis of the original Excel model](docs/excel-analysis.md)
- [Import prints](docs/import-prints.md): live via Home Assistant, and past prints
- [Home Assistant setup](docs/home-assistant.md)

## Feedback

Found a bug or have an idea? [Open an issue](https://github.com/vinzenzhopf/3d-printing-calculator/issues/new).
Please add the version from **Settings → Data & sync → About**.

## License

[MIT](LICENSE)
