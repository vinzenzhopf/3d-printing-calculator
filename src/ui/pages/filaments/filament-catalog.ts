import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { resolveFilamentPrice } from '../../../core/calc/price-resolution';
import {
  deprecate, isFilamentDeprecated, mergeFilaments, mergeProductLines, previewFilamentMerge, previewLineMerge, restore, spoolsInStock,
  type CatalogTarget, type MergePreview,
} from '../../../core/catalog-cleanup';
import { stockByFilament } from '../../../core/stock';
import type { AppDocument, BaseMaterial, Filament, ProductLine } from '../../../core/model';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { cellNumber, cellSelect, cellText, numberField, selectField, textAreaField, textField, type Option } from '../../fields';
import { newId, num, today } from '../../format';
import { BASE_MATERIALS } from '../printers-page';
import { filamentLabel, lineLabel, priceCell } from './labels';
import { applyColor, colorButton } from '../../color-dialog';
import { ask, tell } from '../../dialogs';

const STATUS: Option[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'wishlist', label: 'Wishlist' },
];
/** Readable names of the fields a merge carries over. */
const FIELD_LABEL: Record<string, string> = {
  colorHex: 'swatch', finish: 'finish', link: 'shop link', asin: 'ASIN', manualPrice: 'manual price', lowStockG: 'low-stock threshold',
  predecessorId: 'predecessor', successorId: 'successor', materialProfileId: 'material profile', densityGcm3: 'density', notes: 'notes',
};

interface MergeDraft {
  kind: 'filament' | 'line';
  keepId: string;
  dropId: string;
  mergeIdentical: boolean;
}


