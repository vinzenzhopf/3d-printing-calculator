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
import { jobFromInbox } from '../../core/inbox';
import { cellNumber, cellSelect, cellText, type Option } from '../fields';
import { newId, num, percent, today } from '../format';
import { pickFilament } from '../filament-picker';
import { filamentLabel } from './filaments/labels';

const RESULTS: Option[] = [
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

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
    const jobs = [...doc.printJobs].sort((a, b) => b.date.localeCompare(a.date));
    const printerName = new Map(doc.printers.map((p) => [p.id, p.name]));
    const quoteNumber = new Map(doc.quotes.map((q) => [q.id, q.number]));
    const stats = jobStats(jobs);
    return html`
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <h1 class="h3 mb-0 me-auto">Print log</h1>
        <button class="btn btn-primary" @click=${this.#newDraft}>${this.draft ? 'Discard' : 'Log a print'}</button>
      </div>
      <p class="small text-body-secondary">
        Logged prints take filament from the chosen spools, add to the printer's hour counter, and show your real
        failure rate. Tip: use "Log run" on a quote plate to pre-fill everything.
      </p>
      ${this.#inboxSection()}
      ${this.draft ? this.#form(this.draft) : nothing}
      ${jobs.length
        ? html`<p class="small">${stats.jobs} prints · ${formatDuration(stats.hours * 60)} h · ${num(stats.filamentG / 1000, 2)} kg filament · failed/cancelled: ${stats.failureRate === null ? '–' : percent(stats.failureRate, 1)} of print time</p>
            <div class="table-responsive"><table class="table table-sm align-middle">
              <thead><tr><th>Date</th><th>Print</th><th>Printer</th><th>Time</th><th>Filament</th><th>Result</th><th></th></tr></thead>
              <tbody>
                ${jobs.map((j) => html`<tr class=${j.result === 'success' ? '' : 'table-warning'}>
                  <td class="text-nowrap">${j.date}</td>
                  <td>${j.name}${j.quoteId ? html` <a class="small" href="#/quotes/${j.quoteId}">#${quoteNumber.get(j.quoteId) ?? '?'}</a>` : nothing}${j.note ? html`<div class="small text-body-secondary">${j.note}</div>` : nothing}</td>
                  <td class="small">${printerName.get(j.printerId) ?? '?'}</td>
                  <td>${formatDuration(j.printTimeMin)}</td>
                  <td class="small">${j.filaments.map((f) => html`<div>${num(f.grams)} g ${this.#filamentName(f.filamentId)}${f.spoolId ? ` (${this.#spoolLabel(f.spoolId)})` : ''}</div>`)}</td>
                  <td>${j.result}</td>
                  <td class="text-nowrap">
                    <button class="btn btn-sm btn-link" title="Edit" @click=${() => this.#edit(j)}>✎</button>
                    <button class="btn btn-sm btn-link text-danger" title="Delete (returns the filament to the spools)" @click=${() => this.#delete(j)}>✕</button>
                  </td>
                </tr>`)}
              </tbody>
            </table></div>`
        : this.draft ? nothing : html`<p class="text-body-secondary">No prints logged yet.</p>`}
    `;
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
            <button class="btn btn-sm btn-outline-secondary" @click=${() => {
              if (confirm('Dismiss this detected print? It is removed from the inbox and not logged.')) void this.#removeInbox(item, 'Dismissed detected print');
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

  #delete(job: PrintJob) {
    if (!confirm(`Delete "${job.name}" from ${job.date}? The filament is returned to the spools.`)) return;
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
