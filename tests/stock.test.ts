import { SCHEMA_VERSION } from '../src/core/model';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { loadDocument } from '../src/core/migrations';
import type { AppDocument, FilamentPurchase, Spool } from '../src/core/model';
import {
  assignLabel, clearStock, findSpool, isLabelCode, nextLabelNumber, spoolFromLabel, spoolKeyFromScan,
  gramsToMeters, kindGroups, kindLabel, kindName, labelGenerator, openWithNewLabel, purchaseChoices, setPurchaseSpools, metersToGrams, remainingG, resolveTare, spoolsForPurchase,
  stockByFilament, suggestKind, suggestedSpoolCount, weighIn,
} from '../src/core/stock';

const date = '2026-10-02';

function doc(): AppDocument {
  const d = createEmptyDocument();
  d.productLines.push(
    { id: 'sunlu-pla', manufacturer: 'SUNLU', name: 'PLA+', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 },
    { id: 'sunlu-petg', manufacturer: 'Sunlu', name: 'PETG', baseMaterial: 'PETG', materialProfileId: null, diameterMm: 1.75 },
    { id: 'prusa-petg', manufacturer: 'Prusa', name: 'PETG', baseMaterial: 'PETG', materialProfileId: null, diameterMm: 1.75 },
  );
  for (const [id, line] of [['pla', 'sunlu-pla'], ['petg', 'sunlu-petg'], ['prusa', 'prusa-petg']]) {
    d.filaments.push({ id: id!, productLineId: line!, color: 'x', finish: null, link: null, asin: null, status: 'owned' });
  }
  d.spoolKinds.push({ id: 'sunlu-cardboard', name: 'SUNLU plastic + cardboard', manufacturer: 'SUNLU', emptyG: 160, source: 'test' });
  return d;
}

function spool(extra: Partial<Spool> = {}): Spool {
  return { id: 's', filamentId: 'pla', label: 'S1', nominalG: 1000, kindId: 'tare-sunlu-plastic', status: 'open', movements: [], ...extra };
}

describe('resolveTare', () => {
  it("uses the spool's own measurement, else its kind, else unknown", () => {
    const d = doc();
    expect(resolveTare(d, spool({ tareG: 155 }))).toMatchObject({ grams: 155, source: 'spool' });
    expect(resolveTare(d, spool())).toMatchObject({ grams: 130, source: 'kind', kind: { name: 'SUNLU plastic' } });
    expect(resolveTare(d, spool({ kindId: 'sunlu-cardboard' }))).toMatchObject({ grams: 160, source: 'kind' });
    expect(resolveTare(d, spool({ kindId: undefined }))).toMatchObject({ grams: null, source: 'none' });
    expect(resolveTare(d, spool({ kindId: 'deleted' }))).toMatchObject({ grams: null, source: 'none' });
  });
});

describe('suggestKind', () => {
  it("suggests the brand's kind, then a generic one", () => {
    const d = doc();
    expect(suggestKind(d, 'petg')).toBe('tare-sunlu-plastic'); // "Sunlu" matches "SUNLU"
    expect(suggestKind(d, 'prusa')).toBe('tare-any-plastic');
  });

  it('prefers the kind used last for the same line, then the same brand', () => {
    const d = doc();
    d.spools.push(spool({ id: 'a', filamentId: 'petg', kindId: 'sunlu-cardboard' }));
    expect(suggestKind(d, 'pla')).toBe('sunlu-cardboard'); // same brand
    d.spools.push(spool({ id: 'b', filamentId: 'pla', kindId: 'tare-any-cardboard' }));
    expect(suggestKind(d, 'pla')).toBe('tare-any-cardboard'); // same line wins
    expect(suggestKind(d, 'petg')).toBe('sunlu-cardboard');
  });

  it("takes the purchase's kind first (e.g. a pack of refills)", () => {
    const d = doc();
    d.purchases.push({ id: 'p', date, store: 'x', description: '', filamentId: 'pla', packageWeightKg: 1, quantity: 3, totalPrice: 30, totalKg: 3, kindId: 'tare-any-refill' });
    d.spools.push(spool({ id: 'a', filamentId: 'pla', kindId: 'sunlu-cardboard' }));
    expect(suggestKind(d, 'pla', 'p')).toBe('tare-any-refill');
    expect(suggestKind(d, 'pla')).toBe('sunlu-cardboard');
    let n = 0;
    const [first] = spoolsForPurchase(d.purchases[0]!, 3, { newId: () => `id${n++}`, nextLabel: labelGenerator(d), date, kindId: suggestKind(d, 'pla', 'p') });
    expect(first?.kindId).toBe('tare-any-refill');
  });
});

