import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { activeFilaments } from '../../../core/catalog-cleanup';
import { compareColors, swatchBackground } from '../../../core/colors';
import type { AppDocument, Filament } from '../../../core/model';
import { stockByFilament, type FilamentStock } from '../../../core/stock';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { num } from '../../format';
import { lineLabel } from './labels';

type Show = 'stock' | 'owned' | 'all';
type Sort = 'color' | 'brand' | 'stock';

const SHOW: [Show, string][] = [['stock', 'In stock'], ['owned', 'Owned'], ['all', 'Incl. wishlist']];

/** Filaments as large color tiles, for picking colors for a print. */
@customElement('filament-colors')
export class FilamentColors extends LitElement {
  #store = new StoreController(this, store());
  @state() private show: Show | null = null;
  @state() private material = '';
  @state() private sort: Sort = 'color';
  @state() private filter = '';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    const doc = this.#doc;
    const stock = stockByFilament(doc);
    // Without any spools yet, "in stock" would be empty: start with all owned filaments then.
    const show = this.show ?? (doc.spools.length ? 'stock' : 'owned');
    const line = (f: Filament) => doc.productLines.find((l) => l.id === f.productLineId);
    const materials = [...new Set(doc.productLines.map((l) => l.baseMaterial))].sort();
    const q = this.filter.toLowerCase();
    const inStock = (f: Filament) => (stock.get(f.id)?.spools ?? 0) > 0;
    const tiles = activeFilaments(doc)
      .filter((f) => (show === 'all' ? true : show === 'owned' ? f.status === 'owned' : inStock(f)))
      .filter((f) => !this.material || line(f)?.baseMaterial === this.material)
      .filter((f) => !q || `${f.color} ${f.finish ?? ''} ${f.colorHex ?? ''} ${line(f) ? lineLabel(line(f)!) : ''}`.toLowerCase().includes(q))
      .sort((a, b) =>
        this.sort === 'stock' ? (stock.get(b.id)?.knownG ?? 0) - (stock.get(a.id)?.knownG ?? 0) || compareColors(a.colorHex, b.colorHex)
        : this.sort === 'brand' ? (line(a) ? lineLabel(line(a)!) : '').localeCompare(line(b) ? lineLabel(line(b)!) : '') || compareColors(a.colorHex, b.colorHex)
        : compareColors(a.colorHex, b.colorHex) || a.color.localeCompare(b.color),
      );

    return html`
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <input class="form-control form-control-sm" style="max-width: 14rem" type="search" placeholder="Filter (color, brand, hex)…" aria-label="Filter"
          .value=${this.filter} @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)} />
        <div class="btn-group btn-group-sm" role="group" aria-label="Show">
          ${SHOW.map(([v, label]) => html`<button class="btn ${show === v ? 'btn-secondary' : 'btn-outline-secondary'}" @click=${() => (this.show = v)}>${label}</button>`)}
        </div>
        <select class="form-select form-select-sm w-auto" aria-label="Material" @change=${(e: Event) => (this.material = (e.target as HTMLSelectElement).value)}>
          <option value="" ?selected=${!this.material}>All materials</option>
          ${materials.map((m) => html`<option value=${m} ?selected=${m === this.material}>${m}</option>`)}
        </select>
        <select class="form-select form-select-sm w-auto" aria-label="Sort" @change=${(e: Event) => (this.sort = (e.target as HTMLSelectElement).value as Sort)}>
          <option value="color" ?selected=${this.sort === 'color'}>By color</option>
          <option value="brand" ?selected=${this.sort === 'brand'}>By brand</option>
          <option value="stock" ?selected=${this.sort === 'stock'}>Most in stock</option>
        </select>
        <span class="small text-body-secondary ms-auto">${tiles.length} colors</span>
      </div>
      ${tiles.length === 0
        ? html`<p class="text-body-secondary">${show === 'stock' ? 'No filament in stock matches. Show "Owned" to see all colors.' : 'No filaments match.'}</p>`
        : html`<div class="color-grid">${tiles.map((f) => this.#tile(f, stock.get(f.id)))}</div>`}
    `;
  }

  #tile(f: Filament, s: FilamentStock | undefined) {
    const doc = this.#doc;
    const line = doc.productLines.find((l) => l.id === f.productLineId);
    const hex = f.colorHex?.toUpperCase();
    return html`<div class="card h-100 overflow-hidden" title=${`${line ? lineLabel(line) : '?'} – ${f.color}`}>
      <div class="color-swatch ${hex ? '' : 'color-swatch-unknown'}" style=${hex ? `background:${swatchBackground(f)}` : ''}>${hex ? nothing : html`<span>no color set</span>`}</div>
      <div class="card-body p-2 small">
        <div class="font-monospace text-body-secondary">${hex ?? '–'}${f.colorHex2 ? ` → ${f.colorHex2.toUpperCase()}` : ''}</div>
        <div class="fw-semibold text-truncate">${f.color}${f.finish ? html` <span class="fw-normal text-body-secondary">(${f.finish})</span>` : nothing}</div>
        <div class="text-truncate">${line ? lineLabel(line) : '?'}${line ? html` <span class="badge text-bg-light border">${line.baseMaterial}</span>` : nothing}</div>
        <div class="mt-1">${f.status === 'wishlist'
          ? html`<span class="badge text-bg-info">wishlist</span>`
          : s && s.spools > 0
            ? html`<strong>${s.knownG >= 1000 ? `${num(s.knownG / 1000, 1)} kg` : `${num(s.knownG)} g`}</strong>
                <span class="text-body-secondary">· ${s.spools} ${s.spools === 1 ? 'spool' : 'spools'}${s.unknownSpools ? `, ${s.unknownSpools} not weighed` : ''}</span>`
            : html`<span class="text-body-secondary">not in stock</span>`}</div>
      </div>
    </div>`;
  }
}
