import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createEmptyDocument } from '../../core/document';
import { DocumentError, type LoadedDocument } from '../../core/migrations';
import type { Settings } from '../../core/model';
import { exportFileName, parseDocument, serializeDocument, summarize, type DocumentSummary } from '../../core/transfer';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import { numberField, switchField, textAreaField, textField } from '../fields';
import '../pricing-profiles-editor';

@customElement('settings-page')
export class SettingsPage extends LitElement {
  #store = new StoreController(this, store());

  /** Parsed import file waiting for confirmation. */
  @state() private pendingImport: { fileName: string; loaded: LoadedDocument } | null = null;
  @state() private importError: string | null = null;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const s = this.#store.store.doc.settings;
    return html`
      <h1 class="h3 mb-3">Settings</h1>
      <div class="row g-3">
        <div class="col-lg-6">${this.#general(s)}</div>
        <div class="col-lg-6">${this.#business(s)} ${this.#vat(s)}</div>
      </div>
      <pricing-profiles-editor></pricing-profiles-editor>
      <div class="mt-4">${this.#data()}</div>
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

  #export = () => {
    const blob = new Blob([serializeDocument(this.#store.store.doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: exportFileName() });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

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
    if (!confirm('Delete all data in this browser? This cannot be undone. Export first if you want to keep it.')) return;
    await this.#store.store.replaceDocument(createEmptyDocument());
  };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
