import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { StoreController } from '../state/app-store';
import { store } from '../state/store-instance';
import { HashRouter, ROUTES } from './router';
import './pages/dashboard-page';
import './pages/settings-page';

@customElement('app-shell')
export class AppShell extends LitElement {
  #router = new HashRouter(this);
  #store = new StoreController(this, store());

  // Render into the light DOM so the global Bootstrap CSS applies.
  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const { status, error } = this.#store.store;
    return html`
      <nav class="navbar navbar-expand bg-body border-bottom mb-3">
        <div class="container">
          <a class="navbar-brand" href="#/dashboard">3D Print Calc</a>
          <ul class="navbar-nav me-auto flex-wrap">
            ${ROUTES.map(
              (r) => html`<li class="nav-item">
                <a class="nav-link ${this.#router.path === r.path ? 'active' : ''}" href="#/${r.path}">${r.label}</a>
              </li>`,
            )}
          </ul>
          <span class="badge text-bg-${statusColor(status)}" title=${error ?? ''}>${status}</span>
        </div>
      </nav>
      <main class="container pb-5">${this.#page()}</main>
    `;
  }

  #page() {
    switch (this.#router.path) {
      case 'dashboard':
        return html`<dashboard-page></dashboard-page>`;
      case 'settings':
        return html`<settings-page></settings-page>`;
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
