import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import type { Filament, ProductLine } from '../src/core/model';
import { applyEntry, entryDiffs, entryFinish, filamentFromEntry, lineEntries, matchEntry, type SpoolmanFilament } from '../src/core/spoolmandb';

const entry = (manufacturer: string, material: string, name: string, extra: Partial<SpoolmanFilament> = {}): SpoolmanFilament => ({
  id: `${manufacturer}_${material}_${name}_${extra.weight ?? 1000}`.toLowerCase().replace(/\s/g, ''),
  manufacturer, material, name, diameter: 1.75, weight: 1000, color_hex: '808080', ...extra,
});

const db: SpoolmanFilament[] = [
  entry('Acme', 'PLA', 'Black'),
  entry('Acme', 'PLA', 'Meta Black'),
  entry('Acme', 'PLA', 'Meta White'),
  entry('Acme', 'PLA', 'Meta Cream White'),
  entry('Acme', 'PLA+', 'Grey', { color_hex: '615f6c' }),
  entry('Acme', 'PLA+', 'Solid Grey'),
  entry('Acme', 'PLA+', 'Silk Copper', { finish: 'silk', extruder_temp: 210, bed_temp: 60, density: 1.23 }),
  entry('Acme', 'PLA+', 'Copper', { weight: 250 }),
  entry('Acme', 'PLA+', 'Copper'),
  entry('Acme', 'PLA+', 'Rainbow', { color_hexes: ['ff0000', '0000ff'], multi_color_direction: 'longitudinal' }),
  entry('Acme', 'PLA+', 'Black', { diameter: 2.85 }),
  entry('Other', 'PLA+', 'Grey'),
];

const line = (name: string, extra: Partial<ProductLine> = {}): ProductLine =>
  ({ id: 'l', manufacturer: 'Acme', name, baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75, ...extra });
const filament = (color: string, extra: Partial<Filament> = {}): Filament =>
  ({ id: 'f', productLineId: 'l', color, finish: null, link: null, asin: null, status: 'owned', ...extra });

describe('SpoolmanDB matching', () => {
  it('takes the brand, the most specific material, the diameter and one entry per color (1 kg)', () => {
    const entries = lineEntries(db, line('PLA+ 2.0'));
    expect(entries.map((e) => e.name)).toEqual(['Copper', 'Grey', 'Rainbow', 'Silk Copper', 'Solid Grey']);
    expect(entries.find((e) => e.name === 'Copper')!.weight).toBe(1000);
  });

  it('narrows to the line words and ignores them in color names', () => {
    const l = line('PLA Meta');
    const entries = lineEntries(db, l);
    expect(entries.map((e) => e.name)).toEqual(['Meta Black', 'Meta Cream White', 'Meta White']);
    expect(matchEntry(entries, filament('White'), l)?.name).toBe('Meta White');
    expect(matchEntry(entries, filament('Black'), l)?.name).toBe('Meta Black');
  });

  it('matches colors exactly, or a single entry containing the name; gray = grey', () => {
    const l = line('PLA+');
    const entries = lineEntries(db, l);
    expect(matchEntry(entries, filament('Gray'), l)?.name).toBe('Grey');
    expect(matchEntry(entries, filament('Rain bow'), l)?.name).toBe('Rainbow');
    expect(matchEntry(entries, filament('Olive Grey'), l)).toBeUndefined();
    expect(matchEntry(entries, filament('Copper'), l)?.name).toBe('Copper');
    expect(matchEntry(entries, filament('x', { spoolmanId: db[6]!.id }), l, db)?.name).toBe('Silk Copper');
  });
});

describe('SpoolmanDB data', () => {
  it('reads finish, second color and temperatures', () => {
    expect(entryFinish(db[6]!)).toBe('Silk');
    expect(entryFinish(db[9]!)).toBe('Color shift');
    expect(entryFinish(entry('a', 'b', 'c', { translucent: true, finish: 'matte' }))).toBe('Matte translucent');
    const f = filamentFromEntry('l', db[9]!, 'n');
    expect(f).toMatchObject({ color: 'Rainbow', colorHex: '#FF0000', colorHex2: '#0000FF', finish: 'Color shift' });
  });

  it('offers only differences, pre-selecting the empty fields, and applies the chosen ones', () => {
    const d = createEmptyDocument();
    d.productLines.push(line('PLA+'));
    d.filaments.push(filament('Silk Copper', { colorHex: '#808080', nozzleC: 215 }));
    const diffs = entryDiffs(d.filaments[0]!, d.productLines[0], db[6]!);
    expect(diffs.map((x) => [x.key, x.suggested])).toEqual([['finish', true], ['nozzleC', false], ['bedC', true], ['density', true]]);
    applyEntry(d, 'f', db[6]!, ['finish', 'bedC', 'density']);
    expect(d.filaments[0]).toMatchObject({ finish: 'Silk', nozzleC: 215, bedC: 60, spoolmanId: db[6]!.id });
    expect(d.productLines[0]!.densityGcm3).toBe(1.23);
  });
});
