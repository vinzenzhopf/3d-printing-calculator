import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { AppDocument, Customer } from '../../core/model';
import { BILLED_STATUSES, quoteResult } from '../../core/quotes';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import { numberField, selectField, textAreaField, textField, type Option } from '../fields';
import { money, newId, today } from '../format';
import { STATUS_COLOR } from './quotes/status';

const GROUPS = ['family', 'friends', 'colleagues', 'business', 'other'];

@customElement('customers-page')
export class CustomersPage extends LitElement {
  #store = new StoreController(this, store());
  @state() private editing: string | null = null;
  @state() private filter = '';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    const q = this.filter.toLowerCase();
    const customers = [...this.#doc.customers]
      .filter((c) => !q || `${c.name} ${c.tag ?? ''} ${c.group ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    return html`
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <h1 class="h3 mb-0 me-auto">Customers</h1>
        <input class="form-control" style="max-width: 16rem" type="search" placeholder="Filter…" aria-label="Filter"
          .value=${this.filter} @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)} />
        <button class="btn btn-primary" @click=${this.#add}>Add customer</button>
      </div>
      <p class="small text-body-secondary">Stored only in this browser (and your own sync storage, if connected). Keep it to what you need.</p>
      ${customers.length === 0 ? html`<p class="text-body-secondary">No customers yet.</p>` : nothing}
      ${customers.map((c) => this.#card(c))}
    `;
  }

  #card(c: Customer) {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const asOf = today();
    const quotes = doc.quotes.filter((q) => q.customerId === c.id).sort((a, b) => b.number - a.number);
    const billed = quotes.filter((q) => BILLED_STATUSES.has(q.status));
    const revenue = billed.reduce((sum, q) => sum + (quoteResult(doc, q, asOf)?.price ?? 0), 0);
    const open = billed.filter((q) => q.status !== 'paid').reduce((sum, q) => sum + (quoteResult(doc, q, asOf)?.price ?? 0), 0);
    const editing = this.editing === c.id;
    const profile = doc.pricingProfiles.find((p) => p.id === c.defaultPricingProfileId);
    return html`
      <section class="card mb-2">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
          <strong>${c.name}</strong>
          ${c.tag ? html`<span class="badge text-bg-light border">${c.tag}</span>` : nothing}
          ${c.group ? html`<span class="small text-body-secondary">${c.group}</span>` : nothing}
          <span class="small ms-auto">${quotes.length} quotes · ${money(revenue, cur)}${open > 0 ? html` · <span class="text-danger">${money(open, cur)} open</span>` : nothing}</span>
          <button class="btn btn-sm btn-outline-secondary" @click=${() => (this.editing = editing ? null : c.id)}>${editing ? 'Done' : 'Edit'}</button>
        </div>
        ${editing
          ? this.#editor(c, quotes.length)
          : html`<div class="card-body py-2 small">
              ${profile ? html`Profile: ${profile.name}` : nothing}${c.discountPercent ? ` · ${c.discountPercent} % discount` : ''}
              ${quotes.slice(0, 5).map((q) => html` · <a href="#/quotes/${q.id}">#${q.number}</a> <span class="badge text-bg-${STATUS_COLOR[q.status]}">${q.status}</span>`)}
            </div>`}
      </section>
    `;
  }

  #editor(c: Customer, quoteCount: number) {
    const set = (mutate: (x: Customer) => void) =>
      void this.#store.store.update((d) => mutate(d.customers.find((x) => x.id === c.id)!));
    const opt = (v: string) => v || undefined;
    const profiles: Option[] = [{ value: '', label: '– default –' }, ...this.#doc.pricingProfiles.map((p) => ({ value: p.id, label: p.name }))];
    return html`<div class="card-body">
      <div class="row">
        <div class="col-md-4">
          ${textField('Name', c.name, (v) => set((x) => (x.name = v)))}
          ${textField('Tag', c.tag ?? '', (v) => set((x) => (x.tag = opt(v))), { help: 'Short form, e.g. initials.' })}
          ${selectField('Group', c.group ?? '', [{ value: '', label: '–' }, ...GROUPS.map((g) => ({ value: g, label: g }))], (v) => set((x) => (x.group = opt(v))))}
        </div>
        <div class="col-md-4">
          ${textField('E-mail', c.email ?? '', (v) => set((x) => (x.email = opt(v))))}
          ${textField('Phone', c.phone ?? '', (v) => set((x) => (x.phone = opt(v))))}
          ${textField('Messenger', c.messenger ?? '', (v) => set((x) => (x.messenger = opt(v))))}
          ${textAreaField('Address', c.address ?? '', (v) => set((x) => (x.address = opt(v))), { help: 'Printed on quotes.' })}
        </div>
        <div class="col-md-4">
          ${selectField('Default pricing profile', c.defaultPricingProfileId ?? '', profiles, (v) => set((x) => (x.defaultPricingProfileId = opt(v))))}
          ${numberField('Discount', c.discountPercent ?? 0, (v) => set((x) => (x.discountPercent = v || undefined)), { suffix: '%', min: 0, max: 100 })}
          ${textField('Payment preference', c.paymentPreference ?? '', (v) => set((x) => (x.paymentPreference = opt(v))), { placeholder: 'cash, PayPal, transfer…' })}
          ${textAreaField('Notes', c.notes ?? '', (v) => set((x) => (x.notes = opt(v))), { placeholder: 'Preferred colors, materials…' })}
        </div>
      </div>
      ${quoteCount === 0
        ? html`<button class="btn btn-sm btn-outline-danger" @click=${() => void this.#store.store.update((d) => (d.customers = d.customers.filter((x) => x.id !== c.id)))}>Delete customer</button>`
        : html`<p class="small text-body-secondary mb-0">Customers with quotes can't be deleted.</p>`}
    </div>`;
  }

  #add = () => {
    const id = newId();
    void this.#store.store.update((d) => d.customers.push({ id, name: 'New customer' }));
    this.editing = id;
    this.filter = '';
  };
}
