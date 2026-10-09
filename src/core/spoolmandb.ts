import type { AppDocument, Filament, Id, ProductLine } from './model';

/**
 * SpoolmanDB (github.com/Donkie/SpoolmanDB, MIT): community data about
 * filaments — colors, finish, density, temperatures, spool weights. Used on
 * demand to fill in and check the catalog; nothing is sent there.
 */
export const SPOOLMANDB_URL = 'https://donkie.github.io/SpoolmanDB/filaments.json';

export interface SpoolmanFilament {
  id: string;
  manufacturer: string;
  name: string;
  material: string;
  density?: number | null;
  weight?: number | null;
  spool_weight?: number | null;
  spool_type?: 'plastic' | 'cardboard' | 'metal' | null;
  diameter?: number | null;
  color_hex?: string | null;
  color_hexes?: string[] | null;
  extruder_temp?: number | null;
  bed_temp?: number | null;
  finish?: string | null;
  multi_color_direction?: string | null;
  pattern?: string | null;
  translucent?: boolean;
  glow?: boolean;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
/** Words of a line name, e.g. "pla", "meta" for "PLA Meta": color names there often repeat them. */
const lineWords = (line: ProductLine | undefined) => new Set(line ? words(line.name).filter((w) => w.length >= 2) : []);
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/gray/g, 'grey').replace(/[^a-z0-9+]/g, '');

/**
 * Entries for a product line: same brand (also when the brand is only in the
 * line name, "Prusa Research" / "Prusament PLA"), the most specific material
 * found in the line name (PLA+ rather than PLA), same diameter. One per color,
 * the 1 kg variant preferred.
 */
/** A brand name from outside ("Prusament", "Sunlu") is the line's brand, also when it is only in the line name. */
export function brandFits(brandName: string, line: Pick<ProductLine, 'manufacturer' | 'name'>): boolean {
  const m = norm(brandName);
  const brand = norm(line.manufacturer);
  return !!m && !!brand && (m === brand || brand.startsWith(m) || m.startsWith(brand) || norm(`${line.manufacturer} ${line.name}`).includes(m));
}

