import { calculateQuote, type QuoteResult } from './calc/quote';
import type { AppDocument, Id, IsoDate, QuoteStatus } from './model';

/** Quotes whose reserve share counts as collected: delivered or paid. */
const BILLED: ReadonlySet<QuoteStatus> = new Set(['delivered', 'paid']);

export interface ReserveProgress {
  investmentId: Id;
  target: number;
  /** Entered by hand ("already reserved"). */
  alreadyReserved: number;
  /** Charged through delivered and paid quotes. */
  billed: number;
  quotes: number;
  collected: number;
  /** collected / target, 0..1 (can exceed 1). */
  share: number;
  /** Billed per month since the first billed quote; null without one. */
  perMonth: number | null;
  /** When the target is reached at that pace; null when unknown or already reached. */
  eta: IsoDate | null;
}

/**
 * How far each replacement reserve is (MC-8): the amount entered by hand plus the
 * reserve share of every delivered or paid quote, and when the target is reached
 * at the pace so far.
 */
export function reserveProgress(doc: AppDocument, asOf: IsoDate): ReserveProgress[] {
  const billed = new Map<Id, { amount: number; quotes: Set<Id>; first: IsoDate | null }>();
  for (const quote of doc.quotes) {
    if (!BILLED.has(quote.status)) continue;
    const result = reserveResult(doc, quote, asOf);
    if (!result) continue;
    for (const plate of result.plates) {
      for (const r of plate.explain?.reserves ?? []) {
        if (r.amount <= 0) continue;
        const entry = billed.get(r.investmentId) ?? { amount: 0, quotes: new Set<Id>(), first: null };
        entry.amount += r.amount;
        entry.quotes.add(quote.id);
        const date = quote.date ?? asOf;
        if (!entry.first || date < entry.first) entry.first = date;
        billed.set(r.investmentId, entry);
      }
    }
  }
  return doc.plannedInvestments.map((plan) => {
    const b = billed.get(plan.id);
    const amount = b?.amount ?? 0;
    const collected = plan.alreadyReserved + amount;
    const months = b?.first ? monthsBetween(b.first, asOf) : 0;
    const perMonth = b && months >= 1 ? amount / months : null;
    const remaining = plan.targetAmount - collected;
    return {
      investmentId: plan.id,
      target: plan.targetAmount,
      alreadyReserved: plan.alreadyReserved,
      billed: amount,
      quotes: b?.quotes.size ?? 0,
      collected,
      share: plan.targetAmount > 0 ? collected / plan.targetAmount : 0,
      perMonth,
      eta: remaining > 0 && perMonth && perMonth > 0 ? addMonths(asOf, remaining / perMonth) : null,
    };
  });
}

/** The frozen result when it already has reserve details, else a recalculation as of the quote date. */
function reserveResult(doc: AppDocument, quote: AppDocument['quotes'][number], asOf: IsoDate): QuoteResult | null {
  const frozen = quote.snapshot?.result;
  if (frozen?.plates.every((p) => p.explain)) return frozen;
  try {
    return calculateQuote(doc, quote, quote.date ?? asOf);
  } catch {
    return null;
  }
}

function monthsBetween(from: IsoDate, to: IsoDate): number {
  return (Date.parse(to) - Date.parse(from)) / (30.44 * 24 * 3600 * 1000);
}

function addMonths(date: IsoDate, months: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(months * 30.44));
  return d.toISOString().slice(0, 10);
}
