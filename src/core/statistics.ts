import type { AppDocument, Id, IsoDate, PrintJob } from './model';
import { remainingG } from './stock';

/** `YYYY-MM` */
export type Month = string;

export interface MonthStats {
  month: Month;
  prints: number;
  hours: number;
  /** Filament used by logged prints, grams. */
  usedG: number;
  /** Filament bought, kg. */
  boughtKg: number;
  /** Spent on filament (incl. shipping share). */
  spent: number;
}

/** All months from `from` to `to`, inclusive. */
export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) (m = 1), y++;
  }
  return out;
}

/** The month `n` months before `month`. */
export function monthsBefore(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

const jobGrams = (j: PrintJob) => j.filaments.reduce((sum, f) => sum + f.grams, 0) + (j.untrackedFilament?.grams ?? 0);

/** Prints and purchases per month, every month of the range (empty ones as zeros). */
export function monthlyStats(doc: AppDocument, from: Month, to: Month): MonthStats[] {
  const months = new Map(monthRange(from, to).map((month) => [month, { month, prints: 0, hours: 0, usedG: 0, boughtKg: 0, spent: 0 }]));
  for (const j of doc.printJobs) {
    const b = months.get(j.date.slice(0, 7));
    if (!b) continue;
    b.prints++;
    b.hours += j.printTimeMin / 60;
    b.usedG += jobGrams(j);
  }
  for (const p of doc.purchases) {
    const b = months.get(p.date.slice(0, 7));
    if (!b) continue;
    b.boughtKg += p.totalKg;
    b.spent += p.totalPrice;
  }
  return [...months.values()];
}

export interface Totals {
  prints: number;
  hours: number;
  usedG: number;
  /** Share of prints that succeeded; null without prints. */
  successRate: number | null;
  results: Record<PrintJob['result'], number>;
  boughtKg: number;
  spent: number;
  /** Current stock (not limited to the period). */
  stockG: number;
  spools: number;
  unweighedSpools: number;
}

/** Key figures since `from` (inclusive; undefined = all time). */
export function totals(doc: AppDocument, from?: IsoDate): Totals {
  const jobs = doc.printJobs.filter((j) => !from || j.date >= from);
  const purchases = doc.purchases.filter((p) => !from || p.date >= from);
  const results = { success: 0, failed: 0, cancelled: 0 };
  for (const j of jobs) results[j.result]++;
  const inUse = doc.spools.filter((s) => s.status === 'open' || s.status === 'sealed');
  return {
    prints: jobs.length,
    hours: jobs.reduce((sum, j) => sum + j.printTimeMin / 60, 0),
    usedG: jobs.reduce((sum, j) => sum + jobGrams(j), 0),
    successRate: jobs.length ? results.success / jobs.length : null,
    results,
    boughtKg: purchases.reduce((sum, p) => sum + p.totalKg, 0),
    spent: purchases.reduce((sum, p) => sum + p.totalPrice, 0),
    stockG: inUse.reduce((sum, s) => sum + Math.max(remainingG(s) ?? 0, 0), 0),
    spools: inUse.length,
    unweighedSpools: inUse.filter((s) => remainingG(s) === null).length,
  };
}

export interface Share {
  key: string;
  value: number;
  /** Set when the key is a filament. */
  filamentId?: Id;
}

function ranked(map: Map<string, Share>): Share[] {
  return [...map.values()].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
}

function lineOf(doc: AppDocument, filamentId: Id) {
  return doc.productLines.find((l) => l.id === doc.filaments.find((f) => f.id === filamentId)?.productLineId);
}

/** Grams used by logged prints per filament, most used first. */
export function usageByFilament(doc: AppDocument, from?: IsoDate): Share[] {
  const map = new Map<string, Share>();
  for (const j of doc.printJobs) {
    if (from && j.date < from) continue;
    for (const f of j.filaments) {
      const s = map.get(f.filamentId) ?? { key: f.filamentId, value: 0, filamentId: f.filamentId };
      s.value += f.grams;
      map.set(f.filamentId, s);
    }
  }
  return ranked(map);
}

/** Grams used by logged prints per base material (PLA, PETG, …), incl. filament of unknown color. */
export function usageByMaterial(doc: AppDocument, from?: IsoDate): Share[] {
  const map = new Map<string, Share>();
  const add = (key: string, grams: number) => {
    const s = map.get(key) ?? { key, value: 0 };
    s.value += grams;
    map.set(key, s);
  };
  for (const u of usageByFilament(doc, from)) add(lineOf(doc, u.filamentId!)?.baseMaterial ?? 'Unknown', u.value);
  for (const j of doc.printJobs) {
    if (j.untrackedFilament && (!from || j.date >= from)) add(j.untrackedFilament.material ?? 'Unknown', j.untrackedFilament.grams);
  }
  return ranked(map);
}

/** Money spent on filament per brand. */
export function spendByBrand(doc: AppDocument, from?: IsoDate): Share[] {
  const map = new Map<string, Share>();
  for (const p of doc.purchases) {
    if (from && p.date < from) continue;
    const key = lineOf(doc, p.filamentId)?.manufacturer ?? 'Unknown';
    const s = map.get(key) ?? { key, value: 0 };
    s.value += p.totalPrice;
    map.set(key, s);
  }
  return ranked(map);
}
