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

/** Stores used before, most recently used first (purchases and machine costs). */
export function storeSuggestions(doc: AppDocument): string[] {
  const last = new Map<string, string>();
  for (const x of [...doc.purchases, ...doc.machineCosts]) {
    const name = x.store?.trim();
    if (name && (last.get(name) ?? '') < x.date) last.set(name, x.date);
  }
  return [...last.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([name]) => name);
}

/** `<datalist>` for store inputs (`list="stores"`). */
export function storeDatalist(doc: AppDocument) {
  return html`<datalist id="stores">${storeSuggestions(doc).map((s) => html`<option value=${s}></option>`)}</datalist>`;
}

/**
 * Store input: free text plus a visible "previous stores" dropdown (a bare
 * datalist only shows up while typing, which is easy to miss).
 */
export function storeField(doc: AppDocument, value: string, onChange: (store: string) => void) {
  const stores = storeSuggestions(doc);
  return html`<div class="input-group input-group-sm">
    <input class="form-control" list="stores" placeholder="Store" aria-label="Store" .value=${value}
      @change=${(e: Event) => onChange((e.target as HTMLInputElement).value.trim())} />
    ${stores.length
      ? html`<select class="form-select flex-grow-0" style="width: 2.5rem; min-width: 0" aria-label="Previous stores" title="Previous stores"
          @change=${(e: Event) => {
            const select = e.target as HTMLSelectElement;
            if (select.value) onChange(select.value);
            select.value = '';
          }}>
          <option value="" selected></option>
          ${stores.map((s) => html`<option value=${s}>${s}</option>`)}
        </select>`
      : ''}
  </div>`;
}
