import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import type { AppDocument, Spool } from '../src/core/model';
import {
  applyWeight, estimatedSpools, kindFromWeight, printablesWeights, searchWeights, spoolmanWeights, suggestWeights, type SpoolWeight,
} from '../src/core/spool-weights';
import type { SpoolmanFilament } from '../src/core/spoolmandb';

const sm = (manufacturer: string, weight: number, spool_type: 'plastic' | 'cardboard' | null, spool_weight: number): SpoolmanFilament =>
  ({ id: `${manufacturer}-${Math.random()}`, manufacturer, name: 'x', material: 'PLA', weight, spool_type, spool_weight });

const weights: SpoolWeight[] = [
  ...spoolmanWeights([sm('Acme', 1000, 'cardboard', 170), sm('Acme', 1000, 'cardboard', 170), sm('Acme', 1000, 'plastic', 220), sm('Other', 1000, 'plastic', 150)]),
  ...printablesWeights({
    source: { title: 't', author: 'a', url: 'u', license: 'CC BY-NC-SA 4.0' },
    entries: [
      { brand: 'Acme', sizeG: 2500, spoolType: 'plastic', emptyG: 634 },
      { brand: 'Acme', sizeG: 1000, spoolType: 'plastic', variant: 'with Cardboard Core', emptyG: 226, minG: 223, maxG: 230 },
      { brand: 'Acme', sizeG: 1000, spoolType: 'plastic', variant: 'Clear', emptyG: 216 },
    ],
  }),
];

function doc(): AppDocument {
  const d = createEmptyDocument();
  d.productLines.push({ id: 'l', manufacturer: 'ACME', name: 'PLA+', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 });
  d.filaments.push({ id: 'f', productLineId: 'l', color: 'Black', finish: null, link: null, asin: null, status: 'owned' });
  d.spoolKinds = [
    { id: 'gen-card', name: 'Generic cardboard', manufacturer: null, emptyG: 140, source: 'rough average' },
    { id: 'core', name: 'Plastic w. cardboard core', manufacturer: null, emptyG: 218, source: 'rough average' },
    { id: 'own', name: 'My plastic', manufacturer: null, emptyG: 200, source: 'measured 2026-01-01' },
    { id: 'acme', name: 'Plastic', manufacturer: 'Acme', emptyG: 221, source: 'measured' },
    { id: 'refill', name: 'Refill', manufacturer: null, emptyG: 0, source: 'x' },
  ];
  const spool = (id: string, kindId: string | undefined, extra: Partial<Spool> = {}): Spool =>
    ({ id, filamentId: 'f', label: id, nominalG: 1000, ...(kindId ? { kindId } : {}), status: 'open', movements: [], ...extra });
  d.spools.push(
    spool('a', 'gen-card'), spool('b', 'gen-card'), spool('c', 'core'), spool('d', undefined, { nominalG: 2500 }), spool('e', 'own'),
    spool('measured', 'gen-card', { tareG: 150 }), spool('known', 'acme'), spool('refill', 'refill'), spool('gone', 'gen-card', { status: 'empty' }),
  );
  return d;
}

describe('spool weight lists', () => {
  it('groups SpoolmanDB by brand, size, type and weight', () => {
    const acme = weights.filter((w) => w.source === 'spoolmandb' && w.brand === 'Acme');
    expect(acme.map((w) => [w.spoolType, w.emptyG, w.count])).toEqual([['cardboard', 170, 2], ['plastic', 220, 1]]);
  });

  it('searches by words, the given brand and size first', () => {
    expect(searchWeights(weights, 'acme 2.5').map((w) => w.emptyG)).toEqual([634]);
    expect(searchWeights(weights, 'plastic', { brand: 'Other' })[0]!.brand).toBe('Other');
  });

  it('makes a kind with brand, size and source', () => {
    expect(kindFromWeight(weights.find((w) => w.emptyG === 226)!, 'k')).toEqual({
      id: 'k', name: '1 kg plastic (with Cardboard Core)', manufacturer: 'Acme', emptyG: 226, capacityG: 1000,
      source: 'Printables spool weight catalog (Scuk, CC BY-NC-SA 4.0), 223–230 g',
    });
  });
});

describe('suggestions for estimated spools', () => {
  it('only looks at spools with a guessed empty weight', () => {
    expect(estimatedSpools(doc()).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('matches brand, size and spool type, and pre-selects only guesses', () => {
    const s = suggestWeights(doc(), weights);
    const by = (id: string) => s.find((g) => g.spoolIds.includes(id))!;
    expect(by('a')).toMatchObject({ weight: { emptyG: 170 }, spoolIds: ['a', 'b'], preselect: true });
    expect(by('c').weight.emptyG).toBe(226); // plastic with cardboard core
    expect(by('d').weight.emptyG).toBe(634);
    expect(by('e')).toMatchObject({ weight: { emptyG: 220 }, preselect: false }); // own kind, plain plastic first
  });

  it('reuses a kind with the same brand, weight and size, else adds one', () => {
    const d = doc();
    const w = weights.find((x) => x.emptyG === 170)!;
    const id = applyWeight(d, w, ['a', 'b'], () => 'new');
    expect(id).toBe('new');
    expect(d.spools.filter((s) => s.kindId === 'new').map((s) => s.id)).toEqual(['a', 'b']);
    expect(applyWeight(d, w, ['c'], () => 'other')).toBe('new');
  });
});
