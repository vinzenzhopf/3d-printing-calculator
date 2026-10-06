import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { AppDocument, Spool, SpoolType } from '../../../core/model';
import { labelGenerator, remainingG, spoolKeyFromScan, spoolsForPurchase, stockByFilament, suggestedSpoolCount } from '../../../core/stock';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { pickFilament } from '../../filament-picker';
import { scanAndOpen } from '../../qr-scanner';
import { cellNumber, cellSelect } from '../../fields';
import { newId, num, today } from '../../format';
import { SPOOL_TYPES, filamentLabel, spoolHref } from './labels';

type Filter = 'in-use' | 'open' | 'sealed' | 'empty' | 'all';
type Sort = 'left' | 'filament' | 'label';

const FILTERS: [Filter, string][] = [
  ['in-use', 'In use'],
  ['open', 'Open'],
  ['sealed', 'Sealed'],
  ['empty', 'Empty'],
  ['all', 'All'],
];

/**
 * Spool list: cards on phones, a table from md up. Every spool links to its
 * spool page (weigh, details, history), which is also what a label's QR opens.
 */
@customElement('filament-stock')
export class FilamentStock extends LitElement {
  #store = new StoreController(this, store());
  @state() private filter = '';
  @state() private show: Filter = 'in-use';
  @state() private sort: Sort = 'left';
  @state() private addMode: 'purchase' | 'shelf' | null = null;
  @state() private shelf = { filamentId: '', spoolType: 'plastic' as SpoolType, nominalG: 1000 };
  @state() private fromPurchase = { purchaseId: '', count: 1 };

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    const doc = this.#doc;
    const stock = [...stockByFilament(doc).values()];
    const knownKg = stock.reduce((sum, s) => sum + s.knownG, 0) / 1000;
    const unknown = stock.reduce((sum, s) => sum + s.unknownSpools, 0);
    const spools = this.#visible();
    return html`
      <div class="d-flex flex-wrap gap-3 align-items-center mb-3">
        <div><span class="fs-4 fw-semibold">${num(knownKg, 1)} kg</span> <span class="small text-body-secondary">in stock</span></div>
        <div><span class="fs-4 fw-semibold">${stock.reduce((sum, s) => sum + s.spools, 0)}</span> <span class="small text-body-secondary">spools in use</span></div>
        ${unknown ? html`<div><span class="fs-4 fw-semibold text-warning">${unknown}</span> <span class="small text-body-secondary">not weighed</span></div>` : nothing}
        <div class="ms-auto d-flex flex-wrap gap-2">
          <button class="btn btn-sm btn-outline-primary" @click=${() => (this.addMode = this.addMode === 'purchase' ? null : 'purchase')}>+ From purchase</button>
          <button class="btn btn-sm btn-outline-primary" @click=${() => (this.addMode = this.addMode === 'shelf' ? null : 'shelf')}>+ Found on shelf</button>
          <a class="btn btn-sm btn-outline-secondary" href="#/filaments/setup">Labels…</a>
        </div>
      </div>
      ${this.addMode ? html`<section class="card card-body mb-3 bg-body-tertiary">${this.addMode === 'purchase' ? this.#addFromPurchase() : this.#addFromShelf()}</section>` : nothing}

      <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
        <div class="input-group input-group-sm" style="max-width: 20rem">
          <input class="form-control" type="search" placeholder="Filter (color, brand, label, location)…" aria-label="Filter"
            .value=${this.filter} @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)} />
          <button class="btn btn-outline-primary" title="Scan a spool label with the camera" @click=${() => void scanAndOpen((text) => (this.filter = text))}>📷 Scan</button>
        </div>
        <div class="btn-group btn-group-sm" role="group" aria-label="Show">
          ${FILTERS.map(([v, label]) => html`<button class="btn ${this.show === v ? 'btn-secondary' : 'btn-outline-secondary'}" @click=${() => (this.show = v)}>${label}</button>`)}
        </div>
        <select class="form-select form-select-sm w-auto" aria-label="Sort" @change=${(e: Event) => (this.sort = (e.target as HTMLSelectElement).value as Sort)}>
          <option value="left" ?selected=${this.sort === 'left'}>Least left first</option>
          <option value="filament" ?selected=${this.sort === 'filament'}>By filament</option>
          <option value="label" ?selected=${this.sort === 'label'}>By label</option>
        </select>
      </div>

      ${doc.spools.length === 0
        ? html`<p class="text-body-secondary">No spools yet. Stock starts at zero: add spools from a purchase or the ones you find on the shelf, then weigh them.</p>`
        : spools.length === 0
          ? html`<p class="text-body-secondary">No spools match.</p>`
          : html`
              <div class="d-md-none list-group">${spools.map((s) => this.#card(s))}</div>
              <div class="d-none d-md-block table-responsive">
                <table class="table table-sm table-hover align-middle">
                  <thead><tr><th></th><th>Label</th><th>Filament</th><th>Status</th><th>Location</th><th style="width: 12rem">Left</th><th>Last change</th></tr></thead>
                  <tbody>${spools.map((s) => this.#row(s))}</tbody>
                </table>
              </div>`}
    `;
  }

  #name(s: Spool): string {
    const f = this.#doc.filaments.find((x) => x.id === s.filamentId);
    return f ? filamentLabel(this.#doc, f) : '?';
  }

  #visible(): Spool[] {
    // A pasted label link (any host) filters by its code.
    const q = (spoolKeyFromScan(this.filter.trim()) ?? this.filter).toLowerCase();
    const show = (s: Spool) =>
      this.show === 'all' ||
      (this.show === 'in-use' ? s.status === 'open' || s.status === 'sealed' : s.status === this.show);
    const left = (s: Spool) => remainingG(s) ?? -1; // unweighed first: they need attention
    return this.#doc.spools
      .filter(show)
      .filter((s) => !q || `${s.label} ${this.#name(s)} ${s.location ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) =>
        this.sort === 'left' ? left(a) - left(b)
        : this.sort === 'filament' ? this.#name(a).localeCompare(this.#name(b)) || left(a) - left(b)
        : a.label.localeCompare(b.label, undefined, { numeric: true }),
      );
  }

  #fill(s: Spool) {
    const g = remainingG(s);
    const pct = g !== null && s.nominalG > 0 ? Math.max(0, Math.min(100, (g / s.nominalG) * 100)) : null;
    const color = pct === null ? '' : pct < 15 ? 'bg-danger' : pct < 35 ? 'bg-warning' : '';
    return html`
      <div class="d-flex justify-content-between small"><span>${g === null ? html`<span class="badge text-bg-warning">not weighed</span>` : html`<strong>${num(g)} g</strong>`}</span><span class="text-body-secondary">${num(s.nominalG)} g</span></div>
      <div class="progress" style="height: 6px" role="progressbar" aria-label="Remaining" aria-valuenow=${pct ?? 0} aria-valuemin="0" aria-valuemax="100"><div class="progress-bar ${color}" style="width: ${pct ?? 0}%"></div></div>
    `;
  }

  #swatch(s: Spool, size = '1.75rem') {
    const hex = this.#doc.filaments.find((x) => x.id === s.filamentId)?.colorHex;
    return html`<span class="rounded-circle border flex-shrink-0 d-inline-block" style="width:${size};height:${size};background:${hex || 'transparent'}"></span>`;
  }

  #card(s: Spool) {
    return html`<a class="list-group-item list-group-item-action d-flex gap-3 align-items-center" href=${spoolHref(s)}>
      ${this.#swatch(s)}
      <div class="flex-grow-1" style="min-width: 0">
        <div class="d-flex gap-2"><span class="fw-semibold text-truncate">${this.#name(s)}</span></div>
        <div class="small text-body-secondary text-truncate">${s.label} · ${s.status}${s.location ? ` · ${s.location}` : ''}</div>
        ${this.#fill(s)}
      </div>
    </a>`;
  }

  #row(s: Spool) {
    const last = s.movements.at(-1)?.date ?? '–';
    return html`<tr role="link" style="cursor: pointer" @click=${() => (location.hash = spoolHref(s))}>
      <td>${this.#swatch(s, '1.1rem')}</td>
      <td><a href=${spoolHref(s)}>${s.label}</a></td>
      <td>${this.#name(s)}</td>
      <td class="small">${s.status}</td>
      <td class="small">${s.location ?? ''}</td>
      <td>${this.#fill(s)}</td>
      <td class="small text-nowrap">${last}</td>
    </tr>`;
  }

  #addFromPurchase() {
    const doc = this.#doc;
    const withSpools = new Set(doc.spools.map((s) => s.purchaseId).filter(Boolean));
    const purchases = doc.purchases.filter((p) => !withSpools.has(p.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
    const selected = doc.purchases.find((p) => p.id === this.fromPurchase.purchaseId);
    return html`<div class="row g-2 align-items-end">
      <div class="col-md-7"><label class="small d-block">Purchase (newest without spools)
        ${cellSelect(this.fromPurchase.purchaseId, [{ value: '', label: 'Choose…' }, ...purchases.map((p) => ({ value: p.id, label: `${p.date} · ${filamentLabel(doc, doc.filaments.find((f) => f.id === p.filamentId)!)} · ${num(p.totalKg, 2)} kg` }))], (v) => {
          const p = doc.purchases.find((x) => x.id === v);
          this.fromPurchase = { purchaseId: v, count: p ? suggestedSpoolCount(p) : 1 };
        }, true, 'Purchase')}</label></div>
      <div class="col-4 col-md-2"><label class="small d-block">Spools${cellNumber(this.fromPurchase.count, (v) => (this.fromPurchase = { ...this.fromPurchase, count: Math.max(1, v ?? 1) }), { min: 1, step: 1, title: 'Spools' })}</label></div>
      <div class="col-8 col-md-3"><button class="btn btn-sm btn-primary w-100" ?disabled=${!selected} @click=${async () => {
        if (!selected) return;
        const spools = spoolsForPurchase(selected, this.fromPurchase.count, { newId, nextLabel: labelGenerator(this.#doc), date: today() });
        await this.#store.store.update((d) => d.spools.push(...spools));
        this.addMode = null;
        this.fromPurchase = { purchaseId: '', count: 1 };
      }}>Add as sealed spools</button></div>
    </div>`;
  }

  #addFromShelf() {
    return html`<div class="row g-2 align-items-end">
      <div class="col-md-6"><div class="small">Filament</div>${pickFilament(this.shelf.filamentId, (v) => (this.shelf = { ...this.shelf, filamentId: v }))}</div>
      <div class="col-6 col-md-2"><label class="small d-block">Spool${cellSelect(this.shelf.spoolType, SPOOL_TYPES, (v) => (this.shelf = { ...this.shelf, spoolType: v as SpoolType }), true, 'Spool type')}</label></div>
      <div class="col-6 col-md-2"><label class="small d-block">Size (g)${cellNumber(this.shelf.nominalG, (v) => (this.shelf = { ...this.shelf, nominalG: v ?? 1000 }), { min: 0, step: 50, title: 'Nominal grams' })}</label></div>
      <div class="col-md-2"><button class="btn btn-sm btn-primary w-100" ?disabled=${!this.shelf.filamentId} @click=${async () => {
        const id = newId();
        const label = labelGenerator(this.#doc)();
        await this.#store.store.update((d) => d.spools.push({ id, filamentId: this.shelf.filamentId, label, nominalG: this.shelf.nominalG, spoolType: this.shelf.spoolType, status: 'open', movements: [] }));
        this.addMode = null;
        location.hash = `#/spool/${encodeURIComponent(label)}`; // weigh it right away
      }}>Add &amp; weigh</button></div>
      <p class="small text-body-secondary mb-0">Tip: stick a printed label on it and scan it instead. The app then asks which spool it is.</p>
    </div>`;
  }
}
