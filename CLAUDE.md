# CLAUDE.md

## Git

- Never mention Claude/AI in commits: no `Co-Authored-By` trailer, no "Generated with" lines.
- Keep commit messages short: one line, imperative, ≤ 72 chars (e.g. `Add price list page`).

## Project

Static web app (Lit + TypeScript + Vite + Bootstrap CSS), deployed to GitHub Pages. See
`docs/implementation-plan.md` for architecture and milestones, `docs/requirements.md` for requirement ids.

- `npm test`: Vitest. `npm run build`: type check + bundle. Both must pass before committing.
- `src/core/` is pure TS (no DOM, no imports from `ui/`/`state/`). Business math lives there, not in components.
- All document changes go through `store.update(doc => ...)`.
- Components render into light DOM (`createRenderRoot() { return this; }`) so Bootstrap applies.
- Decorators use TS legacy mode (`experimentalDecorators`). Don't switch to standard decorators: Vite doesn't transform them.
- `tests/legacy-replay.test.ts` must keep reproducing the Excel results.

## Data and privacy

- `data/` and `*.xlsx` hold the owner's personal data and are git-ignored. Never commit them, never copy real data into
  fixtures, docs or examples. `tests/fixtures/` must stay anonymized (no customer names).
- `tools/extract_excel.py` regenerates `data/seed/*.json` and the test fixture from the workbook.

## Docs

Keep docs concise and in the usual open-source style. The README starts with the vibe-coded disclaimer.
