/**
 * Catalog cleanup (FI-2b): deprecate old filaments/product lines, or merge
 * duplicates. Deprecating keeps everything as it is and only hides the entry
 * from choices; merging moves every reference to the kept entry and deletes
 * the duplicate.
 */

import type { AppDocument, Filament, Id, IsoDate, ProductLine, Spool } from './model';

// ---------- Deprecation ----------

/** A filament is deprecated by itself or through its product line. */
export function isFilamentDeprecated(doc: AppDocument, f: Filament): boolean {
  return !!f.deprecatedAt || !!doc.productLines.find((l) => l.id === f.productLineId)?.deprecatedAt;
}

/** Filaments to offer for new records (pickers, color overview, to-buy list). */
export function activeFilaments(doc: AppDocument): Filament[] {
  return doc.filaments.filter((f) => !isFilamentDeprecated(doc, f));
}

export type CatalogTarget = { kind: 'filament' | 'line'; id: Id };

function filamentIdsOf(doc: AppDocument, target: CatalogTarget): Set<Id> {
  return new Set(target.kind === 'filament' ? [target.id] : doc.filaments.filter((f) => f.productLineId === target.id).map((f) => f.id));
}

/** Spools still on the shelf (sealed or open): deprecating these would hide filament that's in stock. */
export function spoolsInStock(doc: AppDocument, target: CatalogTarget): Spool[] {
  const ids = filamentIdsOf(doc, target);
  return doc.spools.filter((s) => ids.has(s.filamentId) && (s.status === 'sealed' || s.status === 'open'));
}

export interface DeprecateOptions {
  date: IsoDate;
  /** Links old ↔ new (successorId/predecessorId), so prices can fall back to the old purchases. */
  successorId?: Id;
  /** Deprecate even with spools in stock (after a clear warning). */
  force?: boolean;
}

export function deprecate(doc: AppDocument, target: CatalogTarget, opts: DeprecateOptions): void {
  const inStock = spoolsInStock(doc, target);
  if (inStock.length && !opts.force) {
    throw new Error(`Still in stock: ${inStock.map((s) => s.label).join(', ')}.`);
  }
  const list: (Filament | ProductLine)[] = target.kind === 'filament' ? doc.filaments : doc.productLines;
  const item = list.find((x) => x.id === target.id);
  if (!item) throw new Error('Unknown entry.');
  if (opts.successorId === target.id) throw new Error('An entry cannot be its own successor.');
  item.deprecatedAt = opts.date;
  if (opts.successorId) {
    const successor = list.find((x) => x.id === opts.successorId);
    if (!successor) throw new Error('Unknown successor.');
    item.successorId = successor.id;
    successor.predecessorId = item.id;
  }
}

/** Makes a deprecated entry selectable again (links to a successor stay). */
export function restore(doc: AppDocument, target: CatalogTarget): void {
  const list: (Filament | ProductLine)[] = target.kind === 'filament' ? doc.filaments : doc.productLines;
  const item = list.find((x) => x.id === target.id);
  if (item) delete item.deprecatedAt;
}

/** The entry and its predecessors, newest first (cycle-safe). */
export function predecessorChain<T extends { id: Id; predecessorId?: Id }>(list: T[], id: Id): T[] {
  const chain: T[] = [];
  const seen = new Set<Id>();
  for (let x = list.find((i) => i.id === id); x && !seen.has(x.id); x = x.predecessorId ? list.find((i) => i.id === x!.predecessorId) : undefined) {
    seen.add(x.id);
    chain.push(x);
  }
  return chain;
}

/** A filament by id, also by the id of a duplicate merged into it (for frozen quote snapshots). */
export function findFilament(doc: AppDocument, id: Id): Filament | undefined {
  return doc.filaments.find((f) => f.id === id) ?? doc.filaments.find((f) => f.mergedIds?.includes(id));
}

// ---------- Merging ----------

export interface MergePreview {
  purchases: number;
  spools: number;
  /** Print jobs using the duplicate. */
  printJobs: number;
  /** Quotes with plates using the duplicate. */
  quotes: number;
  /** Frozen quotes whose snapshot names the duplicate: left as they are, still displayed via mergedIds. */
  snapshots: number;
  /** Fields the kept entry takes over because it has none. */
  carriedOver: string[];
}

const CARRY_FILAMENT = ['colorHex', 'finish', 'link', 'asin', 'manualPrice', 'lowStockG', 'predecessorId', 'successorId'] as const;
const CARRY_LINE = ['materialProfileId', 'densityGcm3', 'manualPrice', 'notes', 'predecessorId', 'successorId'] as const;

const empty = (v: unknown) => v === undefined || v === null || v === '';

function missingFields<T extends object>(keep: T, drop: T, fields: readonly (keyof T)[], self: Id[]): string[] {
  return fields.filter((k) => empty(keep[k]) && !empty(drop[k]) && !self.includes(drop[k] as Id)) as string[];
}

export function previewFilamentMerge(doc: AppDocument, keepId: Id, dropId: Id): MergePreview {
  const { keep, drop } = pair(doc.filaments, keepId, dropId);
  return {
    purchases: doc.purchases.filter((p) => p.filamentId === dropId).length,
    spools: doc.spools.filter((s) => s.filamentId === dropId).length,
    printJobs: doc.printJobs.filter((j) => j.filaments.some((f) => f.filamentId === dropId)).length,
    quotes: doc.quotes.filter((q) => q.plates.some((p) => p.filaments.some((f) => f.filamentId === dropId))).length,
    snapshots: doc.quotes.filter((q) => q.snapshot?.result.prices.some((p) => p.filamentId === dropId)).length,
    carriedOver: missingFields(keep, drop, CARRY_FILAMENT, [keepId, dropId]),
  };
}

