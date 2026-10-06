import { LitElement, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { StoreController } from '../state/app-store';
import { store, syncManager } from '../state/store-instance';
import { HashRouter, ROUTES } from './router';
import { syncConflict } from './sync-conflict';
import './pages/dashboard-page';
import './pages/settings-page';
import './pages/printers-page';
import './pages/filaments-page';
import './pages/quotes-page';
import './pages/customers-page';
import './pages/print-log-page';
import './pages/spool-page';

@customElement('app-shell')
export class AppShell extends LitElement {
  #router = new HashRouter(this);
  #store = new StoreController(this, store());
  #onSync = () => {
    // Notice when another device's changes were taken over automatically.
    const pulled = syncManager().service?.lastPulledAt;
    if (pulled && pulled !== this.#shownPull) {
      this.#shownPull = pulled;
      this.#pullNotice = true;
      clearTimeout(this.#noticeTimer);
      this.#noticeTimer = setTimeout(() => {
        this.#pullNotice = false;
        this.requestUpdate();
      }, 6000);
    }
    this.requestUpdate();
  };
  #shownPull: Date | null = null;
  #pullNotice = false;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;

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
                <a class="nav-link ${this.#router.path === r.path || (this.#router.path === 'spool' && r.path === 'filaments') ? 'active' : ''}" href="#/${r.path}">${r.label}</a>
              </li>`,
            )}
          </ul>
        </div>
      </nav>
      <main class="container pb-5">
        ${syncConflict()}
        ${this.#pullNotice
          ? html`<div class="alert alert-info alert-dismissible py-2 mb-3 d-print-none" role="status">
              Updated with changes from another device.
              <button type="button" class="btn-close py-2" aria-label="Close" @click=${() => { this.#pullNotice = false; this.requestUpdate(); }}></button>
            </div>`
          : nothing}
        ${this.#page()}
      </main>
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
    const canSync = !!s && !m.locked && s.status !== 'syncing' && s.status !== 'conflict';
    return html`<a class="badge text-bg-${color} text-decoration-none" href="#/settings/data" title=${s?.error ?? 'Sync settings'}>☁ ${text}</a>
      ${s && !m.locked
        ? html`<button class="badge text-bg-light border-0" style="cursor: pointer" title="Sync now" aria-label="Sync now"
            ?disabled=${!canSync} @click=${() => void s.sync()}>${s.status === 'syncing' ? '…' : '⟳'}</button>`
        : nothing}`;
  }

  #page() {
    switch (this.#router.path) {
      case 'dashboard':
        return html`<dashboard-page></dashboard-page>`;
      case 'settings':
        return html`<settings-page .sub=${this.#router.sub}></settings-page>`;
      case 'printers':
        return html`<printers-page></printers-page>`;
      case 'quotes':
        return html`<quotes-page .sub=${this.#router.sub}></quotes-page>`;
      case 'spool':
        return html`<spool-page .key=${this.#router.sub}></spool-page>`;
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
