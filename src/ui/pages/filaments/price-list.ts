import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { addMonths } from '../../../core/calc/filament-price';
import { linePrices, packClass, resolveFilamentPrice, type ResolvedPrice } from '../../../core/calc/price-resolution';
import type { AppDocument, ManualPrice, ProductLine } from '../../../core/model';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { cellNumber } from '../../fields';
import { money, percent, today } from '../../format';
import '../../price-history-chart';
import type { PricePoint } from '../../price-history-chart';
import { lineLabel, priceCell } from './labels';

@customElement('price-list')
export class PriceList extends LitElement {
  #store = new StoreController(this, store());
  @state() private open = new Set<string>();

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  #update(mutate: (doc: AppDocument) => void) {
    void this.#store.store.update(mutate);
  }

  override render() {
    const doc = this.#doc;
    const asOf = today();
    const lines = doc.productLines
      .filter((l) => doc.filaments.some((f) => f.productLineId === l.id))
      .sort((a, b) => lineLabel(a).localeCompare(lineLabel(b)));
    const rows = lines.map((l) => ({ line: l, computed: linePrices(doc, l.id, asOf) }));
    const acceptable = rows.filter((r) => !r.line.manualPrice && suggested(r.computed));

    return html`
      <p class="text-body-secondary">
        Quotes use a manual price when one is set (color before line), otherwise the price computed from recent
        purchases (last ${doc.settings.filamentPriceWindowMonths} months, reaching further back for rarely bought
        colors). Manual prices older than that window are marked.
      </p>
      <div class="d-flex mb-2">
        <button class="btn btn-sm btn-outline-primary ms-auto" ?disabled=${acceptable.length === 0} @click=${() => this.#acceptAll(acceptable, asOf)}>
          Use computed price for ${acceptable.length} line(s) without manual price
        </button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead>
            <tr>
              <th>Product line</th><th>Computed: 1 kg spools</th><th>Computed: multi-packs</th>
              <th>Manual €/kg</th><th>As of</th><th class="text-end">vs. computed</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => this.#lineRows(r.line, r.computed, asOf))}
          </tbody>
        </table>
      </div>
    `;
  }

  #lineRows(line: ProductLine, computed: ReturnType<typeof linePrices>, asOf: string) {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    const best = suggested(computed);
    const isOpen = this.open.has(line.id);
    const colorOverrides = doc.filaments.filter((f) => f.productLineId === line.id && f.manualPrice).length;
    const setManual = (m: ManualPrice | undefined) =>
      this.#update((d) => {
        const l = d.productLines.find((x) => x.id === line.id)!;
        if (m) l.manualPrice = m;
        else delete l.manualPrice;
      });
    const toggle = () => {
      const next = new Set(this.open);
      if (!next.delete(line.id)) next.add(line.id);
      this.open = next;
    };
    return html`
      <tr>
        <td>
          <button class="btn btn-sm btn-link p-0 text-decoration-none" @click=${toggle}>${isOpen ? '▾' : '▸'} ${lineLabel(line)}</button>
          ${colorOverrides ? html`<span class="badge text-bg-light border">${colorOverrides} color price(s)</span>` : nothing}
        </td>
        <td class="text-nowrap">${priceCell(computed.single, cur)}</td>
        <td class="text-nowrap">${priceCell(computed.multi, cur)}</td>
        ${this.#manualCells(line.manualPrice, best?.pricePerKg ?? null, setManual, asOf)}
      </tr>
      ${isOpen ? html`<tr><td colspan="7">${this.#history(line)}</td></tr>` : nothing}
      ${isOpen ? this.#colorRows(line, asOf) : nothing}
    `;
  }

  #history(line: ProductLine) {
    const doc = this.#doc;
    const color = new Map(doc.filaments.filter((f) => f.productLineId === line.id).map((f) => [f.id, f.color]));
    const points: PricePoint[] = doc.purchases
      .filter((p) => color.has(p.filamentId) && p.totalKg > 0)
      .map((p) => ({ date: p.date, pricePerKg: p.totalPrice / p.totalKg, kg: p.totalKg, series: packClass(p), label: color.get(p.filamentId)! }));
    return html`<div class="py-2"><div class="small fw-semibold mb-1">${lineLabel(line)}: price per kg per purchase</div>
      <price-history-chart .points=${points} .currency=${doc.settings.currency}></price-history-chart></div>`;
  }

  #colorRows(line: ProductLine, asOf: string) {
    const doc = this.#doc;
    const cur = doc.settings.currency;
    return doc.filaments
      .filter((f) => f.productLineId === line.id)
      .sort((a, b) => a.color.localeCompare(b.color))
      .map((f) => {
        const own = resolveFilamentPrice(doc, f.id, { asOf, needKg: 1, computedOnly: true });
        const setManual = (m: ManualPrice | undefined) =>
          this.#update((d) => {
            const x = d.filaments.find((y) => y.id === f.id)!;
            if (m) x.manualPrice = m;
            else delete x.manualPrice;
          });
        return html`<tr class="table-light">
          <td class="ps-4 small">${f.color}${f.finish ? ` (${f.finish})` : ''}${f.acquisition !== 'purchase' ? html` <span class="badge text-bg-light border">${f.acquisition}</span>` : nothing}</td>
          <td class="text-nowrap small" colspan="2">${priceCell(own, cur)}</td>
          ${this.#manualCells(f.manualPrice, own.pricePerKg, setManual, asOf)}
        </tr>`;
      });
  }

  #manualCells(manual: ManualPrice | undefined, computed: number | null, set: (m: ManualPrice | undefined) => void, asOf: string) {
    const windowStart = addMonths(asOf, -this.#doc.settings.filamentPriceWindowMonths);
    const deviation = manual && computed ? manual.pricePerKg / computed - 1 : null;
    return html`
      <td style="width: 8rem">${cellNumber(manual?.pricePerKg ?? null, (v) => set(v === null ? undefined : { pricePerKg: v, asOf }), { min: 0, step: 0.01, allowEmpty: true, title: 'Manual price per kg' })}</td>
      <td class="small text-nowrap">${manual ? html`${manual.asOf}${manual.asOf < windowStart ? html` <span class="badge text-bg-warning fw-normal">old</span>` : nothing}` : ''}</td>
      <td class="text-end small ${deviation !== null && Math.abs(deviation) > 0.15 ? 'text-danger' : ''}">${deviation === null ? '' : `${deviation > 0 ? '+' : ''}${percent(deviation)}`}</td>
      <td class="text-nowrap">
        ${computed !== null && manual?.pricePerKg !== round2(computed)
          ? html`<button class="btn btn-sm btn-link p-0 me-2" title="Set the manual price to the computed one" @click=${() => set({ pricePerKg: round2(computed), asOf })}>use ${money(computed, this.#doc.settings.currency)}</button>`
          : nothing}
        ${manual ? html`<button class="btn btn-sm btn-link p-0 text-danger" title="Remove manual price" @click=${() => set(undefined)}>clear</button>` : nothing}
      </td>
    `;
  }

  #acceptAll(rows: { line: ProductLine; computed: ReturnType<typeof linePrices> }[], asOf: string) {
    this.#update((d) => {
      for (const r of rows) {
        const price = suggested(r.computed)?.pricePerKg;
        if (price) d.productLines.find((l) => l.id === r.line.id)!.manualPrice = { pricePerKg: round2(price), asOf };
      }
    });
  }
}

/** The line price a quote would most likely use: single spools, else multi-packs. */
function suggested(c: ReturnType<typeof linePrices>): ResolvedPrice | null {
  return c.single ?? c.multi;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
