import type { FilamentPurchase, Id, IsoDate } from './model';

export interface OrderLine {
  filamentId: Id;
  kg: number;
  /** Optional explicit price for this line; lines without one share the rest by weight. */
  price?: number;
}

export interface Order {
  date: IsoDate;
  store: string;
  description: string;
  /** Price of all filament lines together, without shipping. */
  totalPrice: number;
  shipping: number;
  lines: OrderLine[];
  kindId?: Id;
  spoolKg?: number;
}

/**
 * Turns one order (e.g. a 4 x 1 kg multi-color bundle) into one purchase per
 * line (FI-4). Lines with an explicit price keep it; the remaining price is
 * split by weight. Shipping is allocated by price share. All lines keep the
 * whole pack size, so the bundle still counts as a multi-pack.
 */
export function splitOrder(order: Order, newId: () => Id): FilamentPurchase[] {
  const lines = order.lines.filter((l) => l.kg > 0);
  const packSizeKg = lines.reduce((sum, l) => sum + l.kg, 0);
  const fixed = lines.reduce((sum, l) => sum + (l.price ?? 0), 0);
  const freeKg = lines.reduce((sum, l) => sum + (l.price === undefined ? l.kg : 0), 0);
  const rest = Math.max(order.totalPrice - fixed, 0);

  const prices = lines.map((l) => l.price ?? (freeKg > 0 ? (rest * l.kg) / freeKg : 0));
  const priceSum = prices.reduce((a, b) => a + b, 0);

  return lines.map((l, i) => {
    const base = prices[i]!;
    const shipping = priceSum > 0 ? (order.shipping * base) / priceSum : order.shipping / lines.length;
    const totalPrice = round4(base + shipping);
    return {
      id: newId(),
      date: order.date,
      store: order.store,
      description: order.description,
      filamentId: l.filamentId,
      ...(order.kindId ? { kindId: order.kindId } : {}),
      ...(order.spoolKg ? { spoolKg: order.spoolKg } : {}),
      packSizeKg,
      packageWeightKg: l.kg,
      quantity: 1,
      totalPrice,
      totalKg: l.kg,
    };
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
