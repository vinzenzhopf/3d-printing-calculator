import type { IsoDate } from '../model';

export interface PriceLot {
  date: IsoDate;
  totalKg: number;
  totalPrice: number;
}

export interface LotPrice {
  pricePerKg: number;
  /** kg of purchases that went into the average. */
  coveredKg: number;
  /** Oldest purchase date used. */
  oldestDate: IsoDate;
  /** Newest purchase date used. */
  newestDate: IsoDate;
  lotsUsed: number;
  /** false when all purchases together don't cover the need. */
  sufficient: boolean;
}

/**
 * "Recent lots covering the need" (FI-10): all purchases of the last
 * `windowMonths` count fully; if they don't cover `needKg`, older purchases are
 * added newest-first, the last one only with the missing part. Returns the
 * kg-weighted €/kg, or undefined when there are no purchases at all.
 * Gifts/samples come in with their value, or not at all.
 */
export function recentLotsPrice(
  lots: readonly PriceLot[],
  opts: { asOf: IsoDate; needKg: number; windowMonths: number },
): LotPrice | undefined {
  const sorted = lots.filter((l) => l.totalKg > 0).sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length === 0) return undefined;

  const windowStart = addMonths(opts.asOf, -opts.windowMonths);
  let kg = 0;
  let cost = 0;
  let used = 0;
  let oldestDate = opts.asOf;
  for (const lot of sorted) {
    const inWindow = lot.date >= windowStart;
    if (!inWindow && used > 0 && kg >= opts.needKg) break;
    // Outside the window only the missing part counts - unless nothing was
    // taken yet and nothing is missing, then the newest lot is the price.
    const missing = opts.needKg - kg;
    const take = inWindow || missing <= 0 ? lot.totalKg : Math.min(lot.totalKg, missing);
    kg += take;
    cost += (lot.totalPrice / lot.totalKg) * take;
    used++;
    oldestDate = lot.date;
  }
  return {
    pricePerKg: cost / kg,
    coveredKg: kg,
    oldestDate,
    newestDate: sorted[0]!.date,
    lotsUsed: used,
    sufficient: kg >= opts.needKg,
  };
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
