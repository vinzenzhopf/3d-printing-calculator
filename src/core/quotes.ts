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
