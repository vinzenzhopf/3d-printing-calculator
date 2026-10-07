import type { AppDocument, FilamentPurchase, Id, IsoDate, ManualPrice } from '../model';
import { predecessorChain } from '../catalog-cleanup';
import { addMonths, recentLotsPrice, type LotPrice } from './filament-price';

export type PackClass = 'single' | 'multi';

/** Multi-packs (2 kg and more) are much cheaper per kg; prices are only pooled within a class. */
export function packClass(p: FilamentPurchase): PackClass {
  return (p.packSizeKg ?? p.packageWeightKg) >= 2 ? 'multi' : 'single';
}

export type PriceSource = 'manual-filament' | 'manual-line' | 'purchases' | 'predecessor-purchases' | 'line-purchases' | 'none';

export interface ResolvedPrice {
  pricePerKg: number | null;
  source: PriceSource;
  /** Date of the manual price, or of the newest purchase used. */
  asOf: IsoDate | null;
  /** Older than the price window: no recent purchase / manual price. */
  stale: boolean;
  lots?: LotPrice;
  packClass?: PackClass;
}

export interface ResolveOptions {
  asOf: IsoDate;
  needKg: number;
  /** Skip manual prices, e.g. to show the computed value next to them in the price list. */
  computedOnly?: boolean;
}

/**
 * Current €/kg of a filament (FI-10, FI-11): manual color price → manual line
 * price → own purchases ("recent lots covering the need") → purchases of its
 * predecessors (FI-2b) → single-spool purchases of the same product line, else
 * of its predecessor lines → none.
 */
export function resolveFilamentPrice(doc: AppDocument, filamentId: Id, opts: ResolveOptions): ResolvedPrice {
  const filament = doc.filaments.find((f) => f.id === filamentId);
  if (!filament) return { ...NONE };
  const windowMonths = doc.settings.filamentPriceWindowMonths;
  const windowStart = addMonths(opts.asOf, -windowMonths);

  if (!opts.computedOnly) {
    const line = doc.productLines.find((l) => l.id === filament.productLineId);
    const manual = filament.manualPrice ?? line?.manualPrice;
    if (manual) return fromManual(manual, filament.manualPrice ? 'manual-filament' : 'manual-line', windowStart);
  }

  const own = doc.purchases.filter((p) => p.filamentId === filamentId);
  const ownPrice = fromLots(own, opts, windowMonths, windowStart, 'purchases');
  if (ownPrice) return ownPrice;

  // Renamed/replaced color: the old one's purchases are the best guess.
  for (const old of predecessorChain(doc.filaments, filamentId).slice(1)) {
    const price = fromLots(doc.purchases.filter((p) => p.filamentId === old.id), opts, windowMonths, windowStart, 'predecessor-purchases');
    if (price) return price;
  }

  // No purchases of this color (gift, wishlist): price it like a single spool of the line (or of the line it replaced).
  for (const line of predecessorChain(doc.productLines, filament.productLineId)) {
    const linePurchases = purchasesOfLine(doc, line.id);
    const singles = linePurchases.filter((p) => packClass(p) === 'single');
    const price = fromLots(singles.length > 0 ? singles : linePurchases, opts, windowMonths, windowStart, 'line-purchases', 'single');
    if (price) return price;
  }
  return { ...NONE };
}

/** Computed line price per pack class for 1 kg, shown in the price list. */
export function linePrices(doc: AppDocument, lineId: Id, asOf: IsoDate): Record<PackClass, ResolvedPrice | null> {
  const windowMonths = doc.settings.filamentPriceWindowMonths;
  const windowStart = addMonths(asOf, -windowMonths);
  const purchases = purchasesOfLine(doc, lineId);
  const opts = { asOf, needKg: 1 };
  const of = (cls: PackClass) =>
    fromLots(purchases.filter((p) => packClass(p) === cls), opts, windowMonths, windowStart, 'line-purchases', cls);
  return { single: of('single'), multi: of('multi') };
}

function purchasesOfLine(doc: AppDocument, lineId: Id): FilamentPurchase[] {
  const ids = new Set(doc.filaments.filter((f) => f.productLineId === lineId).map((f) => f.id));
  return doc.purchases.filter((p) => ids.has(p.filamentId));
}

function fromManual(m: ManualPrice, source: PriceSource, windowStart: IsoDate): ResolvedPrice {
  return { pricePerKg: m.pricePerKg, source, asOf: m.asOf, stale: m.asOf < windowStart };
}

function fromLots(
  purchases: FilamentPurchase[],
  opts: { asOf: IsoDate; needKg: number },
  windowMonths: number,
  windowStart: IsoDate,
  source: PriceSource,
  cls?: PackClass,
): ResolvedPrice | null {
  const lots = recentLotsPrice(purchases, { ...opts, windowMonths });
  if (!lots) return null;
  return {
    pricePerKg: lots.pricePerKg,
    source,
    asOf: lots.newestDate,
    stale: lots.newestDate < windowStart,
    lots,
    ...(cls ? { packClass: cls } : {}),
  };
}

const NONE: ResolvedPrice = { pricePerKg: null, source: 'none', asOf: null, stale: false };
