import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { packClass } from '../../../core/calc/price-resolution';
import type { AppDocument, FilamentPurchase } from '../../../core/model';
import { splitOrder, type Order, type OrderLine } from '../../../core/orders';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { cellNumber, cellSelect, cellText } from '../../fields';
import { money, newId, num, today } from '../../format';
import { pickFilament } from '../../filament-picker';
import { filamentLabel, kindOptions, storeDatalist, storeField } from './labels';
import { ask } from '../../dialogs';

/** For purchases, "no kind" means each spool gets the usual suggestion. */
const SUGGESTED = 'Empty spool: suggested';

function emptyOrder(): Order {
  return { date: today(), store: '', description: '', totalPrice: 0, shipping: 0, lines: [{ filamentId: '', kg: 1 }] };
}

@customElement('filament-purchases')
export class FilamentPurchases extends LitElement {
  #store = new StoreController(this, store());
  @state() private filter = '';
  @state() private draft: Order | null = null;
  /** Purchase shown as an edit row. */
  @state() private editing: string | null = null;

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const q = this.filter.toLowerCase();
    const label = new Map(doc.filaments.map((f) => [f.id, filamentLabel(doc, f)]));
    const purchases = doc.purchases
      .filter((p) => !q || `${p.date} ${p.store} ${p.description} ${label.get(p.filamentId) ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
    const kg = purchases.reduce((sum, p) => sum + p.totalKg, 0);
    const spent = purchases.reduce((sum, p) => sum + p.totalPrice, 0);

    return html`
      <div class="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <input
          class="form-control"
          style="max-width: 20rem"
          type="search"
          placeholder="Filter (date, store, filament)…"
          aria-label="Filter"
          .value=${this.filter}
          @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
        />
        <span class="text-body-secondary small">${purchases.length} purchases · ${num(kg, 1)} kg · ${money(spent, cur)}</span>
        <button class="btn btn-primary ms-auto" @click=${() => (this.draft = this.draft ? null : emptyOrder())}>
          ${this.draft ? 'Cancel' : 'Add purchase'}
        </button>
      </div>
      ${storeDatalist(doc)}
      ${this.draft ? this.#orderForm(this.draft) : nothing}
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead>
            <tr><th>Date</th><th>Store</th><th>Description</th><th>Filament</th><th class="text-end">kg</th><th class="text-end">Price</th><th class="text-end">/ kg</th><th>Pack</th><th></th></tr>
          </thead>
          <tbody>
            ${purchases.map((p) => (this.editing === p.id ? this.#editRow(p) : this.#row(p, cur)))}
          </tbody>
        </table>
      </div>
    `;
  }

  #row(p: FilamentPurchase, cur: string) {
    const f = this.#doc.filaments.find((x) => x.id === p.filamentId);
    const kind = this.#doc.spoolKinds.find((k) => k.id === p.kindId);
    return html`<tr>
      <td class="text-nowrap">${p.date}</td>
      <td>${p.store}</td>
      <td class="small" title=${p.listingTitle ?? ''}>${p.description || html`<span class="text-body-secondary">–</span>`}${kind ? html` <span class="badge text-bg-light border" title="Empty spool">${kind.name}</span>` : nothing}</td>
      <td class="small">${f ? filamentLabel(this.#doc, f) : '?'}</td>
      <td class="text-end">${num(p.totalKg, p.totalKg % 1 ? 2 : 0)}</td>
      <td class="text-end text-nowrap">${money(p.totalPrice, cur)}</td>
      <td class="text-end text-nowrap">${money(p.totalPrice / p.totalKg, cur)}</td>
      <td class="small">${packClass(p) === 'multi' ? `multi (${num(p.packSizeKg ?? p.packageWeightKg, 1)} kg)` : 'single'}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-link" title="Edit" @click=${() => (this.editing = p.id)}>✎</button>
        <button class="btn btn-sm btn-link text-danger" title="Delete" @click=${() => this.#delete(p)}>✕</button>
      </td>
    </tr>`;
  }

  /** All fields of a purchase, edited in place; each change is saved directly. */
  #editRow(p: FilamentPurchase) {
    const set = (mutate: (x: FilamentPurchase) => void) =>
      void this.#store.store.update((d) => mutate(d.purchases.find((x) => x.id === p.id)!));
    return html`<tr class="table-active">
      <td>${cellText(p.date, (v) => v && set((x) => (x.date = v)), { type: 'date', title: 'Date' })}</td>
      <td style="min-width: 9rem">${storeField(this.#doc, p.store, (v) => set((x) => (x.store = v)))}</td>
      <td>${cellText(p.description, (v) => set((x) => (x.description = v)), { title: 'Description', placeholder: 'Description / listing title' })}
        <div class="mt-1">${cellSelect(p.kindId ?? '', kindOptions(this.#doc, SUGGESTED), (v) => set((x) => (v ? (x.kindId = v) : delete x.kindId)), true, 'Empty spool')}</div></td>
      <td style="min-width: 18rem">${pickFilament(p.filamentId, (v) => { if (v) set((x) => (x.filamentId = v)); })}</td>
      <td style="width: 6rem">${cellNumber(p.totalKg, (v) => v && set((x) => { x.totalKg = v; x.packageWeightKg = v / (x.quantity || 1); }), { min: 0.01, step: 0.01, title: 'kg' })}</td>
      <td style="width: 7rem">${cellNumber(p.totalPrice, (v) => v !== null && set((x) => (x.totalPrice = v)), { min: 0, step: 0.01, title: 'Price incl. shipping share' })}</td>
      <td></td>
      <td style="width: 6rem">${cellNumber(p.packSizeKg ?? p.packageWeightKg, (v) => v && set((x) => (x.packSizeKg = v)), { min: 0.1, step: 0.5, title: 'Pack size as sold (kg)' })}</td>
      <td><button class="btn btn-sm btn-primary" @click=${() => (this.editing = null)}>Done</button></td>
    </tr>`;
  }

  #orderForm(order: Order) {
    const cur = this.#doc.settings.currency;
    const edit = (mutate: (o: Order) => void) => {
      const next = structuredClone(order);
      mutate(next);
      this.draft = next;
    };
    const editLine = (i: number, mutate: (l: OrderLine) => void) => edit((o) => mutate(o.lines[i]!));
    const valid = order.lines.some((l) => l.filamentId && l.kg > 0) && order.lines.every((l) => !l.kg || l.filamentId) && order.totalPrice > 0;
    const preview = valid ? splitOrder(order, () => '') : [];
    return html`
      <section class="card card-body mb-3 bg-body-tertiary">
        <h2 class="h6">New purchase</h2>
        <div class="row g-2 mb-2">
          <div class="col-md-2">${cellText(order.date, (v) => edit((o) => (o.date = v)), { type: 'date', title: 'Date' })}</div>
          <div class="col-md-2">${storeField(this.#doc, order.store, (v) => edit((o) => (o.store = v)))}</div>
          <div class="col-md-4">${cellText(order.description, (v) => edit((o) => (o.description = v)), { title: 'Description', placeholder: 'Description / listing title' })}</div>
          <div class="col-md-2">${cellSelect(order.kindId ?? '', kindOptions(this.#doc, SUGGESTED), (v) => edit((o) => (v ? (o.kindId = v) : delete o.kindId)), true, 'Empty spool')}</div>
        </div>
        <table class="table table-sm align-middle mb-2">
          <thead><tr><th>Filament</th><th>kg</th><th>Own price (optional)</th><th class="text-end">Resulting</th><th></th></tr></thead>
          <tbody>
            ${order.lines.map((l, i) => html`<tr>
              <td style="min-width: 18rem">${pickFilament(l.filamentId, (v) => editLine(i, (x) => (x.filamentId = v)))}</td>
              <td style="width: 7rem">${cellNumber(l.kg, (v) => editLine(i, (x) => (x.kg = v ?? 0)), { min: 0, step: 0.01, title: 'kg' })}</td>
              <td style="width: 10rem">${cellNumber(l.price ?? null, (v) => editLine(i, (x) => (v === null ? delete x.price : (x.price = v))), { min: 0, step: 0.01, allowEmpty: true, title: 'Line price' })}</td>
              <td class="text-end text-nowrap">${preview[i] ? `${money(preview[i]!.totalPrice, cur)} (${money(preview[i]!.totalPrice / preview[i]!.totalKg, cur)}/kg)` : ''}</td>
              <td>${order.lines.length > 1 ? html`<button class="btn btn-sm btn-link text-danger" title="Remove line" @click=${() => edit((o) => o.lines.splice(i, 1))}>✕</button>` : nothing}</td>
            </tr>`)}
          </tbody>
        </table>
        <div class="row g-2 align-items-end">
          <div class="col-auto"><button class="btn btn-sm btn-outline-primary" @click=${() => edit((o) => o.lines.push({ filamentId: '', kg: 1 }))}>+ Color / line</button></div>
          <div class="col-md-2 ms-auto"><label class="small">Price (filament)${cellNumber(order.totalPrice, (v) => edit((o) => (o.totalPrice = v ?? 0)), { min: 0, step: 0.01, title: 'Total price' })}</label></div>
          <div class="col-md-2"><label class="small">Shipping${cellNumber(order.shipping, (v) => edit((o) => (o.shipping = v ?? 0)), { min: 0, step: 0.01, title: 'Shipping' })}</label></div>
          <div class="col-auto"><button class="btn btn-primary" ?disabled=${!valid} @click=${this.#save}>Save</button></div>
        </div>
        <p class="small text-body-secondary mt-2 mb-0">
          Bundles: add one line per color. The price is split by weight unless a line has its own price; shipping is
          spread over the lines. Packs of 2 kg or more count as multi-packs for pricing.
        </p>
      </section>
    `;
  }

  #save = () => {
    const order = this.draft;
    if (!order) return;
    const purchases = splitOrder(order, newId);
    void this.#store.store.update((d) => d.purchases.push(...purchases));
    this.draft = null;
  };

  async #delete(p: FilamentPurchase) {
    if (!(await ask(`Delete the purchase from ${p.date} (${p.description || p.store})?`, { ok: 'Delete', danger: true }))) return;
    void this.#store.store.update((d) => (d.purchases = d.purchases.filter((x) => x.id !== p.id)));
  }
}
