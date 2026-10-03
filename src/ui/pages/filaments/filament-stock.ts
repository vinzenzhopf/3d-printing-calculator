import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { AppDocument, Spool, SpoolType, TarePreset } from '../../../core/model';
import {
  labelGenerator, remainingG, resolveTare, spoolsForPurchase, stockByFilament, suggestedSpoolCount, weighIn,
  type ResolvedTare,
} from '../../../core/stock';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { cellNumber, cellSelect, cellText, switchField, type Option } from '../../fields';
import { money, newId, num, today } from '../../format';
import { pickFilament } from '../../filament-picker';
import { filamentLabel, lineLabel } from './labels';

const STATUS: Option[] = [
  { value: 'sealed', label: 'Sealed' },
  { value: 'open', label: 'Open' },
  { value: 'empty', label: 'Empty' },
  { value: 'discarded', label: 'Discarded' },
];
const SPOOL_TYPES: Option[] = [
  { value: 'plastic', label: 'Plastic spool' },
  { value: 'cardboard', label: 'Cardboard spool' },
  { value: 'refill', label: 'Refill / reusable spool' },
];
const TARE_SOURCE: Record<ResolvedTare['source'], string> = {
  spool: 'measured',
  line: 'line preset',
  manufacturer: 'brand preset',
  default: 'generic preset',
  none: 'no preset',
};

