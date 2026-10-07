import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { formatDuration, parseDuration } from '../../core/duration';
import type { AppDocument, PrintJob } from '../../core/model';
import { addJob, jobStats, removeJob, replaceJob, suggestSpool } from '../../core/print-log';
import { remainingG } from '../../core/stock';
import { StoreController } from '../../state/app-store';
import { store, syncManager } from '../../state/store-instance';
import type { InboxItem } from '../../state/sync-manager';
import { parseFileName } from '../../core/filename';
import { jobFromInbox, jobFromInboxAsIs } from '../../core/inbox';
import './print-import-panel';
import { cellNumber, cellSelect, cellText, type Option } from '../fields';
import { newId, num, percent, today } from '../format';
import { pickFilament } from '../filament-picker';
import { filamentLabel } from './filaments/labels';
import { ask } from '../dialogs';

const RESULTS: Option[] = [
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Rows shown before "Show all", so a long imported history stays quick. */
const LIST_LIMIT = 100;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let pendingDraft: PrintJob | null = null;

/** Opens the print log with a pre-filled job (e.g. from a quote plate). */
export function openPrintLogWith(job: PrintJob): void {
  pendingDraft = job;
  location.hash = '#/log';
}

@customElement('print-log-page')
export class PrintLogPage extends LitElement {
  #store = new StoreController(this, store());
  @state() private draft: PrintJob | null = null;
  /** The draft edits an existing job (instead of logging a new one). */
  @state() private editingExisting = false;
  @state() private inbox: InboxItem[] = [];
  @state() private inboxState: 'idle' | 'loading' | 'error' = 'idle';
  @state() private inboxError = '';
  /** Inbox item the current draft came from; removed from the repo when saved. */
  @state() private fromInbox: InboxItem | null = null;
  @state() private importing = false;
  /** List filters: text, printer, result, period ("2026" or "2026-10"). */
  @state() private filter = { text: '', printerId: '', result: '', period: '' };
  @state() private showAll = false;
  @state() private addingAll = '';

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    if (pendingDraft) {
      this.draft = pendingDraft;
      pendingDraft = null;
    }
    void this.#loadInbox();
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    const doc = this.#doc;
    const all = [...doc.printJobs].sort((a, b) => b.date.localeCompare(a.date));
    const printerName = new Map(doc.printers.map((p) => [p.id, p.name]));
    const quoteNumber = new Map(doc.quotes.map((q) => [q.id, q.number]));
    const f = this.filter;
    const q = f.text.trim().toLowerCase();
    const jobs = all.filter((j) =>
      (!f.printerId || j.printerId === f.printerId) &&
      (!f.result || (f.result === 'unsuccessful' ? j.result !== 'success' : j.result === f.result)) &&
      (!f.period || j.date.startsWith(f.period)) &&
      (!q || `${j.name} ${j.note ?? ''}`.toLowerCase().includes(q)));
    const stats = jobStats(jobs);
    const shown = this.showAll ? jobs : jobs.slice(0, LIST_LIMIT);
    return html`
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <h1 class="h3 mb-0 me-auto">Print log</h1>
        <button class="btn btn-outline-primary" @click=${() => (this.importing = !this.importing)}>${this.importing ? 'Close import' : 'Import prints…'}</button>
        <button class="btn btn-primary" @click=${this.#newDraft}>${this.draft ? 'Discard' : 'Log a print'}</button>
      </div>
      <p class="small text-body-secondary">
        Logged prints take filament from the chosen spools, add to the printer's hour counter, and show your real
        failure rate. Tip: use "Log run" on a quote plate to pre-fill everything.
      </p>
      ${this.importing ? html`<print-import-panel></print-import-panel>` : nothing}
      ${this.#inboxSection()}
      ${this.draft ? this.#form(this.draft) : nothing}
      ${all.length ? this.#filters(all) : nothing}
      ${jobs.length
        ? html`<p class="small">${stats.jobs} prints${jobs.length < all.length ? ` (of ${all.length})` : ''} · ${formatDuration(stats.hours * 60)} h · ${num(stats.filamentG / 1000, 2)} kg filament · failed/cancelled: ${stats.failureRate === null ? '–' : percent(stats.failureRate, 1)} of print time</p>
            <div class="table-responsive"><table class="table table-sm align-middle">
              <thead><tr><th>Date</th><th>Print</th><th>Printer</th><th>Time</th><th>Filament</th><th>Result</th><th></th></tr></thead>
              <tbody>
                ${shown.map((j) => html`<tr class=${j.result === 'success' ? '' : 'table-warning'}>
                  <td class="text-nowrap">${j.date}</td>
                  <td>${j.name}${j.quoteId ? html` <a class="small" href="#/quotes/${j.quoteId}">#${quoteNumber.get(j.quoteId) ?? '?'}</a>` : nothing}${j.note ? html`<div class="small text-body-secondary">${j.note}</div>` : nothing}</td>
                  <td class="small">${printerName.get(j.printerId) ?? '?'}</td>
                  <td>${formatDuration(j.printTimeMin)}</td>
                  <td class="small">${j.filaments.map((f) => html`<div>${num(f.grams)} g ${this.#filamentName(f.filamentId)}${f.spoolId ? ` (${this.#spoolLabel(f.spoolId)})` : ''}</div>`)}${j.untrackedFilament
                    ? html`<div class="text-body-secondary" title="Color/spool not known">${num(j.untrackedFilament.grams)} g ${j.untrackedFilament.material ?? ''}, color unknown</div>`
                    : nothing}</td>
                  <td>${j.result}</td>
                  <td class="text-nowrap">
                    <button class="btn btn-sm btn-link" title="Edit" @click=${() => this.#edit(j)}>✎</button>
                    <button class="btn btn-sm btn-link text-danger" title="Delete (returns the filament to the spools)" @click=${() => this.#delete(j)}>✕</button>
                  </td>
                </tr>`)}
              </tbody>
            </table></div>
            ${jobs.length > shown.length
              ? html`<button class="btn btn-sm btn-outline-secondary" @click=${() => (this.showAll = true)}>Show all ${jobs.length} prints</button>`
              : nothing}`
        : all.length
          ? html`<p class="text-body-secondary">No prints match the filter.</p>`
          : this.draft ? nothing : html`<p class="text-body-secondary">No prints logged yet.</p>`}
    `;
  }

  #filters(all: PrintJob[]) {
    const doc = this.#doc;
    const f = this.filter;
    const set = (patch: Partial<typeof f>) => {
      this.filter = { ...f, ...patch };
      this.showAll = false;
    };
    const used = new Set(all.map((j) => j.printerId));
    const years = [...new Set(all.map((j) => j.date.slice(0, 4)))].sort().reverse();
    const months = [...new Set(all.map((j) => j.date.slice(0, 7)))].sort().reverse();
    const active = f.text || f.printerId || f.result || f.period;
    return html`<div class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <input class="form-control form-control-sm" style="max-width: 14rem" type="search" placeholder="Search (name, file)…" aria-label="Search prints"
        .value=${f.text} @input=${(e: Event) => set({ text: (e.target as HTMLInputElement).value })} />
      <select class="form-select form-select-sm w-auto" aria-label="Printer" @change=${(e: Event) => set({ printerId: (e.target as HTMLSelectElement).value })}>
        <option value="" ?selected=${!f.printerId}>All printers</option>
        ${doc.printers.filter((p) => used.has(p.id)).map((p) => html`<option value=${p.id} ?selected=${f.printerId === p.id}>${p.name}</option>`)}
      </select>
      <select class="form-select form-select-sm w-auto" aria-label="Result" @change=${(e: Event) => set({ result: (e.target as HTMLSelectElement).value })}>
        <option value="" ?selected=${!f.result}>All results</option>
        <option value="success" ?selected=${f.result === 'success'}>Successful</option>
        <option value="unsuccessful" ?selected=${f.result === 'unsuccessful'}>Failed or cancelled</option>
      </select>
      <select class="form-select form-select-sm w-auto" aria-label="Period" @change=${(e: Event) => set({ period: (e.target as HTMLSelectElement).value })}>
        <option value="" ?selected=${!f.period}>All time</option>
        ${years.map((y) => html`<optgroup label=${y}>
          <option value=${y} ?selected=${f.period === y}>${y} (whole year)</option>
          ${months.filter((m) => m.startsWith(y)).map((m) => html`<option value=${m} ?selected=${f.period === m}>${MONTH_NAMES[Number(m.slice(5)) - 1]} ${y}</option>`)}
        </optgroup>`)}
      </select>
      ${active ? html`<button class="btn btn-sm btn-link" @click=${() => set({ text: '', printerId: '', result: '', period: '' })}>Clear filters</button>` : nothing}
    </div>`;
  }

  #form(job: PrintJob) {
    const doc = this.#doc;
    const edit = (mutate: (j: PrintJob) => void) => {
      const next = structuredClone(job);
      mutate(next);
      this.draft = next;
    };
    const printers: Option[] = doc.printers.filter((p) => p.status !== 'retired').map((p) => ({ value: p.id, label: p.name }));
    const spoolOptions = (filamentId: string): Option[] => [
      { value: '', label: 'no spool (stock not changed)' },
      ...doc.spools
        .filter((s) => s.filamentId === filamentId && s.status !== 'discarded' && s.status !== 'empty')
        .map((s) => ({ value: s.id, label: `${s.label} · ${remainingG(s) === null ? 'unknown' : `${num(remainingG(s))} g`}` })),
    ];
    const valid = job.printerId && job.filaments.every((f) => f.filamentId);
    return html`
      <section class="card card-body mb-3 bg-body-tertiary">
        <div class="row g-2 mb-2">
          <div class="col-md-2"><label class="small d-block">Date${cellText(job.date, (v) => edit((j) => (j.date = v)), { type: 'date', title: 'Date' })}</label></div>
          <div class="col-md-4"><label class="small d-block">Print${cellText(job.name, (v) => edit((j) => (j.name = v)), { title: 'Name' })}</label></div>
          <div class="col-md-2"><label class="small d-block">Printer${cellSelect(job.printerId, printers, (v) => edit((j) => (j.printerId = v)), true, 'Printer')}</label></div>
          <div class="col-md-2"><label class="small d-block">Time (h:mm)
            <input class="form-control form-control-sm" .value=${formatDuration(job.printTimeMin)}
              @change=${(e: Event) => { const input = e.target as HTMLInputElement; const m = parseDuration(input.value); if (m === null) input.value = formatDuration(job.printTimeMin); else edit((j) => (j.printTimeMin = m)); }} /></label></div>
          <div class="col-md-2"><label class="small d-block">Result${cellSelect(job.result, RESULTS, (v) => edit((j) => (j.result = v as PrintJob['result'])), true, 'Result')}</label></div>
        </div>
        ${job.untrackedFilament
          ? html`<div class="small mb-2">
              ${num(job.untrackedFilament.grams)} g ${job.untrackedFilament.material ?? ''} without a known color (counts in totals, not in stock).
              <button class="btn btn-sm btn-link" @click=${() => edit((j) => { j.filaments.push({ filamentId: '', grams: j.untrackedFilament!.grams }); delete j.untrackedFilament; })}>Assign to a filament</button>
            </div>`
          : nothing}
        <table class="table table-sm align-middle mb-2">
          <thead><tr><th>Filament</th><th style="width: 7rem">Grams used</th><th>From spool</th><th></th></tr></thead>
          <tbody>
            ${job.filaments.map((f, i) => html`<tr>
              <td style="min-width: 18rem">${pickFilament(f.filamentId, (v) => edit((j) => { const spoolId = v ? suggestSpool(this.#doc, v) : undefined; j.filaments[i] = { filamentId: v, grams: f.grams, ...(spoolId ? { spoolId } : {}) }; }))}</td>
              <td>${cellNumber(f.grams, (v) => edit((j) => (j.filaments[i]!.grams = v ?? 0)), { min: 0, step: 0.1, title: 'Grams' })}</td>
              <td>${f.filamentId ? cellSelect(f.spoolId ?? '', spoolOptions(f.filamentId), (v) => edit((j) => { if (v) j.filaments[i]!.spoolId = v; else delete j.filaments[i]!.spoolId; }), true, 'Spool') : nothing}</td>
              <td><button class="btn btn-sm btn-link text-danger" title="Remove" @click=${() => edit((j) => j.filaments.splice(i, 1))}>✕</button></td>
            </tr>`)}
          </tbody>
        </table>
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <button class="btn btn-sm btn-outline-primary" @click=${() => edit((j) => j.filaments.push({ filamentId: '', grams: 0 }))}>+ Filament</button>
          ${cellText(job.note, (v) => edit((j) => (j.note = v || undefined)), { title: 'Note', placeholder: 'Note (optional)' })}
          <button class="btn btn-primary ms-auto" ?disabled=${!valid} @click=${this.#save}>${this.editingExisting ? 'Save changes' : 'Save print'}</button>
        </div>
        ${job.result !== 'success' ? html`<p class="small text-body-secondary mt-2 mb-0">For failed prints, enter the filament used until it failed.</p>` : nothing}
      </section>
    `;
  }

  #newDraft = () => {
    if (this.draft) {
      this.draft = null;
      this.editingExisting = false;
      this.fromInbox = null;
      return;
    }
    const printer = this.#doc.printers.find((p) => p.status === 'active');
    this.draft = { id: newId(), date: today(), printerId: printer?.id ?? '', name: 'Print', printTimeMin: 60, result: 'success', filaments: [{ filamentId: '', grams: 0 }] };
  };

  #save = async () => {
    const job = this.draft;
    if (!job) return;
    const existing = this.editingExisting;
    const inboxItem = this.fromInbox;
    await this.#store.store.update((d) => (existing ? replaceJob(d, job, newId) : addJob(d, job, newId)));
    this.editingExisting = false;
    this.fromInbox = null;
    if (inboxItem) await this.#removeInbox(inboxItem, `Logged print ${job.name}`);
    this.draft = null;
  };

  async #loadInbox() {
    if (!syncManager().inboxAvailable) return;
    this.inboxState = 'loading';
    try {
      this.inbox = await syncManager().loadInbox();
      this.inboxState = 'idle';
    } catch (e) {
      this.inboxError = e instanceof Error ? e.message : String(e);
      this.inboxState = 'error';
    }
  }

  async #removeInbox(item: InboxItem, reason: string) {
    try {
      await syncManager().removeInboxItem(item, reason);
      this.inbox = this.inbox.filter((x) => x.path !== item.path);
    } catch (e) {
      this.inboxError = e instanceof Error ? e.message : String(e);
      this.inboxState = 'error';
    }
  }

  /** Logs every detected print as it is and removes its inbox file. */
  async #addAll(localDate: (iso: string) => string) {
    const items = this.inbox.filter((i) => i.entry);
    if (!(await ask(`Add all ${items.length} detected prints to the log as they are? Filament without a chosen color is kept by weight; you can edit each entry later.`, { ok: `Add ${items.length} prints` }))) return;
    const jobs = items.map((i) => jobFromInboxAsIs(this.#doc, i.entry!, { id: newId(), localDate }));
    await this.#store.store.update((d) => {
      for (const job of jobs) addJob(d, job, newId);
    });
    let n = 0;
    for (const item of items) {
      this.addingAll = `Cleaning up the inbox… ${++n}/${items.length}`;
      await this.#removeInbox(item, `Logged print ${item.entry!.file}`);
    }
    this.addingAll = '';
  }

  #inboxSection() {
    if (!syncManager().inboxAvailable) return nothing;
    const items = this.inbox;
    if (this.inboxState === 'idle' && items.length === 0) {
      return html`<p class="small text-body-secondary">No detected prints waiting.
        <button class="btn btn-sm btn-link p-0 align-baseline" @click=${() => void this.#loadInbox()}>Check again</button></p>`;
    }
    const localDate = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    return html`<section class="card mb-3 border-info">
      <div class="card-header d-flex align-items-center gap-2">
        <strong class="me-auto">Detected prints${items.length ? ` (${items.length})` : ''}</strong>
        ${this.addingAll ? html`<span class="small text-body-secondary">${this.addingAll}</span>` : nothing}
        ${items.some((i) => i.entry) && !this.addingAll
          ? html`<button class="btn btn-sm btn-outline-primary" title="Log every detected print as it is; filament without a color is kept by weight" @click=${() => void this.#addAll(localDate)}>Add all</button>`
          : nothing}
        <button class="btn btn-sm btn-link" ?disabled=${this.inboxState === 'loading'} @click=${() => void this.#loadInbox()}>${this.inboxState === 'loading' ? 'Loading…' : 'Refresh'}</button>
      </div>
      ${this.inboxState === 'error' ? html`<div class="alert alert-danger m-2 mb-0">${this.inboxError}</div>` : nothing}
      <ul class="list-group list-group-flush">
        ${items.map((item) => {
          const e = item.entry;
          return html`<li class="list-group-item d-flex flex-wrap gap-2 align-items-center small">
            ${e
              ? html`<span class="text-nowrap">${localDate(e.finishedAt)}</span>
                  ${((info) => html`<span class="me-auto text-break" title=${e.file}>${info.base || '(no file name)'}
                    <span class="text-body-secondary">· ${[info.grams !== undefined ? `${info.grams} g` : '', ...info.extras, e.printer].filter(Boolean).join(' · ')}</span></span>`)(parseFileName(e.file))}
                  <span>${e.durationMin === null ? '' : `${formatDuration(e.durationMin)} h`}</span>
                  <span class="badge text-bg-${e.result === 'success' ? 'success' : 'warning'}">${e.result}</span>
                  <button class="btn btn-sm btn-primary" @click=${() => {
                    this.draft = jobFromInbox(this.#doc, e, { id: newId(), localDate });
                    this.fromInbox = item;
                    this.editingExisting = false;
                  }}>Add…</button>`
              : html`<span class="me-auto text-danger">Unreadable inbox file ${item.path}</span>`}
            <button class="btn btn-sm btn-outline-secondary" @click=${async () => {
              if (await ask('Dismiss this detected print? It is removed from the inbox and not logged.', { ok: 'Dismiss', danger: true })) void this.#removeInbox(item, 'Dismissed detected print');
            }}>Dismiss</button>
          </li>`;
        })}
      </ul>
    </section>`;
  }

  #edit(job: PrintJob) {
    this.draft = structuredClone(job);
    this.editingExisting = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async #delete(job: PrintJob) {
    if (!(await ask(`Delete "${job.name}" from ${job.date}? The filament is returned to the spools.`, { ok: 'Delete', danger: true }))) return;
    void this.#store.store.update((d) => removeJob(d, job.id));
  }

  #filamentName(id: string): string {
    const f = this.#doc.filaments.find((x) => x.id === id);
    return f ? filamentLabel(this.#doc, f) : '?';
  }

  #spoolLabel(id: string): string {
    return this.#doc.spools.find((s) => s.id === id)?.label ?? '?';
  }
}
