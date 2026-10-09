import type { AppDocument, Id, Spool, SpoolKind } from './model';
import { brandFits, type SpoolmanFilament } from './spoolmandb';

/**
 * Known empty-spool weights from community lists, to pick an empty spool kind
 * instead of typing it, and to replace rough estimates on spools that were
 * never weighed empty.
 */
export interface SpoolWeight {
  /** Stable key: source, brand, size, type, variant. */
  id: string;
  source: 'spoolmandb' | 'printables';
  brand: string;
  /** Filament on a new spool, grams; null = not stated. */
  sizeG: number | null;
  spoolType: string | null;
  variant?: string;
  emptyG: number;
  minG?: number;
  maxG?: number;
  /** SpoolmanDB: how many filaments come on it (a hint how common it is). */
  count?: number;
}

export interface PrintablesCatalog {
  source: { title: string; author: string; url: string; license: string };
  entries: { brand: string; sizeG: number; spoolType: string; variant?: string; emptyG: number; minG?: number; maxG?: number }[];
}

const key = (...parts: (string | number | null | undefined)[]) => parts.map((p) => String(p ?? '').toLowerCase()).join('|');

/** One entry per brand, size, spool type and weight, with the number of filaments listing it. */
export function spoolmanWeights(db: readonly SpoolmanFilament[]): SpoolWeight[] {
  const byKey = new Map<string, SpoolWeight>();
  for (const e of db) {
    if (!e.spool_weight) continue;
    const id = key('spoolmandb', e.manufacturer, e.weight, e.spool_type, e.spool_weight);
    const existing = byKey.get(id);
    if (existing) existing.count! += 1;
    else byKey.set(id, { id, source: 'spoolmandb', brand: e.manufacturer, sizeG: e.weight ?? null, spoolType: e.spool_type ?? null, emptyG: e.spool_weight, count: 1 });
  }
  return [...byKey.values()];
}

export function printablesWeights(catalog: PrintablesCatalog): SpoolWeight[] {
  return catalog.entries.map((e) => ({
    id: key('printables', e.brand, e.sizeG, e.spoolType, e.variant),
    source: 'printables' as const,
    brand: e.brand,
    sizeG: e.sizeG,
    spoolType: e.spoolType,
    emptyG: e.emptyG,
    ...(e.variant ? { variant: e.variant } : {}),
    ...(e.minG !== undefined ? { minG: e.minG, maxG: e.maxG } : {}),
  }));
}

export const sizeText = (g: number | null) => (g === null ? '' : g >= 1000 ? `${g / 1000} kg` : `${g} g`);

/** "1 kg cardboard (Clear)" */
export function weightTitle(w: SpoolWeight): string {
  return [sizeText(w.sizeG), w.spoolType ?? 'spool', w.variant ? `(${w.variant})` : ''].filter(Boolean).join(' ');
}

const SOURCE_NAME: Record<SpoolWeight['source'], string> = {
  spoolmandb: 'SpoolmanDB',
  printables: 'Printables spool weight catalog (Scuk, CC BY-NC-SA 4.0)',
};

/** A new empty spool kind from a list entry; `brand` = the owner's spelling of the brand. */
export function kindFromWeight(w: SpoolWeight, id: Id, brand = w.brand): SpoolKind {
  const range = w.minG !== undefined ? `, ${w.minG}–${w.maxG} g` : '';
  return {
    id,
    name: weightTitle(w).replace(/^./, (c) => c.toUpperCase()),
    manufacturer: brand,
    emptyG: w.emptyG,
    ...(w.sizeG ? { capacityG: w.sizeG } : {}),
    source: `${SOURCE_NAME[w.source]}${range}`,
  };
}

/**
 * Entries matching a search ("esun 2.5", "sunlu cardboard"): every word must
 * occur. The given brand and size come first, then the more common ones.
 */
export function searchWeights(all: readonly SpoolWeight[], query: string, hint: { brand?: string; lineName?: string; sizeG?: number } = {}): SpoolWeight[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = (w: SpoolWeight) => `${w.brand} ${weightTitle(w)} ${w.sizeG ?? ''} ${w.emptyG} g`.toLowerCase();
  const fitsBrand = (w: SpoolWeight) => !!hint.brand && brandFits(w.brand, { manufacturer: hint.brand, name: hint.lineName ?? '' });
  const score = (w: SpoolWeight) => (fitsBrand(w) ? 4 : 0) + (hint.sizeG && w.sizeG === hint.sizeG ? 2 : 0) + Math.min(w.count ?? 1, 50) / 100;
  return all
    .filter((w) => words.every((x) => text(w).includes(x)))
    .sort((a, b) => score(b) - score(a) || a.brand.localeCompare(b.brand) || (a.sizeG ?? 0) - (b.sizeG ?? 0));
}

