import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { machineRate, reserveRatePerHour, type MachineRate } from '../../core/calc/machine-rate';
import type { AppDocument, BaseMaterial, MachineCost, MaintenanceTask, PlannedInvestment, Printer } from '../../core/model';
import { maintenanceStatus, markDone } from '../../core/maintenance';
import { jobStats } from '../../core/print-log';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import { cellNumber, cellSelect, cellText, numberField, selectField, switchField, textField, type Option } from '../fields';
import { money, newId, num, percent, today } from '../format';

const STATUS: Option[] = [
  { value: 'active', label: 'Active' },
  { value: 'planned', label: 'Planned' },
  { value: 'retired', label: 'Retired' },
];
const TOOL_TYPES: Option[] = [
  { value: 'single', label: 'Single nozzle' },
  { value: 'mmu', label: 'MMU / AMS (single nozzle, multi filament)' },
  { value: 'toolchanger', label: 'Tool changer' },
];
const COST_KINDS: Option[] = [
  { value: 'investment', label: 'Investment' },
  { value: 'wear-part', label: 'Wear part' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'shipping', label: 'Shipping' },
];
const RESERVE_MODES: Option[] = [
  { value: 'lifetime', label: 'Spread over useful life' },
  { value: 'target-date', label: 'Save up until a date' },
  { value: 'fixed-rate', label: 'Fixed rate per hour' },
];
export const BASE_MATERIALS: BaseMaterial[] = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Other'];
const STATUS_ORDER = { active: 0, planned: 1, retired: 2 };

