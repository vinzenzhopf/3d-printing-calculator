import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { QuoteResult } from '../../../core/calc/quote';
import type { Quote } from '../../../core/model';
import { store } from '../../../state/store-instance';
import { money, num } from '../../format';

const VALID_DAYS = 30;

/** Customer-facing offer, only visible when printing (QO-1). Internal costs are not shown. */
@customElement('quote-offer')
export class QuoteOffer extends LitElement {
  @property({ attribute: false }) quote!: Quote;
  @property({ attribute: false }) result!: QuoteResult;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const doc = store().doc;
    const s = doc.settings;
    const cur = s.currency;
    const q = this.quote;
    const r = this.result;
    const customer = doc.customers.find((c) => c.id === q.customerId);
    // Positions are shown at the shown price level (gross when prices include VAT).
    const factor = r.net > 0 ? r.price / r.net : 1;
    const validUntil = q.date ? addDays(q.date, VALID_DAYS) : null;

    return html`
      <article class="p-2">
        <header class="d-flex justify-content-between mb-4">
          <div>
            ${s.businessMode && s.business.name
              ? html`<div class="fw-semibold fs-5">${s.business.name}</div>
                  <div class="small" style="white-space: pre-line">${s.business.address}</div>
                  <div class="small">${s.business.email}</div>`
              : nothing}
          </div>
          <div class="text-end">
            <div class="fs-4 fw-semibold">Quote #${q.number}</div>
            ${q.date ? html`<div>Date: ${q.date}</div>` : nothing}
            ${validUntil ? html`<div class="small">Valid until ${validUntil}</div>` : nothing}
          </div>
        </header>
        ${customer
          ? html`<section class="mb-4">
              <div class="fw-semibold">${customer.name}</div>
              <div class="small" style="white-space: pre-line">${customer.address ?? ''}</div>
            </section>`
          : nothing}
        <h2 class="h5">${q.title}</h2>
        <table class="table">
          <thead><tr><th>Position</th><th class="text-end">Quantity</th><th class="text-end">Unit price</th><th class="text-end">Total</th></tr></thead>
          <tbody>
            ${r.plates.map((p) => html`<tr>
              <td>${p.name}</td>
              <td class="text-end">${num(p.parts)}</td>
              <td class="text-end">${money(p.pricePerPart * factor, cur)}</td>
              <td class="text-end">${money(p.price * factor, cur)}</td>
            </tr>`)}
          </tbody>
          <tfoot>
            ${s.vat.enabled
              ? html`<tr><td colspan="3" class="text-end">Net</td><td class="text-end">${money(r.net, cur)}</td></tr>
                  <tr><td colspan="3" class="text-end">VAT ${s.vat.ratePercent} %</td><td class="text-end">${money(r.vat, cur)}</td></tr>
                  <tr class="fw-semibold"><td colspan="3" class="text-end">Total</td><td class="text-end">${money(r.gross, cur)}</td></tr>`
              : html`<tr class="fw-semibold"><td colspan="3" class="text-end">Total</td><td class="text-end">${money(r.price, cur)}</td></tr>`}
          </tfoot>
        </table>
        ${!s.vat.enabled && s.vat.noVatNote ? html`<p class="small">${s.vat.noVatNote}</p>` : nothing}
      </article>
    `;
  }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