@customElement('filament-stock')
export class FilamentStock extends LitElement {
  #store = new StoreController(this, store());
  @state() private weighSpoolId = '';
  @state() private grossG: number | null = null;
  @state() private isEmptySpool = false;
  @state() private saveAsPreset = true;
  @state() private filter = '';
  @state() private showUsedUp = false;
  @state() private open = new Set<string>();
  @state() private addMode: 'purchase' | 'shelf' | null = null;
  @state() private shelf = { filamentId: '', spoolType: 'plastic' as SpoolType, nominalG: 1000 };
  @state() private fromPurchase = { purchaseId: '', count: 1 };

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  #update(mutate: (doc: AppDocument) => void) {
    return this.#store.store.update(mutate);
  }

  override render() {
    const doc = this.#doc;
    const stock = [...stockByFilament(doc).values()];
    const knownKg = stock.reduce((sum, s) => sum + s.knownG, 0) / 1000;
    const unknown = stock.reduce((sum, s) => sum + s.unknownSpools, 0);
    return html`
      <div class="row g-3">
        <div class="col-lg-5">${this.#weighPanel()}</div>
        <div class="col-lg-7">
          <section class="card card-body mb-3">
            <div class="d-flex flex-wrap gap-3 align-items-center">
              <div><div class="fs-4 fw-semibold">${num(knownKg, 1)} kg</div><div class="small text-body-secondary">known stock</div></div>
              <div><div class="fs-4 fw-semibold">${stock.reduce((sum, s) => sum + s.spools, 0)}</div><div class="small text-body-secondary">spools in use</div></div>
              ${unknown ? html`<div><div class="fs-4 fw-semibold text-warning">${unknown}</div><div class="small text-body-secondary">not weighed yet</div></div>` : nothing}
              <div class="ms-auto d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary" @click=${() => (this.addMode = this.addMode === 'purchase' ? null : 'purchase')}>+ From purchase</button>
                <button class="btn btn-sm btn-outline-primary" @click=${() => (this.addMode = this.addMode === 'shelf' ? null : 'shelf')}>+ Found on shelf</button>
              </div>
            </div>
            ${this.addMode === 'purchase' ? this.#addFromPurchase() : this.addMode === 'shelf' ? this.#addFromShelf() : nothing}
          </section>
        </div>
      </div>
      ${this.#spoolTable()} ${this.#presets()}
    `;
  }

  // --- Weigh-in (phone-friendly) -------------------------------------------

  #weighPanel() {
    const doc = this.#doc;
    const spools = doc.spools.filter((s) => s.status !== 'discarded').sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const spool = doc.spools.find((s) => s.id === this.weighSpoolId);
    const tare = spool ? resolveTare(doc, spool) : null;
    const preview = spool && this.grossG !== null && !this.isEmptySpool ? weighIn(doc, spool, this.grossG, today(), '') : null;
    const line = spool ? doc.productLines.find((l) => l.id === doc.filaments.find((f) => f.id === spool.filamentId)?.productLineId) : undefined;
    return html`
      <section class="card card-body">
        <h2 class="h5">Weigh a spool</h2>
        <label class="form-label">Spool
          ${cellSelect(this.weighSpoolId, [{ value: '', label: 'Choose spool…' }, ...spools.map((s) => ({ value: s.id, label: `${s.label} · ${filamentLabel(doc, doc.filaments.find((f) => f.id === s.filamentId)!)}` }))], (v) => { this.weighSpoolId = v; this.isEmptySpool = false; }, false, 'Spool')}
        </label>
        <label class="form-label">Scale reading (g, with spool)
          <input class="form-control form-control-lg" type="number" inputmode="decimal" min="0" step="1"
            .value=${this.grossG === null ? '' : String(this.grossG)}
            @input=${(e: Event) => { const v = (e.target as HTMLInputElement).valueAsNumber; this.grossG = Number.isFinite(v) ? v : null; }} />
        </label>
        ${spool
          ? html`
              ${switchField('This is the empty spool', this.isEmptySpool, (v) => (this.isEmptySpool = v), { help: 'Marks the spool empty and stores its weight as its tare.' })}
              ${this.isEmptySpool && line
                ? switchField(`Save as preset for ${lineLabel(line)} (${spool.spoolType ?? 'plastic'})`, this.saveAsPreset, (v) => (this.saveAsPreset = v))
                : nothing}
              <div class="small mb-2">
                Tare: <strong>${tare?.grams === null || !tare ? '?' : `${tare.grams} g`}</strong> (${tare ? TARE_SOURCE[tare.source] : ''}${tare && !tare.verified ? ', unverified' : ''})
                · Before: ${remainingG(spool) === null ? 'unknown' : `${num(remainingG(spool))} g`}
              </div>
              ${preview ? html`<div class="fs-4 mb-2">→ <strong>${num(preview.netG)} g</strong> <span class="fs-6 text-body-secondary">(${preview.movement.grams >= 0 ? '+' : ''}${num(preview.movement.grams)} g)</span></div>` : nothing}
            `
          : nothing}
        <button class="btn btn-primary btn-lg" ?disabled=${!spool || this.grossG === null} @click=${this.#saveWeighIn}>Save</button>
      </section>
    `;
  }

  #saveWeighIn = async () => {
    const doc = this.#doc;
    const spool = doc.spools.find((s) => s.id === this.weighSpoolId);
    if (!spool || this.grossG === null) return;
    const gross = this.grossG;
    const date = today();
    if (this.isEmptySpool) {
      const filament = doc.filaments.find((f) => f.id === spool.filamentId);
      const line = doc.productLines.find((l) => l.id === filament?.productLineId);
      const type = spool.spoolType ?? 'plastic';
      await this.#update((d) => {
        const s = d.spools.find((x) => x.id === spool.id)!;
        s.tareG = gross;
        s.status = 'empty';
        const left = remainingG(s);
        if (left) s.movements.push({ id: newId(), date, kind: 'weigh-in', grams: -left, grossG: gross, tareG: gross, note: 'Empty spool' });
        if (this.saveAsPreset && line) {
          const existing = d.tarePresets.find((p) => p.productLineId === line.id && p.spoolType === type);
          if (existing) Object.assign(existing, { emptyG: gross, source: `measured ${date}`, verified: true });
          else d.tarePresets.push({ id: newId(), manufacturer: line.manufacturer, productLineId: line.id, spoolType: type, emptyG: gross, source: `measured ${date}`, verified: true });
        }
      });
    } else {
      const { movement } = weighIn(doc, spool, gross, date, newId());
      await this.#update((d) => {
        const s = d.spools.find((x) => x.id === spool.id)!;
        s.movements.push(movement);
        if (s.status === 'sealed') s.status = 'open';
      });
    }
    this.grossG = null;
    this.isEmptySpool = false;
  };

  // --- Adding spools --------------------------------------------------------

  #addFromPurchase() {
    const doc = this.#doc;
    const withSpools = new Set(doc.spools.map((s) => s.purchaseId).filter(Boolean));
    const purchases = doc.purchases.filter((p) => !withSpools.has(p.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
    const selected = doc.purchases.find((p) => p.id === this.fromPurchase.purchaseId);
    return html`<div class="row g-2 mt-2 align-items-end">
      <div class="col-md-7"><label class="small d-block">Purchase (newest without spools)
        ${cellSelect(this.fromPurchase.purchaseId, [{ value: '', label: 'Choose…' }, ...purchases.map((p) => ({ value: p.id, label: `${p.date} · ${filamentLabel(doc, doc.filaments.find((f) => f.id === p.filamentId)!)} · ${num(p.totalKg, 2)} kg` }))], (v) => {
          const p = doc.purchases.find((x) => x.id === v);
          this.fromPurchase = { purchaseId: v, count: p ? suggestedSpoolCount(p) : 1 };
        }, true, 'Purchase')}</label></div>
      <div class="col-md-2"><label class="small d-block">Spools${cellNumber(this.fromPurchase.count, (v) => (this.fromPurchase = { ...this.fromPurchase, count: Math.max(1, v ?? 1) }), { min: 1, step: 1, title: 'Spools' })}</label></div>
      <div class="col-md-3"><button class="btn btn-sm btn-primary w-100" ?disabled=${!selected} @click=${async () => {
        if (!selected) return;
        const spools = spoolsForPurchase(selected, this.fromPurchase.count, { newId, nextLabel: labelGenerator(this.#doc), date: today() });
        await this.#update((d) => d.spools.push(...spools));
        this.addMode = null;
        this.fromPurchase = { purchaseId: '', count: 1 };
      }}>Add as sealed spools</button></div>
    </div>`;
  }

  #addFromShelf() {
    const doc = this.#doc;
    return html`<div class="row g-2 mt-2 align-items-end">
      <div class="col-md-5"><div class="small">Filament</div>${pickFilament(this.shelf.filamentId, (v) => (this.shelf = { ...this.shelf, filamentId: v }))}</div>
      <div class="col-md-3"><label class="small d-block">Spool${cellSelect(this.shelf.spoolType, SPOOL_TYPES, (v) => (this.shelf = { ...this.shelf, spoolType: v as SpoolType }), true, 'Spool type')}</label></div>
      <div class="col-md-2"><label class="small d-block">Size (g)${cellNumber(this.shelf.nominalG, (v) => (this.shelf = { ...this.shelf, nominalG: v ?? 1000 }), { min: 0, step: 50, title: 'Nominal grams' })}</label></div>
      <div class="col-md-2"><button class="btn btn-sm btn-primary w-100" ?disabled=${!this.shelf.filamentId} @click=${async () => {
        const label = labelGenerator(this.#doc)();
        const id = newId();
        await this.#update((d) => d.spools.push({ id, filamentId: this.shelf.filamentId, label, nominalG: this.shelf.nominalG, spoolType: this.shelf.spoolType, status: 'open', movements: [] }));
        this.addMode = null;
        this.weighSpoolId = id; // weigh it right away
      }}>Add</button></div>
      <p class="small text-body-secondary mb-0">Stock stays "unknown" until you weigh it. It's preselected in the weigh panel.</p>
    </div>`;
  }

  // --- Spool list -----------------------------------------------------------

  #spoolTable() {
    const doc = this.#doc;
    const q = this.filter.toLowerCase();
    const label = new Map(doc.filaments.map((f) => [f.id, filamentLabel(doc, f)]));
    const spools = doc.spools
      .filter((s) => this.showUsedUp || (s.status !== 'empty' && s.status !== 'discarded'))
      .filter((s) => !q || `${s.label} ${label.get(s.filamentId) ?? ''} ${s.location ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (label.get(a.filamentId) ?? '').localeCompare(label.get(b.filamentId) ?? '') || a.label.localeCompare(b.label, undefined, { numeric: true }));
    return html`
      <div class="d-flex flex-wrap gap-2 align-items-center mt-4 mb-2">
        <h2 class="h5 mb-0 me-auto">Spools</h2>
        <input class="form-control form-control-sm" style="max-width: 16rem" type="search" placeholder="Filter (label, filament, location)…" aria-label="Filter"
          .value=${this.filter} @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)} />
        ${switchField('Show empty / discarded', this.showUsedUp, (v) => (this.showUsedUp = v))}
      </div>
      ${doc.spools.length === 0
        ? html`<p class="text-body-secondary">No spools yet. Stock starts at zero: add spools from a purchase, or the ones you find on the shelf, and weigh them.</p>`
        : html`<div class="table-responsive"><table class="table table-sm align-middle">
            <thead><tr><th>Label</th><th>Filament</th><th>Status</th><th>Location</th><th class="text-end">Stock</th><th>Tare</th><th></th></tr></thead>
            <tbody>${spools.map((s) => this.#spoolRows(s, label.get(s.filamentId) ?? '?'))}</tbody>
          </table></div>`}
    `;
  }

  #spoolRows(s: Spool, filament: string) {
    const doc = this.#doc;
    const g = remainingG(s);
    const tare = resolveTare(doc, s);
    const isOpen = this.open.has(s.id);
    const set = (mutate: (x: Spool) => void) => void this.#update((d) => mutate(d.spools.find((x) => x.id === s.id)!));
    const toggle = () => {
      const next = new Set(this.open);
      if (!next.delete(s.id)) next.add(s.id);
      this.open = next;
    };
    const pct = g !== null && s.nominalG > 0 ? Math.max(0, Math.min(100, (g / s.nominalG) * 100)) : null;
    return html`
      <tr>
        <td><button class="btn btn-sm btn-link p-0 text-decoration-none" @click=${toggle}>${isOpen ? '▾' : '▸'} ${s.label}</button></td>
        <td class="small">${filament}</td>
        <td>${cellSelect(s.status, STATUS, (v) => set((x) => (x.status = v as Spool['status'])), true, 'Status')}</td>
        <td style="max-width: 9rem">${cellText(s.location, (v) => set((x) => (x.location = v || undefined)), { title: 'Location', placeholder: 'shelf, dry box…' })}</td>
        <td class="text-end text-nowrap" style="min-width: 7rem">
          ${g === null ? html`<span class="badge text-bg-warning">unknown</span>` : html`${num(g)} g
            <div class="progress" style="height: 4px" role="progressbar" aria-label="Remaining" aria-valuenow=${pct ?? 0} aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width: ${pct ?? 0}%"></div></div>`}
        </td>
        <td class="small text-nowrap">${tare.grams === null ? '?' : `${tare.grams} g`} <span class="text-body-secondary">${TARE_SOURCE[tare.source]}</span></td>
        <td><button class="btn btn-sm btn-outline-primary" title="Weigh" @click=${() => { this.weighSpoolId = s.id; this.isEmptySpool = false; window.scrollTo({ top: 0, behavior: 'smooth' }); }}>⚖</button></td>
      </tr>
      ${isOpen ? html`<tr><td colspan="7" class="bg-body-tertiary">${this.#ledger(s)}</td></tr>` : nothing}
    `;
  }

  #ledger(s: Spool) {
    const cur = this.#doc.settings.currency;
    const purchase = this.#doc.purchases.find((p) => p.id === s.purchaseId);
    let running = 0;
    const rows = s.movements.map((m) => ({ m, after: (running += m.grams) }));
    return html`
      <div class="row g-2 small">
        <div class="col-md-7">
          <table class="table table-sm mb-2">
            <thead><tr><th>Date</th><th>Kind</th><th class="text-end">Change</th><th class="text-end">After</th><th>Note</th></tr></thead>
            <tbody>
              ${rows.length === 0 ? html`<tr><td colspan="5" class="text-body-secondary">No movements: stock unknown.</td></tr>` : nothing}
              ${rows.map(({ m, after }) => html`<tr>
                <td>${m.date}</td><td>${m.kind}</td>
                <td class="text-end">${m.grams >= 0 ? '+' : ''}${num(m.grams)} g</td>
                <td class="text-end">${num(after)} g</td>
                <td>${m.grossG !== undefined ? `scale ${num(m.grossG)} g − tare ${num(m.tareG ?? 0)} g` : ''}${m.note ? ` ${m.note}` : ''}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>
        <div class="col-md-5">
          <div class="mb-1">Size: ${num(s.nominalG)} g · ${s.spoolType ?? 'plastic'}${purchase ? html` · bought ${purchase.date} (${money(purchase.totalPrice / purchase.totalKg, cur)}/kg)` : nothing}</div>
          <div class="d-flex gap-2 align-items-center mb-2">
            Own tare (g) ${cellNumber(s.tareG ?? null, (v) => void this.#update((d) => { const x = d.spools.find((y) => y.id === s.id)!; if (v === null) delete x.tareG; else x.tareG = v; }), { min: 0, allowEmpty: true, width: '6rem', title: 'Own tare' })}
          </div>
          <div class="d-flex gap-2 align-items-center mb-2">
            Correct by (g) ${cellNumber(null, (v) => { if (v) void this.#update((d) => d.spools.find((y) => y.id === s.id)!.movements.push({ id: newId(), date: today(), kind: 'adjust', grams: v, note: 'Manual correction' })); }, { allowEmpty: true, width: '6rem', title: 'Correction in grams' })}
          </div>
          <button class="btn btn-sm btn-outline-danger" @click=${() => {
            if (confirm(`Delete spool ${s.label} and its history?`)) void this.#update((d) => (d.spools = d.spools.filter((x) => x.id !== s.id)));
          }}>Delete spool</button>
        </div>
      </div>
    `;
  }

  // --- Tare presets ---------------------------------------------------------

  #presets() {
    const doc = this.#doc;
    const lines: Option[] = [{ value: '', label: 'any line' }, ...doc.productLines.map((l) => ({ value: l.id, label: lineLabel(l) }))];
    const set = (id: string, mutate: (p: TarePreset) => void) => void this.#update((d) => mutate(d.tarePresets.find((p) => p.id === id)!));
    return html`
      <h2 class="h5 mt-4">Empty-spool weights</h2>
      <p class="small text-body-secondary">Used to turn scale readings into filament weight. A spool's own measured weight wins, then product line, then brand, then the generic values. Weigh an empty spool once to replace the estimates.</p>
      <div class="table-responsive"><table class="table table-sm align-middle">
        <thead><tr><th>Brand</th><th>Product line</th><th>Spool</th><th>Empty (g)</th><th>Source</th><th>Verified</th><th></th></tr></thead>
        <tbody>
          ${doc.tarePresets.map((p) => html`<tr>
            <td>${cellText(p.manufacturer, (v) => set(p.id, (x) => (x.manufacturer = v || null)), { title: 'Brand', placeholder: 'any' })}</td>
            <td>${cellSelect(p.productLineId ?? '', lines, (v) => set(p.id, (x) => (x.productLineId = v || null)), true, 'Product line')}</td>
            <td>${cellSelect(p.spoolType, SPOOL_TYPES, (v) => set(p.id, (x) => (x.spoolType = v as SpoolType)), true, 'Spool type')}</td>
            <td style="width: 7rem">${cellNumber(p.emptyG, (v) => set(p.id, (x) => (x.emptyG = v ?? 0)), { min: 0, title: 'Empty grams' })}</td>
            <td class="small">${p.source}</td>
            <td><input class="form-check-input" type="checkbox" aria-label="Verified" .checked=${p.verified} @change=${(e: Event) => set(p.id, (x) => (x.verified = (e.target as HTMLInputElement).checked))} /></td>
            <td><button class="btn btn-sm btn-link text-danger" title="Delete" @click=${() => void this.#update((d) => (d.tarePresets = d.tarePresets.filter((x) => x.id !== p.id)))}>✕</button></td>
          </tr>`)}
        </tbody>
      </table></div>
      <button class="btn btn-sm btn-outline-primary" @click=${() => void this.#update((d) => d.tarePresets.push({ id: newId(), manufacturer: null, productLineId: null, spoolType: 'plastic', emptyG: 200, source: 'manual', verified: false }))}>+ Add preset</button>
    `;
  }
}