/**
 * Spools whose empty weight is only a guess: in stock, never weighed empty, and
 * on no kind, a generic kind, or one whose weight is a rough average.
 */
export function estimatedSpools(doc: AppDocument): Spool[] {
  return doc.spools.filter((s) => {
    if (s.status === 'empty' || s.status === 'discarded' || s.tareG !== undefined) return false;
    const kind = doc.spoolKinds.find((k) => k.id === s.kindId);
    if (kind && kind.emptyG === 0) return false; // refill without a spool
    return !kind || !kind.manufacturer || /rough|average|estimate/i.test(kind.source);
  });
}

export interface WeightSuggestion {
  weight: SpoolWeight;
  spoolIds: Id[];
  /** Other entries for the same brand and size, to choose instead. */
  alternatives: SpoolWeight[];
  /** All its spools are on no kind or a clear guess (generic, rough average); others may be the owner's own value. */
  preselect: boolean;
}

/** No kind, a "Generic …" one or a rough average: not something the owner measured or looked up. */
function isGuess(kind: SpoolKind | undefined): boolean {
  return !kind || /^generic/i.test(kind.name) || /rough|average|estimate/i.test(kind.source);
}

/**
 * For estimated spools: the list entry for the spool's brand and size, of the
 * same spool type as its current kind if that says one. Spools getting the
 * same entry are grouped.
 */
export function suggestWeights(doc: AppDocument, all: readonly SpoolWeight[]): WeightSuggestion[] {
  const groups = new Map<string, WeightSuggestion>();
  for (const s of estimatedSpools(doc)) {
    const line = doc.productLines.find((l) => l.id === doc.filaments.find((f) => f.id === s.filamentId)?.productLineId);
    if (!line) continue;
    const fitting = all.filter((w) => brandFits(w.brand, line) && w.sizeG === s.nominalG);
    if (fitting.length === 0) continue;
    const kindName = doc.spoolKinds.find((k) => k.id === s.kindId)?.name.toLowerCase() ?? '';
    const type = /cardboard/.test(kindName) && !/plastic/.test(kindName) ? 'cardboard' : /plastic/.test(kindName) ? 'plastic' : null;
    const ofType = type ? fitting.filter((w) => w.spoolType === type) : [];
    // "Plastic with cardboard core": the entries saying so.
    const withCore = type === 'plastic' && /cardboard/.test(kindName) ? ofType.filter((w) => /cardboard/i.test(w.variant ?? '')) : [];
    const pool = withCore.length ? withCore : ofType.length ? ofType : fitting;
    // Plain entries before variants ("Clear", "2.0 Version"), then the most common one.
    const best = [...pool].sort((a, b) => Number(!!a.variant) - Number(!!b.variant) || (b.count ?? 1) - (a.count ?? 1))[0]!;
    const group = groups.get(best.id) ?? { weight: best, spoolIds: [], alternatives: fitting.filter((w) => w.id !== best.id), preselect: true };
    group.spoolIds.push(s.id);
    group.preselect &&= isGuess(doc.spoolKinds.find((k) => k.id === s.kindId));
    groups.set(best.id, group);
  }
  return [...groups.values()];
}

/**
 * Puts spools on the kind for a list entry: an existing kind of that brand
 * with the same weight and size, else a new one (named with the brand as the
 * spools' product line writes it). Returns the kind id.
 */
export function applyWeight(doc: AppDocument, w: SpoolWeight, spoolIds: readonly Id[], newId: () => Id): Id {
  const lineOf = (filamentId: Id) => doc.productLines.find((l) => l.id === doc.filaments.find((f) => f.id === filamentId)?.productLineId);
  const firstLine = doc.spools.filter((s) => spoolIds.includes(s.id)).map((s) => lineOf(s.filamentId)).find(Boolean);
  const brand = firstLine && brandFits(w.brand, firstLine) ? firstLine.manufacturer : w.brand;
  const existing = doc.spoolKinds.find(
    (k) => k.manufacturer?.toLowerCase() === brand.toLowerCase() && k.emptyG === w.emptyG && (k.capacityG ?? null) === (w.sizeG ?? null),
  );
  const kind = existing ?? kindFromWeight(w, newId(), brand);
  if (!existing) doc.spoolKinds.push(kind);
  for (const s of doc.spools) if (spoolIds.includes(s.id)) s.kindId = kind.id;
  return kind.id;
}