describe('stock ledger', () => {
  it('is unknown until something is booked, then the sum of movements', () => {
    const s = spool();
    expect(remainingG(s)).toBeNull();
    s.movements.push({ id: 'm1', date, kind: 'initial', grams: 1000 }, { id: 'm2', date, kind: 'print', grams: -240 });
    expect(remainingG(s)).toBe(760);
  });

  it('weigh-in books the difference to the previous stock', () => {
    const d = doc();
    const s = spool({ movements: [{ id: 'm1', date, kind: 'initial', grams: 1000 }] });
    const w = weighIn(d, s, 830, date, 'w1'); // 830 g on the scale − 130 g SUNLU tare = 700 g
    expect(w.netG).toBe(700);
    expect(w.movement).toMatchObject({ kind: 'weigh-in', grams: -300, grossG: 830, tareG: 130 });
    s.movements.push(w.movement);
    expect(remainingG(s)).toBe(700);
  });

  it('weigh-in of a never-weighed spool sets the stock', () => {
    const w = weighIn(doc(), spool(), 500, date, 'w');
    expect(w.movement.grams).toBe(370);
  });

  it('sums stock per filament and counts unknown spools', () => {
    const d = doc();
    d.spools.push(
      spool({ id: 'a', movements: [{ id: 'm', date, kind: 'initial', grams: 800 }] }),
      spool({ id: 'b' }),
      spool({ id: 'c', status: 'empty', movements: [{ id: 'm', date, kind: 'initial', grams: 50 }] }),
    );
    expect(stockByFilament(d).get('pla')).toEqual({ knownG: 800, spools: 2, unknownSpools: 1 });
  });
});

describe('spools from purchases', () => {
  const purchase: FilamentPurchase = { id: 'p', date, store: 'x', description: '', filamentId: 'pla', packageWeightKg: 4, quantity: 1, totalPrice: 44, totalKg: 4 };

  it('suggests 1 kg spools and books them sealed at full weight with running labels', () => {
    const d = doc();
    d.spools.push(spool({ label: 'S7' }));
    let n = 0;
    const spools = spoolsForPurchase(purchase, suggestedSpoolCount(purchase), { newId: () => `id${n++}`, nextLabel: labelGenerator(d), date });
    expect(spools.map((s) => s.label)).toEqual(['S8', 'S9', 'S10', 'S11']);
    expect(spools.every((s) => s.status === 'sealed' && remainingG(s) === 1000)).toBe(true);
    expect(suggestedSpoolCount({ ...purchase, totalKg: 0.75 })).toBe(1);
    expect(suggestedSpoolCount({ ...purchase, totalKg: 2.5 })).toBe(2);
  });

  it('uses the spool size of the purchase: one 2.5 kg spool stays one spool', () => {
    const big = { ...purchase, totalKg: 2.5, packageWeightKg: 2.5, spoolKg: 2.5 };
    expect(suggestedSpoolCount(big)).toBe(1);
    expect(suggestedSpoolCount({ ...big, totalKg: 5, quantity: 2 })).toBe(2);
    expect(suggestedSpoolCount({ ...purchase, totalKg: 3, spoolKg: 0.75 })).toBe(4);
    const [s] = spoolsForPurchase(big, suggestedSpoolCount(big), { newId: () => 'x', nextLabel: () => 'S1', date });
    expect(s?.nominalG).toBe(2500);
  });
});

