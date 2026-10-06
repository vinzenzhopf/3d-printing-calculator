import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { resolveFilamentPrice } from '../../../core/calc/price-resolution';
import { stockByFilament } from '../../../core/stock';
import type { AppDocument, BaseMaterial, Filament, ProductLine } from '../../../core/model';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { cellNumber, cellSelect, cellText, numberField, selectField, textAreaField, textField, type Option } from '../../fields';
import { newId, num, today } from '../../format';
import { BASE_MATERIALS } from '../printers-page';
import { lineLabel, priceCell } from './labels';
import { tell } from '../../dialogs';

const STATUS: Option[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'wishlist', label: 'Wishlist' },
];
const ACQUISITION: Option[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'gift', label: 'Gift' },
  { value: 'sample', label: 'Sample' },
];

@customElement('filament-catalog')
export class FilamentCatalog extends LitElement {
  #store = new StoreController(this, store());
  @state() private filter = '';
  @state() private editingLine: string | null = null;
  @state() private open = new Set<string>();

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  #update(mutate: (doc: AppDocument) => void) {
    void this.#store.store.update(mutate);
  }

  override render() {
    const q = this.filter.toLowerCase();
    const matches = (l: ProductLine, f?: Filament) =>
      !q || `${lineLabel(l)} ${l.aliases?.join(' ') ?? ''} ${f ? `${f.color} ${f.finish ?? ''}` : ''}`.toLowerCase().includes(q);
    const lines = [...this.#doc.productLines]
      .filter((l) => matches(l) || this.#doc.filaments.some((f) => f.productLineId === l.id && matches(l, f)))
      .sort((a, b) => lineLabel(a).localeCompare(lineLabel(b)));
    const manufacturers = [...new Set(lines.map((l) => l.manufacturer))];

    return html`
      <div class="d-flex flex-wrap gap-2 mb-3">
        <input
          class="form-control"
          style="max-width: 20rem"
          type="search"
          placeholder="Filter (brand, line, color, alias)…"
          aria-label="Filter"
          .value=${this.filter}
          @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
        />
        <button class="btn btn-outline-primary ms-auto" @click=${this.#addLine}>Add product line</button>
      </div>
      ${manufacturers.map(
        (m) => html`
          <h2 class="h5 mt-4">${m}</h2>
          ${lines
            .filter((l) => l.manufacturer === m)
            // A line that matches by itself shows all colors; otherwise only the matching ones.
            .map((l) => this.#line(l, q && !matches(l) ? (f: Filament) => matches(l, f) : null, !!q))}
        `,
      )}
    `;
  }

  #line(line: ProductLine, colorFilter: ((f: Filament) => boolean) | null, filtering: boolean) {
    const filaments = this.#doc.filaments
      .filter((f) => f.productLineId === line.id && (!colorFilter || colorFilter(f)))
      .sort((a, b) => a.color.localeCompare(b.color));
    const isOpen = this.open.has(line.id) || filtering;
    const editing = this.editingLine === line.id;
    const toggle = () => {
      const next = new Set(this.open);
      if (!next.delete(line.id)) next.add(line.id);
      this.open = next;
    };
    return html`
      <section class="card mb-2">
        <div class="card-header d-flex align-items-center gap-2" role="button" @click=${toggle}>
          <span>${isOpen ? '▾' : '▸'}</span>
          <strong>${line.name}</strong>
          <span class="badge text-bg-light border">${line.baseMaterial}</span>
          ${line.successorId ? html`<span class="small text-body-secondary">→ succeeded by ${this.#lineName(line.successorId)}</span>` : nothing}
          <span class="ms-auto small text-body-secondary">${filaments.length} colors</span>
        </div>
        ${isOpen
          ? html`<div class="card-body">
              ${line.notes ? html`<p class="small text-body-secondary">${line.notes}</p>` : nothing}
              ${line.aliases?.length ? html`<p class="small">Aliases: ${line.aliases.map((a) => html`<span class="badge text-bg-light border me-1">${a}</span>`)}</p>` : nothing}
              ${this.#filamentTable(filaments)}
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary" @click=${() => this.#addFilament(line.id)}>+ Add color</button>
                <button class="btn btn-sm btn-outline-secondary" @click=${() => (this.editingLine = editing ? null : line.id)}>
                  ${editing ? 'Done editing line' : 'Edit line'}
                </button>
              </div>
              ${editing ? this.#lineEditor(line) : nothing}
            </div>`
          : nothing}
      </section>
    `;
  }

  #filamentTable(filaments: Filament[]) {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const asOf = today();
    const stock = stockByFilament(doc);
    const set = (id: string, mutate: (f: Filament) => void) => this.#update((d) => mutate(d.filaments.find((f) => f.id === id)!));
    return html`
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead>
            <tr><th></th><th>Color</th><th>Finish</th><th>Status</th><th>Acquired as</th><th class="text-end">Bought</th><th class="text-end">Stock</th><th title="Warn below this stock">Low at (g)</th><th>Price / kg (1 kg)</th><th>Link</th><th></th></tr>
          </thead>
          <tbody>
            ${filaments.map((f) => {
              const bought = doc.purchases.filter((p) => p.filamentId === f.id);
              const kg = bought.reduce((sum, p) => sum + p.totalKg, 0);
              return html`<tr>
                <td>${cellText(f.colorHex ?? '#ffffff', (v) => set(f.id, (x) => (x.colorHex = v)), { type: 'color', title: 'Swatch' })}</td>
                <td>${cellText(f.color, (v) => set(f.id, (x) => (x.color = v)), { title: 'Color' })}</td>
                <td>${cellText(f.finish, (v) => set(f.id, (x) => (x.finish = v || null)), { title: 'Finish', placeholder: 'matte, silk…' })}</td>
                <td>${cellSelect(f.status, STATUS, (v) => set(f.id, (x) => (x.status = v as Filament['status'])), true, 'Status')}</td>
                <td>${cellSelect(f.acquisition, ACQUISITION, (v) => set(f.id, (x) => (x.acquisition = v as Filament['acquisition'])), true, 'Acquired as')}</td>
                <td class="text-end text-nowrap">${kg ? `${num(kg, kg % 1 ? 2 : 0)} kg` : '–'}</td>
                <td class="text-end text-nowrap">${stockCell(stock.get(f.id), f.lowStockG)}</td>
                <td style="width: 6rem">${cellNumber(f.lowStockG ?? null, (v) => set(f.id, (x) => (v === null || v === 0 ? delete x.lowStockG : (x.lowStockG = v))), { min: 0, step: 100, allowEmpty: true, title: 'Low-stock threshold in grams' })}</td>
                <td class="text-nowrap">${priceCell(resolveFilamentPrice(doc, f.id, { asOf, needKg: 1 }), cur)}</td>
                <td>${f.link ? html`<a href=${f.link} target="_blank" rel="noopener noreferrer">shop</a>` : nothing}</td>
                <td>${bought.length === 0
                  ? html`<button class="btn btn-sm btn-link text-danger" title="Delete" @click=${() => this.#deleteFilament(f)}>✕</button>`
                  : nothing}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  #lineEditor(line: ProductLine) {
    const set = (mutate: (l: ProductLine) => void) => this.#update((d) => mutate(d.productLines.find((l) => l.id === line.id)!));
    const others: Option[] = [{ value: '', label: '–' }, ...this.#doc.productLines.filter((l) => l.id !== line.id).map((l) => ({ value: l.id, label: lineLabel(l) }))];
    const profiles: Option[] = [{ value: '', label: '–' }, ...this.#doc.materialProfiles.map((m) => ({ value: m.id, label: m.name }))];
    return html`
      <hr />
      <div class="row g-3">
        <div class="col-md-4">
          ${textField('Manufacturer', line.manufacturer, (v) => set((l) => (l.manufacturer = v)))}
          ${textField('Product line', line.name, (v) => set((l) => (l.name = v)))}
          ${selectField('Base material', line.baseMaterial, BASE_MATERIALS.map((b) => ({ value: b, label: b })), (v) => set((l) => (l.baseMaterial = v as BaseMaterial)))}
          ${selectField('Material profile (power)', line.materialProfileId ?? '', profiles, (v) => set((l) => (l.materialProfileId = v || null)))}
        </div>
        <div class="col-md-4">
          ${textField('Aliases', line.aliases?.join(', ') ?? '', (v) => set((l) => (l.aliases = v ? v.split(',').map((a) => a.trim()).filter(Boolean) : undefined)), { help: 'Listing names, comma-separated.' })}
          ${selectField('Predecessor', line.predecessorId ?? '', others, (v) => set((l) => (l.predecessorId = v || undefined)))}
          ${selectField('Successor', line.successorId ?? '', others, (v) => set((l) => (l.successorId = v || undefined)))}
        </div>
        <div class="col-md-4">
          ${numberField('Diameter', line.diameterMm, (v) => set((l) => (l.diameterMm = v)), { suffix: 'mm', step: 0.01, min: 0 })}
          ${numberField('Density', line.densityGcm3 ?? 0, (v) => set((l) => (l.densityGcm3 = v || undefined)), { suffix: 'g/cm³', step: 0.01, min: 0 })}
          ${textAreaField('Notes', line.notes ?? '', (v) => set((l) => (l.notes = v || undefined)))}
        </div>
      </div>
      ${this.#doc.filaments.some((f) => f.productLineId === line.id)
        ? nothing
        : html`<button class="btn btn-sm btn-outline-danger" @click=${() => this.#update((d) => (d.productLines = d.productLines.filter((l) => l.id !== line.id)))}>Delete line</button>`}
    `;
  }

  #lineName(id: string): string {
    const l = this.#doc.productLines.find((x) => x.id === id);
    return l ? l.name : '?';
  }

  #addLine = () => {
    const id = newId();
    this.#update((d) => d.productLines.push({ id, manufacturer: 'New manufacturer', name: 'New line', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 }));
    this.open = new Set([...this.open, id]);
    this.editingLine = id;
    this.filter = '';
  };

  #addFilament(lineId: string) {
    this.#update((d) =>
      d.filaments.push({ id: newId(), productLineId: lineId, color: 'New color', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned' }),
    );
  }

  #deleteFilament(f: Filament) {
    const used = this.#doc.quotes.some((q) => q.plates.some((p) => p.filaments.some((pf) => pf.filamentId === f.id)));
    if (used) {
      void tell(`"${f.color}" is used in quotes and can't be deleted.`);
      return;
    }
    this.#update((d) => (d.filaments = d.filaments.filter((x) => x.id !== f.id)));
  }
}

function stockCell(s: { knownG: number; spools: number; unknownSpools: number } | undefined, lowG: number | undefined) {
  const low = lowG !== undefined && (s?.knownG ?? 0) < lowG ? html` <span class="badge text-bg-danger">low</span>` : nothing;
  if (!s) return html`<span class="text-body-secondary">–</span>${low}`;
  return html`${num(s.knownG / 1000, 2)} kg${s.unknownSpools ? html` <span class="badge text-bg-warning" title="Spools not weighed yet">+${s.unknownSpools} ?</span>` : nothing}${low}`;
}
