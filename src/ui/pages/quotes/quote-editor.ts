import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { QuoteResult } from '../../../core/calc/quote';
import { formatDuration, parseDuration } from '../../../core/duration';
import type { AppDocument, Plate, Quote, QuoteExtra, QuoteStatus } from '../../../core/model';
import { jobFromPlate } from '../../../core/print-log';
import { QUOTE_STATUSES, compareQuote, createQuote, freezeQuote, quoteResult, quoteSummaryText, setQuoteStatus } from '../../../core/quotes';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { cellNumber, cellSelect, cellText, numberField, selectField, textAreaField, textField, type Option } from '../../fields';
import { money, newId, num, percent, today } from '../../format';
import { pickFilament } from '../../filament-picker';
import { SOURCE_LABEL, filamentOptions } from '../filaments/labels';
import { STATUS_COLOR } from './status';
import { partsPerRun, planParts } from '../../../core/parts';
import { applyEstimate } from '../../../core/slicer';
import { DEFAULT_DENSITY, metersToGrams } from '../../../core/stock';
import { readSlicerFile } from '../../slicer-file';
import { openPrintLogWith } from '../print-log-page';
import './quote-offer';
import { ask } from '../../dialogs';

@customElement('quote-editor')
export class QuoteEditor extends LitElement {
  @property() quoteId = '';
  @state() private copied = false;
  @state() private importNote: { plateId: string; text: string; error: boolean } | null = null;
  #store = new StoreController(this, store());

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  get #quote(): Quote | undefined {
    return this.#doc.quotes.find((q) => q.id === this.quoteId);
  }

  #set(mutate: (q: Quote) => void) {
    void this.#store.store.update((d) => mutate(d.quotes.find((q) => q.id === this.quoteId)!));
  }

  #plate(id: string, mutate: (p: Plate) => void) {
    this.#set((q) => mutate(q.plates.find((p) => p.id === id)!));
  }

  override render() {
    const quote = this.#quote;
    // Gone right after a delete, before the route switches back to the list.
    if (!quote) return nothing;
    const doc = this.#doc;
    const result = quoteResult(doc, quote, today());
    const frozen = !!quote.snapshot;
    return html`
      <div class="d-print-none">
        <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
          <a href="#/quotes" class="btn btn-sm btn-outline-secondary">← Quotes</a>
          <h1 class="h4 mb-0 me-auto">#${quote.number} ${quote.title}</h1>
          <span class="badge text-bg-${STATUS_COLOR[quote.status]}">${quote.status}</span>
          <button class="btn btn-sm btn-outline-secondary" @click=${() => window.print()} ?disabled=${!result}>Print / PDF</button>
          <button class="btn btn-sm btn-outline-secondary" ?disabled=${!result} @click=${() => this.#copySummary(result!)}>${this.copied ? 'Copied ✓' : 'Copy summary'}</button>
          <button class="btn btn-sm btn-outline-secondary" @click=${this.#duplicate}>Duplicate</button>
          <button class="btn btn-sm btn-outline-danger" @click=${this.#delete}>Delete</button>
        </div>
        ${frozen
          ? html`<div class="alert alert-info d-flex flex-wrap align-items-center gap-2">
              🔒 Frozen on ${new Date(quote.snapshot!.frozenAt).toLocaleDateString()}: prices no longer change with new purchases or settings.
              <button class="btn btn-sm btn-outline-primary ms-auto" @click=${() => this.#status('draft')}>Back to draft to edit</button>
            </div>`
          : quote.status !== 'draft'
            ? html`<div class="alert alert-warning d-flex flex-wrap align-items-center gap-2">
                Not frozen: this ${quote.status} quote is recalculated with current prices.
                <button class="btn btn-sm btn-outline-primary ms-auto" @click=${() => this.#set((q) => freezeQuote(this.#doc, q, today(), new Date()))}>Freeze now</button>
              </div>`
            : nothing}
        <div class="row g-3">
          <div class="col-lg-8 order-2 order-lg-1">
            <fieldset ?disabled=${frozen}>
              ${this.#header(quote)} ${quote.plates.map((p, i) => this.#plateCard(p, i, result))}
              <button class="btn btn-outline-primary mb-3" @click=${this.#addPlate}>+ Add plate</button>
              ${this.#planner(quote)} ${this.#extras(quote)}
            </fieldset>
            ${textAreaField('Notes', quote.notes ?? '', (v) => this.#set((q) => (q.notes = v || undefined)))}
          </div>
          <div class="col-lg-4 order-1 order-lg-2">
            <div class="sticky-lg-top" style="top: 1rem">${result ? this.#result(result) : html`<div class="alert alert-danger">Cannot calculate: check the pricing profile.</div>`}</div>
          </div>
        </div>
      </div>
      ${result ? html`<quote-offer class="d-none d-print-block" .quote=${quote} .result=${result}></quote-offer>` : nothing}
    `;
  }

  #header(quote: Quote) {
    const doc = this.#doc;
    const customers: Option[] = [{ value: '', label: '– none –' }, ...doc.customers.map((c) => ({ value: c.id, label: c.name }))];
    const profiles: Option[] = doc.pricingProfiles.map((p) => ({ value: p.id, label: p.name }));
    return html`
      <section class="card card-body mb-3">
        <div class="row">
          <div class="col-md-6">${textField('Title', quote.title, (v) => this.#set((q) => (q.title = v)))}</div>
          <div class="col-md-3">${selectField('Customer', quote.customerId ?? '', customers, this.#setCustomer)}</div>
          <div class="col-md-3"><label class="form-label d-block mb-3"><span class="d-block mb-1">Date</span>${cellText(quote.date, (v) => this.#set((q) => (q.date = v || undefined)), { type: 'date', title: 'Date' })}</label></div>
          <div class="col-md-4">${selectField('Pricing profile', quote.pricingProfileId, profiles, (v) => this.#set((q) => (q.pricingProfileId = v)))}</div>
          <div class="col-md-4">
            <label class="form-label d-block mb-3"><span class="d-block mb-1">Status</span>
              ${cellSelect(quote.status, QUOTE_STATUSES.map((s) => ({ value: s, label: s })), (v) => this.#status(v as QuoteStatus), false, 'Status')}
            </label>
          </div>
          <div class="col-md-4">${numberField('Discount', quote.discountPercent ?? 0, (v) => this.#set((q) => (q.discountPercent = v || undefined)), { suffix: '%', min: 0, max: 100 })}</div>
        </div>
      </section>
    `;
  }

  #plateCard(plate: Plate, index: number, result: QuoteResult | null) {
    const doc = this.#doc;
    const printers: Option[] = doc.printers.filter((p) => p.status !== 'retired' || p.id === plate.printerId).map((p) => ({ value: p.id, label: `${p.name}${p.status === 'planned' ? ' (planned)' : ''}` }));
    const r = result?.plates.find((p) => p.plateId === plate.id);
    const cur = doc.settings.currency;
    const multi = plate.filaments.length > 1;
    return html`
      <section class="card mb-3">
        <div class="card-header d-flex align-items-center gap-2">
          <span class="text-body-secondary">${index + 1}.</span>
          <div class="flex-grow-1">${cellText(plate.name, (v) => this.#plate(plate.id, (p) => (p.name = v)), { title: 'Plate name' })}</div>
          ${r ? html`<span class="small text-nowrap">${money(r.price, cur)}${r.parts > 1 ? html` · ${money(r.pricePerPart, cur)}/part` : nothing}</span>` : nothing}
          <button class="btn btn-sm btn-outline-secondary" title="Log one printed run of this plate" ?disabled=${plate.filaments.length === 0}
            @click=${() => openPrintLogWith(jobFromPlate(doc, plate, { id: newId(), date: today(), quoteId: this.quoteId }))}>Log run</button>
          <button class="btn btn-sm btn-link" title="Duplicate plate" @click=${() => this.#set((q) => q.plates.splice(index + 1, 0, { ...structuredClone(plate), id: newId(), name: `${plate.name} (copy)` }))}>⧉</button>
          <button class="btn btn-sm btn-link text-danger" title="Remove plate" @click=${() => this.#set((q) => q.plates.splice(index, 1))}>✕</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-2">
            <div class="col-md-4"><label class="small d-block">Printer${cellSelect(plate.printerId, printers, (v) => this.#plate(plate.id, (p) => (p.printerId = v)), true, 'Printer')}</label></div>
            <div class="col-md-3"><label class="small d-block">Print time (h:mm)
              <input class="form-control form-control-sm" .value=${formatDuration(plate.printTimeMin)} placeholder="7:23"
                @change=${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const min = parseDuration(input.value);
                  if (min === null) input.value = formatDuration(plate.printTimeMin);
                  else this.#plate(plate.id, (p) => (p.printTimeMin = min));
                }} /></label></div>
            <div class="col-md-2"><label class="small d-block">Runs${cellNumber(plate.runs, (v) => this.#plate(plate.id, (p) => (p.runs = v ?? 1)), { min: 0, step: 1, title: 'Runs' })}</label></div>
            <div class="col-md-3">${plate.parts?.length
              ? html`<div class="small">Parts per run</div><div class="pt-1">${partsPerRun(plate)} <span class="small text-body-secondary">(from list)</span></div>`
              : html`<label class="small d-block">Parts per run${cellNumber(plate.partsPerRun ?? 1, (v) => this.#plate(plate.id, (p) => (p.partsPerRun = v && v !== 1 ? v : undefined)), { min: 1, step: 1, title: 'Parts per run' })}</label>`}</div>
          </div>
          <table class="table table-sm align-middle mb-2">
            <thead><tr><th>Filament</th><th style="width: 8rem">g per run</th><th></th></tr></thead>
            <tbody>
              ${plate.filaments.map((f, i) => html`<tr>
                <td style="min-width: 18rem">${pickFilament(f.filamentId, (v) => this.#plate(plate.id, (p) => (p.filaments[i]!.filamentId = v)))}</td>
                <td>${cellNumber(f.weightG, (v) => this.#plate(plate.id, (p) => (p.filaments[i]!.weightG = v ?? 0)), { min: 0, step: 0.01, title: 'Grams' })}</td>
                <td><button class="btn btn-sm btn-link text-danger" title="Remove filament" @click=${() => this.#plate(plate.id, (p) => p.filaments.splice(i, 1))}>✕</button></td>
              </tr>`)}
            </tbody>
          </table>
          <div class="d-flex flex-wrap gap-2 align-items-center">
            <button class="btn btn-sm btn-outline-primary" @click=${() => this.#plate(plate.id, (p) => p.filaments.push({ filamentId: '', weightG: 0 }))}>+ Filament</button>
            <label class="btn btn-sm btn-outline-secondary mb-0" title="Read print time and grams from G-code, binary G-code or a sliced 3MF (parsed locally)">
              Import slicer file…
              <input type="file" hidden accept=".gcode,.gco,.bgcode,.3mf" @change=${(e: Event) => this.#importSlicer(plate.id, e)} />
            </label>
            ${this.importNote?.plateId === plate.id
              ? html`<span class="small ${this.importNote.error ? 'text-danger' : 'text-success'}">${this.importNote.text}</span>`
              : nothing}
          </div>
          ${this.#partList(plate)}
          ${multi
            ? html`<div class="row g-2 mt-1">
                <div class="col-md-4"><label class="small d-block">Purge / wipe tower (g, from slicer)${cellNumber(plate.purgeG ?? null, (v) => this.#plate(plate.id, (p) => (v === null ? delete p.purgeG : (p.purgeG = v))), { min: 0, allowEmpty: true, title: 'Purge grams' })}</label></div>
                <div class="col-md-4"><label class="small d-block">or: filament changes${cellNumber(plate.filamentChanges ?? null, (v) => this.#plate(plate.id, (p) => (v === null ? delete p.filamentChanges : (p.filamentChanges = v))), { min: 0, step: 1, allowEmpty: true, title: 'Filament changes' })}</label></div>
              </div>`
            : nothing}
        </div>
      </section>
    `;
  }

  #partList(plate: Plate) {
    const parts = plate.parts ?? [];
    const names = [...new Set((this.#quote?.requiredParts ?? []).map((r) => r.name))];
    const set = (mutate: (p: Plate) => void) => this.#plate(plate.id, mutate);
    return html`<details class="mt-2" ?open=${parts.length > 0}>
      <summary class="small">Parts on this plate${parts.length ? ` (${partsPerRun(plate)} per run)` : ''}</summary>
      <datalist id="parts-${plate.id}">${names.map((n) => html`<option value=${n}></option>`)}</datalist>
      <table class="table table-sm align-middle mb-1 mt-1">
        <tbody>
          ${parts.map((part, i) => html`<tr>
            <td><input class="form-control form-control-sm" list="parts-${plate.id}" aria-label="Part name" .value=${part.name}
              @change=${(e: Event) => set((p) => (p.parts![i]!.name = (e.target as HTMLInputElement).value.trim()))} /></td>
            <td style="width: 7rem">${cellNumber(part.quantity, (v) => set((p) => (p.parts![i]!.quantity = v ?? 1)), { min: 1, step: 1, title: 'Quantity per run' })}</td>
            <td style="width: 2rem"><button class="btn btn-sm btn-link text-danger" title="Remove part" @click=${() => set((p) => { p.parts!.splice(i, 1); if (!p.parts!.length) delete p.parts; })}>✕</button></td>
          </tr>`)}
        </tbody>
      </table>
      <button class="btn btn-sm btn-outline-secondary" @click=${() => set((p) => (p.parts ??= []).push({ name: '', quantity: 1 }))}>+ Part</button>
    </details>`;
  }

  #planner(quote: Quote) {
    const required = quote.requiredParts ?? [];
    const rows = planParts(quote);
    const hasParts = quote.plates.some((p) => p.parts?.length);
    const set = (mutate: (q: Quote) => void) => this.#set(mutate);
    if (!required.length && !hasParts) {
      return html`<p class="small"><button class="btn btn-sm btn-link p-0" @click=${() => set((q) => (q.requiredParts = [{ name: '', quantity: 1 }]))}>+ Part planner</button>
        <span class="text-body-secondary">: list the parts the customer needs and check that your plates cover them.</span></p>`;
    }
    return html`<section class="card card-body mb-3">
      <h2 class="h6">Part planner</h2>
      <div class="row g-3">
        <div class="col-md-5">
          <div class="small text-body-secondary mb-1">Required</div>
          ${required.map((r, i) => html`<div class="input-group input-group-sm mb-1">
            <input class="form-control" aria-label="Required part" .value=${r.name} @change=${(e: Event) => set((q) => (q.requiredParts![i]!.name = (e.target as HTMLInputElement).value.trim()))} />
            ${cellNumber(r.quantity, (v) => set((q) => (q.requiredParts![i]!.quantity = v ?? 0)), { min: 0, step: 1, width: '5rem', title: 'Required quantity' })}
            <button class="btn btn-outline-danger" title="Remove" @click=${() => set((q) => q.requiredParts!.splice(i, 1))}>✕</button>
          </div>`)}
          <button class="btn btn-sm btn-outline-secondary" @click=${() => set((q) => (q.requiredParts ??= []).push({ name: '', quantity: 1 }))}>+ Required part</button>
        </div>
        <div class="col-md-7">
          <table class="table table-sm mb-0">
            <thead><tr><th>Part</th><th class="text-end">Required</th><th class="text-end">Planned</th><th class="text-end">Diff</th></tr></thead>
            <tbody>
              ${rows.map((r) => html`<tr class=${r.diff < 0 ? 'table-danger' : r.diff > 0 ? 'table-warning' : 'table-success'}>
                <td>${r.name}</td><td class="text-end">${r.required}</td><td class="text-end">${r.planned}</td>
                <td class="text-end fw-semibold">${r.diff > 0 ? '+' : ''}${r.diff}</td>
              </tr>`)}
            </tbody>
          </table>
          <div class="small text-body-secondary mt-1">Planned = parts per run × runs, from each plate's part list.</div>
        </div>
      </div>
    </section>`;
  }

  #extras(quote: Quote) {
    const cur = this.#doc.settings.currency;
    const extras = quote.extras ?? [];
    const set = (i: number, mutate: (e: QuoteExtra) => void) => this.#set((q) => mutate(q.extras![i]!));
    return html`
      <section class="card card-body mb-3">
        <h2 class="h6">Extras</h2>
        ${extras.length
          ? html`<table class="table table-sm align-middle">
              <thead><tr><th>Description</th><th>Minutes / quantity</th><th>Unit cost</th><th></th></tr></thead>
              <tbody>
                ${extras.map((e, i) => html`<tr>
                  <td>${cellText(e.description, (v) => set(i, (x) => (x.description = v)), { title: 'Description' })}</td>
                  ${e.kind === 'labor'
                    ? html`<td>${cellNumber(e.minutes ?? 0, (v) => set(i, (x) => (x.minutes = v ?? 0)), { min: 0, title: 'Minutes' })}</td><td class="small text-body-secondary">min × hourly rate</td>`
                    : html`<td>${cellNumber(e.quantity ?? 1, (v) => set(i, (x) => (x.quantity = v ?? 1)), { min: 0, title: 'Quantity' })}</td>
                        <td>${cellNumber(e.unitCost ?? 0, (v) => set(i, (x) => (x.unitCost = v ?? 0)), { min: 0, step: 0.01, title: `Unit cost (${cur})` })}</td>`}
                  <td><button class="btn btn-sm btn-link text-danger" title="Remove" @click=${() => this.#set((q) => q.extras!.splice(i, 1))}>✕</button></td>
                </tr>`)}
              </tbody>
            </table>`
          : html`<p class="small text-body-secondary">Design time, post-processing, magnets, inserts, packaging, shipping…</p>`}
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-primary" @click=${() => this.#set((q) => (q.extras ??= []).push({ id: newId(), kind: 'labor', description: 'Design / post-processing', minutes: 30 }))}>+ Labor</button>
          <button class="btn btn-sm btn-outline-primary" @click=${() => this.#set((q) => (q.extras ??= []).push({ id: newId(), kind: 'item', description: 'Hardware', quantity: 1, unitCost: 0 }))}>+ Item</button>
        </div>
      </section>
    `;
  }

  #result(r: QuoteResult) {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const vat = doc.settings.vat;
    const row = (label: string, value: number, cls = '') => (Math.abs(value) < 0.005 && !cls ? nothing : html`<tr class=${cls}><td>${label}</td><td class="text-end">${money(value, cur)}</td></tr>`);
    const filamentName = new Map(filamentOptions(doc).map((o) => [o.value, o.label]));
    return html`
      <section class="card">
        <div class="card-body">
          <div class="text-body-secondary small">${vat.enabled ? (vat.pricesIncludeVat ? 'Price incl. VAT' : 'Price excl. VAT') : 'Price'}</div>
          <div class="display-6 fw-semibold mb-2">${money(r.price, cur)}</div>
          <table class="table table-sm mb-2">
            <tbody>
              ${row('Filament', r.production.filament)} ${row('Energy', r.production.energy)} ${row('Machine', r.production.machine)}
              ${row('Labor', r.production.labor)} ${row('Labor extras', r.laborExtras)} ${row('Items', r.items)} ${row('Failure allowance', r.failure)}
              ${row('Cost', r.cost, 'fw-semibold')}
              ${row('Markup', r.markup)} ${row('Discount', -r.discount)} ${row('Minimum price', r.minimumApplied)} ${row('Rounding', r.rounding)}
              ${row(vat.enabled ? 'Net' : 'Price', r.net, 'fw-semibold')}
              ${vat.enabled ? html`${row(`VAT ${vat.ratePercent} %`, r.vat)} ${row('Gross', r.gross, 'fw-semibold')}` : nothing}
            </tbody>
          </table>
          <div class="small">
            <div>Margin: <strong>${r.margin === null ? '–' : percent(r.margin, 1)}</strong> · Full cost: ${money(r.fullCost, cur)}</div>
            <div>Print time: ${formatDuration(r.printHours * 60)} h · ${r.pricePerPrintHour === null ? '' : `${money(r.pricePerPrintHour, cur)} per print hour`}</div>
            <div>Filament: ${num(r.plates.reduce((s, p) => s + p.filamentG, 0))} g</div>
          </div>
          ${r.warnings.map((w) => html`<div class="alert alert-warning py-1 px-2 mt-2 mb-0 small">${w}</div>`)}
          ${this.#comparison()}
          ${r.prices.length
            ? html`<details class="mt-2 small"><summary>Filament prices used</summary>
                <ul class="mb-0">${r.prices.map((p) => html`<li>${filamentName.get(p.filamentId) ?? p.filamentId}: ${money(p.pricePerKg, cur)}/kg (${SOURCE_LABEL[p.source]}${p.stale ? ', stale' : ''})</li>`)}</ul>
              </details>`
            : nothing}
        </div>
      </section>
    `;
  }

  async #importSlicer(plateId: string, e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const estimates = await readSlicerFile(file);
      const doc = this.#doc;
      const name = file.name.replace(/(\.gcode)?\.(3mf|b?gcode|gco)$/i, '');
      // Cura reports meters: convert with the slot's filament (density, diameter), else PLA defaults.
      const gramsPerMeter = (plate: Plate) => (slot: number) => {
        const f = doc.filaments.find((x) => x.id === plate.filaments[slot]?.filamentId);
        const line = doc.productLines.find((l) => l.id === f?.productLineId);
        return metersToGrams(1, line?.densityGcm3 ?? DEFAULT_DENSITY[line?.baseMaterial ?? 'PLA'] ?? 1.24, line?.diameterMm ?? 1.75);
      };
      await this.#store.store.update((d) => {
        const q = d.quotes.find((x) => x.id === this.quoteId)!;
        const index = q.plates.findIndex((p) => p.id === plateId);
        const first = q.plates[index]!;
        applyEstimate(first, estimates[0]!, gramsPerMeter(first), estimates.length > 1 ? `${name} (1)` : name);
        // Further plates of a multi-plate 3MF become new quote plates.
        estimates.slice(1).forEach((est, i) => {
          const plate: Plate = { id: newId(), name: `Plate ${q.plates.length + 1}`, printerId: first.printerId, printTimeMin: 0, runs: 1, filaments: first.filaments.map((f) => ({ filamentId: f.filamentId, weightG: 0 })) };
          applyEstimate(plate, est, gramsPerMeter(plate), `${name} (${i + 2})`);
          q.plates.splice(index + 1 + i, 0, plate);
        });
      });
      const e0 = estimates[0]!;
      this.importNote = {
        plateId,
        error: false,
        text: `${e0.slicer}: ${e0.printTimeMin === null ? '?' : formatDuration(e0.printTimeMin)} h${estimates.length > 1 ? `, ${estimates.length} plates imported` : ''}${e0.filamentTypes.length ? ` · ${e0.filamentTypes.join(' / ')}` : ''}. Check the filament rows.`,
      };
    } catch (err) {
      this.importNote = { plateId, error: true, text: err instanceof Error ? err.message : String(err) };
    }
  }

  #copySummary(result: QuoteResult) {
    const cur = this.#doc.settings.currency;
    void navigator.clipboard.writeText(quoteSummaryText(this.#doc, this.#quote!, result, (n) => money(n, cur))).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    });
  }

  #comparison() {
    const quote = this.#quote!;
    if (quote.snapshot || quote.plates.length === 0) return nothing;
    const cur = this.#doc.settings.currency;
    const c = compareQuote(this.#doc, quote, today());
    const plateIds = new Set(quote.plates.map((p) => p.printerId));
    const table = (rows: typeof c.profiles, current: (id: string) => boolean) => html`<table class="table table-sm mb-2">
      <tbody>${rows.map((row) => html`<tr class=${current(row.id) ? 'fw-semibold' : ''}><td>${row.name}</td><td class="text-end">${row.warnings.length ? html`<span class="text-warning" title=${row.warnings.join(' · ')}>⚠ </span>` : nothing}${money(row.price, cur)}</td></tr>`)}</tbody>
    </table>`;
    return html`<details class="mt-2 small">
      <summary>Compare profiles and printers</summary>
      <div class="mt-2 text-body-secondary">Pricing profile</div>
      ${table(c.profiles, (id) => id === quote.pricingProfileId)}
      <div class="text-body-secondary">All plates on…</div>
      ${table(c.printers, (id) => plateIds.size === 1 && plateIds.has(id))}
      ${[...c.profiles, ...c.printers].some((x) => x.warnings.length) ? html`<div class="text-body-secondary">⚠ incomplete: hover for details (e.g. missing power table).</div>` : nothing}
    </details>`;
  }

  #status(status: QuoteStatus) {
    this.#set((q) => setQuoteStatus(this.#doc, q, status, today(), new Date()));
  }

  #setCustomer = (customerId: string) => {
    const customer = this.#doc.customers.find((c) => c.id === customerId);
    this.#set((q) => {
      if (customerId) q.customerId = customerId;
      else delete q.customerId;
      // Customer defaults apply to drafts only; sent quotes keep their terms.
      if (q.status === 'draft' && customer) {
        if (customer.defaultPricingProfileId) q.pricingProfileId = customer.defaultPricingProfileId;
        if (customer.discountPercent) q.discountPercent = customer.discountPercent;
      }
    });
  };

  #addPlate = () => {
    const printer = this.#quote?.plates.at(-1)?.printerId ?? this.#doc.printers.find((p) => p.status === 'active')?.id ?? '';
    this.#set((q) => q.plates.push({ id: newId(), name: `Plate ${q.plates.length + 1}`, printerId: printer, printTimeMin: 60, runs: 1, filaments: [] }));
  };

  #duplicate = async () => {
    const src = this.#quote;
    if (!src) return;
    const copy: Quote = { ...structuredClone(src), ...createQuote(this.#doc, { id: newId(), date: today() }), title: `${src.title} (copy)`, status: 'draft' };
    copy.plates = structuredClone(src.plates).map((p) => ({ ...p, id: newId() }));
    copy.extras = structuredClone(src.extras ?? []);
    if (src.customerId) copy.customerId = src.customerId;
    copy.pricingProfileId = src.pricingProfileId;
    delete copy.snapshot;
    await this.#store.store.update((d) => d.quotes.push(copy));
    location.hash = `#/quotes/${copy.id}`;
  };

  #delete = async () => {
    if (!(await ask(`Delete quote #${this.#quote?.number}?`, { ok: 'Delete', danger: true }))) return;
    await this.#store.store.update((d) => (d.quotes = d.quotes.filter((q) => q.id !== this.quoteId)));
    location.hash = '#/quotes';
  };
}
