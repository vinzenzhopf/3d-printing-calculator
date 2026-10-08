import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { isFilamentDeprecated } from '../../../core/catalog-cleanup';
import type { AppDocument, Filament } from '../../../core/model';
import {
  applyEntry, entryDiffs, filamentFromEntry, lineEntries, matchEntry, type Diff, type DiffKey, type SpoolmanFilament,
} from '../../../core/spoolmandb';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { newId } from '../../format';
import { loadSpoolmanDb } from '../../spoolmandb-client';
import { swatch } from './labels';

const NONE = '__none__';

/**
 * Compares a product line's colors with SpoolmanDB and offers the differences
 * (color, second color, finish, temperatures, density) to take over, plus the
 * line's colors that are not in the catalog yet. Nothing changes without "Apply".
 */
@customElement('spoolman-check')
export class SpoolmanCheck extends LitElement {
  @property() lineId = '';
  #store = new StoreController(this, store());
  @state() private db: SpoolmanFilament[] | null = null;
  @state() private error = '';
  /** Entry chosen by hand per filament (NONE = no entry). */
  @state() private chosen: Record<string, string> = {};
  /** Checkbox changes per "filamentId|key"; unset = the diff's suggestion. */
  @state() private picked: Record<string, boolean> = {};
  @state() private done = '';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override connectedCallback() {
    super.connectedCallback();
    loadSpoolmanDb().then(
      (db) => (this.db = db),
      (e: Error) => (this.error = `SpoolmanDB could not be loaded: ${e.message}`),
    );
  }

  override render() {
    const doc = this.#doc;
    const line = doc.productLines.find((l) => l.id === this.lineId);
    if (!line) return nothing;
    const box = (content: unknown) => html`<div class="border rounded p-2 my-2 bg-body-tertiary">${content}
      <div class="form-text">Data from <a href="https://github.com/Donkie/SpoolmanDB" target="_blank" rel="noopener">SpoolmanDB</a>, maintained by the community: worth a look before taking it over.</div></div>`;
    if (this.error) return box(html`<div class="text-danger small">${this.error}</div>`);
    if (!this.db) return box(html`<div class="small"><span class="spinner-border spinner-border-sm"></span> Loading SpoolmanDB (a few MB, once per session)…</div>`);

    const entries = lineEntries(this.db, line);
    if (entries.length === 0) {
      return box(html`<div class="small">No SpoolmanDB entries for ${line.manufacturer} ${line.name} (${line.diameterMm} mm). The brand or material may be named differently there.</div>`);
    }
    const filaments = doc.filaments.filter((f) => f.productLineId === line.id && !isFilamentDeprecated(doc, f)).sort((a, b) => a.color.localeCompare(b.color));
    const rows = filaments.map((f) => {
      const choice = this.chosen[f.id];
      const entry = choice === NONE ? undefined : choice ? entries.find((e) => e.id === choice) ?? this.db!.find((e) => e.id === choice) : matchEntry(entries, f, line, this.db!);
      return { f, entry, diffs: entry ? entryDiffs(f, line, entry) : [] };
    });
    // Density belongs to the line: only pre-select it when all colors agree.
    const densities = new Set(rows.flatMap((r) => r.diffs.filter((d) => d.key === 'density').map((d) => d.proposed)));
    const isPicked = (f: Filament, d: Diff) => this.picked[`${f.id}|${d.key}`] ?? (d.suggested && (d.key !== 'density' || densities.size === 1));
    const toApply = rows.filter((r) => r.entry && (r.diffs.some((d) => isPicked(r.f, d)) || (this.chosen[r.f.id] && r.f.spoolmanId !== r.entry.id)));
    const used = new Set(rows.map((r) => r.entry?.id).filter(Boolean));
    const missing = entries.filter((e) => !used.has(e.id));

    return box(html`
      <div class="small fw-semibold mb-2">SpoolmanDB: ${entries.length} colors for ${line.manufacturer} ${line.name}</div>
      <div class="list-group mb-2">
        ${rows.map(({ f, entry, diffs }) => html`<div class="list-group-item">
          <div class="d-flex flex-wrap gap-2 align-items-center">
            ${swatch(f, '1.25rem')}<span class="fw-semibold">${f.color}</span>
            <select class="form-select form-select-sm w-auto ms-auto" aria-label="SpoolmanDB entry"
              @change=${(e: Event) => (this.chosen = { ...this.chosen, [f.id]: (e.target as HTMLSelectElement).value })}>
              <option value=${NONE} ?selected=${!entry}>– no entry –</option>
              ${entries.map((e) => html`<option value=${e.id} ?selected=${entry?.id === e.id}>${e.name}</option>`)}
            </select>
          </div>
          ${entry
            ? diffs.length === 0
              ? html`<div class="small text-success mt-1">✓ matches "${entry.name}"</div>`
              : diffs.map((d) => html`<label class="d-flex gap-2 align-items-center small mt-1">
                  <input type="checkbox" class="form-check-input mt-0" .checked=${isPicked(f, d)}
                    @change=${(e: Event) => (this.picked = { ...this.picked, [`${f.id}|${d.key}`]: (e.target as HTMLInputElement).checked })} />
                  <span>${d.label}: ${this.#value(d.key, d.current)} → <strong>${this.#value(d.key, d.proposed)}</strong></span>
                </label>`)
            : html`<div class="small text-body-secondary mt-1">No matching entry found: pick one, or leave it.</div>`}
        </div>`)}
      </div>
      <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
        <button class="btn btn-sm btn-primary" ?disabled=${toApply.length === 0} @click=${() => this.#apply(toApply.map((r) => ({ f: r.f, entry: r.entry!, keys: r.diffs.filter((d) => isPicked(r.f, d)).map((d) => d.key) })))}>
          Apply to ${toApply.length} ${toApply.length === 1 ? 'color' : 'colors'}</button>
        ${this.done ? html`<span class="small text-success">${this.done}</span>` : nothing}
      </div>
      ${missing.length
        ? html`<details><summary class="small">Colors in SpoolmanDB you don't have (${missing.length})</summary>
            <div class="list-group mt-1">${missing.map((e) => html`<div class="list-group-item d-flex gap-2 align-items-center small">
              ${swatch(filamentFromEntry(line.id, e, ''), '1.1rem')}<span class="me-auto">${e.name}</span>
              <button class="btn btn-sm btn-outline-primary" @click=${() => void this.#add(e)}>+ Add</button>
            </div>`)}</div></details>`
        : nothing}
    `);
  }

  #value(key: DiffKey, v: string) {
    if (!v) return html`<span class="text-body-secondary">–</span>`;
    return key === 'colorHex' || key === 'colorHex2' ? html`${swatch(v, '0.9rem')} <span class="font-monospace">${v}</span>` : v;
  }

  async #apply(items: { f: Filament; entry: SpoolmanFilament; keys: DiffKey[] }[]) {
    await this.#store.store.update((d) => {
      for (const { f, entry, keys } of items) applyEntry(d, f.id, entry, keys);
    });
    this.picked = {};
    this.chosen = {};
    this.done = `Updated ${items.length} ${items.length === 1 ? 'color' : 'colors'}.`;
  }

  async #add(e: SpoolmanFilament) {
    await this.#store.store.update((d) => d.filaments.push(filamentFromEntry(this.lineId, e, newId())));
    this.done = `Added ${e.name}.`;
  }
}