@customElement('filament-catalog')
export class FilamentCatalog extends LitElement {
  #store = new StoreController(this, store());
  @state() private filter = '';
  @state() private editingLine: string | null = null;
  @state() private open = new Set<string>();
  @state() private showDeprecated = false;
  /** Entry being deprecated, with the chosen successor. */
  @state() private deprecating: (CatalogTarget & { successorId: string }) | null = null;
  @state() private merge: MergeDraft | null = null;

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
      .filter((l) => this.showDeprecated || !l.deprecatedAt)
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
        <div class="form-check form-switch align-self-center mb-0">
          <label class="form-check-label">
            <input class="form-check-input" type="checkbox" role="switch" .checked=${this.showDeprecated}
              @change=${(e: Event) => (this.showDeprecated = (e.target as HTMLInputElement).checked)} />
            Show deprecated
          </label>
        </div>
        <button class="btn btn-outline-secondary ms-auto" @click=${() => (this.merge = this.merge ? null : { kind: 'filament', keepId: '', dropId: '', mergeIdentical: true })}>Merge duplicates…</button>
        <button class="btn btn-outline-primary" @click=${this.#addLine}>Add product line</button>
      </div>
      ${this.merge ? this.#mergePanel(this.merge) : nothing}
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
    const all = this.#doc.filaments.filter((f) => f.productLineId === line.id && (!colorFilter || colorFilter(f)));
    const filaments = all
      .filter((f) => this.showDeprecated || !f.deprecatedAt)
      .sort((a, b) => a.color.localeCompare(b.color));
    const hidden = all.length - filaments.length;
    const isOpen = this.open.has(line.id) || filtering;
    const editing = this.editingLine === line.id;
    const toggle = () => {
      const next = new Set(this.open);
      if (!next.delete(line.id)) next.add(line.id);
      this.open = next;
    };
    return html`
      <section class="card mb-2 ${line.deprecatedAt ? 'opacity-50' : ''}">
        <div class="card-header d-flex align-items-center gap-2" role="button" @click=${toggle}>
          <span>${isOpen ? '▾' : '▸'}</span>
          <strong>${line.name}</strong>
          <span class="badge text-bg-light border">${line.baseMaterial}</span>
          ${line.deprecatedAt ? html`<span class="badge text-bg-secondary" title=${`since ${line.deprecatedAt}`}>deprecated</span>` : nothing}
          ${line.successorId ? html`<span class="small text-body-secondary">→ succeeded by ${this.#lineName(line.successorId)}</span>` : nothing}
          <span class="ms-auto small text-body-secondary">${filaments.length} colors${hidden ? ` · ${hidden} deprecated hidden` : ''}</span>
        </div>
        ${isOpen
          ? html`<div class="card-body">
              ${line.notes ? html`<p class="small text-body-secondary">${line.notes}</p>` : nothing}
              ${line.aliases?.length ? html`<p class="small">Aliases: ${line.aliases.map((a) => html`<span class="badge text-bg-light border me-1">${a}</span>`)}</p>` : nothing}
              ${this.#filamentTable(filaments)}
              <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-sm btn-outline-primary" @click=${() => this.#addFilament(line.id)}>+ Add color</button>
                <button class="btn btn-sm btn-outline-secondary" @click=${() => (this.editingLine = editing ? null : line.id)}>
                  ${editing ? 'Done editing line' : 'Edit line'}
                </button>
                ${line.deprecatedAt
                  ? html`<button class="btn btn-sm btn-outline-secondary" @click=${() => this.#update((d) => restore(d, { kind: 'line', id: line.id }))}>Restore line</button>`
                  : html`<button class="btn btn-sm btn-outline-secondary" title="Old line: keep its history, hide it from choices" @click=${() => (this.deprecating = { kind: 'line', id: line.id, successorId: '' })}>Deprecate line…</button>`}
                <button class="btn btn-sm btn-outline-secondary" title="Duplicate or typo: move everything to another line" @click=${() => this.#openMerge({ kind: 'line', keepId: '', dropId: line.id, mergeIdentical: true })}>Merge line…</button>
              </div>
              ${this.deprecating?.kind === 'line' && this.deprecating.id === line.id ? this.#deprecateForm(this.deprecating) : nothing}
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
            <tr><th></th><th>Color</th><th>Finish</th><th>Status</th><th>Notes</th><th class="text-end">Bought</th><th class="text-end">Stock</th><th title="Warn below this stock">Low at (g)</th><th>Price / kg (1 kg)</th><th>Link</th><th></th></tr>
          </thead>
          <tbody>
            ${filaments.map((f) => {
              const bought = doc.purchases.filter((p) => p.filamentId === f.id);
              const kg = bought.reduce((sum, p) => sum + p.totalKg, 0);
              const successor = f.successorId ? doc.filaments.find((x) => x.id === f.successorId) : undefined;
              const row = html`<tr class=${f.deprecatedAt ? 'opacity-50' : ''}>
                <td>${colorButton(f, (c) => set(f.id, (x) => applyColor(x, c)), { title: 'Color, second color and finish' })}</td>
                <td style="min-width: 9rem">${cellText(f.color, (v) => set(f.id, (x) => (x.color = v)), { title: 'Color' })}
                  ${f.deprecatedAt ? html`<div class="small text-body-secondary">deprecated ${f.deprecatedAt}${successor ? ` → ${successor.color}` : ''}</div>` : nothing}</td>
                <td style="min-width: 6rem">${cellText(f.finish, (v) => set(f.id, (x) => (x.finish = v || null)), { title: 'Finish', placeholder: 'matte, silk…' })}</td>
                <td>${cellSelect(f.status, STATUS, (v) => set(f.id, (x) => (x.status = v as Filament['status'])), true, 'Status')}</td>
                <td style="min-width: 8rem">${cellText(f.notes, (v) => set(f.id, (x) => (v ? (x.notes = v) : delete x.notes)), { title: 'Notes', placeholder: 'e.g. 235 °C works best' })}</td>
                <td class="text-end text-nowrap">${kg ? `${num(kg, kg % 1 ? 2 : 0)} kg` : '–'}</td>
                <td class="text-end text-nowrap">${stockCell(stock.get(f.id), f.lowStockG)}</td>
                <td style="min-width: 5.5rem">${cellNumber(f.lowStockG ?? null, (v) => set(f.id, (x) => (v === null || v === 0 ? delete x.lowStockG : (x.lowStockG = v))), { min: 0, step: 100, allowEmpty: true, title: 'Low-stock threshold in grams' })}</td>
                <td class="text-nowrap">${priceCell(resolveFilamentPrice(doc, f.id, { asOf, needKg: 1 }), cur)}</td>
                <td>${f.link ? html`<a href=${f.link} target="_blank" rel="noopener noreferrer">shop</a>` : nothing}</td>
                <td>${this.#filamentActions(f, bought.length === 0)}</td>
              </tr>`;
              return this.deprecating?.kind === 'filament' && this.deprecating.id === f.id
                ? html`${row}<tr><td colspan="11">${this.#deprecateForm(this.deprecating)}</td></tr>`
                : row;
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
        : html`<button class="btn btn-sm btn-outline-danger" @click=${() => this.#update((d) => {
            d.productLines = d.productLines.filter((l) => l.id !== line.id);
            for (const l of d.productLines) {
              if (l.predecessorId === line.id) delete l.predecessorId;
              if (l.successorId === line.id) delete l.successorId;
            }
          })}>Delete line</button>`}
    `;
  }

  /** Compact action menu per color (a select keeps the wide table from overflowing). */
  #filamentActions(f: Filament, deletable: boolean) {
    const actions: [string, string, () => void][] = [
      f.deprecatedAt
        ? ['restore', 'Restore (make selectable again)', () => this.#update((d) => restore(d, { kind: 'filament', id: f.id }))]
        : ['deprecate', 'Deprecate (old color, keep history)…', () => (this.deprecating = { kind: 'filament', id: f.id, successorId: '' })],
      ['merge', 'Merge into another color (duplicate)…', () => void this.#openMerge({ kind: 'filament', keepId: '', dropId: f.id, mergeIdentical: true })],
      ...(deletable ? [['delete', 'Delete', () => this.#deleteFilament(f)] as [string, string, () => void]] : []),
    ];
    return html`<select class="form-select form-select-sm" style="width: 3rem; min-width: 0" aria-label="Actions" title="Deprecate, merge, delete"
      @change=${(e: Event) => {
        const select = e.target as HTMLSelectElement;
        actions.find(([v]) => v === select.value)?.[2]();
        select.value = '';
      }}>
      <option value="" selected></option>
      ${actions.map(([v, label]) => html`<option value=${v}>${label}</option>`)}
    </select>`;
  }

  /** Inline form for deprecating: stock warning and optional successor. */
  #deprecateForm(target: CatalogTarget & { successorId: string }) {
    const doc = this.#doc;
    const inStock = spoolsInStock(doc, target);
    const name = target.kind === 'filament' ? filamentLabel(doc, doc.filaments.find((f) => f.id === target.id)!) : this.#lineName(target.id);
    const successors: Option[] = [
      { value: '', label: 'No successor' },
      ...(target.kind === 'filament'
        ? doc.filaments.filter((f) => f.id !== target.id && !isFilamentDeprecated(doc, f)).map((f) => ({ value: f.id, label: filamentLabel(doc, f) }))
        : doc.productLines.filter((l) => l.id !== target.id && !l.deprecatedAt).map((l) => ({ value: l.id, label: lineLabel(l) }))
      ).sort((a, b) => a.label.localeCompare(b.label)),
    ];
    return html`<div class="border rounded p-2 my-2 bg-body-tertiary small">
      <p class="mb-2">Deprecate <strong>${name}</strong>: purchases, spools, prints and quotes keep it, but it's hidden from
        filament choices, the color overview and the to-buy list.</p>
      ${inStock.length
        ? html`<div class="alert alert-warning py-1 px-2 mb-2">Still in stock: ${inStock.map((s) => s.label).join(', ')}.
            Use these up or mark them empty first. Deprecating now hides filament you still have.</div>`
        : nothing}
      <div class="d-flex flex-wrap gap-2 align-items-center">
        <label class="text-nowrap" for="successor">Successor</label>
        <select id="successor" class="form-select form-select-sm w-auto" @change=${(e: Event) => (this.deprecating = { ...target, successorId: (e.target as HTMLSelectElement).value })}>
          ${successors.map((o) => html`<option value=${o.value} ?selected=${o.value === target.successorId}>${o.label}</option>`)}
        </select>
        <span class="text-body-secondary">Prices fall back to the old purchases.</span>
        <button class="btn btn-sm ${inStock.length ? 'btn-warning' : 'btn-primary'} ms-auto" @click=${() => void this.#deprecate(target, inStock.length)}>
          ${inStock.length ? 'Deprecate anyway' : 'Deprecate'}
        </button>
        <button class="btn btn-sm btn-link" @click=${() => (this.deprecating = null)}>Cancel</button>
      </div>
    </div>`;
  }

  async #deprecate(target: CatalogTarget & { successorId: string }, inStock: number) {
    if (inStock && !(await ask(`${inStock} ${inStock === 1 ? 'spool is' : 'spools are'} still in stock. Deprecate anyway?`, { ok: 'Deprecate', danger: true }))) return;
    await this.#store.store.update((d) => deprecate(d, target, { date: today(), force: true, ...(target.successorId ? { successorId: target.successorId } : {}) }));
    this.deprecating = null;
  }

  async #openMerge(draft: MergeDraft) {
    this.merge = draft;
    await this.updateComplete;
    this.querySelector('.merge-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Choose what to keep and what to merge into it; shows what moves before anything changes. */
  #mergePanel(m: MergeDraft) {
    const doc = this.#doc;
    const set = (patch: Partial<MergeDraft>) => (this.merge = { ...m, ...patch });
    const options: Option[] = [
      { value: '', label: 'Choose…' },
      ...(m.kind === 'filament'
        ? doc.filaments.map((f) => ({ value: f.id, label: `${filamentLabel(doc, f)}${isFilamentDeprecated(doc, f) ? ' · deprecated' : ''}` }))
        : doc.productLines.map((l) => ({ value: l.id, label: `${lineLabel(l)}${l.deprecatedAt ? ' · deprecated' : ''}` }))
      ).sort((a, b) => a.label.localeCompare(b.label)),
    ];
    // Both must still exist: the panel re-renders while a merge deletes one.
    const ready = m.keepId !== m.dropId && [m.keepId, m.dropId].every((id) => options.some((o) => id && o.value === id));
    const preview = ready ? this.#mergePreviewText(m) : [];
    return html`<section class="card mb-3 merge-panel">
      <div class="card-body">
        <div class="d-flex flex-wrap gap-3 align-items-center mb-2">
          <strong>Merge duplicates</strong>
          <div class="btn-group btn-group-sm" role="group" aria-label="Merge what">
            ${(['filament', 'line'] as const).map((k) => html`<button class="btn ${m.kind === k ? 'btn-secondary' : 'btn-outline-secondary'}"
              @click=${() => (this.merge = { kind: k, keepId: '', dropId: '', mergeIdentical: true })}>${k === 'filament' ? 'Colors' : 'Product lines'}</button>`)}
          </div>
          <span class="small text-body-secondary">For real duplicates and typos. For a renamed or replaced product, deprecate the old one instead.</span>
        </div>
        <div class="row g-2 align-items-end">
          <div class="col-md-5"><label class="form-label small mb-0">Merge (deleted afterwards)</label>${cellSelect(m.dropId, options, (v) => set({ dropId: v }), true, 'Merge')}</div>
          <div class="col-md-1 text-center">
            <button class="btn btn-sm btn-link" title="Swap" @click=${() => set({ keepId: m.dropId, dropId: m.keepId })}>⇄</button>
          </div>
          <div class="col-md-5"><label class="form-label small mb-0">into (kept)</label>${cellSelect(m.keepId, options, (v) => set({ keepId: v }), true, 'Keep')}</div>
        </div>
        ${m.keepId && m.keepId === m.dropId ? html`<p class="small text-danger mt-2 mb-0">Choose two different entries.</p>` : nothing}
        ${ready
          ? html`<ul class="small mt-2 mb-2">${preview.map((l) => html`<li>${l}</li>`)}</ul>
              ${m.kind === 'line' && previewLineMerge(doc, m.keepId, m.dropId).identical.length
                ? html`<div class="form-check small mb-2"><label class="form-check-label">
                    <input class="form-check-input" type="checkbox" .checked=${m.mergeIdentical} @change=${(e: Event) => set({ mergeIdentical: (e.target as HTMLInputElement).checked })} />
                    Also merge colors that exist in both lines</label></div>`
                : nothing}`
          : nothing}
        <div class="d-flex gap-2 ${ready ? '' : 'mt-2'}">
          <button class="btn btn-sm btn-danger" ?disabled=${!ready} @click=${() => void this.#merge(m, preview)}>Merge…</button>
          <button class="btn btn-sm btn-link" @click=${() => (this.merge = null)}>Close</button>
        </div>
      </div>
    </section>`;
  }

  #mergePreviewText(m: MergeDraft): string[] {
    const doc = this.#doc;
    if (m.kind === 'filament') {
      const name = (id: string) => filamentLabel(doc, doc.filaments.find((f) => f.id === id)!);
      return [...describeMerge(previewFilamentMerge(doc, m.keepId, m.dropId), name(m.keepId)), `"${name(m.dropId)}" is deleted.`];
    }
    const p = previewLineMerge(doc, m.keepId, m.dropId);
    const keep = this.#lineName(m.keepId);
    const lines = [`${p.filaments} ${p.filaments === 1 ? 'color moves' : 'colors move'} to ${keep}.`];
    if (p.identical.length) {
      const colors = p.identical.map((x) => doc.filaments.find((f) => f.id === x.dropId)!.color).join(', ');
      if (m.mergeIdentical) {
        const sum = p.identical.map((x) => previewFilamentMerge(doc, x.keepId, x.dropId)).reduce((a, b) => ({
          purchases: a.purchases + b.purchases, spools: a.spools + b.spools, printJobs: a.printJobs + b.printJobs,
          quotes: a.quotes + b.quotes, snapshots: a.snapshots + b.snapshots, carriedOver: [],
        }));
        lines.push(`In both lines: ${colors}. Merged into the existing colors:`, ...describeMerge(sum, keep).map((l) => `  ${l}`));
      } else {
        lines.push(`In both lines: ${colors}. Kept as separate colors.`);
      }
    }
    if (p.carriedOver.length) lines.push(`${keep} takes over: ${p.carriedOver.map((k) => FIELD_LABEL[k] ?? k).join(', ')}.`);
    lines.push(`The other line's name becomes an alias of ${keep}, then the line is deleted.`);
    return lines;
  }

  async #merge(m: MergeDraft, preview: string[]) {
    if (!(await ask(`${preview.join('\n')}\n\nThis can't be undone (except by restoring a backup).`, { ok: 'Merge', danger: true }))) return;
    try {
      await this.#store.store.update((d) => {
        if (m.kind === 'filament') mergeFilaments(d, m.keepId, m.dropId);
        else mergeProductLines(d, m.keepId, m.dropId, { mergeIdentical: m.mergeIdentical });
      });
      this.merge = null;
    } catch (err) {
      await tell(err instanceof Error ? err.message : String(err));
    }
  }

  #lineName(id: string): string {
    const l = this.#doc.productLines.find((x) => x.id === id);
    return l ? lineLabel(l) : '?';
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
      d.filaments.push({ id: newId(), productLineId: lineId, color: 'New color', finish: null, link: null, asin: null, status: 'owned' }),
    );
  }

  #deleteFilament(f: Filament) {
    const doc = this.#doc;
    const used =
      doc.quotes.some((q) => q.plates.some((p) => p.filaments.some((pf) => pf.filamentId === f.id))) ||
      doc.spools.some((s) => s.filamentId === f.id) ||
      doc.printJobs.some((j) => j.filaments.some((jf) => jf.filamentId === f.id));
    if (used) {
      void tell(`"${f.color}" is used in quotes, spools or prints and can't be deleted. Deprecate it, or merge it into another color.`);
      return;
    }
    this.#update((d) => {
      d.filaments = d.filaments.filter((x) => x.id !== f.id);
      for (const x of d.filaments) {
        if (x.predecessorId === f.id) delete x.predecessorId;
        if (x.successorId === f.id) delete x.successorId;
      }
    });
  }
}

/** What a filament merge moves, as list items. */
function describeMerge(p: MergePreview, keep: string): string[] {
  const moved = [
    [p.purchases, 'purchase'], [p.spools, 'spool'], [p.printJobs, 'print'], [p.quotes, 'quote'],
  ].filter(([n]) => n).map(([n, what]) => `${n} ${what}${n === 1 ? '' : 's'}`);
  return [
    moved.length ? `${moved.join(', ')} move to ${keep}.` : 'Nothing references it.',
    ...(p.snapshots ? [`${p.snapshots} frozen ${p.snapshots === 1 ? 'quote stays' : 'quotes stay'} as calculated and still shows the name.`] : []),
    ...(p.carriedOver.length ? [`${keep} takes over: ${p.carriedOver.map((k) => FIELD_LABEL[k] ?? k).join(', ')}.`] : []),
  ];
}

function stockCell(s: { knownG: number; spools: number; unknownSpools: number } | undefined, lowG: number | undefined) {
  const low = lowG !== undefined && (s?.knownG ?? 0) < lowG ? html` <span class="badge text-bg-danger">low</span>` : nothing;
  if (!s) return html`<span class="text-body-secondary">–</span>${low}`;
  return html`${num(s.knownG / 1000, 2)} kg${s.unknownSpools ? html` <span class="badge text-bg-warning" title="Spools not weighed yet">+${s.unknownSpools} ?</span>` : nothing}${low}`;
}
