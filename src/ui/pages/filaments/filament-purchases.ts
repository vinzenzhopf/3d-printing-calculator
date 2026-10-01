import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { packClass } from '../../../core/calc/price-resolution';
import type { AppDocument, FilamentPurchase } from '../../../core/model';
import { splitOrder, type Order, type OrderLine } from '../../../core/orders';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { cellNumber, cellSelect, cellText, type Option } from '../../fields';
import { money, newId, num, today } from '../../format';
import { filamentLabel, filamentOptions } from './labels';

const SPOOL_TYPES: Option[] = [
  { value: '', label: 'Spool type…' },
  { value: 'plastic', label: 'Plastic spool' },
  { value: 'cardboard', label: 'Cardboard spool' },
  { value: 'refill', label: 'Refill (no spool)' },
];

function emptyOrder(): Order {
  return { date: today(), store: '', description: '', totalPrice: 0, shipping: 0, lines: [{ filamentId: '', kg: 1 }] };
}

@customElement('filament-purchases')
export class FilamentPurchases extends LitElement {
  #store = new StoreController(this, store());
  @state() private filter = '';
  @state() private draft: Order | null = null;

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
      ${this.draft ? this.#orderForm(this.draft) : nothing}
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead>
            <tr><th>Date</th><th>Store</th><th>Description</th><th>Filament</th><th class="text-end">kg</th><th class="text-end">Price</th><th class="text-end">/ kg</th><th>Pack</th><th></th></tr>
          </thead>
          <tbody>
            ${purchases.map((p) => this.#row(p, cur))}
          </tbody>
        </table>
      </div>
    `;
  }

  #row(p: FilamentPurchase, cur: string) {
    const set = (mutate: (x: FilamentPurchase) => void) =>
      void this.#store.store.update((d) => mutate(d.purchases.find((x) => x.id === p.id)!));
    return html`<tr>
      <td class="text-nowrap">${p.date}</td>
      <td>${p.store}</td>
      <td class="small" title=${p.listingTitle ?? ''}>${p.description}${p.spoolType === 'refill' ? html` <span class="badge text-bg-light border">refill</span>` : nothing}</td>
      <td style="min-width: 14rem">${cellSelect(p.filamentId, filamentOptions(this.#doc), (v) => set((x) => (x.filamentId = v)), true, 'Filament')}</td>
      <td class="text-end">${num(p.totalKg, p.totalKg % 1 ? 2 : 0)}</td>
      <td class="text-end text-nowrap">${money(p.totalPrice, cur)}</td>
      <td class="text-end text-nowrap">${money(p.totalPrice / p.totalKg, cur)}</td>
      <td class="small">${packClass(p) === 'multi' ? `multi (${num(p.packSizeKg ?? p.packageWeightKg, 1)} kg)` : 'single'}</td>
      <td><button class="btn btn-sm btn-link text-danger" title="Delete" @click=${() => this.#delete(p)}>✕</button></td>
    </tr>`;
  }

  #orderForm(order: Order) {
    const cur = this.#doc.settings.currency;
    const options: Option[] = [{ value: '', label: 'Filament…' }, ...filamentOptions(this.#doc)];
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
          <div class="col-md-2">${cellText(order.store, (v) => edit((o) => (o.store = v)), { title: 'Store', placeholder: 'Store' })}</div>
          <div class="col-md-4">${cellText(order.description, (v) => edit((o) => (o.description = v)), { title: 'Description', placeholder: 'Description / listing title' })}</div>
          <div class="col-md-2">${cellSelect(order.spoolType ?? '', SPOOL_TYPES, (v) => edit((o) => (o.spoolType = (v || null) as Order['spoolType'])), true, 'Spool type')}</div>
        </div>
        <table class="table table-sm align-middle mb-2">
          <thead><tr><th>Filament</th><th>kg</th><th>Own price (optional)</th><th class="text-end">Resulting</th><th></th></tr></thead>
          <tbody>
            ${order.lines.map((l, i) => html`<tr>
              <td>${cellSelect(l.filamentId, options, (v) => editLine(i, (x) => (x.filamentId = v)), true, 'Filament')}</td>
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

  #delete(p: FilamentPurchase) {
    if (!confirm(`Delete the purchase from ${p.date} (${p.description || p.store})?`)) return;
    void this.#store.store.update((d) => (d.purchases = d.purchases.filter((x) => x.id !== p.id)));
  }
}