@customElement('printers-page')
export class PrintersPage extends LitElement {
  #store = new StoreController(this, store());
  @state() private editing: string | null = null;

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  #update(mutate: (doc: AppDocument) => void) {
    void this.#store.store.update(mutate);
  }

  #printer(id: string, mutate: (p: Printer) => void) {
    this.#update((doc) => mutate(doc.printers.find((p) => p.id === id)!));
  }

  override render() {
    const asOf = today();
    const printers = [...this.#doc.printers].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    return html`
      <div class="d-flex align-items-center mb-3">
        <h1 class="h3 mb-0 me-auto">Printers</h1>
        <button class="btn btn-primary" @click=${this.#addPrinter}>Add printer</button>
      </div>
      ${printers.length === 0 ? html`<p class="text-body-secondary">No printers yet.</p>` : nothing}
      ${printers.map((p) => this.#printerCard(p, machineRate(this.#doc, p.id, asOf)))}
      ${this.#reserves(asOf)}
      ${this.#materialProfiles()}
    `;
  }

  #printerCard(p: Printer, rate: MachineRate) {
    const cur = this.#doc.settings.currency;
    const editing = this.editing === p.id;
    const badge = { active: 'success', planned: 'info', retired: 'secondary' }[p.status];
    return html`
      <section class="card mb-3">
        <div class="card-header d-flex align-items-center gap-2">
          <strong class="me-auto">${p.name}</strong>
          ${p.paidOff ? html`<span class="badge text-bg-light border">paid off</span>` : nothing}
          <span class="badge text-bg-${badge}">${p.status}</span>
          <button class="btn btn-sm btn-outline-secondary" @click=${() => (this.editing = editing ? null : p.id)}>
            ${editing ? 'Done' : 'Edit'}
          </button>
        </div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-md-5">
              <h3 class="h6">Machine cost per print hour</h3>
              <table class="table table-sm mb-1">
                <tbody>
                  <tr><td>Investment${p.paidOff ? ' (paid off)' : ''}</td><td class="text-end">${money(rate.investmentPerHour, cur, 3)}</td></tr>
                  <tr><td>Wear parts</td><td class="text-end">${money(rate.wearPerHour, cur, 3)}</td></tr>
                  ${rate.sharedPerHour ? html`<tr><td>Shared costs</td><td class="text-end">${money(rate.sharedPerHour, cur, 3)}</td></tr>` : nothing}
                  ${rate.reserves.map((r) => html`<tr><td>Reserve: ${r.name} <span class="text-body-secondary small">(100 %)</span></td><td class="text-end">${money(r.ratePerHour, cur, 3)}</td></tr>`)}
                  <tr class="fw-semibold"><td>Total</td><td class="text-end">${money(rate.totalPerHour, cur, 3)}</td></tr>
                </tbody>
              </table>
              <p class="small text-body-secondary mb-0">Pricing profiles charge 0–100 % of the reserve.</p>
            </div>
            <div class="col-md-7 small">
              <h3 class="h6">Hours basis</h3>
              <div>Print hours per year: <strong>${num(rate.hours.hoursPerYear)}</strong> <span class="text-body-secondary">(${rate.hours.hoursPerYearSource})</span></div>
              <div>Lifetime print hours: <strong>${num(rate.hours.lifetimeHours)}</strong> <span class="text-body-secondary">(${rate.hours.lifetimeSource})</span></div>
              ${this.#logged(p.id)} ${this.#maintenanceSummary(p.id)}
              ${rate.warnings.map((w) => html`<div class="alert alert-warning py-1 px-2 mt-2 mb-0">${w}</div>`)}
            </div>
          </div>
          ${editing ? this.#printerEditor(p) : nothing}
        </div>
      </section>
    `;
  }

  #logged(printerId: string) {
    const stats = jobStats(this.#doc.printJobs.filter((j) => j.printerId === printerId));
    if (stats.jobs === 0) return nothing;
    return html`<div>Logged prints: <strong>${stats.jobs}</strong> (${num(stats.hours, 1)} h) · failed/cancelled:
      <strong>${stats.failureRate === null ? '–' : percent(stats.failureRate, 1)}</strong> of print time</div>`;
  }

  #maintenanceSummary(printerId: string) {
    const due = maintenanceStatus(this.#doc).filter((m) => m.printerId === printerId && (m.dueInHours === null || m.dueInHours <= 20));
    return due.map((m) => html`<div class="alert alert-${m.dueInHours !== null && m.dueInHours > 0 ? 'info' : 'warning'} py-1 px-2 mt-2 mb-0">
      🔧 ${m.task}: ${dueText(m.dueInHours)}</div>`);
  }

  #maintenance(p: Printer) {
    const tasks = p.maintenance ?? [];
    const status = new Map(maintenanceStatus(this.#doc).map((m) => [m.taskId, m.dueInHours]));
    const set = (i: number, mutate: (t: MaintenanceTask) => void) => this.#printer(p.id, (x) => mutate(x.maintenance![i]!));
    return html`
      <h3 class="h6 mt-3">Maintenance</h3>
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead><tr><th>Task</th><th>Every (h)</th><th>Last done</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${tasks.map((t, i) => html`<tr>
              <td>${cellText(t.task, (v) => set(i, (x) => (x.task = v)), { title: 'Task' })}</td>
              <td style="width: 7rem">${cellNumber(t.everyHours, (v) => set(i, (x) => (x.everyHours = v ?? 100)), { min: 1, title: 'Interval in print hours' })}</td>
              <td class="small text-nowrap">${t.lastDoneHours === null ? 'never' : `${num(t.lastDoneHours)} h${t.lastDoneDate ? ` (${t.lastDoneDate})` : ''}`}</td>
              <td class="small text-nowrap">${dueText(status.get(t.id) ?? null)}</td>
              <td class="text-nowrap">
                <button class="btn btn-sm btn-outline-success" @click=${() => this.#update((d) => { const pr = d.printers.find((x) => x.id === p.id)!; markDone(d, pr, pr.maintenance![i]!, today()); })}>Done</button>
                <button class="btn btn-sm btn-link text-danger" title="Remove" @click=${() => this.#printer(p.id, (x) => x.maintenance!.splice(i, 1))}>✕</button>
              </td>
            </tr>`)}
          </tbody>
        </table>
      </div>
      <button class="btn btn-sm btn-outline-primary" @click=${() => this.#printer(p.id, (x) => (x.maintenance ??= []).push({ id: newId(), task: 'New task', everyHours: 200, lastDoneHours: null }))}>+ Add task</button>
    `;
  }

  #printerEditor(p: Printer) {
    const set = (mutate: (x: Printer) => void) => this.#printer(p.id, mutate);
    return html`
      <hr />
      <div class="row g-3">
        <div class="col-md-4">
          ${textField('Name', p.name, (v) => set((x) => (x.name = v)))}
          ${selectField('Status', p.status, STATUS, (v) => set((x) => (x.status = v as Printer['status'])))}
          ${selectField('Technology', p.technology, [{ value: 'FDM', label: 'FDM' }, { value: 'resin', label: 'Resin (not calculated yet)' }], (v) => set((x) => (x.technology = v as Printer['technology'])))}
          ${switchField('Paid off', !!p.paidOff, (v) => set((x) => (x.paidOff = v)), { help: 'No further amortization, only wear parts and reserve.' })}
        </div>
        <div class="col-md-4">
          ${selectField('Tool setup', p.toolType ?? 'single', TOOL_TYPES, (v) => set((x) => (x.toolType = v as Printer['toolType'])))}
          ${numberField('Toolheads / slots', p.toolheads ?? 1, (v) => set((x) => (x.toolheads = v)), { step: 1, min: 1 })}
          ${numberField('Waste per print run', p.purgeWastePerPlateG ?? 0, (v) => set((x) => (x.purgeWastePerPlateG = v)), { suffix: 'g', min: 0, help: 'Priming line, skirt.' })}
          ${numberField('Purge per filament change', p.purgePerFilamentChangeG ?? 0, (v) => set((x) => (x.purgePerFilamentChangeG = v)), { suffix: 'g', min: 0, step: 0.001 })}
        </div>
        <div class="col-md-4">
          ${numberField('First power phase', p.firstHourPhaseMin ?? 60, (v) => set((x) => (x.firstHourPhaseMin = v)), { suffix: 'min', min: 0, help: 'Higher power while the chamber/bed settles.' })}
          ${numberField('Print hours per year (override)', p.hoursPerYearOverride ?? 0, (v) => set((x) => (x.hoursPerYearOverride = v > 0 ? v : undefined)), { min: 0, help: '0 = derive from hour counters below.' })}
          ${textField('Inbox key', p.inboxKey ?? '', (v) => set((x) => (x.inboxKey = v || undefined)), { help: 'Printer name in detected prints, e.g. "mk3s" from Home Assistant.' })}
          ${numberField('Purchase price', p.purchasePrice ?? 0, (v) => set((x) => (x.purchasePrice = v || undefined)), { suffix: this.#doc.settings.currency, min: 0 })}
        </div>
      </div>
      ${this.#powerProfiles(p)} ${this.#usageStats(p)} ${this.#maintenance(p)} ${this.#machineCosts(p)}
      <button class="btn btn-sm btn-outline-danger mt-2" @click=${() => this.#deletePrinter(p)}>Delete printer</button>
    `;
  }

  #powerProfiles(p: Printer) {
    const profiles = this.#doc.materialProfiles;
    const used = profiles.filter((m) => p.powerProfiles[m.id]);
    const unused = profiles.filter((m) => !p.powerProfiles[m.id]);
    const others = this.#doc.printers.filter((o) => o.id !== p.id && Object.keys(o.powerProfiles).length > 0);
    const setPower = (id: string, key: 'heatupMin' | 'heatupPowerW' | 'powerFirstHourW' | 'powerFollowingHoursW') => (v: number | null) =>
      this.#printer(p.id, (x) => (x.powerProfiles[id]![key] = v ?? 0));
    return html`
      <h3 class="h6 mt-3">Power per material</h3>
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead><tr><th>Material</th><th>Heat-up (min)</th><th>Heat-up (W)</th><th>First phase (W)</th><th>After (W)</th><th></th></tr></thead>
          <tbody>
            ${used.map((m) => {
              const pp = p.powerProfiles[m.id]!;
              return html`<tr>
                <td>${m.name}</td>
                <td>${cellNumber(pp.heatupMin, setPower(m.id, 'heatupMin'), { min: 0, title: 'Heat-up minutes' })}</td>
                <td>${cellNumber(pp.heatupPowerW, setPower(m.id, 'heatupPowerW'), { min: 0, title: 'Heat-up watts' })}</td>
                <td>${cellNumber(pp.powerFirstHourW, setPower(m.id, 'powerFirstHourW'), { min: 0, title: 'First phase watts' })}</td>
                <td>${cellNumber(pp.powerFollowingHoursW, setPower(m.id, 'powerFollowingHoursW'), { min: 0, title: 'Following watts' })}</td>
                <td><button class="btn btn-sm btn-link text-danger" title="Remove" @click=${() => this.#printer(p.id, (x) => delete x.powerProfiles[m.id])}>✕</button></td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <div class="d-flex flex-wrap gap-2">
        ${unused.length
          ? cellSelect('', [{ value: '', label: '+ Add material…' }, ...unused.map((m) => ({ value: m.id, label: m.name }))], (id) => {
              if (id) this.#printer(p.id, (x) => (x.powerProfiles[id] = { heatupMin: 3, heatupPowerW: 200, powerFirstHourW: 100, powerFollowingHoursW: 90 }));
            }, true, 'Add material')
          : nothing}
        ${others.length
          ? cellSelect('', [{ value: '', label: 'Copy power table from…' }, ...others.map((o) => ({ value: o.id, label: o.name }))], (id) => {
              const src = this.#doc.printers.find((o) => o.id === id);
              if (src) this.#printer(p.id, (x) => (x.powerProfiles = structuredClone(src.powerProfiles)));
            }, true, 'Copy power table')
          : nothing}
      </div>
    `;
  }

  #usageStats(p: Printer) {
    const stats = p.usageStats ?? [];
    const set = (i: number, mutate: (s: NonNullable<Printer['usageStats']>[number]) => void) =>
      this.#printer(p.id, (x) => mutate(x.usageStats![i]!));
    return html`
      <h3 class="h6 mt-3">Hour counters</h3>
      <p class="small text-body-secondary">Readings from OctoPrint or the printer's statistics. Leave "since" empty for a lifetime counter.</p>
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead><tr><th>Source</th><th>Since</th><th>As of</th><th>Print hours</th><th></th></tr></thead>
          <tbody>
            ${stats.map((s, i) => html`<tr>
              <td>${cellText(s.source, (v) => set(i, (x) => (x.source = v)), { title: 'Source' })}</td>
              <td>${cellText(s.since, (v) => set(i, (x) => (x.since = v || null)), { type: 'date', title: 'Since' })}</td>
              <td>${cellText(s.asOf, (v) => set(i, (x) => (x.asOf = v)), { type: 'date', title: 'As of' })}</td>
              <td>${cellNumber(s.printHours, (v) => set(i, (x) => (x.printHours = v ?? 0)), { min: 0, title: 'Print hours' })}</td>
              <td><button class="btn btn-sm btn-link text-danger" title="Remove" @click=${() => this.#printer(p.id, (x) => x.usageStats!.splice(i, 1))}>✕</button></td>
            </tr>`)}
          </tbody>
        </table>
      </div>
      <button class="btn btn-sm btn-outline-primary" @click=${() => this.#printer(p.id, (x) => (x.usageStats ??= []).push({ source: 'Manual', asOf: today(), since: null, printHours: 0 }))}>
        + Add reading
      </button>
    `;
  }

  #machineCosts(p: Printer) {
    const cur = this.#doc.settings.currency;
    const costs = this.#doc.machineCosts.filter((c) => c.printerId === p.id).sort((a, b) => b.date.localeCompare(a.date));
    const total = costs.reduce((sum, c) => sum + c.total, 0);
    const set = (id: string, mutate: (c: MachineCost) => void) =>
      this.#update((doc) => mutate(doc.machineCosts.find((c) => c.id === id)!));
    return html`
      <h3 class="h6 mt-3">Machine costs <span class="text-body-secondary fw-normal">(${costs.length} items, ${money(total, cur)})</span></h3>
      <div class="table-responsive" style="max-height: 24rem">
        <table class="table table-sm align-middle">
          <thead class="sticky-top"><tr><th>Date</th><th>Description</th><th>Kind</th><th>Total</th><th>Years</th><th></th></tr></thead>
          <tbody>
            ${costs.map((c) => html`<tr>
              <td>${cellText(c.date, (v) => set(c.id, (x) => (x.date = v)), { type: 'date', title: 'Date' })}</td>
              <td>${cellText(c.description, (v) => set(c.id, (x) => (x.description = v)), { title: 'Description' })}</td>
              <td>${cellSelect(c.kind, COST_KINDS, (v) => set(c.id, (x) => (x.kind = v as MachineCost['kind'])), true, 'Kind')}</td>
              <td>${cellNumber(c.total, (v) => set(c.id, (x) => (x.total = v ?? 0)), { min: 0, width: '7rem', title: 'Total' })}</td>
              <td>${c.kind === 'investment' ? cellNumber(c.amortizationYears, (v) => set(c.id, (x) => (x.amortizationYears = v ?? 0)), { min: 0, width: '5rem', title: 'Amortization years' }) : nothing}</td>
              <td><button class="btn btn-sm btn-link text-danger" title="Delete" @click=${() => this.#update((doc) => (doc.machineCosts = doc.machineCosts.filter((x) => x.id !== c.id)))}>✕</button></td>
            </tr>`)}
          </tbody>
        </table>
      </div>
      <button class="btn btn-sm btn-outline-primary" @click=${() => this.#update((doc) => doc.machineCosts.push({
        id: newId(), date: today(), store: '', description: '', quantity: 1, total: 0, amortizationYears: 0, kind: 'wear-part', printerId: p.id,
      }))}>+ Add cost</button>
    `;
  }

  #reserves(asOf: string) {
    const cur = this.#doc.settings.currency;
    const plans = this.#doc.plannedInvestments;
    const set = (id: string, mutate: (x: PlannedInvestment) => void) =>
      this.#update((doc) => mutate(doc.plannedInvestments.find((x) => x.id === id)!));
    const printerOptions: Option[] = [{ value: '', label: '–' }, ...this.#doc.printers.map((p) => ({ value: p.id, label: p.name }))];
    return html`
      <h2 class="h4 mt-4">Replacement reserves</h2>
      <p class="text-body-secondary small">
        Money set aside per print hour for a future printer. It is charged on all printers that aren't retired. When you
        buy it, the reserve offsets the price.
      </p>
      ${plans.map((plan) => {
        const rate = reserveRatePerHour(plan, asOf, null);
        return html`<section class="card card-body mb-3">
          <div class="row g-3">
            <div class="col-md-4">
              ${textField('Name', plan.name, (v) => set(plan.id, (x) => (x.name = v)))}
              ${numberField('Target amount', plan.targetAmount, (v) => set(plan.id, (x) => (x.targetAmount = v)), { suffix: cur, min: 0 })}
              ${selectField('For printer', plan.printerId ?? '', printerOptions, (v) => set(plan.id, (x) => (x.printerId = v || null)))}
            </div>
            <div class="col-md-4">
              ${selectField('Mode', plan.mode, RESERVE_MODES, (v) => set(plan.id, (x) => (x.mode = v as PlannedInvestment['mode'])))}
              ${plan.mode === 'lifetime' ? numberField('Useful life', plan.usefulLifeYears ?? 5, (v) => set(plan.id, (x) => (x.usefulLifeYears = v)), { suffix: 'years', min: 1 }) : nothing}
              ${plan.mode === 'target-date' ? textField('Target date', plan.targetDate ?? '', (v) => set(plan.id, (x) => (x.targetDate = v || null)), { placeholder: 'YYYY-MM-DD' }) : nothing}
              ${plan.mode === 'fixed-rate' ? numberField('Rate', plan.fixedRatePerHour ?? 0, (v) => set(plan.id, (x) => (x.fixedRatePerHour = v)), { suffix: `${cur}/h`, min: 0, step: 0.01 }) : nothing}
              ${plan.mode !== 'fixed-rate' ? numberField('Expected print hours per year', plan.expectedHoursPerYear ?? 0, (v) => set(plan.id, (x) => (x.expectedHoursPerYear = v > 0 ? v : undefined)), { min: 0, help: '0 = use each printer\'s own hours.' }) : nothing}
            </div>
            <div class="col-md-4">
              ${numberField('Already reserved', plan.alreadyReserved, (v) => set(plan.id, (x) => (x.alreadyReserved = v)), { suffix: cur, min: 0 })}
              <div class="fs-5">Rate: <strong>${rate === null ? 'per printer' : `${money(rate, cur, 3)}/h`}</strong></div>
              <button class="btn btn-sm btn-outline-danger mt-3" @click=${() => this.#update((doc) => (doc.plannedInvestments = doc.plannedInvestments.filter((x) => x.id !== plan.id)))}>Delete reserve</button>
            </div>
          </div>
        </section>`;
      })}
      <button class="btn btn-outline-primary" @click=${() => this.#update((doc) => doc.plannedInvestments.push({
        id: newId(), name: 'Next printer', printerId: null, targetAmount: 1000, mode: 'lifetime', usefulLifeYears: 5, alreadyReserved: 0,
      }))}>Add reserve</button>
    `;
  }

  #materialProfiles() {
    const set = (id: string, mutate: (m: AppDocument['materialProfiles'][number]) => void) =>
      this.#update((doc) => mutate(doc.materialProfiles.find((m) => m.id === id)!));
    return html`
      <h2 class="h4 mt-4">Material profiles</h2>
      <p class="text-body-secondary small">Groups filaments by printing behavior; each printer has a power table per profile.</p>
      <div class="row row-cols-1 row-cols-md-3 g-2 mb-2">
        ${this.#doc.materialProfiles.map((m) => html`<div class="col"><div class="input-group input-group-sm">
          ${cellText(m.name, (v) => set(m.id, (x) => (x.name = v)), { title: 'Profile name' })}
          ${cellSelect(m.baseMaterial, BASE_MATERIALS.map((b) => ({ value: b, label: b })), (v) => set(m.id, (x) => (x.baseMaterial = v as BaseMaterial)), true, 'Base material')}
        </div></div>`)}
      </div>
      <button class="btn btn-sm btn-outline-primary" @click=${() => this.#update((doc) => doc.materialProfiles.push({ id: newId(), name: 'New profile', baseMaterial: 'PLA' }))}>+ Add profile</button>
    `;
  }

  #addPrinter = () => {
    const id = newId();
    this.#update((doc) =>
      doc.printers.push({
        id, name: 'New printer', technology: 'FDM', status: 'planned', toolheads: 1, toolType: 'single',
        purgeWastePerPlateG: 10, purgePerFilamentChangeG: null, firstHourPhaseMin: 60, powerProfiles: {}, usageStats: [],
      }),
    );
    this.editing = id;
  };

  #deletePrinter(p: Printer) {
    const usedIn = this.#doc.quotes.filter((q) => q.plates.some((pl) => pl.printerId === p.id)).length;
    if (usedIn > 0) {
      alert(`"${p.name}" is used in ${usedIn} quote(s). Set it to "retired" instead.`);
      return;
    }
    if (!confirm(`Delete "${p.name}" and its machine costs?`)) return;
    this.#update((doc) => {
      doc.printers = doc.printers.filter((x) => x.id !== p.id);
      doc.machineCosts = doc.machineCosts.filter((c) => c.printerId !== p.id);
    });
    this.editing = null;
  }
}

export function dueText(dueInHours: number | null): string {
  if (dueInHours === null) return 'not recorded yet: press "Done" after doing it';
  return dueInHours <= 0 ? `overdue by ${Math.round(-dueInHours)} h` : `due in ${Math.round(dueInHours)} h`;
}
