# 3D Printing Calculator

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
work. Next: spool stock and weigh-ins, then sync. See the [milestones](docs/implementation-plan.md#8-milestones).

## Features (planned)

- Quotes with multiple plates, printers and filaments per plate, extras, and a printable offer
- Pricing profiles: components, failure allowance, markup, minimum price, rounding, optional VAT
- Filament price based on recent purchases or a manual price list
- Machine cost per hour, including a reserve for your next printer
- Inventory: manufacturers, product lines, colors, purchases, spools, weigh-ins with empty-spool presets
- Local-first storage (IndexedDB) with JSON export/import and optional sync (GitHub, more adapters later)

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

## License

[MIT](LICENSE)
