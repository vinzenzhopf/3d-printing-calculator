import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createEmptyDocument } from '../../core/document';
import { DocumentError, type LoadedDocument } from '../../core/migrations';
import type { Settings } from '../../core/model';
import { clearStock, isLabelCode, nextLabelNumber } from '../../core/stock';
import { labelCode } from '../../core/labels';
import { parseDocument, summarize, type DocumentSummary } from '../../core/transfer';
import { downloadBackup } from '../backup';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import { numberField, switchField, textAreaField, textField } from '../fields';
import '../pricing-profiles-editor';
import '../sync-settings';
import './printers-page';
import { ask, tell } from '../dialogs';

const TABS = [
  { sub: '', label: 'General' },
  { sub: 'pricing', label: 'Pricing profiles' },
  { sub: 'printers', label: 'Printers' },
  { sub: 'data', label: 'Data & sync' },
  { sub: 'maintenance', label: 'Maintenance' },
];

@customElement('settings-page')
export class SettingsPage extends LitElement {
  #store = new StoreController(this, store());
  @property() sub = '';

  /** Parsed import file waiting for confirmation. */
  @state() private pendingImport: { fileName: string; loaded: LoadedDocument } | null = null;
  @state() private importError: string | null = null;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const s = this.#store.store.doc.settings;
    const tab = TABS.some((t) => t.sub === this.sub) ? this.sub : '';
    return html`
      <h1 class="h3 mb-3">Settings</h1>
      <ul class="nav nav-tabs mb-3">
        ${TABS.map((t) => html`<li class="nav-item">
          <a class="nav-link ${t.sub === tab ? 'active' : ''}" href="#/settings${t.sub ? `/${t.sub}` : ''}">${t.label}</a>
        </li>`)}
      </ul>
      ${tab === 'pricing'
        ? html`<pricing-profiles-editor></pricing-profiles-editor>`
        : tab === 'printers'
          ? html`<printers-page></printers-page>`
        : tab === 'maintenance'
          ? html`<div class="row g-3">
              <div class="col-lg-6">${this.#stockReset()}</div>
              <div class="col-lg-6">${this.#labelCounter()}</div>
            </div>`
        : tab === 'data'
          ? html`<div class="row g-3">
              <div class="col-lg-6"><sync-settings></sync-settings></div>
              <div class="col-lg-6">${this.#data()} ${this.#about()}</div>
            </div>`
          : html`<div class="row g-3">
              <div class="col-lg-6">${this.#general(s)}</div>
              <div class="col-lg-6">${this.#business(s)} ${this.#vat(s)}</div>
            </div>`}
    `;
  }

  #set(mutate: (s: Settings) => void) {
    void this.#store.store.update((doc) => mutate(doc.settings));
  }

  #general(s: Settings) {
    return html`
      <section class="card card-body">
        <h2 class="h5 mb-3">Calculation defaults</h2>
        ${numberField('Energy price', s.energyPricePerKwh, (v) => this.#set((x) => (x.energyPricePerKwh = v)), {
          suffix: `${s.currency}/kWh`, step: 0.01, min: 0,
        })}
        ${numberField('Hourly rate (labor)', s.hourlyRate, (v) => this.#set((x) => (x.hourlyRate = v)), {
          suffix: `${s.currency}/h`, step: 0.5, min: 0,
        })}
        ${numberField('Labor per plate run', s.laborPerPlateMin, (v) => this.#set((x) => (x.laborPerPlateMin = v)), {
          suffix: 'min', step: 1, min: 0, help: 'Setup, plate removal and cleanup for each print run.',
        })}
        ${numberField('Filament price window', s.filamentPriceWindowMonths, (v) => this.#set((x) => (x.filamentPriceWindowMonths = v)), {
          suffix: 'months', step: 1, min: 1,
          help: 'Purchases in this period always count for the current filament price. Rarely bought filaments reach further back.',
        })}
        ${textField('Currency', s.currency, (v) => this.#set((x) => (x.currency = v.toUpperCase())), {
          help: 'ISO code, e.g. EUR, USD, CHF.',
        })}
      </section>
    `;
  }

  #business(s: Settings) {
    return html`
      <section class="card card-body mb-3">
        <h2 class="h5 mb-3">Business</h2>
        ${switchField('Business mode', s.businessMode, (v) => this.#set((x) => (x.businessMode = v)), {
          help: 'Shows your business details and numbering on quotes.',
        })}
        ${s.businessMode
          ? html`
              ${textField('Business name', s.business.name, (v) => this.#set((x) => (x.business.name = v)))}
              ${textField('E-mail', s.business.email, (v) => this.#set((x) => (x.business.email = v)))}
              ${textAreaField('Address', s.business.address, (v) => this.#set((x) => (x.business.address = v)))}
            `
          : nothing}
      </section>
    `;
  }

  #vat(s: Settings) {
    return html`
      <section class="card card-body">
        <h2 class="h5 mb-3">VAT</h2>
        ${switchField('Charge VAT', s.vat.enabled, (v) => this.#set((x) => (x.vat.enabled = v)))}
        ${s.vat.enabled
          ? html`
              ${numberField('VAT rate', s.vat.ratePercent, (v) => this.#set((x) => (x.vat.ratePercent = v)), {
                suffix: '%', step: 0.1, min: 0, max: 100,
              })}
              ${switchField('Prices include VAT', s.vat.pricesIncludeVat, (v) => this.#set((x) => (x.vat.pricesIncludeVat = v)), {
                help: 'On: quotes show gross prices. Off: net prices plus VAT.',
              })}
            `
          : textAreaField('Note on quotes without VAT', s.vat.noVatNote, (v) => this.#set((x) => (x.vat.noVatNote = v)), {
              placeholder: 'e.g. a small-business notice required in your country',
            })}
        <p class="form-text mb-0">Configuration only, not tax advice.</p>
      </section>
    `;
  }

  #stockReset() {
    const doc = this.#store.store.doc;
    const spools = doc.spools.length;
    const entries = doc.spools.reduce((sum, s) => sum + s.movements.length, 0);
    const linkedJobs = doc.printJobs.filter((j) => j.filaments.some((f) => f.spoolId)).length;
    return html`
      <section class="card card-body">
        <h2 class="h5 mb-3">Start the stock over</h2>
        <p>Currently <strong>${spools} spools</strong> with ${entries} history entries (weigh-ins, prints, corrections).</p>
        <p class="small text-body-secondary">
          Deletes all spools and their history, including which label is on which spool. Purchases, empty spools,
          the label counter and the print log stay${linkedJobs ? html`; ${linkedJobs} logged prints lose their link to a spool` : nothing}.
          Printed labels can be scanned again afterwards to set the spools up anew.
        </p>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-outline-primary" @click=${this.#export}>Export backup first</button>
          <button class="btn btn-danger ms-auto" ?disabled=${spools === 0} @click=${this.#clearStock}>Delete all spools</button>
        </div>
      </section>
    `;
  }

  #clearStock = async () => {
    const n = this.#store.store.doc.spools.length;
    if (!(await ask(`Delete all ${n} spools and their history? This cannot be undone (except from a backup or the repository history).`, { ok: 'Delete all spools', danger: true }))) return;
    await this.#store.store.update((d) => clearStock(d));
    await tell('The stock is empty now. Scan a label or add spools to start again.');
  };

  #labelCounter() {
    const doc = this.#store.store.doc;
    const stored = doc.settings.labelNextNumber ?? 1;
    const next = nextLabelNumber(doc);
    const highest = doc.spools.filter((s) => isLabelCode(s.label)).map((s) => s.label).sort().at(-1);
    return html`
      <section class="card card-body">
        <h2 class="h5 mb-3">Label numbers</h2>
        ${numberField('Next label number', stored, (v) => this.#set((s) => (s.labelNextNumber = Math.max(1, Math.round(v)))), {
          min: 1, step: 1,
          help: `The next label sheet starts at ${labelCode(next)}.${next > stored ? ` Codes up to ${highest} are already on spools, so it can't start lower.` : ''}`,
        })}
        <p class="small text-body-secondary mb-0">
          Printing labels (Filaments → Spool setup) advances it. Lower it to reprint numbers you never stuck on a spool,
          e.g. after a misprint.
        </p>
      </section>
    `;
  }

  #about() {
    const repo = 'https://github.com/vinzenzhopf/3d-printing-calculator';
    const commit = __APP_COMMIT__;
    return html`
      <section class="card card-body mt-3">
        <h2 class="h5 mb-3">About</h2>
        <p class="text-body-secondary small">
          Open source (MIT), vibe-coded with an AI assistant: check the numbers before you send a quote. Your data never
          goes to the project, only to this browser and your own sync repository.
        </p>
        <div class="d-flex flex-wrap gap-2 mb-3">
          <a class="btn btn-outline-primary" href=${repo} target="_blank" rel="noopener noreferrer">Source code</a>
          <a class="btn btn-outline-primary" href="${repo}/issues/new" target="_blank" rel="noopener noreferrer">Report a problem or idea</a>
          <a class="btn btn-link" href="${repo}/blob/main/docs/home-assistant.md" target="_blank" rel="noopener noreferrer">Home Assistant guide</a>
          <a class="btn btn-link" href="${repo}/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">License</a>
        </div>
        <div class="small text-body-secondary">
          Version: ${commit === 'dev'
            ? 'development build'
            : html`<a href="${repo}/commit/${commit}" target="_blank" rel="noopener noreferrer"><code>${commit}</code></a>`}
          · built ${__APP_BUILT__}. Please mention it when you report a problem.
        </div>
      </section>
    `;
  }