describe('length and weight', () => {
  it('converts with density and diameter (1.75 mm PLA ≈ 2.98 g/m)', () => {
    expect(metersToGrams(1, 1.24, 1.75)).toBeCloseTo(2.9825, 4);
    expect(gramsToMeters(1000, 1.24, 1.75)).toBeCloseTo(335.3, 1);
  });
});

describe('spool migrations', () => {
  it('adds spools and the default empty spools to version 1 documents', () => {
    const { doc: d } = loadDocument({ schemaVersion: 1 });
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.spools).toEqual([]);
    expect(d.spoolKinds.map((k) => k.id)).toContain('tare-sunlu-plastic');
  });

  it('turns tare presets into spool kinds and keeps every spool on the weight it had', () => {
    const lines = [
      { id: 'sunlu-pla', manufacturer: 'SUNLU', name: 'PLA+' },
      { id: 'sunlu-petg', manufacturer: 'SUNLU', name: 'PETG' },
      { id: 'prusa-petg', manufacturer: 'Prusa', name: 'PETG' },
    ];
    const filaments = [{ id: 'pla', productLineId: 'sunlu-pla' }, { id: 'petg', productLineId: 'sunlu-petg' }, { id: 'prusa', productLineId: 'prusa-petg' }];
    const tarePresets = [
      { id: 'sunlu', manufacturer: 'SUNLU', productLineId: null, spoolType: 'plastic', emptyG: 130, source: 'SpoolmanDB', verified: false },
      { id: 'petg', manufacturer: 'SUNLU', productLineId: 'sunlu-petg', spoolType: 'plastic', emptyG: 209, source: 'measured', verified: true },
      { id: 'any', manufacturer: null, productLineId: null, spoolType: 'plastic', emptyG: 200, source: 'avg', verified: false },
      { id: 'refill', manufacturer: null, productLineId: null, spoolType: 'refill', emptyG: 0, source: 'avg', verified: false },
      // brand field used as a description
      { id: 'full', manufacturer: 'SUNLU Full Plastic', productLineId: null, spoolType: 'plastic', emptyG: 180, source: 'x', verified: false },
      { id: 'generic', manufacturer: 'Generic', productLineId: null, spoolType: 'cardboard', emptyG: 140, source: 'x', verified: false },
    ];
    const s = (id: string, filamentId: string, spoolType: string | null) => ({ id, filamentId, label: id, nominalG: 1000, spoolType, status: 'open', movements: [] });
    const { doc: d, warnings } = loadDocument({
      schemaVersion: 3, productLines: lines, filaments, tarePresets,
      purchases: [
        { id: 'p1', date, store: 'x', description: '', filamentId: 'pla', spoolType: 'refill', packageWeightKg: 1, quantity: 1, totalPrice: 10, totalKg: 1 },
        { id: 'p2', date, store: 'x', description: '', filamentId: 'pla', spoolType: 'plastic', packageWeightKg: 1, quantity: 1, totalPrice: 10, totalKg: 1 },
      ],
      spools: [s('a', 'pla', 'plastic'), s('b', 'petg', 'plastic'), s('c', 'prusa', null), s('d', 'pla', 'refill'), s('e', 'pla', 'cardboard')],
    });
    expect(d.spoolKinds.map((k) => [k.id, k.name, k.emptyG])).toEqual([
      ['sunlu', 'SUNLU plastic', 130], ['petg', 'SUNLU PETG plastic', 209], ['any', 'Plastic spool', 200], ['refill', 'Refill without spool', 0],
      ['full', 'SUNLU Full Plastic', 180], ['generic', 'Generic cardboard', 140],
    ]);
    expect(d.spoolKinds.map((k) => k.manufacturer)).toEqual(['SUNLU', 'SUNLU', null, null, 'SUNLU', null]);
    expect(d.spools.map((x) => x.kindId)).toEqual(['sunlu', 'petg', 'any', 'refill', undefined]);
    expect(d.spools.every((x) => !('spoolType' in x))).toBe(true);
    expect('tarePresets' in d).toBe(false);
    expect(d.purchases.map((p) => p.kindId)).toEqual(['refill', undefined]);
    expect(d.purchases.every((p) => !('spoolType' in p))).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe('spool labels', () => {
  it('finds spools by label (case-insensitive) or id, and assigns printed labels', () => {
    const d = doc();
    d.spools.push(spool({ id: 'a', label: 'S7' }), spool({ id: 'b', label: 'S8' }));
    expect(findSpool(d, 's7')?.id).toBe('a');
    expect(findSpool(d, 'b')?.id).toBe('b');
    expect(isLabelCode('l0042')).toBe(true);
    expect(isLabelCode('S7')).toBe(false);

    assignLabel(d, 'a', 'l0042');
    expect(findSpool(d, 'L0042')?.id).toBe('a');
    expect(findSpool(d, 'S7')?.id).toBe('a'); // the old label still finds it
    expect(() => assignLabel(d, 'b', 'L0042')).toThrow('already on spool L0042');
    expect(() => assignLabel(d, 'b', 'S7')).toThrow('already on spool L0042');
  });

  it('moves everything to a new label when a sealed spool is opened', () => {
    const d = doc();
    d.spools.push(spool({ id: 'a', label: 'L0001', status: 'sealed', movements: [{ id: 'm', date, kind: 'initial', grams: 1000 }] }));
    openWithNewLabel(d, 'a', 'L0002', date);
    expect(d.spools[0]).toMatchObject({ label: 'L0002', previousLabels: ['L0001'], status: 'open', openedAt: date });
    expect(remainingG(d.spools[0]!)).toBe(1000);
    expect(findSpool(d, 'L0001')?.id).toBe('a');
  });
});

describe('empty spool kinds', () => {
  it('names kinds with their brand and offers the filament brand first', () => {
    const d = doc();
    d.spoolKinds.push({ id: 'prusa', name: 'Cardboard', manufacturer: 'Prusa', emptyG: 193, source: 'x', capacityG: 1000 });
    expect(kindName(d.spoolKinds.find((k) => k.id === 'prusa')!)).toBe('Prusa - Cardboard');
    expect(kindName(d.spoolKinds.find((k) => k.id === 'sunlu-cardboard')!)).toBe('SUNLU plastic + cardboard');
    expect(kindLabel(d.spoolKinds.find((k) => k.id === 'prusa')!)).toBe('Prusa - Cardboard · 193 g · for 1 kg');
    const groups = kindGroups(d, 'prusa');
    expect(groups.map((g) => g.name)).toEqual(['Prusa', 'Generic', 'Other brands']);
    expect(groups[0]!.kinds.map((k) => k.id)).toEqual(['prusa']);
  });
});

describe('spoolFromLabel (onboarding)', () => {
  let n = 0;
  const id = () => `x${n++}`;
  const base = { code: 'l0007', filamentId: 'pla', nominalG: 1000, kindId: 'tare-sunlu-plastic', date };

  it('creates an opened spool and weighs it in one step', () => {
    const s = spoolFromLabel(doc(), { ...base, sealed: false, grossG: 730 }, id);
    expect(s).toMatchObject({ label: 'L0007', status: 'open' });
    expect(remainingG(s)).toBe(600); // 730 − 130 g SUNLU spool
  });

  it('books sealed spools at full weight and leaves unweighed ones unknown', () => {
    expect(remainingG(spoolFromLabel(doc(), { ...base, sealed: true }, id))).toBe(1000);
    expect(remainingG(spoolFromLabel(doc(), { ...base, sealed: false }, id))).toBeNull();
  });

  it('refuses a label that is already used', () => {
    const d = doc();
    d.spools.push(spool({ label: 'L0007' }));
    expect(() => spoolFromLabel(d, { ...base, sealed: true }, id)).toThrow('already on another spool');
  });
});

describe('spoolKeyFromScan', () => {
  it.each([
    ['https://vinzenzhopf.github.io/3d-printing-calculator/#/spool/L0042', 'L0042'],
    ['https://print.example.com/#/spool/L0042', 'L0042'],
    ['https://print.example.com/#/s/L0043', 'L0043'],
    ['https://print.example.com/#/settings/L0044', null],
    ['http://localhost:5173/#/spool/S12', 'S12'],
    [' l0007 ', 'L0007'],
    ['4260682250131', null],
    ['https://example.com/', null],
  ])('%s → %s', (text, key) => expect(spoolKeyFromScan(text)).toBe(key));
});

describe('stock maintenance', () => {
  it('clears all spools and unlinks logged prints, keeping purchases and empty spools', () => {
    const d = doc();
    d.spools.push(spool({ id: 'a' }), spool({ id: 'b' }));
    d.printJobs.push({ id: 'j', date, name: 'x', printerId: 'p', printTimeMin: 10, result: 'success', filaments: [{ filamentId: 'pla', grams: 5, spoolId: 'a' }] });
    const kinds = d.spoolKinds.length;
    clearStock(d);
    expect(d.spools).toEqual([]);
    expect(d.printJobs[0]!.filaments[0]).toEqual({ filamentId: 'pla', grams: 5 });
    expect(d.spoolKinds.length).toBe(kinds);
  });

  it('next label number: stored counter, but never below codes on spools', () => {
    const d = doc();
    expect(nextLabelNumber(d)).toBe(1);
    d.settings.labelNextNumber = 41;
    expect(nextLabelNumber(d)).toBe(41);
    d.spools.push(spool({ label: 'L0050' }), spool({ label: 'S99' }));
    expect(nextLabelNumber(d)).toBe(51);
    clearStock(d);
    d.settings.labelNextNumber = 1;
    expect(nextLabelNumber(d)).toBe(1);
  });
});

describe('purchases and spools', () => {
  const purchase = (id: string, filamentId: string, date: string, kg = 1): FilamentPurchase =>
    ({ id, date, store: '', description: '', filamentId, packageWeightKg: kg, quantity: 1, totalPrice: 20, totalKg: kg });

  it('offers own purchases first, then other colors of the line, with linked spool counts', () => {
    const d = doc();
    d.filaments.push({ id: 'pla2', productLineId: 'sunlu-pla', color: 'y', finish: null, link: null, asin: null, status: 'owned' });
    d.purchases.push(purchase('old', 'pla', '2025-01-01', 2), purchase('dup', 'pla2', '2026-01-01'), purchase('new', 'pla', '2026-02-01'), purchase('other', 'petg', '2026-03-01'));
    d.spools.push(spool({ id: 's1', purchaseId: 'old' }), spool({ id: 's2', purchaseId: 'old' }));
    const choices = purchaseChoices(d, 'pla', 's2');
    expect(choices.map((c) => [c.purchase.id, c.sameFilament])).toEqual([['new', true], ['old', true], ['dup', false]]);
    expect(choices[1]).toMatchObject({ spools: 1, expected: 2 });
  });

  it('edits a purchase as spools × kg per spool', () => {
    const p = purchase('p', 'pla', date, 2);
    setPurchaseSpools(p, 1, 2.5);
    expect(p).toMatchObject({ totalKg: 2.5, spoolKg: 2.5, packSizeKg: 2.5, packageWeightKg: 2.5 });
    const bundled = { ...purchase('b', 'pla', date, 1), packSizeKg: 4 };
    setPurchaseSpools(bundled, 2, 1);
    expect(bundled).toMatchObject({ totalKg: 2, packSizeKg: 4 });
  });
});
