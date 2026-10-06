import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { AppDocument } from '../../core/model';
import { counterPeriods, monthlyStats, monthsBefore, spendByBrand, totals, usageByFilament, usageByMaterial, type CounterPeriod, type MonthStats } from '../../core/statistics';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import '../charts';
import { shareBars } from '../charts';
import { money, num, percent, today } from '../format';
import { filamentLabel } from './filaments/labels';

type Period = '12' | '24' | 'all';
type Metric = 'spent' | 'boughtKg' | 'usedG' | 'hours' | 'prints';

const PERIODS: [Period, string][] = [['12', '12 months'], ['24', '24 months'], ['all', 'All time']];

/** Statistics over the print log and purchases: key figures, months, and breakdowns. */
@customElement('statistics-page')
export class StatisticsPage extends LitElement {
  #store = new StoreController(this, store());
  @state() private period: Period = '12';
  @state() private metric: Metric = 'spent';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  /** First month shown; "all" starts at the oldest print or purchase. */
  #fromMonth(): string {
    const now = today().slice(0, 7);
    if (this.period !== 'all') return monthsBefore(now, Number(this.period) - 1);
    const dates = [...this.#doc.purchases.map((p) => p.date), ...this.#doc.printJobs.map((j) => j.date)].sort();
    return dates[0]?.slice(0, 7) ?? now;
  }

  override render() {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const fromMonth = this.#fromMonth();
    const from = this.period === 'all' ? undefined : `${fromMonth}-01`;
    const t = totals(doc, from);
    const months = monthlyStats(doc, fromMonth, today().slice(0, 7));
    const metrics: Record<Metric, { label: string; value: (m: MonthStats) => number; format: (v: number) => string }> = {
      spent: { label: 'Spent on filament', value: (m) => m.spent, format: (v) => money(v, cur, 0) },
      boughtKg: { label: 'Filament bought', value: (m) => m.boughtKg, format: (v) => `${num(v, v < 10 ? 1 : 0)} kg` },
      usedG: { label: 'Filament printed', value: (m) => m.usedG / 1000, format: (v) => `${num(v, v < 10 ? 1 : 0)} kg` },
      hours: { label: 'Print hours', value: (m) => m.hours, format: (v) => `${num(v)} h` },
      prints: { label: 'Prints', value: (m) => m.prints, format: (v) => num(v) },
    };
    const metric = metrics[this.metric];
    const filament = (id: string) => doc.filaments.find((f) => f.id === id);
    const kg = (g: number) => (g >= 1000 ? `${num(g / 1000, 1)} kg` : `${num(g)} g`);

    const kpis: [string, string, string?][] = [
      ['Spent on filament', money(t.spent, cur, 0), `${num(t.boughtKg, 1)} kg bought`],
      ['Prints logged', num(t.prints), t.successRate === null ? undefined : `${percent(t.successRate)} successful`],
      ['Print hours', num(t.hours), t.prints ? `Ø ${num(t.hours / t.prints, 1)} h per print` : undefined],
      ['Filament printed', kg(t.usedG), t.hours ? `${num(t.usedG / t.hours)} g per hour` : undefined],
      ['In stock now', kg(t.stockG), `${t.spools} spools${t.unweighedSpools ? `, ${t.unweighedSpools} not weighed` : ''}`],
    ];

    return html`
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <h1 class="h3 mb-0 me-auto">Statistics</h1>
        <div class="btn-group btn-group-sm" role="group" aria-label="Period">
          ${PERIODS.map(([v, label]) => html`<button class="btn ${this.period === v ? 'btn-secondary' : 'btn-outline-secondary'}" @click=${() => (this.period = v)}>${label}</button>`)}
        </div>
      </div>

      <div class="row row-cols-2 row-cols-md-3 row-cols-xl-5 g-3 mb-3">
        ${kpis.map(([label, value, sub]) => html`<div class="col"><div class="card card-body h-100">
          <div class="small text-body-secondary">${label}</div>
          <div class="fs-4 fw-semibold">${value}</div>
          ${sub ? html`<div class="small text-body-secondary">${sub}</div>` : nothing}
        </div></div>`)}
      </div>

      <section class="card card-body mb-3">
        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
          <h2 class="h6 mb-0 me-auto">Per month</h2>
          <select class="form-select form-select-sm w-auto" aria-label="Value" @change=${(e: Event) => (this.metric = (e.target as HTMLSelectElement).value as Metric)}>
            ${(Object.keys(metrics) as Metric[]).map((k) => html`<option value=${k} ?selected=${k === this.metric}>${metrics[k].label}</option>`)}
          </select>
        </div>
        <month-chart .bars=${months.map((m) => ({ label: m.month, value: metric.value(m) }))} .format=${metric.format} name=${metric.label}></month-chart>
      </section>

      <div class="row g-3">
        <div class="col-lg-4"><section class="card card-body h-100">
          <h2 class="h6">Printed by material</h2>
          ${shareBars(usageByMaterial(doc, from).map((s) => ({ label: s.key, value: s.value, text: kg(s.value) })), 'No prints with filament logged yet.')}
        </section></div>
        <div class="col-lg-4"><section class="card card-body h-100">
          <h2 class="h6">Most printed colors</h2>
          ${shareBars(usageByFilament(doc, from).slice(0, 10).map((s) => {
            const f = filament(s.filamentId!);
            return { label: f ? filamentLabel(doc, f) : '?', value: s.value, text: kg(s.value), swatch: f?.colorHex ?? '' };
          }), 'No prints with filament logged yet.')}
        </section></div>
        <div class="col-lg-4"><section class="card card-body h-100">
          <h2 class="h6">Spent by brand</h2>
          ${shareBars(spendByBrand(doc, from).map((s) => ({ label: s.key, value: s.value, text: money(s.value, cur, 0) })), 'No purchases in this period.')}
        </section></div>
        ${t.prints
          ? html`<div class="col-lg-4"><section class="card card-body h-100">
              <h2 class="h6">Print results</h2>
              ${shareBars(([['success', 'Successful'], ['failed', 'Failed'], ['cancelled', 'Cancelled']] as const).map(([k, label]) => ({ label, value: t.results[k], text: `${t.results[k]} (${percent(t.results[k] / t.prints)})` })).filter((r) => r.value > 0), '')}
            </section></div>`
          : nothing}
      </div>
      ${this.#counters()}
    `;
  }

