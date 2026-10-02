import { LitElement, html, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface PricePoint {
  date: string;
  pricePerKg: number;
  kg: number;
  series: 'single' | 'multi';
  label: string;
}

const SERIES = {
  single: { name: '1 kg spools', color: 'var(--series-1)' },
  multi: { name: 'Multi-packs', color: 'var(--series-2)' },
} as const;

const HEIGHT = 220;
const PAD = { top: 16, right: 64, bottom: 28, left: 44 };
const DAY = 86_400_000;

/**
 * Price per kg over time, one dot per purchase (FI-8). Two series by pack size,
 * legend + direct label on the latest point, hover/focus tooltip, table view.
 */
@customElement('price-history-chart')
export class PriceHistoryChart extends LitElement {
  @property({ attribute: false }) points: PricePoint[] = [];
  @property() currency = 'EUR';
  @state() private width = 600;
  @state() private hover: number | null = null;
  // Inside a horizontally scrolling table, size to the visible area, not the whole table.
  #resize = new ResizeObserver(() => {
    const own = this.getBoundingClientRect().width;
    const visible = this.closest('.table-responsive')?.clientWidth;
    this.width = Math.max(280, Math.round(Math.min(own, visible ? visible - 24 : own)));
  });

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.#resize.observe(this);
    const scroller = this.closest('.table-responsive');
    if (scroller) this.#resize.observe(scroller);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#resize.disconnect();
  }

  #fmt(v: number) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: this.currency, maximumFractionDigits: 2 }).format(v);
  }

  override render() {
    const pts = [...this.points].sort((a, b) => a.date.localeCompare(b.date));
    if (pts.length === 0) return html`<p class="small text-body-secondary">No purchases to chart.</p>`;
    const w = this.width;
    const t = pts.map((p) => Date.parse(p.date));
    // Margin on both sides so edge points don't sit on the axis labels.
    const span = Math.max(Math.max(...t) - Math.min(...t), 180 * DAY);
    const t0 = Math.min(...t) - span * 0.04;
    const t1 = Math.max(...t) + span * 0.04;
    const yMax = niceMax(Math.max(...pts.map((p) => p.pricePerKg)) * 1.1);
    const x = (ms: number) => PAD.left + ((ms - t0) / (t1 - t0)) * (w - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - v / yMax) * (HEIGHT - PAD.top - PAD.bottom);
    const yTicks = ticks(yMax);
    const years = yearTicks(t0, t1);
    const used = (['single', 'multi'] as const).filter((s) => pts.some((p) => p.series === s));
    const latest = used.map((s) => pts.filter((p) => p.series === s).at(-1)!);
    const hovered = this.hover === null ? null : pts[this.hover];

    return html`
      <div class="viz-root position-relative">
        ${used.length > 1
          ? html`<div class="d-flex gap-3 small mb-1 viz-legend">
              ${used.map((s) => html`<span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill=${SERIES[s].color}></circle></svg> ${SERIES[s].name}</span>`)}
            </div>`
          : nothing}
        <svg width=${w} height=${HEIGHT} role="img" aria-label="Price per kg over time, one dot per purchase">
          ${yTicks.map((v) => svg`
            <line x1=${PAD.left} x2=${w - PAD.right} y1=${y(v)} y2=${y(v)} class="viz-grid"></line>
            <text x=${PAD.left - 6} y=${y(v)} dy="0.32em" text-anchor="end" class="viz-axis">${v}</text>`)}
          ${years.map((ms) => svg`
            <line x1=${x(ms)} x2=${x(ms)} y1=${HEIGHT - PAD.bottom} y2=${HEIGHT - PAD.bottom + 4} class="viz-base"></line>
            <text x=${x(ms)} y=${HEIGHT - 8} text-anchor="middle" class="viz-axis">${new Date(ms).getUTCFullYear()}</text>`)}
          <line x1=${PAD.left} x2=${w - PAD.right} y1=${y(0)} y2=${y(0)} class="viz-base"></line>
          ${pts.map((p, i) => svg`
            <g class="viz-point" tabindex="0" role="img" aria-label=${`${p.date}, ${p.label}: ${this.#fmt(p.pricePerKg)} per kg`}
              @pointerenter=${() => (this.hover = i)} @pointerleave=${() => (this.hover = null)}
              @focus=${() => (this.hover = i)} @blur=${() => (this.hover = null)}>
              <circle cx=${x(Date.parse(p.date))} cy=${y(p.pricePerKg)} r="12" fill="transparent"></circle>
              <circle cx=${x(Date.parse(p.date))} cy=${y(p.pricePerKg)} r=${this.hover === i ? 6 : 5} fill=${SERIES[p.series].color} class="viz-dot"></circle>
            </g>`)}
          ${latest.map((p) => svg`
            <text x=${x(Date.parse(p.date)) + 9} y=${y(p.pricePerKg)} dy="0.32em" class="viz-label">${this.#fmt(p.pricePerKg)}</text>`)}
        </svg>
        ${hovered
          ? html`<div class="viz-tooltip" style="left:${Math.min(x(Date.parse(hovered.date)) + 12, w - 190)}px; top:${Math.max(y(hovered.pricePerKg) - 20, 0)}px">
              <div class="fw-semibold">${this.#fmt(hovered.pricePerKg)} / kg</div>
              <div class="d-flex align-items-center gap-1"><svg width="12" height="4" aria-hidden="true"><line x1="0" x2="12" y1="2" y2="2" stroke=${SERIES[hovered.series].color} stroke-width="2"></line></svg>${SERIES[hovered.series].name}</div>
              <div class="viz-muted">${hovered.date} · ${hovered.kg} kg · ${hovered.label}</div>
            </div>`
          : nothing}
        <details class="small">
          <summary>Show as table</summary>
          <table class="table table-sm mt-1 w-auto">
            <thead><tr><th>Date</th><th>Purchase</th><th>Pack</th><th class="text-end">kg</th><th class="text-end">per kg</th></tr></thead>
            <tbody>${[...pts].reverse().map((p) => html`<tr><td>${p.date}</td><td>${p.label}</td><td>${SERIES[p.series].name}</td><td class="text-end">${p.kg}</td><td class="text-end">${this.#fmt(p.pricePerKg)}</td></tr>`)}</tbody>
          </table>
        </details>
      </div>
    `;
  }
}

/** Round up to a clean axis maximum (5, 10, 20, 25, 30, 40, 50, ...). */
function niceMax(v: number): number {
  const steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 100) * 100;
}

function ticks(max: number): number[] {
  const step = max <= 10 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
}

function yearTicks(t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let year = new Date(t0).getUTCFullYear() + 1; Date.UTC(year, 0, 1) <= t1; year++) out.push(Date.UTC(year, 0, 1));
  return out;
}
