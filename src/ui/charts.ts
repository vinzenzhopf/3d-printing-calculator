import { LitElement, html, nothing, svg, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface Bar {
  label: string;
  value: number;
}

const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 28, left: 48 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-01" → "Jan 26" (axis) / "January 2026" style text for tooltips. */
function monthText(month: string, long = false): string {
  const [y, m] = month.split('-');
  const name = MONTHS[Number(m) - 1] ?? month;
  return long ? `${name} ${y}` : name;
}

/**
 * One value per month as vertical bars: hover/focus tooltip, year marks under
 * January, and a table view. `format` renders values (axis, tooltip, table).
 */
@customElement('month-chart')
export class MonthChart extends LitElement {
  @property({ attribute: false }) bars: Bar[] = [];
  @property({ attribute: false }) format: (v: number) => string = (v) => String(Math.round(v));
  @property() name = '';
  @state() private width = 600;
  @state() private hover: number | null = null;
  #resize = new ResizeObserver(() => (this.width = Math.max(280, Math.round(this.getBoundingClientRect().width))));

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.#resize.observe(this);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#resize.disconnect();
  }

  override render() {
    const bars = this.bars;
    if (bars.length === 0) return nothing;
    const w = this.width;
    const max = niceMax(Math.max(...bars.map((b) => b.value), 0));
    const plotW = w - PAD.left - PAD.right;
    const slot = plotW / bars.length;
    const barW = Math.max(2, Math.min(slot * 0.7, 36));
    const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
    const y = (v: number) => PAD.top + (1 - v / max) * (HEIGHT - PAD.top - PAD.bottom);
    const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];
    // Label every month when there is room, else only quarters.
    const every = slot >= 34 ? 1 : slot >= 12 ? 3 : 6;
    const hovered = this.hover === null ? null : bars[this.hover];
    return html`
      <div class="viz-root position-relative">
        <svg width=${w} height=${HEIGHT} role="img" aria-label=${`${this.name} per month`}>
          ${ticks.map((v) => svg`
            <line x1=${PAD.left} x2=${w - PAD.right} y1=${y(v)} y2=${y(v)} class="viz-grid"></line>
            <text x=${PAD.left - 6} y=${y(v)} dy="0.32em" text-anchor="end" class="viz-axis">${this.format(v)}</text>`)}
          ${bars.map((b, i) => svg`
            <g class="viz-point" tabindex="0" role="img" aria-label=${`${monthText(b.label, true)}: ${this.format(b.value)}`}
              @pointerenter=${() => (this.hover = i)} @pointerleave=${() => (this.hover = null)}
              @focus=${() => (this.hover = i)} @blur=${() => (this.hover = null)}>
              <rect x=${PAD.left + i * slot} y=${PAD.top} width=${slot} height=${HEIGHT - PAD.top - PAD.bottom} fill="transparent"></rect>
              <rect x=${x(i)} y=${y(b.value)} width=${barW} height=${Math.max(y(0) - y(b.value), b.value > 0 ? 1 : 0)} rx="2"
                fill="var(--series-1)" opacity=${this.hover === null || this.hover === i ? 1 : 0.55}></rect>
            </g>
            ${i % every === 0 || b.label.endsWith('-01')
              ? svg`<text x=${x(i) + barW / 2} y=${HEIGHT - 12} text-anchor="middle" class="viz-axis">${monthText(b.label)}</text>`
              : nothing}
            ${b.label.endsWith('-01') || i === 0
              ? svg`<text x=${x(i) + barW / 2} y=${HEIGHT - 1} text-anchor="middle" class="viz-axis">${b.label.slice(0, 4)}</text>`
              : nothing}`)}
          <line x1=${PAD.left} x2=${w - PAD.right} y1=${y(0)} y2=${y(0)} class="viz-base"></line>
        </svg>
        ${hovered
          ? html`<div class="viz-tooltip" style="width: auto; left:${Math.min(x(this.hover!) + barW + 6, w - 140)}px; top:${Math.max(y(hovered.value) - 30, 0)}px">
              <div class="fw-semibold">${this.format(hovered.value)}</div>
              <div class="viz-muted">${monthText(hovered.label, true)}</div>
            </div>`
          : nothing}
        <details class="small">
          <summary>Show as table</summary>
          <table class="table table-sm mt-1 w-auto">
            <thead><tr><th>Month</th><th class="text-end">${this.name}</th></tr></thead>
            <tbody>${[...bars].reverse().map((b) => html`<tr><td>${monthText(b.label, true)}</td><td class="text-end">${this.format(b.value)}</td></tr>`)}</tbody>
          </table>
        </details>
      </div>
    `;
  }
}

export interface ShareRow {
  label: string;
  value: number;
  /** Value as text, e.g. "1.2 kg". */
  text: string;
  /** Color swatch in front of the label (filaments). */
  swatch?: string;
}

/** Ranked horizontal bars with the value at the end, e.g. usage per material. */
export function shareBars(rows: ShareRow[], empty: string): TemplateResult {
  if (rows.length === 0) return html`<p class="small text-body-secondary mb-0">${empty}</p>`;
  const max = Math.max(...rows.map((r) => r.value));
  return html`<div class="d-flex flex-column gap-2">
    ${rows.map((r) => html`<div>
      <div class="d-flex justify-content-between gap-2 small">
        <span class="text-truncate">${r.swatch !== undefined
          ? html`<span class="d-inline-block rounded-circle border align-middle me-1" style="width:.85rem;height:.85rem;background:${r.swatch || 'transparent'}"></span>`
          : nothing}${r.label}</span>
        <span class="text-nowrap fw-semibold">${r.text}</span>
      </div>
      <div class="progress" style="height: 6px" role="presentation"><div class="progress-bar" style="width:${(r.value / max) * 100}%; background: var(--series-1, #2a78d6)"></div></div>
    </div>`)}
  </div>`;
}

/** Clean axis maximum: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((f) => f * p >= v) ?? 10) * p;
}
