import { LitElement, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { StoreController } from '../state/app-store';
import { store, syncManager } from '../state/store-instance';
import { HashRouter, ROUTES } from './router';
import './pages/dashboard-page';
import './pages/settings-page';
import './pages/printers-page';
import './pages/filaments-page';
import './pages/quotes-page';
import './pages/customers-page';
import './pages/print-log-page';

@customElement('app-shell')
export class AppShell extends LitElement {
  #router = new HashRouter(this);
  #store = new StoreController(this, store());
  #onSync = () => this.requestUpdate();

  override connectedCallback() {
    super.connectedCallback();
    syncManager().addEventListener('change', this.#onSync);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    syncManager().removeEventListener('change', this.#onSync);
  }

  // Render into the light DOM so the global Bootstrap CSS applies.
  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const { status, error } = this.#store.store;
    return html`
      <nav class="navbar navbar-expand bg-body border-bottom mb-3 d-print-none">
        <div class="container flex-wrap">
          <a class="navbar-brand" href="#/dashboard">3D Print Calc</a>
          <span class="d-flex gap-1 order-md-last">
            ${this.#syncBadge()}
            <span class="badge text-bg-${statusColor(status)}" title=${error ?? 'Saved in this browser'}>${status}</span>
          </span>
          <ul class="navbar-nav app-nav">
            ${ROUTES.map(
              (r) => html`<li class="nav-item">
                <a class="nav-link ${this.#router.path === r.path ? 'active' : ''}" href="#/${r.path}">${r.label}</a>
              </li>`,
            )}
          </ul>
        </div>
      </nav>
      <main class="container pb-5">${this.#page()}</main>
    `;
  }

  #syncBadge() {
    const m = syncManager();
    if (!m.config) return nothing;
    const s = m.service;
    const [color, text] = m.locked ? ['warning', 'sync locked']
      : !s ? ['secondary', 'sync']
      : s.status === 'conflict' ? ['danger', 'sync conflict']
      : s.status === 'error' ? ['danger', 'sync error']
      : s.status === 'syncing' ? ['info', 'syncing…']
      : s.hasLocalChanges ? ['secondary', 'unsynced']
      : ['success', 'synced'];
    return html`<a class="badge text-bg-${color} text-decoration-none" href="#/settings" title=${s?.error ?? 'Sync settings'}>☁ ${text}</a>`;
  }

  #page() {
    switch (this.#router.path) {
      case 'dashboard':
        return html`<dashboard-page></dashboard-page>`;
      case 'settings':
        return html`<settings-page></settings-page>`;
      case 'printers':
        return html`<printers-page></printers-page>`;
      case 'quotes':
        return html`<quotes-page .sub=${this.#router.sub}></quotes-page>`;
      case 'log':
        return html`<print-log-page></print-log-page>`;
      case 'customers':
        return html`<customers-page></customers-page>`;
      case 'filaments':
        return html`<filaments-page .sub=${this.#router.sub}></filaments-page>`;
      default:
        return html`<div class="alert alert-secondary">
          <strong>${ROUTES.find((r) => r.path === this.#router.path)?.label}</strong> is not built yet.
        </div>`;
    }
  }
}

function statusColor(status: string): string {
  return { ready: 'success', saving: 'info', loading: 'secondary', conflict: 'warning', error: 'danger' }[status] ?? 'secondary';
}
