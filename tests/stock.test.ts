import { SCHEMA_VERSION } from '../src/core/model';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { loadDocument } from '../src/core/migrations';
import type { AppDocument, FilamentPurchase, Spool } from '../src/core/model';
import {
  gramsToMeters, labelGenerator, metersToGrams, remainingG, resolveTare, spoolsForPurchase,
  stockByFilament, suggestedSpoolCount, weighIn,
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
    d.filaments.push({ id: id!, productLineId: line!, color: 'x', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned' });
  }
  d.tarePresets.push({ id: 'petg', manufacturer: 'SUNLU', productLineId: 'sunlu-petg', spoolType: 'plastic', emptyG: 209, source: 'test', verified: false });
  return d;
}

function spool(extra: Partial<Spool> = {}): Spool {
  return { id: 's', filamentId: 'pla', label: 'S1', nominalG: 1000, spoolType: 'plastic', status: 'open', movements: [], ...extra };
}

describe('resolveTare', () => {
  it('uses the most specific match: own, line, manufacturer (case-insensitive), default', () => {
    const d = doc();
    expect(resolveTare(d, spool({ tareG: 155 }))).toMatchObject({ grams: 155, source: 'spool' });
    expect(resolveTare(d, spool({ filamentId: 'petg' }))).toMatchObject({ grams: 209, source: 'line' });
    expect(resolveTare(d, spool())).toMatchObject({ grams: 130, source: 'manufacturer' });
    expect(resolveTare(d, spool({ filamentId: 'prusa' }))).toMatchObject({ grams: 200, source: 'default' });
    expect(resolveTare(d, spool({ spoolType: 'refill' }))).toMatchObject({ grams: 0, source: 'default' });
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
});

describe('length and weight', () => {
  it('converts with density and diameter (1.75 mm PLA ≈ 2.98 g/m)', () => {
    expect(metersToGrams(1, 1.24, 1.75)).toBeCloseTo(2.9825, 4);
    expect(gramsToMeters(1000, 1.24, 1.75)).toBeCloseTo(335.3, 1);
  });
});

describe('schema 2 migration', () => {
  it('adds spools and default tare presets to version 1 documents', () => {
    const { doc: d } = loadDocument({ schemaVersion: 1 });
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.spools).toEqual([]);
    expect(d.tarePresets.length).toBeGreaterThan(0);
  });
});
