import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AppDocument } from '../../core/model';
import { createQuote, quoteResult } from '../../core/quotes';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import { money, newId, today } from '../format';
import './quotes/quote-editor';
import { STATUS_COLOR } from './quotes/status';

@customElement('quotes-page')
export class QuotesPage extends LitElement {
  /** Quote id from `#/quotes/<id>`; empty = list. */
  @property() sub = '';
  #store = new StoreController(this, store());
  @state() private filter = '';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    if (this.sub) {
      return this.#doc.quotes.some((q) => q.id === this.sub)
        ? html`<quote-editor .quoteId=${this.sub}></quote-editor>`
        : html`<div class="alert alert-warning">Quote not found. <a href="#/quotes">Back to quotes</a></div>`;
    }
    return this.#list();
  }

  #list() {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const asOf = today();
    const customer = new Map(doc.customers.map((c) => [c.id, c.name]));
    const q = this.filter.toLowerCase();
    const quotes = doc.quotes
      .filter((x) => !q || `${x.number} ${x.title} ${customer.get(x.customerId ?? '') ?? ''} ${x.status}`.toLowerCase().includes(q))
      .sort((a, b) => b.number - a.number);
    return html`
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <h1 class="h3 mb-0 me-auto">Quotes</h1>
        <input
          class="form-control"
          style="max-width: 16rem"
          type="search"
          placeholder="Filter…"
          aria-label="Filter"
          .value=${this.filter}
          @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
        />
        <button class="btn btn-primary" @click=${this.#create}>New quote</button>
      </div>
      ${quotes.length === 0 ? html`<p class="text-body-secondary">No quotes yet.</p>` : nothing}
      <div class="list-group">
        ${quotes.map((x) => {
          const r = quoteResult(doc, x, asOf);
          return html`<a class="list-group-item list-group-item-action d-flex flex-wrap gap-2 align-items-center" href="#/quotes/${x.id}">
            <span class="text-body-secondary" style="min-width: 3rem">#${x.number}</span>
            <span class="fw-semibold me-auto">${x.title}</span>
            ${x.customerId ? html`<span class="small">${customer.get(x.customerId) ?? '?'}</span>` : nothing}
            <span class="small text-body-secondary">${x.date ?? ''}</span>
            <span class="badge text-bg-${STATUS_COLOR[x.status]}">${x.status}</span>
            <span class="text-end" style="min-width: 6rem">${money(r?.price, cur)}${x.snapshot ? html` <span title="frozen">🔒</span>` : nothing}</span>
          </a>`;
        })}
      </div>
    `;
  }

  #create = async () => {
    const doc = this.#doc;
    const quote = createQuote(doc, { id: newId(), date: today() });
    const printer = doc.printers.find((p) => p.status === 'active') ?? doc.printers[0];
    if (printer) quote.plates.push({ id: newId(), name: 'Plate 1', printerId: printer.id, printTimeMin: 60, runs: 1, filaments: [] });
    await this.#store.store.update((d) => d.quotes.push(quote));
    location.hash = `#/quotes/${quote.id}`;
  };
}
