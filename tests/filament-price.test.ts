import { describe, expect, it } from 'vitest';
import { recentLotsPrice, type PriceLot } from '../src/core/calc/filament-price';

const asOf = '2026-10-01';
const opts = (needKg: number) => ({ asOf, needKg, windowMonths: 12 });

// SUNLU PLA+ Silver purchase history (requirements FI-10 example).
const silver: PriceLot[] = [
  { date: '2023-02-20', totalKg: 2, totalPrice: 35.18 },
  { date: '2023-04-21', totalKg: 1, totalPrice: 23.99 },
  { date: '2024-07-06', totalKg: 1, totalPrice: 17.99 },
];

// SUNLU PLA+ Black: an old expensive lot and a recent bulk pack.
const black: PriceLot[] = [
  { date: '2023-09-22', totalKg: 2, totalPrice: 43.99 },
  { date: '2026-01-30', totalKg: 4, totalPrice: 44.99 },
];

describe('recentLotsPrice', () => {
  it('stretches back newest-first for rarely bought colors, last lot partially', () => {
    const r = recentLotsPrice(silver, opts(1.5))!;
    expect(r.pricePerKg).toBeCloseTo((17.99 + 0.5 * 23.99) / 1.5, 6); // 19.99
    expect(r.coveredKg).toBe(1.5);
    expect(r.oldestDate).toBe('2023-04-21');
    expect(r.sufficient).toBe(true);
  });

  it('uses only the window when it covers the need', () => {
    const r = recentLotsPrice(black, opts(1.7))!;
    expect(r.pricePerKg).toBeCloseTo(11.2475, 6);
    expect(r.lotsUsed).toBe(1);
  });

  it('counts the whole window even beyond the need', () => {
    const r = recentLotsPrice(black, opts(0.1))!;
    expect(r.coveredKg).toBe(4);
  });

  it('falls back to the last purchase when nothing is in the window and nothing is needed yet', () => {
    const r = recentLotsPrice(silver, opts(0))!;
    expect(r.pricePerKg).toBeCloseTo(17.99, 6);
  });

  it('flags when all purchases together do not cover the need', () => {
    const r = recentLotsPrice(silver, opts(10))!;
    expect(r.sufficient).toBe(false);
    expect(r.coveredKg).toBe(4);
    expect(r.pricePerKg).toBeCloseTo((35.18 + 23.99 + 17.99) / 4, 6);
  });

  it('returns undefined without purchases', () => {
    expect(recentLotsPrice([], opts(1))).toBeUndefined();
  });
});
