import { calculateQuote, type QuoteResult } from './calc/quote';
import type { AppDocument, Id, IsoDate, Quote, QuoteStatus } from './model';

export const QUOTE_STATUSES: QuoteStatus[] = ['draft', 'sent', 'accepted', 'printing', 'delivered', 'paid', 'rejected'];

/** Statuses that count as revenue for customer statistics. */
export const BILLED_STATUSES = new Set<QuoteStatus>(['accepted', 'printing', 'delivered', 'paid']);

export function nextQuoteNumber(doc: AppDocument): number {
  return doc.quotes.reduce((max, q) => Math.max(max, q.number), 0) + 1;
}

export function createQuote(doc: AppDocument, opts: { id: Id; date: IsoDate; customerId?: Id }): Quote {
  const customer = doc.customers.find((c) => c.id === opts.customerId);
  const profileId =
    customer?.defaultPricingProfileId ??
    doc.pricingProfiles.find((p) => p.id === 'standard')?.id ??
    doc.pricingProfiles[0]?.id ??
    '';
  return {
    id: opts.id,
    number: nextQuoteNumber(doc),
    title: 'New quote',
    date: opts.date,
    pricingProfileId: profileId,
    status: 'draft',
    plates: [],
    extras: [],
    ...(customer ? { customerId: customer.id } : {}),
    ...(customer?.discountPercent ? { discountPercent: customer.discountPercent } : {}),
  };
}

/**
 * Status change with freezing (QC-5): leaving draft stores a snapshot of the
 * calculation; going back to draft discards it so the quote recalculates live.
 */
export function setQuoteStatus(doc: AppDocument, quote: Quote, status: QuoteStatus, asOf: IsoDate, now: Date): void {
  if (status === 'draft') delete quote.snapshot;
  else if (quote.status === 'draft' || !quote.snapshot) freezeQuote(doc, quote, asOf, now);
  quote.status = status;
}

export function freezeQuote(doc: AppDocument, quote: Quote, asOf: IsoDate, now: Date): void {
  quote.snapshot = { frozenAt: now.toISOString(), result: calculateQuote(doc, quote, asOf) };
}

/** The result to show: the frozen snapshot, or a live calculation for drafts and unfrozen quotes. */
export function quoteResult(doc: AppDocument, quote: Quote, asOf: IsoDate): QuoteResult | null {
  if (quote.snapshot) return quote.snapshot.result;
  try {
    return calculateQuote(doc, quote, asOf);
  } catch {
    return null;
  }
}

export interface OfferPosition {
  name: string;
  quantity: number;
  /** At the price level the customer sees (gross when prices include VAT). */
  unitPrice: number;
  total: number;
}

/**
 * What the customer is charged for, at the shown price level: the required
 * parts with their agreed prices when the quote is priced by parts, else one
 * position per plate (its share of the price).
 */
export function offerPositions(result: QuoteResult): OfferPosition[] {
  if (result.explain?.target?.kind === 'parts') {
    return (result.parts ?? [])
      .filter((p) => p.price !== null && p.required > 0)
      .map((p) => ({ name: p.name, quantity: p.required, unitPrice: p.price!, total: p.required * p.price! }));
  }
  const factor = result.net > 0 ? result.price / result.net : 1;
  return result.plates.map((p) => ({ name: p.name, quantity: p.parts, unitPrice: p.pricePerPart * factor, total: p.price * factor }));
}

/**
 * Plain-text summary for messengers / e-mail (QO-2). Positions at the shown
 * price level (gross when prices include VAT); no internal costs.
 */
export function quoteSummaryText(doc: AppDocument, quote: Quote, result: QuoteResult, fmt: (n: number) => string): string {
  const s = doc.settings;
  const lines = [`Quote #${quote.number}: ${quote.title}`, ''];
  for (const p of offerPositions(result)) {
    lines.push(p.quantity > 1 ? `- ${p.name}: ${p.quantity} × ${fmt(p.unitPrice)} = ${fmt(p.total)}` : `- ${p.name}: ${fmt(p.total)}`);
  }
  lines.push('', `Total: ${fmt(result.price)}${s.vat.enabled ? (s.vat.pricesIncludeVat ? ` incl. ${s.vat.ratePercent} % VAT` : ` + ${s.vat.ratePercent} % VAT`) : ''}`);
  if (!s.vat.enabled && s.vat.noVatNote) lines.push(s.vat.noVatNote);
  return lines.join('\n');
}

export interface Comparison {
  id: Id;
  name: string;
  /** Price as shown to the customer; null when it can't be calculated. */
  price: number | null;
  cost: number | null;
  /** Calculation warnings (e.g. no power profile on a planned printer): the number is incomplete. */
  warnings: string[];
}

/**
 * What-if (QC-7): the quote's price with every pricing profile, and with all
 * plates moved to each printer that is not retired (incl. planned ones).
 */
export function compareQuote(doc: AppDocument, quote: Quote, asOf: IsoDate): { profiles: Comparison[]; printers: Comparison[] } {
  const run = (q: Quote) => {
    try {
      const r = calculateQuote(doc, q, asOf);
      return { price: r.price, cost: r.cost, warnings: r.warnings.filter((w) => !w.startsWith('Price is below')) };
    } catch (e) {
      return { price: null, cost: null, warnings: [e instanceof Error ? e.message : String(e)] };
    }
  };
  return {
    profiles: doc.pricingProfiles.map((p) => ({ id: p.id, name: p.name, ...run({ ...quote, pricingProfileId: p.id }) })),
    printers: doc.printers
      .filter((p) => p.status !== 'retired')
      .map((p) => ({ id: p.id, name: p.name, ...run({ ...quote, plates: quote.plates.map((pl) => ({ ...pl, printerId: p.id })) }) })),
  };
}
