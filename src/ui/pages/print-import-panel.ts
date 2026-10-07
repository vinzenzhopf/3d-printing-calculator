import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { formatDuration } from '../../core/duration';
import type { AppDocument } from '../../core/model';
import { IMPORT_SOURCES, parseImport, planImport, type ImportParse } from '../../core/print-import';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import { cellSelect } from '../fields';
import { num } from '../format';

const GUIDE = 'https://github.com/vinzenzhopf/3d-printing-calculator/blob/main/docs/import-prints.md#past-prints';

/** Local date of an ISO timestamp, the day the print ended where you are. */
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Imports past prints from a printer's own history (OctoPrint, Klipper/Moonraker,
 * or any CSV) into the print log, with a preview and duplicate check.
 */
@customElement('print-import-panel')
export class PrintImportPanel extends LitElement {
  #store = new StoreController(this, store());
  @state() private parsed: (ImportParse & { fileName: string }) | null = null;
  @state() private printerId = '';
  @state() private error = '';
  @state() private done = '';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    const doc = this.#doc;
    const printers = doc.printers.filter((p) => p.status !== 'planned');
    const printerId = this.printerId || printers.find((p) => p.status === 'active')?.id || printers[0]?.id || '';
    const plan = this.parsed && printerId ? planImport(doc, this.parsed.prints, { printerId, localDate, note: `Imported from ${IMPORT_SOURCES[this.parsed.source]}` }) : null;
    return html`
      <section class="card card-body mb-3 bg-body-tertiary">
        <h2 class="h6">Import past prints</h2>
        <p class="small text-body-secondary mb-2">
          From a printer's own history: <strong>OctoPrint</strong> (<code>uploads/.metadata.json</code>),
          <strong>Klipper/Moonraker</strong> (<code>/server/history/list</code>), or a <strong>CSV</strong> with a date
          column and optionally name, print time, grams, result and material (e.g. exported from Bambuddy or a
          spreadsheet). Prints already in the log are skipped. <a href=${GUIDE} target="_blank" rel="noopener noreferrer">How to get the files</a>
        </p>
        <div class="d-flex flex-wrap gap-2 align-items-end mb-2">
          <label class="small">File<input class="form-control form-control-sm" type="file" accept=".json,.csv,.txt,application/json,text/csv" @change=${this.#read} /></label>
          <label class="small">Printer${cellSelect(printerId, printers.map((p) => ({ value: p.id, label: p.name })), (v) => (this.printerId = v), true, 'Printer')}</label>
        </div>
        ${this.error ? html`<div class="alert alert-danger py-2 small mb-2">${this.error}</div>` : nothing}
        ${this.done ? html`<div class="alert alert-success py-2 small mb-2">${this.done}</div>` : nothing}
        ${this.parsed && plan ? this.#preview(this.parsed, plan) : nothing}
      </section>
    `;
  }

  #preview(parsed: ImportParse & { fileName: string }, plan: ReturnType<typeof planImport>) {
    const first = parsed.prints[0]?.finishedAt;
    const last = parsed.prints.at(-1)?.finishedAt;
    const hours = plan.jobs.reduce((sum, j) => sum + j.printTimeMin / 60, 0);
    const grams = plan.jobs.reduce((sum, j) => sum + (j.untrackedFilament?.grams ?? 0), 0);
    return html`
      <div class="small mb-2">
        <strong>${IMPORT_SOURCES[parsed.source]}</strong> · ${parsed.fileName}:
        ${num(parsed.prints.length)} prints${first && last ? ` from ${localDate(first)} to ${localDate(last)}` : ''}.
        <strong>${num(plan.jobs.length)} new</strong> (${num(hours)} h${grams ? `, ${num(grams / 1000, 1)} kg filament` : ''}),
        ${num(plan.duplicates.length)} already in the log${parsed.skipped.length ? `, ${parsed.skipped.length} skipped` : ''}.
      </div>
      ${plan.jobs.length
        ? html`<div class="table-responsive mb-2" style="max-height: 16rem">
            <table class="table table-sm small mb-0">
              <thead><tr><th>Date</th><th>Print</th><th class="text-end">Time</th><th class="text-end">Filament</th><th>Result</th></tr></thead>
              <tbody>${plan.jobs.slice(-50).reverse().map((j) => html`<tr>
                <td class="text-nowrap">${j.date}</td><td>${j.name}</td><td class="text-end">${formatDuration(j.printTimeMin)}</td>
                <td class="text-end text-nowrap">${j.untrackedFilament ? `${num(j.untrackedFilament.grams)} g ${j.untrackedFilament.material ?? ''}` : '–'}</td><td>${j.result}</td>
              </tr>`)}</tbody>
            </table>
          </div>
          ${plan.jobs.length > 50 ? html`<div class="small text-body-secondary mb-2">Showing the latest 50.</div>` : nothing}
          <button class="btn btn-primary btn-sm" @click=${() => void this.#add(plan)}>Add ${num(plan.jobs.length)} prints to the log</button>
          <div class="form-text">The filament is logged with its material but without a color; it counts in the statistics, not in the stock. Assign a filament later if you like.</div>`
        : nothing}
      ${parsed.skipped.length ? html`<details class="small mt-2"><summary>Skipped rows</summary><ul class="mb-0">${parsed.skipped.slice(0, 20).map((s) => html`<li>${s}</li>`)}</ul></details>` : nothing}
    `;
  }

  #read = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.error = this.done = '';
    this.parsed = null;
    if (!file) return;
    try {
      this.parsed = { ...parseImport(await file.text()), fileName: file.name };
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  };

  async #add(plan: ReturnType<typeof planImport>) {
    await this.#store.store.update((d) => {
      d.printJobs.push(...plan.jobs);
      d.printJobs.sort((a, b) => a.date.localeCompare(b.date));
    });
    this.done = `${plan.jobs.length} prints added to the log.`;
    this.parsed = null;
  }
}
