import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';

@customElement('dashboard-page')
export class DashboardPage extends LitElement {
  #store = new StoreController(this, store());

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const { doc, adapterId } = this.#store.store;
    const counts: [string, number][] = [
      ['Quotes', doc.quotes.length],
      ['Filaments', doc.filaments.length],
      ['Purchases', doc.purchases.length],
      ['Printers', doc.printers.length],
      ['Customers', doc.customers.length],
      ['Pricing profiles', doc.pricingProfiles.length],
    ];
    return html`
      <h1 class="h3 mb-3">Dashboard</h1>
      <div class="row g-3 mb-4">
        ${counts.map(
          ([label, n]) => html`<div class="col-6 col-md-4 col-lg-2">
            <div class="card text-center"><div class="card-body">
              <div class="fs-3 fw-semibold">${n}</div>
              <div class="text-body-secondary small">${label}</div>
            </div></div>
          </div>`,
        )}
      </div>
      <p class="text-body-secondary small">
        Storage: <code>${adapterId}</code> · schema v${doc.schemaVersion} · last change ${new Date(doc.updatedAt).toLocaleString()}
      </p>
    `;
  }
}
