import type { AppDocument, FilamentPurchase, Id, IsoDate, Spool, SpoolKind, StockMovement } from './model';

/** Remaining net grams, or null when the spool was never weighed / booked (FI-6). */
export function remainingG(spool: Spool): number | null {
  if (spool.movements.length === 0) return null;
  return spool.movements.reduce((sum, m) => sum + m.grams, 0);
}

export type TareSource = 'spool' | 'kind' | 'none';

export interface ResolvedTare {
  grams: number | null;
  source: TareSource;
  kind?: SpoolKind;
}

/** Empty-spool weight (FI-6a): this spool's own measurement, else its kind's weight. */
export function resolveTare(doc: AppDocument, spool: Pick<Spool, 'kindId' | 'tareG'>): ResolvedTare {
  const kind = spool.kindId ? doc.spoolKinds.find((k) => k.id === spool.kindId) : undefined;
  if (spool.tareG !== undefined) return { grams: spool.tareG, source: 'spool', ...(kind ? { kind } : {}) };
  return kind ? { grams: kind.emptyG, source: 'kind', kind } : { grams: null, source: 'none' };
}

/**
 * Empty spool kind for a new spool of this filament: the purchase's kind if it
 * has one, else the one used last for the same product line, else for the same
 * brand, else the brand's own kind, else a generic one. Unpacked refills are
 * changed by hand.
 */
export function suggestKind(doc: AppDocument, filamentId: Id, purchaseId?: Id): Id | undefined {
  const fromPurchase = purchaseId ? doc.purchases.find((p) => p.id === purchaseId)?.kindId : undefined;
  if (fromPurchase && doc.spoolKinds.some((k) => k.id === fromPurchase)) return fromPurchase;
  const brandOf = (fid: Id) => {
    const line = doc.productLines.find((l) => l.id === doc.filaments.find((f) => f.id === fid)?.productLineId);
    return { lineId: line?.id, brand: line?.manufacturer.toLowerCase() };
  };
  const target = brandOf(filamentId);
  const known = new Set(doc.spoolKinds.map((k) => k.id));
  const used = [...doc.spools].reverse().filter((s) => s.kindId && known.has(s.kindId));
  const sameLine = used.find((s) => target.lineId && brandOf(s.filamentId).lineId === target.lineId);
  const sameBrand = used.find((s) => target.brand && brandOf(s.filamentId).brand === target.brand);
  return (
    sameLine?.kindId ??
    sameBrand?.kindId ??
    doc.spoolKinds.find((k) => target.brand && k.manufacturer?.toLowerCase() === target.brand)?.id ??
    doc.spoolKinds.find((k) => k.manufacturer === null)?.id ??
    doc.spoolKinds[0]?.id
  );
}

/** "SUNLU plastic + cardboard · 160 g", for pickers. */
export function kindLabel(kind: SpoolKind): string {
  return `${kind.name} · ${kind.emptyG} g`;
}

export interface WeighIn {
  movement: StockMovement;
  netG: number;
}

/**
 * Books a weigh-in: gross scale reading minus tare is the new stock; the
 * movement holds the difference to the previous stock (0 when unknown).
 */
export function weighIn(doc: AppDocument, spool: Spool, grossG: number, date: IsoDate, id: Id): WeighIn {
  const tare = resolveTare(doc, spool).grams ?? 0;
  const netG = Math.max(grossG - tare, 0);
  const previous = remainingG(spool) ?? 0;
  return {
    netG,
    movement: { id, date, kind: 'weigh-in', grams: netG - previous, grossG, tareG: tare },
  };
}

/** Filament per spool of a purchase: as entered, else 1 kg (or the whole purchase if less). */
export function spoolKgOf(purchase: FilamentPurchase): number {
  return purchase.spoolKg ?? Math.min(1, purchase.totalKg);
}

/** Suggested split of a purchase into spools of its spool size (a partial spool counts as none). */
export function suggestedSpoolCount(purchase: FilamentPurchase): number {
  return Math.max(1, Math.floor(purchase.totalKg / spoolKgOf(purchase) + 1e-9));
}

/** Sealed spools for a purchase, booked at their full nominal weight. */
export function spoolsForPurchase(
  purchase: FilamentPurchase,
  count: number,
  opts: { newId: () => Id; nextLabel: () => string; date: IsoDate; kindId?: Id },
): Spool[] {
  const nominalG = Math.round((purchase.totalKg * 1000) / count);
  return Array.from({ length: count }, () => ({
    id: opts.newId(),
    filamentId: purchase.filamentId,
    purchaseId: purchase.id,
    label: opts.nextLabel(),
    nominalG,
    ...(opts.kindId ? { kindId: opts.kindId } : {}),
    status: 'sealed' as const,
    movements: [{ id: opts.newId(), date: opts.date, kind: 'initial' as const, grams: nominalG, note: `Purchase ${purchase.date}` }],
  }));
}

/** Next free label like "S12". */
export function labelGenerator(doc: AppDocument): () => string {
  let n = doc.spools.reduce((max, s) => Math.max(max, Number(/^S(\d+)$/.exec(s.label)?.[1] ?? 0)), 0);
  return () => `S${++n}`;
}

export interface FilamentStock {
  /** Sum of all spools with known stock. */
  knownG: number;
  spools: number;
  unknownSpools: number;
}

/** Stock per filament over spools that are not empty or discarded. */
export function stockByFilament(doc: AppDocument): Map<Id, FilamentStock> {
  const result = new Map<Id, FilamentStock>();
  for (const s of doc.spools) {
    if (s.status === 'empty' || s.status === 'discarded') continue;
    const entry = result.get(s.filamentId) ?? { knownG: 0, spools: 0, unknownSpools: 0 };
    const g = remainingG(s);
    entry.spools++;
    if (g === null) entry.unknownSpools++;
    else entry.knownG += g;
    result.set(s.filamentId, entry);
  }
  return result;
}

