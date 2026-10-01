import { describe, expect, it } from 'vitest';
import { packClass } from '../src/core/calc/price-resolution';
import { splitOrder, type Order } from '../src/core/orders';

let n = 0;
const id = () => `p${n++}`;

const bundle: Order = {
  date: '2025-02-14',
  store: 'Amazon',
  description: 'SUNLU PLA+ 2.0 4 x 1 kg',
  totalPrice: 50.99,
  shipping: 0,
  lines: ['green', 'yellow', 'grey', 'black'].map((filamentId) => ({ filamentId, kg: 1 })),
};

describe('splitOrder', () => {
  it('splits a multi-color bundle evenly and keeps it a multi-pack', () => {
    const purchases = splitOrder(bundle, id);
    expect(purchases).toHaveLength(4);
    for (const p of purchases) {
      expect(p.totalPrice).toBeCloseTo(12.7475, 4);
      expect(p.packSizeKg).toBe(4);
      expect(packClass(p)).toBe('multi');
    }
  });

  it('keeps explicit line prices and shares the rest by weight', () => {
    const [a, b, c] = splitOrder(
      { ...bundle, totalPrice: 60, lines: [{ filamentId: 'a', kg: 1, price: 20 }, { filamentId: 'b', kg: 2 }, { filamentId: 'c', kg: 0.5 }] },
      id,
    );
    expect(a!.totalPrice).toBe(20);
    expect(b!.totalPrice).toBeCloseTo(32, 4);
    expect(c!.totalPrice).toBeCloseTo(8, 4);
  });

  it('allocates shipping by price share so the totals add up', () => {
    const purchases = splitOrder({ ...bundle, totalPrice: 30, shipping: 6, lines: [{ filamentId: 'a', kg: 2 }, { filamentId: 'b', kg: 1 }] }, id);
    expect(purchases.map((p) => p.totalPrice)).toEqual([24, 12]);
  });

  it('drops empty lines', () => {
    expect(splitOrder({ ...bundle, lines: [{ filamentId: 'a', kg: 0 }, { filamentId: 'b', kg: 1 }] }, id)).toHaveLength(1);
  });
});
