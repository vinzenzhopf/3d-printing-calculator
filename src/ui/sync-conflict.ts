import { html, type TemplateResult } from 'lit';
import { summarize, type DocumentSummary } from '../core/transfer';
import { store, syncManager } from '../state/store-instance';
import { downloadBackup } from './backup';

const ROWS: [string, keyof DocumentSummary][] = [
  ['Quotes', 'quotes'],
  ['Filaments', 'filaments'],
  ['Purchases', 'purchases'],
  ['Printers', 'printers'],
  ['Customers', 'customers'],
];

/** Readable names of the document parts that differ between the two versions. */
const AREAS: Record<string, string> = {
  settings: 'settings', pricingProfiles: 'pricing profiles', quotes: 'quotes', customers: 'customers', filaments: 'filaments',
  productLines: 'product lines', purchases: 'purchases', spools: 'spools / stock', spoolKinds: 'empty spools',
  printers: 'printers', machineCosts: 'machine costs', plannedInvestments: 'reserves', materialProfiles: 'material profiles',
  printJobs: 'print log',
};

/**
 * "Both sides changed" choice, shown at the top of every page until resolved.
 * Nothing is synced in either direction meanwhile.
 */
export function syncConflict(): TemplateResult | null {
  const s = syncManager().service;
  if (!s?.conflict) return null;
  const local = summarize(store().doc);
  const remote = summarize(s.conflict.remoteDoc);
  const localDoc = store().doc as unknown as Record<string, unknown>;
  const remoteDoc = s.conflict.remoteDoc as unknown as Record<string, unknown>;
  const differs = Object.keys(AREAS).filter((k) => JSON.stringify(localDoc[k]) !== JSON.stringify(remoteDoc[k])).map((k) => AREAS[k]);
  return html`
    <div class="alert alert-warning mb-3 d-print-none" role="alert">
      <strong>Sync stopped: the repository was changed on another device, and this device has changes too.</strong>
      Choose which version to keep; the other one is replaced. Older versions stay in the repository's commit history.
      <div class="table-responsive">
        <table class="table table-sm w-auto my-2 bg-transparent">
          <thead><tr><th></th><th class="text-end">This device</th><th class="text-end">Repository</th></tr></thead>
          <tbody>
            ${ROWS.map(([label, key]) => html`<tr class=${local[key] !== remote[key] ? 'fw-semibold' : ''}><td>${label}</td><td class="text-end">${local[key]}</td><td class="text-end">${remote[key]}</td></tr>`)}
            <tr><td>Last change</td><td class="text-end">${new Date(local.updatedAt).toLocaleString()}</td><td class="text-end">${new Date(remote.updatedAt).toLocaleString()}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="mb-2">Different: <strong>${differs.length ? differs.join(', ') : 'only the change date'}</strong></p>
      <div class="d-flex flex-wrap gap-2">
        <button class="btn btn-sm btn-outline-secondary" @click=${() => downloadBackup(store().doc)}>Export this device's data first</button>
        <button class="btn btn-sm btn-warning" @click=${() => void s.resolve('mine')}>Keep this device (overwrite repository)</button>
        <button class="btn btn-sm btn-warning" @click=${() => void s.resolve('theirs')}>Use repository (replace this device)</button>
      </div>
    </div>
  `;
}
