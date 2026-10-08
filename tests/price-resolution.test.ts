import { describe, expect, it } from 'vitest';
import { linePrices, packClass, resolveFilamentPrice } from '../src/core/calc/price-resolution';
import { createEmptyDocument } from '../src/core/document';
import type { AppDocument, Filament, FilamentPurchase } from '../src/core/model';

const asOf = '2026-10-01';

function filament(id: string, extra: Partial<Filament> = {}): Filament {
  return { id, productLineId: 'pla-plus', color: id, finish: null, link: null, asin: null, status: 'owned', ...extra };
}

let n = 0;
function purchase(filamentId: string, date: string, kg: number, price: number, packSizeKg = kg): FilamentPurchase {
  return { id: `p${n++}`, date, store: 'x', description: '', filamentId, packSizeKg, packageWeightKg: kg, quantity: 1, totalPrice: price, totalKg: kg };
}

function doc(): AppDocument {
  return {
    ...createEmptyDocument(),
    productLines: [{ id: 'pla-plus', manufacturer: 'SUNLU', name: 'PLA+', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 }],
    filaments: [filament('black'), filament('silver'), filament('gift-red')],
    purchases: [
      purchase('black', '2023-09-22', 2, 43.99),
      purchase('black', '2026-01-30', 4, 44.99),
      purchase('silver', '2023-02-20', 2, 35.18),
      purchase('silver', '2023-04-21', 1, 23.99),
      purchase('silver', '2024-07-06', 1, 17.99),
      purchase('black', '2026-01-12', 1, 15.18),
    ],
  };
}

describe('resolveFilamentPrice', () => {
  it('uses own recent purchases', () => {
    const r = resolveFilamentPrice(doc(), 'black', { asOf, needKg: 1.7 });
    expect(r.source).toBe('purchases');
    expect(r.pricePerKg).toBeCloseTo((44.99 + 15.18) / 5, 6);
    expect(r.stale).toBe(false);
  });

  it('stretches back for rarely bought colors and marks them stale', () => {
    const r = resolveFilamentPrice(doc(), 'silver', { asOf, needKg: 1.5 });
    expect(r.pricePerKg).toBeCloseTo(19.99, 2);
    expect(r.stale).toBe(true);
    expect(r.asOf).toBe('2024-07-06');
  });

  it('prices a gifted color like a single spool of its line', () => {
    const r = resolveFilamentPrice(doc(), 'gift-red', { asOf, needKg: 0.5 });
    expect(r.source).toBe('line-purchases');
    expect(r.packClass).toBe('single');
    expect(r.pricePerKg).toBeCloseTo(15.18, 6); // the only single-spool purchase in the window
  });

  it('prices gifts by their value and ignores gifts without one', () => {
    const d = doc();
    d.purchases.push({ ...purchase('gift-red', '2026-09-01', 1, 0), acquisition: 'gift', value: 22 });
    expect(resolveFilamentPrice(d, 'gift-red', { asOf, needKg: 1 })).toMatchObject({ source: 'purchases', pricePerKg: 22 });
    d.purchases.at(-1)!.value = undefined;
    expect(resolveFilamentPrice(d, 'gift-red', { asOf, needKg: 1 }).source).toBe('line-purchases');
  });

  it('manual color price wins over line price and purchases', () => {
    const d = doc();
    d.productLines[0]!.manualPrice = { pricePerKg: 12, asOf: '2026-09-01' };
    d.filaments[1]!.manualPrice = { pricePerKg: 18.5, asOf: '2026-09-15' };
    expect(resolveFilamentPrice(d, 'silver', { asOf, needKg: 1 })).toMatchObject({ pricePerKg: 18.5, source: 'manual-filament', stale: false });
    expect(resolveFilamentPrice(d, 'black', { asOf, needKg: 1 })).toMatchObject({ pricePerKg: 12, source: 'manual-line' });
    expect(resolveFilamentPrice(d, 'black', { asOf, needKg: 1, computedOnly: true }).source).toBe('purchases');
  });

  it('flags old manual prices as stale', () => {
    const d = doc();
    d.filaments[0]!.manualPrice = { pricePerKg: 20, asOf: '2024-01-01' };
    expect(resolveFilamentPrice(d, 'black', { asOf, needKg: 1 }).stale).toBe(true);
  });

  it('returns none for unknown filaments or lines without purchases', () => {
    expect(resolveFilamentPrice(doc(), 'nope', { asOf, needKg: 1 }).pricePerKg).toBeNull();
    const d = doc();
    d.purchases = [];
    expect(resolveFilamentPrice(d, 'black', { asOf, needKg: 1 }).source).toBe('none');
  });
});

describe('pack classes', () => {
  it('classifies by pack size, also for bundles split into colors', () => {
    expect(packClass(purchase('x', asOf, 1, 15))).toBe('single');
    expect(packClass(purchase('x', asOf, 1, 12.75, 4))).toBe('multi');
    expect(packClass({ ...purchase('x', asOf, 2.5, 40), spoolKg: 2.5 })).toBe('single'); // one big spool
    expect(packClass({ ...purchase('x', asOf, 5, 70), spoolKg: 2.5 })).toBe('multi');
  });

  it('computes line prices per pack class', () => {
    const r = linePrices(doc(), 'pla-plus', asOf);
    expect(r.multi?.pricePerKg).toBeCloseTo(44.99 / 4, 6);
    expect(r.single?.pricePerKg).toBeCloseTo(15.18, 6);
  });
});