  #data() {
    const doc = this.#store.store.doc;
    return html`
      <section class="card card-body">
        <h2 class="h5 mb-3">Data</h2>
        <p class="text-body-secondary">
          Your data is stored in this browser (<code>${this.#store.store.adapterId}</code>). Export regularly as a backup
          or to move it to another device.
        </p>
        <div class="d-flex flex-wrap gap-2 mb-3">
          <button class="btn btn-primary" @click=${this.#export}>Export data</button>
          <label class="btn btn-outline-primary mb-0">
            Import data…
            <input type="file" accept="application/json,.json" hidden @change=${this.#pickImport} />
          </label>
          <button class="btn btn-outline-danger ms-auto" @click=${this.#reset}>Reset all data</button>
        </div>
        ${this.importError ? html`<div class="alert alert-danger">${this.importError}</div>` : nothing}
        ${this.pendingImport ? this.#importPreview(summarize(doc), this.pendingImport) : nothing}
      </section>
    `;
  }

  #importPreview(current: DocumentSummary, pending: { fileName: string; loaded: LoadedDocument }) {
    const incoming = summarize(pending.loaded.doc);
    const rows: [string, keyof DocumentSummary][] = [
      ['Quotes', 'quotes'], ['Filaments', 'filaments'], ['Purchases', 'purchases'],
      ['Printers', 'printers'], ['Customers', 'customers'],
    ];
    const { warnings } = pending.loaded;
    return html`
      <div class="border rounded p-3 bg-body-tertiary">
        <h3 class="h6">Import <code>${pending.fileName}</code>?</h3>
        <table class="table table-sm w-auto">
          <thead><tr><th></th><th class="text-end">Current</th><th class="text-end">File</th></tr></thead>
          <tbody>
            ${rows.map(([label, key]) => html`<tr><td>${label}</td><td class="text-end">${current[key]}</td><td class="text-end">${incoming[key]}</td></tr>`)}
            <tr><td>Last change</td><td class="text-end">${fmtDate(current.updatedAt)}</td><td class="text-end">${fmtDate(incoming.updatedAt)}</td></tr>
          </tbody>
        </table>
        ${warnings.length
          ? html`<div class="alert alert-warning">
              <strong>${warnings.length} warning(s):</strong>
              <ul class="mb-0">${warnings.slice(0, 10).map((w) => html`<li>${w}</li>`)}</ul>
              ${warnings.length > 10 ? html`<div>… and ${warnings.length - 10} more</div>` : nothing}
            </div>`
          : nothing}
        <p class="text-danger">This replaces all current data. Export first if you want to keep it.</p>
        <button class="btn btn-danger" @click=${this.#confirmImport}>Replace current data</button>
        <button class="btn btn-link" @click=${() => (this.pendingImport = null)}>Cancel</button>
      </div>
    `;
  }

  #export = () => downloadBackup(this.#store.store.doc);

  #pickImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow picking the same file again
    if (!file) return;
    this.importError = null;
    this.pendingImport = null;
    try {
      this.pendingImport = { fileName: file.name, loaded: parseDocument(await file.text()) };
    } catch (err) {
      this.importError = err instanceof DocumentError ? err.message : `Could not read the file: ${String(err)}`;
    }
  };

  #confirmImport = async () => {
    if (!this.pendingImport) return;
    await this.#store.store.replaceDocument(this.pendingImport.loaded.doc);
    this.pendingImport = null;
  };

  #reset = async () => {
    if (!(await ask('Delete all data in this browser? This cannot be undone. Export first if you want to keep it.', { ok: 'Delete all data', danger: true }))) return;
    await this.#store.store.replaceDocument(createEmptyDocument());
  };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
