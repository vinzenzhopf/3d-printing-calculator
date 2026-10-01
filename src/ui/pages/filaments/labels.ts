import { html, nothing } from 'lit';
import type { PriceSource, ResolvedPrice } from '../../../core/calc/price-resolution';
import type { AppDocument, Filament, ProductLine } from '../../../core/model';
import type { Option } from '../../fields';
import { money } from '../../format';

export const SOURCE_LABEL: Record<PriceSource, string> = {
  'manual-filament': 'manual (color)',
  'manual-line': 'manual (line)',
  purchases: 'purchases',
  'line-purchases': 'line purchases',
  none: 'no price',
};

export function lineLabel(line: ProductLine): string {
  return `${line.manufacturer} ${line.name}`;
}

export function filamentLabel(doc: AppDocument, f: Filament): string {
  const line = doc.productLines.find((l) => l.id === f.productLineId);
  return `${line ? lineLabel(line) : '?'} – ${f.color}${f.finish ? ` (${f.finish})` : ''}`;
}

/** Filament options grouped/sorted by product line, for selects. */
export function filamentOptions(doc: AppDocument): Option[] {
  return doc.filaments
    .map((f) => ({ value: f.id, label: filamentLabel(doc, f) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Price with its source and a stale marker. */
export function priceCell(price: ResolvedPrice | null, currency: string) {
  if (!price || price.pricePerKg === null) return html`<span class="text-body-secondary">–</span>`;
  return html`${money(price.pricePerKg, currency)}
    <span class="badge text-bg-light border fw-normal" title=${price.asOf ? `as of ${price.asOf}` : ''}>${SOURCE_LABEL[price.source]}</span>
    ${price.stale ? html`<span class="badge text-bg-warning fw-normal" title="No purchase or manual price within the price window">stale</span>` : nothing}`;
}

export function swatch(hex: string | undefined) {
  return html`<span
    class="d-inline-block rounded-circle border align-middle"
    style="width:1rem;height:1rem;background:${hex || 'transparent'}"
  ></span>`;
}