/** Filament length ↔ weight (FI-6b), e.g. for slicer meters or printer counters. */
export function metersToGrams(meters: number, densityGcm3: number, diameterMm: number): number {
  const areaMm2 = Math.PI * (diameterMm / 2) ** 2;
  return (areaMm2 * meters * 1000 * densityGcm3) / 1000;
}

export function gramsToMeters(grams: number, densityGcm3: number, diameterMm: number): number {
  return grams / metersToGrams(1, densityGcm3, diameterMm);
}

/** Typical densities when a product line has none set. */
export const DEFAULT_DENSITY: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, Other: 1.24 };

export interface ToBuy {
  filamentId: Id;
  stockG: number;
  thresholdG: number;
  /** Some spools of this filament are not weighed yet, so the real stock may be higher. */
  hasUnknown: boolean;
  lastPurchase?: FilamentPurchase;
}

/** Filaments below their low-stock threshold (FI-7), most urgent first. */
export function toBuyList(doc: AppDocument): ToBuy[] {
  const stock = stockByFilament(doc);
  return doc.filaments
    .filter((f) => f.lowStockG !== undefined && f.status === 'owned')
    .map((f) => {
      const s = stock.get(f.id);
      const lastPurchase = doc.purchases.filter((p) => p.filamentId === f.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      return { filamentId: f.id, stockG: s?.knownG ?? 0, thresholdG: f.lowStockG!, hasUnknown: (s?.unknownSpools ?? 0) > 0, ...(lastPurchase ? { lastPurchase } : {}) };
    })
    .filter((x) => x.stockG < x.thresholdG)
    .sort((a, b) => a.stockG / a.thresholdG - b.stockG / b.thresholdG);
}

/** A spool by its label (printed label code like "L0042", or an older "S12") or its id. */
export function findSpool(doc: AppDocument, key: string): Spool | undefined {
  const k = key.trim().toLowerCase();
  return doc.spools.find((s) => s.label.toLowerCase() === k) ?? doc.spools.find((s) => s.id === key);
}

/** Printed label codes ("L0042") as produced by core/labels. */
export function isLabelCode(key: string): boolean {
  return /^L\d{4,}$/i.test(key.trim());
}

/** Next label number to print: the stored counter, but never below codes already on spools. */
export function nextLabelNumber(doc: AppDocument): number {
  const used = doc.spools.filter((s) => isLabelCode(s.label)).map((s) => Number(s.label.slice(1)));
  return Math.max(doc.settings.labelNextNumber ?? 1, ...used.map((n) => n + 1), 1);
}

/**
 * Starts the stock from scratch: deletes all spools with their history and
 * unlinks them from logged prints. Purchases, empty spools and the print log stay.
 */
export function clearStock(doc: AppDocument): void {
  doc.spools = [];
  for (const job of doc.printJobs) for (const f of job.filaments) delete f.spoolId;
}

/**
 * Sticks a printed label on a spool: the label code becomes the spool's label.
 * A code can only belong to one spool.
 */
export function assignLabel(doc: AppDocument, spoolId: Id, code: string): void {
  const normalized = code.trim().toUpperCase();
  const other = doc.spools.find((s) => s.label.toUpperCase() === normalized && s.id !== spoolId);
  if (other) throw new Error(`Label ${normalized} is already on another spool.`);
  const spool = doc.spools.find((s) => s.id === spoolId);
  if (!spool) throw new Error('Unknown spool.');
  spool.label = normalized;
}

export interface LabelSpoolInput {
  code: string;
  filamentId: Id;
  nominalG: number;
  kindId?: Id;
  /** Unopened: booked at full nominal weight, no weighing needed. */
  sealed: boolean;
  /** Scale reading incl. spool, for opened spools (optional: stock stays unknown without it). */
  grossG?: number | null;
  purchaseId?: Id;
  date: IsoDate;
}

/**
 * Onboarding a physical spool from its printed label: create it with the label
 * and, in the same step, book its stock (sealed = full, or a weigh-in).
 */
export function spoolFromLabel(doc: AppDocument, input: LabelSpoolInput, newId: () => Id): Spool {
  const code = input.code.trim().toUpperCase();
  if (doc.spools.some((s) => s.label.toUpperCase() === code)) throw new Error(`Label ${code} is already on another spool.`);
  const spool: Spool = {
    id: newId(),
    filamentId: input.filamentId,
    label: code,
    nominalG: input.nominalG,
    ...(input.kindId ? { kindId: input.kindId } : {}),
    status: input.sealed ? 'sealed' : 'open',
    movements: [],
    ...(input.purchaseId ? { purchaseId: input.purchaseId } : {}),
  };
  if (input.sealed) {
    spool.movements.push({ id: newId(), date: input.date, kind: 'initial', grams: input.nominalG, note: 'Sealed spool' });
  } else if (input.grossG !== undefined && input.grossG !== null) {
    spool.movements.push(weighIn(doc, spool, input.grossG, input.date, newId()).movement);
  }
  return spool;
}

/**
 * The spool key in a scanned code: our label links (".../#/spool/L0042") or a
 * bare label code. null for anything else (e.g. a product barcode → use as search).
 */
export function spoolKeyFromScan(text: string): string | null {
  const t = text.trim();
  const link = /#\/spool\/([^/?#\s]+)/.exec(t);
  if (link) return decodeURIComponent(link[1]!);
  return isLabelCode(t) ? t.toUpperCase() : null;
}
