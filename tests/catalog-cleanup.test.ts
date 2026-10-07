import { describe, expect, it } from 'vitest';
import { resolveFilamentPrice } from '../src/core/calc/price-resolution';
import type { QuoteResult } from '../src/core/calc/quote';
import {
  activeFilaments, deprecate, findFilament, isFilamentDeprecated, mergeFilaments, mergeProductLines, previewFilamentMerge,
  previewLineMerge, restore, spoolsInStock,
} from '../src/core/catalog-cleanup';
import { createEmptyDocument } from '../src/core/document';
import { findDanglingReferences } from '../src/core/migrations';
import type { AppDocument, Filament } from '../src/core/model';
import { toBuyList } from '../src/core/stock';

const date = '2026-10-07';

function filament(id: string, productLineId: string, color: string, extra: Partial<Filament> = {}): Filament {
  return { id, productLineId, color, finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned', ...extra };
}

function doc(): AppDocument {
  const d = createEmptyDocument();
  d.printers.push({
    id: 'p1', name: 'Printer', technology: 'FDM', status: 'active', toolheads: 1, toolType: 'single',
    purgeWastePerPlateG: null, purgePerFilamentChangeG: null, firstHourPhaseMin: null, powerProfiles: {},
  });
  d.productLines.push(
    { id: 'pla', manufacturer: 'Brand', name: 'PLA+', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 },
    { id: 'pla2', manufacturer: 'Brand', name: 'PLA+ 2.0', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75, densityGcm3: 1.24 },
  );
  d.filaments.push(
    filament('grey', 'pla', 'Grey', { lowStockG: 500 }),
    filament('grau', 'pla', 'Grau', { colorHex: '#888888', manualPrice: { pricePerKg: 20, asOf: date }, lowStockG: 300 }),
    filament('black', 'pla', 'Black', { lowStockG: 500 }),
    filament('black2', 'pla2', 'black'),
    filament('white2', 'pla2', 'White'),
  );
  const purchase = (id: string, filamentId: string, totalPrice: number) => ({
    id, date: '2026-09-01', store: 'Shop', description: '', filamentId, packageWeightKg: 1, quantity: 1, totalPrice, totalKg: 1,
  });
  d.purchases.push(purchase('pu1', 'grey', 15), purchase('pu2', 'grau', 17), purchase('pu3', 'black', 12), purchase('pu4', 'black2', 14));
  d.spools.push(
    { id: 's1', filamentId: 'grau', label: 'S1', nominalG: 1000, status: 'open', movements: [{ id: 'm1', date, kind: 'initial', grams: 1000 }] },
    { id: 's2', filamentId: 'black', label: 'S2', nominalG: 1000, status: 'empty', movements: [] },
  );
  d.printJobs.push({
    id: 'j1', date, printerId: 'p1', name: 'Job', printTimeMin: 60, result: 'success',
    filaments: [{ filamentId: 'grau', grams: 20, spoolId: 's1' }, { filamentId: 'grey', grams: 5 }],
  });
  const plate = (id: string, filaments: [string, number][]) => ({
    id, name: id, printerId: 'p1', printTimeMin: 60, runs: 1, filaments: filaments.map(([filamentId, weightG]) => ({ filamentId, weightG })),
  });
  d.quotes.push(
    { id: 'q1', number: 1, title: 'Draft', pricingProfileId: d.pricingProfiles[0]!.id, status: 'draft', plates: [plate('a', [['grey', 10], ['grau', 5]])] },
    {
      id: 'q2', number: 2, title: 'Sent', pricingProfileId: d.pricingProfiles[0]!.id, status: 'sent', plates: [plate('b', [['grau', 7]])],
      snapshot: { frozenAt: date, result: { prices: [{ filamentId: 'grau', pricePerKg: 17, source: 'purchases', asOf: date, stale: false }] } as unknown as QuoteResult },
    },
  );
  return d;
}

describe('deprecate', () => {
  it('hides a filament from choices and the to-buy list, but keeps its history', () => {
    const d = doc();
    expect(toBuyList(d).map((x) => x.filamentId)).toContain('black');
    deprecate(d, { kind: 'filament', id: 'black' }, { date });
    expect(isFilamentDeprecated(d, d.filaments.find((f) => f.id === 'black')!)).toBe(true);
    expect(activeFilaments(d).map((f) => f.id)).not.toContain('black');
    expect(toBuyList(d).map((x) => x.filamentId)).not.toContain('black');
    expect(d.purchases.find((p) => p.id === 'pu3')!.filamentId).toBe('black');
    restore(d, { kind: 'filament', id: 'black' });
    expect(activeFilaments(d).map((f) => f.id)).toContain('black');
  });

  it('deprecates all colors of a deprecated line', () => {
    const d = doc();
    deprecate(d, { kind: 'line', id: 'pla2' }, { date });
    expect(activeFilaments(d).map((f) => f.id)).toEqual(['grey', 'grau', 'black']);
  });

  it('refuses while spools are in stock, unless forced', () => {
    const d = doc();
    expect(spoolsInStock(d, { kind: 'filament', id: 'grau' }).map((s) => s.label)).toEqual(['S1']);
    expect(spoolsInStock(d, { kind: 'filament', id: 'black' })).toEqual([]); // empty spools don't count
    expect(spoolsInStock(d, { kind: 'line', id: 'pla' }).map((s) => s.label)).toEqual(['S1']);
    expect(() => deprecate(d, { kind: 'line', id: 'pla' }, { date })).toThrow(/S1/);
    deprecate(d, { kind: 'line', id: 'pla' }, { date, force: true });
    expect(d.productLines.find((l) => l.id === 'pla')!.deprecatedAt).toBe(date);
  });

  it('links the successor, whose price falls back to the predecessor purchases', () => {
    const d = doc();
    d.filaments.push(filament('black3', 'pla2', 'Black v3'));
    expect(resolveFilamentPrice(d, 'black3', { asOf: date, needKg: 1 }).source).toBe('line-purchases');
    deprecate(d, { kind: 'filament', id: 'black' }, { date, successorId: 'black3' });
    expect(d.filaments.find((f) => f.id === 'black')!.successorId).toBe('black3');
    expect(d.filaments.find((f) => f.id === 'black3')!.predecessorId).toBe('black');
    expect(resolveFilamentPrice(d, 'black3', { asOf: date, needKg: 1 })).toMatchObject({ source: 'predecessor-purchases', pricePerKg: 12 });
    expect(findDanglingReferences(d)).toEqual([]);
  });

  it('prices a new line without purchases from its predecessor line', () => {
    const d = doc();
    d.productLines.push({ id: 'pla3', manufacturer: 'Brand', name: 'PLA+ 3.0', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 });
    d.filaments.push(filament('red3', 'pla3', 'Red'));
    expect(resolveFilamentPrice(d, 'red3', { asOf: date, needKg: 1 }).source).toBe('none');
    deprecate(d, { kind: 'line', id: 'pla2' }, { date, successorId: 'pla3' });
    expect(resolveFilamentPrice(d, 'red3', { asOf: date, needKg: 1 })).toMatchObject({ source: 'line-purchases', pricePerKg: 14 });
  });
});

describe('mergeFilaments', () => {
  it('previews what moves', () => {
    expect(previewFilamentMerge(doc(), 'grey', 'grau')).toEqual({
      purchases: 1, spools: 1, printJobs: 1, quotes: 2, snapshots: 1, carriedOver: ['colorHex', 'manualPrice'],
    });
  });

  it('moves all references, carries over missing fields and deletes the duplicate', () => {
    const d = doc();
    mergeFilaments(d, 'grey', 'grau');
    expect(d.filaments.map((f) => f.id)).not.toContain('grau');
    expect(d.purchases.filter((p) => p.filamentId === 'grey').map((p) => p.id)).toEqual(['pu1', 'pu2']);
    expect(d.spools.find((s) => s.id === 's1')!.filamentId).toBe('grey');
    expect(d.printJobs[0]!.filaments.map((f) => f.filamentId)).toEqual(['grey', 'grey']);
    // A plate that used both colors gets one row with the summed weight.
    expect(d.quotes[0]!.plates[0]!.filaments).toEqual([{ filamentId: 'grey', weightG: 15 }]);
    const grey = d.filaments.find((f) => f.id === 'grey')!;
    expect(grey).toMatchObject({ colorHex: '#888888', manualPrice: { pricePerKg: 20 }, lowStockG: 500, mergedIds: ['grau'] });
    expect(findDanglingReferences(d)).toEqual([]);
  });

  it('leaves frozen snapshots as they are, still resolvable by name', () => {
    const d = doc();
    const before = JSON.stringify(d.quotes[1]!.snapshot);
    mergeFilaments(d, 'grey', 'grau');
    expect(JSON.stringify(d.quotes[1]!.snapshot)).toBe(before);
    expect(findFilament(d, 'grau')?.id).toBe('grey');
  });

  it('retargets successor links and rejects merging an entry with itself', () => {
    const d = doc();
    deprecate(d, { kind: 'filament', id: 'black' }, { date, successorId: 'grau' });
    mergeFilaments(d, 'grey', 'grau');
    expect(d.filaments.find((f) => f.id === 'black')!.successorId).toBe('grey');
    expect(d.filaments.find((f) => f.id === 'grey')!.predecessorId).toBe('black');
    expect(findDanglingReferences(d)).toEqual([]);
    expect(() => mergeFilaments(d, 'grey', 'grey')).toThrow();
  });
});

describe('mergeProductLines', () => {
  it('previews moving colors and finds identical ones', () => {
    expect(previewLineMerge(doc(), 'pla', 'pla2')).toEqual({ filaments: 2, identical: [{ keepId: 'black', dropId: 'black2' }], carriedOver: ['densityGcm3'] });
  });

  it('moves the colors and merges identical ones when asked', () => {
    const d = doc();
    mergeProductLines(d, 'pla', 'pla2', { mergeIdentical: true });
    expect(d.productLines.map((l) => l.id)).toEqual(['pla']);
    expect(d.productLines[0]).toMatchObject({ densityGcm3: 1.24, aliases: ['PLA+ 2.0'] });
    expect(d.filaments.map((f) => f.id)).toEqual(['grey', 'grau', 'black', 'white2']);
    expect(d.filaments.every((f) => f.productLineId === 'pla')).toBe(true);
    expect(d.purchases.find((p) => p.id === 'pu4')!.filamentId).toBe('black');
    expect(findDanglingReferences(d)).toEqual([]);
  });

  it('keeps identical colors separate when not asked to merge them', () => {
    const d = doc();
    mergeProductLines(d, 'pla', 'pla2', { mergeIdentical: false });
    expect(d.filaments.filter((f) => f.productLineId === 'pla')).toHaveLength(5);
    expect(findDanglingReferences(d)).toEqual([]);
  });

  it('retargets line successor links', () => {
    const d = doc();
    d.productLines.push({ id: 'old', manufacturer: 'Brand', name: 'PLA', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 });
    deprecate(d, { kind: 'line', id: 'old' }, { date, successorId: 'pla2' });
    mergeProductLines(d, 'pla', 'pla2', { mergeIdentical: true });
    expect(d.productLines.find((l) => l.id === 'old')!.successorId).toBe('pla');
    expect(d.productLines.find((l) => l.id === 'pla')!.predecessorId).toBe('old');
    expect(findDanglingReferences(d)).toEqual([]);
  });
});

describe('findDanglingReferences', () => {
  it('reports spools, print jobs and successor links to missing filaments', () => {
    const d = doc();
    d.filaments = d.filaments.filter((f) => f.id !== 'grau');
    d.filaments[0]!.successorId = 'gone';
    const warnings = findDanglingReferences(d).join('\n');
    expect(warnings).toMatch(/Spool S1: unknown filament grau/);
    expect(warnings).toMatch(/Print .*unknown filament grau/);
    expect(warnings).toMatch(/unknown successor gone/);
  });
});
