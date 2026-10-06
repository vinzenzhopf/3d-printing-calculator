import { LitElement, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { formatDuration } from '../../core/duration';
import type { AppDocument } from '../../core/model';
import { maintenanceStatus } from '../../core/maintenance';
import { quoteResult } from '../../core/quotes';
import { stockByFilament, toBuyList } from '../../core/stock';
import { StoreController } from '../../state/app-store';
import { store, syncManager } from '../../state/store-instance';
import { downloadBackup, lastBackup } from '../backup';
import { money, num, today } from '../format';
import { filamentLabel } from './filaments/labels';
import { dueText } from './printers-page';
import { STATUS_COLOR } from './quotes/status';

const BACKUP_WARN_DAYS = 30;
const OPEN_STATUSES = new Set(['draft', 'sent', 'accepted', 'printing', 'delivered']);

@customElement('dashboard-page')
export class DashboardPage extends LitElement {
  #store = new StoreController(this, store());

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    const doc = this.#doc;
    const stockKg = [...stockByFilament(doc).values()].reduce((sum, s) => sum + s.knownG, 0) / 1000;
    const counts: [string, string, string][] = [
      ['Quotes', String(doc.quotes.length), '#/quotes'],
      ['Prints logged', String(doc.printJobs.length), '#/log'],
      ['Filament in stock', `${num(stockKg, 1)} kg`, '#/filaments/stock'],
      ['Filaments', String(doc.filaments.length), '#/filaments'],
      ['Printers', String(doc.printers.filter((p) => p.status === 'active').length), '#/settings/printers'],
      ['Customers', String(doc.customers.length), '#/customers'],
    ];
    return html`
      <h1 class="h3 mb-3">Dashboard</h1>
      ${this.#backupReminder()}
      <div class="row g-3 mb-4">
        ${counts.map(([label, value, href]) => html`<div class="col-6 col-md-4 col-lg-2">
          <a class="card text-center text-decoration-none h-100" href=${href}><div class="card-body">
            <div class="fs-4 fw-semibold">${value}</div>
            <div class="text-body-secondary small">${label}</div>
          </div></a>
        </div>`)}
      </div>
      <div class="row g-3">
        <div class="col-lg-6">${this.#openQuotes()}</div>
        <div class="col-lg-6">${this.#maintenance()} ${this.#toBuy()} ${this.#recentPrints()}</div>
      </div>
    `;
  }

  #backupReminder() {
    const doc = this.#doc;
    const m = syncManager();
    if (m.service && !m.locked) return nothing; // synced data has its own history
    const hasData = doc.quotes.length + doc.filaments.length + doc.printers.length > 0;
    if (!hasData) {
      return html`<div class="alert alert-info">Welcome! Start in <a href="#/settings/printers">Settings → Printers</a> and <a href="#/filaments">Filaments</a>, or import data in <a href="#/settings/data">Settings</a>.</div>`;
    }
    const last = lastBackup();
    const days = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null;
    if (days !== null && days < BACKUP_WARN_DAYS) return nothing;
    return html`<div class="alert alert-warning d-flex flex-wrap align-items-center gap-2">
      <span>${days === null ? 'Your data has never been exported.' : `Last backup ${days} days ago.`} It only lives in this browser. Export it, or set up <a href="#/settings/data">sync</a>.</span>
      <button class="btn btn-sm btn-warning ms-auto" @click=${() => { downloadBackup(doc); this.requestUpdate(); }}>Export now</button>
    </div>`;
  }

  #openQuotes() {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const asOf = today();
    const customer = new Map(doc.customers.map((c) => [c.id, c.name]));
    const open = doc.quotes.filter((q) => OPEN_STATUSES.has(q.status)).sort((a, b) => b.number - a.number);
    const total = open.filter((q) => q.status !== 'draft').reduce((sum, q) => sum + (quoteResult(doc, q, asOf)?.price ?? 0), 0);
    return html`<section class="card">
      <div class="card-header d-flex"><strong class="me-auto">Open quotes</strong><span class="small">${money(total, cur)} not yet paid</span></div>
      ${open.length === 0
        ? html`<div class="card-body text-body-secondary small">Nothing open.</div>`
        : html`<div class="list-group list-group-flush">${open.slice(0, 8).map((q) => html`<a class="list-group-item list-group-item-action d-flex gap-2 align-items-center" href="#/quotes/${q.id}">
            <span class="text-body-secondary small">#${q.number}</span><span class="me-auto">${q.title}${q.customerId ? html` <span class="small text-body-secondary">· ${customer.get(q.customerId)}</span>` : nothing}</span>
            <span class="badge text-bg-${STATUS_COLOR[q.status]}">${q.status}</span><span class="small">${money(quoteResult(doc, q, asOf)?.price, cur)}</span>
          </a>`)}</div>`}
    </section>`;
  }

  #maintenance() {
    const doc = this.#doc;
    const due = maintenanceStatus(doc).filter((m) => m.dueInHours !== null && m.dueInHours <= 20);
    if (due.length === 0) return nothing;
    const name = new Map(doc.printers.map((p) => [p.id, p.name]));
    return html`<section class="card mb-3 border-warning">
      <div class="card-header"><strong>Maintenance due</strong></div>
      <ul class="list-group list-group-flush">${due.map((m) => html`<li class="list-group-item small d-flex gap-2">
        <span class="me-auto">🔧 ${m.task} <span class="text-body-secondary">· ${name.get(m.printerId)}</span></span><span>${dueText(m.dueInHours)}</span>
      </li>`)}</ul>
    </section>`;
  }

  #toBuy() {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const list = toBuyList(doc);
    const lowSet = doc.filaments.some((f) => f.lowStockG !== undefined);
    return html`<section class="card mb-3">
      <div class="card-header"><strong>To buy</strong></div>
      ${list.length === 0
        ? html`<div class="card-body text-body-secondary small">${lowSet ? 'All filaments above their low-stock level.' : html`Set "Low at" thresholds in the <a href="#/filaments">catalog</a> to get a shopping list.`}</div>`
        : html`<ul class="list-group list-group-flush">${list.map((x) => {
            const f = doc.filaments.find((y) => y.id === x.filamentId)!;
            const p = x.lastPurchase;
            return html`<li class="list-group-item small d-flex flex-wrap gap-2">
              <span class="me-auto">${filamentLabel(doc, f)}</span>
              <span>${num(x.stockG)} / ${num(x.thresholdG)} g${x.hasUnknown ? html` <span class="badge text-bg-warning" title="Some spools are not weighed yet">?</span>` : nothing}</span>
              ${p ? html`<span class="text-body-secondary">last ${p.date}, ${money(p.totalPrice / p.totalKg, cur)}/kg</span>` : nothing}
              ${f.link ? html`<a href=${f.link} target="_blank" rel="noopener noreferrer">shop</a>` : nothing}
            </li>`;
          })}</ul>`}
    </section>`;
  }

  #recentPrints() {
    const jobs = [...this.#doc.printJobs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    if (jobs.length === 0) return nothing;
    return html`<section class="card">
      <div class="card-header"><strong>Recent prints</strong></div>
      <ul class="list-group list-group-flush">${jobs.map((j) => html`<li class="list-group-item small d-flex gap-2">
        <span class="text-body-secondary">${j.date}</span><span class="me-auto">${j.name}</span><span>${formatDuration(j.printTimeMin)} h</span>
        ${j.result !== 'success' ? html`<span class="badge text-bg-warning">${j.result}</span>` : nothing}
      </li>`)}</ul>
    </section>`;
  }
}
