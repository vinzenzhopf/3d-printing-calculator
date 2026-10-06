import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './filaments/filament-catalog';
import './filaments/filament-purchases';
import './filaments/price-list';
import './filaments/filament-stock';
import './filaments/spool-setup';
import './filaments/filament-colors';

const TABS = [
  { sub: '', label: 'Catalog' },
  { sub: 'colors', label: 'Colors' },
  { sub: 'stock', label: 'Stock' },
  { sub: 'purchases', label: 'Purchases' },
  { sub: 'prices', label: 'Price list' },
  { sub: 'setup', label: 'Spool setup' },
];

@customElement('filaments-page')
export class FilamentsPage extends LitElement {
  @property() sub = '';

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const tab = TABS.some((t) => t.sub === this.sub) ? this.sub : '';
    return html`
      <h1 class="h3 mb-3">Filaments</h1>
      <ul class="nav nav-tabs mb-3">
        ${TABS.map(
          (t) => html`<li class="nav-item">
            <a class="nav-link ${t.sub === tab ? 'active' : ''}" href="#/filaments${t.sub ? `/${t.sub}` : ''}">${t.label}</a>
          </li>`,
        )}
      </ul>
      ${tab === 'colors'
        ? html`<filament-colors></filament-colors>`
        : tab === 'stock'
        ? html`<filament-stock></filament-stock>`
        : tab === 'purchases'
        ? html`<filament-purchases></filament-purchases>`
        : tab === 'prices'
          ? html`<price-list></price-list>`
        : tab === 'setup'
          ? html`<spool-setup></spool-setup>`
          : html`<filament-catalog></filament-catalog>`}
    `;
  }
}