  /** Printer counters (OctoPrint, display) per period, all time; independent of the period buttons. */
  #counters() {
    const rows = counterPeriods(this.#doc);
    if (rows.length === 0) return nothing;
    const period = (r: CounterPeriod) =>
      r.since === null ? `lifetime, as of ${r.asOf}`
      : r.since.endsWith('-01-01') && r.asOf === `${r.since.slice(0, 4)}-12-31` ? r.since.slice(0, 4)
      : `${r.since} – ${r.asOf}`;
    return html`
      <section class="card card-body mt-3">
        <h2 class="h6">Printer counters</h2>
        <p class="small text-body-secondary">
          What the printers themselves counted (OctoPrint, printer display), next to the print log for the same period.
          Edit them under Printers → usage statistics.
        </p>
        <div class="table-responsive"><table class="table table-sm align-middle mb-0">
          <thead><tr><th>Printer</th><th>Period</th><th>Source</th><th class="text-end">Prints</th><th class="text-end">Hours</th><th class="text-end">In print log</th></tr></thead>
          <tbody>${rows.map((r) => html`<tr>
            <td>${r.printer}</td>
            <td class="text-nowrap">${period(r)}</td>
            <td class="small">${r.source}</td>
            <td class="text-end text-nowrap">${r.prints === undefined ? '–' : num(r.prints)}${r.printsFinished !== undefined ? html` <span class="small text-body-secondary">(${num(r.printsFinished)} finished)</span>` : nothing}</td>
            <td class="text-end">${num(r.hours)} h</td>
            <td class="text-end text-nowrap small">${r.loggedPrints ? `${num(r.loggedPrints)} prints · ${num(r.loggedHours)} h` : '–'}</td>
          </tr>`)}</tbody>
        </table></div>
      </section>
    `;
  }
}
