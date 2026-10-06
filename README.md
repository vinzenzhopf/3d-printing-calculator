# 3D Printing Calculator

**▶ Open the app: https://vinzenzhopf.github.io/3d-printing-calculator/**

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

Early development. Quotes (multi-plate, multi-filament, pricing profiles, freezing, printable offer), customers,
printers with machine cost per hour, the filament catalog with purchases and price list, and JSON export/import
work, as do spool stock and weigh-ins with empty-spool presets, sync via a private GitHub repository, and offline
use (installable as an app). See the [milestones](docs/implementation-plan.md#8-milestones).

## Features

- Quotes with multiple plates, printers and filaments per plate, extras, a part planner, and a printable offer
- Import print time and grams from slicer files (PrusaSlicer, OrcaSlicer, Bambu Studio, Cura; G-code, binary G-code, 3MF)
- Compare a quote across pricing profiles and printers
- Pricing profiles: components, failure allowance, markup, minimum price, rounding, optional VAT
- Filament price based on recent purchases or a manual price list
- Machine cost per hour, including a reserve for your next printer; maintenance reminders by print hours
- Filament price history per product line
- Inventory: manufacturers, product lines, colors, purchases, spools, weigh-ins with empty-spool presets, low-stock list
- Printable QR spool labels (PDF for common A4 label sheets): scan a spool with the phone to weigh it
- Print log: deducts filament from spools, tracks printer hours and your real failure rate; prints can be detected automatically via [Home Assistant](docs/home-assistant.md) (OctoPrint)
- Local-first storage (IndexedDB) with JSON export/import and optional sync (GitHub, more adapters later)
- Works offline and can be installed as an app

## Your data

Everything is stored in your browser (IndexedDB). Use **Settings → Data → Export** for backups. To use the app on
several devices, connect **Settings → Sync** to a private GitHub repository you own:

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
- [Detect prints with Home Assistant](docs/home-assistant.md)

## License

[MIT](LICENSE)
