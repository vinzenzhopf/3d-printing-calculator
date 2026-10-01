import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './filaments/filament-catalog';
import './filaments/filament-purchases';
import './filaments/price-list';

const TABS = [
  { sub: '', label: 'Catalog' },
  { sub: 'purchases', label: 'Purchases' },
  { sub: 'prices', label: 'Price list' },
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
      ${tab === 'purchases'
        ? html`<filament-purchases></filament-purchases>`
        : tab === 'prices'
          ? html`<price-list></price-list>`
          : html`<filament-catalog></filament-catalog>`}
    `;
  }
}
