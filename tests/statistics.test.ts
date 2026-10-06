import { describe, expect, it } from 'vitest';
import { compareColors, hexToHsl } from '../src/core/colors';
import { createEmptyDocument } from '../src/core/document';
import type { AppDocument } from '../src/core/model';
import { counterPeriods, monthRange, monthlyStats, monthsBefore, spendByBrand, totals, usageByFilament, usageByMaterial } from '../src/core/statistics';

function doc(): AppDocument {
  const d = createEmptyDocument();
  d.productLines.push(
    { id: 'pla', manufacturer: 'SUNLU', name: 'PLA+', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 },
    { id: 'petg', manufacturer: 'eSUN', name: 'PETG', baseMaterial: 'PETG', materialProfileId: null, diameterMm: 1.75 },
  );
  d.filaments.push(
    { id: 'white', productLineId: 'pla', color: 'White', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned' },
    { id: 'black', productLineId: 'pla', color: 'Black', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned' },
    { id: 'grey', productLineId: 'petg', color: 'Grey', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned' },
  );
  const purchase = (id: string, date: string, filamentId: string, kg: number, price: number) =>
    d.purchases.push({ id, date, store: 'x', description: '', filamentId, packageWeightKg: kg, quantity: 1, totalKg: kg, totalPrice: price });
  purchase('p1', '2025-12-03', 'white', 4, 40);
  purchase('p2', '2026-01-20', 'grey', 2.5, 40);
  purchase('p3', '2026-01-25', 'black', 1, 15);
  const job = (id: string, date: string, min: number, result: 'success' | 'failed' | 'cancelled', filaments: [string, number][]) =>
    d.printJobs.push({ id, date, printerId: 'mk3s', name: id, printTimeMin: min, result, filaments: filaments.map(([filamentId, grams]) => ({ filamentId, grams })) });
  job('j1', '2026-01-05', 120, 'success', [['white', 100]]);
  job('j2', '2026-01-07', 60, 'failed', [['white', 20], ['black', 5]]);
  job('j3', '2026-02-01', 240, 'success', [['grey', 300]]);
  return d;
}

describe('months', () => {
  it('ranges across years and steps back', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBefore('2026-02', 11)).toBe('2025-03');
    expect(monthsBefore('2026-01', 1)).toBe('2025-12');
  });
});

describe('monthlyStats', () => {
  it('sums prints and purchases per month, including empty months', () => {
    const m = monthlyStats(doc(), '2025-12', '2026-03');
    expect(m.map((x) => x.month)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
    expect(m[0]).toMatchObject({ prints: 0, boughtKg: 4, spent: 40 });
    expect(m[1]).toMatchObject({ prints: 2, hours: 3, usedG: 125, boughtKg: 3.5, spent: 55 });
    expect(m[2]).toMatchObject({ prints: 1, hours: 4, usedG: 300, boughtKg: 0 });
    expect(m[3]).toMatchObject({ prints: 0, hours: 0, usedG: 0, spent: 0 });
  });
});

describe('totals', () => {
  it('counts results, filament and spend since a date; stock is always current', () => {
    const d = doc();
    d.spools.push(
      { id: 's1', filamentId: 'white', label: 'S1', nominalG: 1000, status: 'open', movements: [{ id: 'm', date: '2026-01-01', kind: 'initial', grams: 880 }] },
      { id: 's2', filamentId: 'grey', label: 'S2', nominalG: 2500, status: 'sealed', movements: [] },
      { id: 's3', filamentId: 'black', label: 'S3', nominalG: 1000, status: 'empty', movements: [{ id: 'm', date: '2026-01-01', kind: 'initial', grams: 0 }] },
    );
    const all = totals(d);
    expect(all).toMatchObject({ prints: 3, hours: 7, usedG: 425, boughtKg: 7.5, spent: 95, stockG: 880, spools: 2, unweighedSpools: 1 });
    expect(all.results).toEqual({ success: 2, failed: 1, cancelled: 0 });
    expect(all.successRate).toBeCloseTo(2 / 3);
    expect(totals(d, '2026-01-21')).toMatchObject({ prints: 1, boughtKg: 1, spent: 15, stockG: 880 });
    expect(totals(createEmptyDocument()).successRate).toBeNull();
  });
});

describe('breakdowns', () => {
  it('ranks usage by filament and material, and spend by brand', () => {
    const d = doc();
    expect(usageByFilament(d).map((s) => [s.filamentId, s.value])).toEqual([['grey', 300], ['white', 120], ['black', 5]]);
    expect(usageByMaterial(d).map((s) => [s.key, s.value])).toEqual([['PETG', 300], ['PLA', 125]]);
    expect(spendByBrand(d).map((s) => [s.key, s.value])).toEqual([['SUNLU', 55], ['eSUN', 40]]);
    expect(usageByFilament(d, '2026-01-06').map((s) => s.filamentId)).toEqual(['grey', 'white', 'black']);
    expect(spendByBrand(d, '2026-01-01').map((s) => s.key)).toEqual(['eSUN', 'SUNLU']);
  });

  it('counts filament of unknown color in totals and per material, not per filament', () => {
    const d = doc();
    d.printJobs.push({ id: 'j4', date: '2026-02-03', printerId: 'mk3s', name: 'imported', printTimeMin: 60, result: 'success', filaments: [], untrackedFilament: { grams: 200, material: 'ASA' } });
    expect(totals(d).usedG).toBe(625);
    expect(usageByMaterial(d).map((s) => [s.key, s.value])).toEqual([['PETG', 300], ['ASA', 200], ['PLA', 125]]);
    expect(usageByFilament(d).map((s) => s.filamentId)).toEqual(['grey', 'white', 'black']);
    expect(monthlyStats(d, '2026-02', '2026-02')[0]!.usedG).toBe(500);
  });
});

describe('colors', () => {
  it('converts hex to hsl', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(hexToHsl('0f0')?.h).toBe(120);
    expect(hexToHsl('nope')).toBeNull();
  });

  it('orders by hue, then greys light to dark, then unknown colors', () => {
    const hexes = [undefined, '#000000', '#0000ff', '#ffffff', '#ff0000', '#808080', '#00ff00', '#ffff00'];
    expect([...hexes].sort(compareColors)).toEqual(['#ff0000', '#ffff00', '#00ff00', '#0000ff', '#ffffff', '#808080', '#000000', undefined]);
  });
});

describe('counterPeriods', () => {
  it('lists printer counters per period with the print log of the same period', () => {
    const d = doc();
    d.printers.push({ id: 'mk3s', name: 'MK3S+', technology: 'FDM', status: 'active', toolheads: 1, toolType: 'single', purgeWastePerPlateG: 10, purgePerFilamentChangeG: null, firstHourPhaseMin: 60, powerProfiles: {},
      usageStats: [
        { source: 'Display', asOf: '2026-02-01', since: null, printHours: 9000 },
        { source: 'OctoPrint', asOf: '2025-12-31', since: '2025-01-01', prints: 300, printHours: 1500 },
        { source: 'OctoPrint', asOf: '2026-01-31', since: '2026-01-01', prints: 3, printsFinished: 2, printHours: 4 },
      ] });
    const rows = counterPeriods(d);
    expect(rows.map((r) => [r.since, r.prints, r.loggedPrints, r.loggedHours])).toEqual([
      ['2026-01-01', 3, 2, 3],
      ['2025-01-01', 300, 0, 0],
      [null, undefined, 3, 7],
    ]);
  });
});