export function lineEntries(db: readonly SpoolmanFilament[], line: ProductLine): SpoolmanFilament[] {
  const lineName = norm(line.name);
  const sameBrand = db.filter((e) => brandFits(e.manufacturer, line));
  const materialFits = (e: SpoolmanFilament) => {
    const m = norm(e.material);
    return lineName.includes(m) || m === norm(line.baseMaterial);
  };
  const fitting = sameBrand.filter((e) => materialFits(e) && Math.abs((e.diameter ?? line.diameterMm) - line.diameterMm) < 0.1);
  // Most specific material: "PLA+" beats "PLA" when the line is "PLA+ 2.0".
  const inName = fitting.filter((e) => lineName.includes(norm(e.material)));
  const longest = Math.max(0, ...inName.map((e) => norm(e.material).length));
  let chosen = longest ? inName.filter((e) => norm(e.material).length === longest) : fitting;
  // Words of the line name beyond the material ("PLA Meta" → "meta") often start the color names there.
  const extras = [...lineWords(line)].filter((w) => !chosen.some((e) => norm(e.material) === w));
  const marked = chosen.filter((e) => words(e.name).some((w) => extras.includes(w)));
  if (marked.length) chosen = marked;
  const byColor = new Map<string, SpoolmanFilament>();
  for (const e of chosen) {
    const key = `${norm(e.material)}|${norm(e.name)}`;
    const prev = byColor.get(key);
    if (!prev || (prev.weight !== 1000 && e.weight === 1000)) byColor.set(key, e);
  }
  return [...byColor.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The entry for a filament: its stored SpoolmanDB id, else the best color-name match (or none). */
export function matchEntry(
  entries: readonly SpoolmanFilament[],
  filament: Filament,
  line?: ProductLine,
  all: readonly SpoolmanFilament[] = entries,
): SpoolmanFilament | undefined {
  if (filament.spoolmanId) {
    const linked = all.find((e) => e.id === filament.spoolmanId);
    if (linked) return linked;
  }
  const color = norm(filament.color);
  if (!color) return undefined;
  // "Meta White" in the line "PLA Meta" is its "White".
  const skip = lineWords(line);
  const name = (e: SpoolmanFilament) => norm(words(e.name).filter((w) => !skip.has(w)).join(' ')) || norm(e.name);
  const exact = entries.find((e) => name(e) === color);
  if (exact) return exact;
  // "Copper" → "Silk Copper", but not "Olive Green" → "Green"; "Grey" with "Solid Grey" and "Dark Grey" is unclear.
  const partial = entries.filter((e) => name(e).includes(color));
  return partial.length === 1 ? partial[0] : undefined;
}

/** "Silk", "Translucent", "Matte Marble", "Dual color"… from the entry's flags. */
export function entryFinish(e: SpoolmanFilament): string | null {
  const parts = [
    e.finish && e.finish !== 'glossy' ? e.finish : null,
    e.translucent ? 'translucent' : null,
    e.glow ? 'glow' : null,
    e.pattern ?? null,
    e.multi_color_direction === 'coaxial' ? 'dual color' : e.multi_color_direction === 'longitudinal' ? 'color shift' : null,
  ].filter((p): p is string => !!p);
  if (parts.length === 0) return null;
  const text = parts.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type DiffKey = 'colorHex' | 'colorHex2' | 'finish' | 'nozzleC' | 'bedC' | 'density';

export interface Diff {
  key: DiffKey;
  label: string;
  current: string;
  proposed: string;
  /** Pre-select: only where nothing is set yet; differing values are offered, not pushed. */
  suggested: boolean;
}

const hex = (h: string | null | undefined) => (h ? `#${h.replace(/^#/, '').toUpperCase()}` : undefined);

function entryColors(e: SpoolmanFilament): [string | undefined, string | undefined] {
  const multi = e.color_hexes?.filter(Boolean) ?? [];
  return multi.length >= 2 ? [hex(multi[0]), hex(multi[1])] : [hex(e.color_hex ?? multi[0]), undefined];
}

/** What the entry would change on the filament (and its line's density). */
export function entryDiffs(filament: Filament, line: ProductLine | undefined, e: SpoolmanFilament): Diff[] {
  const [c1, c2] = entryColors(e);
  const finish = entryFinish(e);
  const diffs: Diff[] = [];
  const add = (key: DiffKey, label: string, current: string | number | null | undefined, proposed: string | number | null | undefined, same = (a: string, b: string) => a === b) => {
    if (proposed === undefined || proposed === null || proposed === '') return;
    const cur = current === undefined || current === null ? '' : String(current);
    if (cur && same(cur, String(proposed))) return;
    diffs.push({ key, label, current: cur, proposed: String(proposed), suggested: !cur });
  };
  const sameHex = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();
  add('colorHex', 'Color', filament.colorHex, c1, sameHex);
  add('colorHex2', 'Second color', filament.colorHex2, c2, sameHex);
  add('finish', 'Finish', filament.finish, finish, (a, b) => a.toLowerCase() === b.toLowerCase());
  add('nozzleC', 'Nozzle °C', filament.nozzleC, e.extruder_temp);
  add('bedC', 'Bed °C', filament.bedC, e.bed_temp);
  if (line) add('density', 'Density (line)', line.densityGcm3, e.density);
  return diffs;
}

/** Applies the chosen diffs and links the filament to the entry. */
export function applyEntry(doc: AppDocument, filamentId: Id, e: SpoolmanFilament, keys: readonly DiffKey[]): void {
  const f = doc.filaments.find((x) => x.id === filamentId);
  if (!f) return;
  const line = doc.productLines.find((l) => l.id === f.productLineId);
  const [c1, c2] = entryColors(e);
  f.spoolmanId = e.id;
  for (const key of keys) {
    if (key === 'colorHex' && c1) f.colorHex = c1;
    if (key === 'colorHex2' && c2) f.colorHex2 = c2;
    if (key === 'finish') f.finish = entryFinish(e);
    if (key === 'nozzleC' && e.extruder_temp) f.nozzleC = e.extruder_temp;
    if (key === 'bedC' && e.bed_temp) f.bedC = e.bed_temp;
    if (key === 'density' && line && e.density) line.densityGcm3 = e.density;
  }
}

/** A new color of a line from an entry. */
export function filamentFromEntry(lineId: Id, e: SpoolmanFilament, id: Id): Filament {
  const [c1, c2] = entryColors(e);
  return {
    id, productLineId: lineId, color: e.name, finish: entryFinish(e), link: null, asin: null, status: 'owned', spoolmanId: e.id,
    ...(c1 ? { colorHex: c1 } : {}), ...(c2 ? { colorHex2: c2 } : {}),
    ...(e.extruder_temp ? { nozzleC: e.extruder_temp } : {}), ...(e.bed_temp ? { bedC: e.bed_temp } : {}),
  };
}