/** Moves every reference from `dropId` to `keepId`, takes over what the kept filament lacks, and deletes the duplicate. */
export function mergeFilaments(doc: AppDocument, keepId: Id, dropId: Id): void {
  const { keep, drop } = pair(doc.filaments, keepId, dropId);
  for (const k of missingFields(keep, drop, CARRY_FILAMENT, [keepId, dropId])) {
    (keep as unknown as Record<string, unknown>)[k] = drop[k as keyof Filament];
  }
  if (drop.status === 'owned') keep.status = 'owned';
  keep.mergedIds = [...new Set([...(keep.mergedIds ?? []), dropId, ...(drop.mergedIds ?? [])])];

  for (const p of doc.purchases) if (p.filamentId === dropId) p.filamentId = keepId;
  for (const s of doc.spools) if (s.filamentId === dropId) s.filamentId = keepId;
  for (const j of doc.printJobs) {
    for (const f of j.filaments) if (f.filamentId === dropId) f.filamentId = keepId;
  }
  for (const q of doc.quotes) {
    for (const plate of q.plates) {
      for (const f of plate.filaments) if (f.filamentId === dropId) f.filamentId = keepId;
      // A plate that used both now has the same filament twice: one row with the summed weight.
      const rows = plate.filaments.filter((f) => f.filamentId === keepId);
      if (rows.length > 1) {
        rows[0]!.weightG = rows.reduce((sum, f) => sum + f.weightG, 0);
        plate.filaments = plate.filaments.filter((f) => f.filamentId !== keepId || f === rows[0]);
      }
    }
  }
  retarget(doc.filaments, dropId, keepId);
  doc.filaments = doc.filaments.filter((f) => f.id !== dropId);
}

export interface LineMergePreview {
  /** Colors of the duplicate line moving to the kept line. */
  filaments: number;
  /** Colors in both lines (same color and finish, ignoring case), merged too when asked. */
  identical: { keepId: Id; dropId: Id }[];
  carriedOver: string[];
}

const sameColor = (a: Filament, b: Filament) =>
  a.color.trim().toLowerCase() === b.color.trim().toLowerCase() && (a.finish ?? '').trim().toLowerCase() === (b.finish ?? '').trim().toLowerCase();

export function previewLineMerge(doc: AppDocument, keepId: Id, dropId: Id): LineMergePreview {
  const { keep, drop } = pair(doc.productLines, keepId, dropId);
  const kept = doc.filaments.filter((f) => f.productLineId === keepId);
  const moving = doc.filaments.filter((f) => f.productLineId === dropId);
  const identical = moving.flatMap((d) => {
    const k = kept.find((x) => sameColor(x, d));
    return k ? [{ keepId: k.id, dropId: d.id }] : [];
  });
  return { filaments: moving.length, identical, carriedOver: missingFields(keep, drop, CARRY_LINE, [keepId, dropId]) };
}

/**
 * Moves the duplicate line's colors to the kept line (merging identical colors
 * when asked), takes over what the kept line lacks plus the duplicate's name as
 * an alias, and deletes the duplicate line.
 */
export function mergeProductLines(doc: AppDocument, keepId: Id, dropId: Id, opts: { mergeIdentical: boolean }): void {
  const { keep, drop } = pair(doc.productLines, keepId, dropId);
  const { identical, carriedOver } = previewLineMerge(doc, keepId, dropId);
  for (const k of carriedOver) (keep as unknown as Record<string, unknown>)[k] = drop[k as keyof ProductLine];
  const aliases = [...(keep.aliases ?? []), ...(drop.aliases ?? [])];
  if (drop.name.toLowerCase() !== keep.name.toLowerCase() || drop.manufacturer.toLowerCase() !== keep.manufacturer.toLowerCase()) {
    aliases.push(drop.manufacturer.toLowerCase() === keep.manufacturer.toLowerCase() ? drop.name : `${drop.manufacturer} ${drop.name}`);
  }
  const unique = [...new Map(aliases.map((a) => [a.toLowerCase(), a])).values()];
  if (unique.length) keep.aliases = unique;

  for (const f of doc.filaments) if (f.productLineId === dropId) f.productLineId = keepId;
  if (opts.mergeIdentical) for (const m of identical) mergeFilaments(doc, m.keepId, m.dropId);
  retarget(doc.productLines, dropId, keepId);
  doc.productLines = doc.productLines.filter((l) => l.id !== dropId);
}

function pair<T extends { id: Id }>(list: T[], keepId: Id, dropId: Id): { keep: T; drop: T } {
  if (keepId === dropId) throw new Error('Choose two different entries.');
  const keep = list.find((x) => x.id === keepId);
  const drop = list.find((x) => x.id === dropId);
  if (!keep || !drop) throw new Error('Unknown entry.');
  return { keep, drop };
}

/** Successor/predecessor links to the deleted entry point to the kept one (and never to itself). */
function retarget(list: { id: Id; predecessorId?: Id; successorId?: Id }[], from: Id, to: Id): void {
  for (const x of list) {
    if (x.predecessorId === from) x.predecessorId = to;
    if (x.successorId === from) x.successorId = to;
    if (x.predecessorId === x.id) delete x.predecessorId;
    if (x.successorId === x.id) delete x.successorId;
  }
}
