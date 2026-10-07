import type { CostSplit, Plate, Quote } from './model';

/** Parts one run of a plate produces: its part list, else the simple count (default 1). */
export function partsPerRun(plate: Plate): number {
  return plate.parts?.length ? plate.parts.reduce((sum, p) => sum + p.quantity, 0) : (plate.partsPerRun ?? 1);
}

export interface PartPlanRow {
  name: string;
  required: number;
  planned: number;
  /** planned − required: negative = missing, positive = surplus. */
  diff: number;
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * Part planner (QC-3): required parts vs. what the plates produce
 * (parts per run × runs). Parts that are produced but not required are listed too.
 */
export function planParts(quote: Quote): PartPlanRow[] {
  const planned = new Map<string, { name: string; count: number }>();
  for (const plate of quote.plates) {
    for (const part of plate.parts ?? []) {
      const k = key(part.name);
      if (!k) continue;
      const entry = planned.get(k) ?? { name: part.name.trim(), count: 0 };
      entry.count += part.quantity * Math.max(plate.runs, 0);
      planned.set(k, entry);
    }
  }
  const rows: PartPlanRow[] = (quote.requiredParts ?? [])
    .filter((r) => key(r.name))
    .map((r) => {
      const count = planned.get(key(r.name))?.count ?? 0;
      planned.delete(key(r.name));
      return { name: r.name.trim(), required: r.quantity, planned: count, diff: count - r.quantity };
    });
  for (const extra of planned.values()) rows.push({ name: extra.name, required: 0, planned: extra.count, diff: extra.count });
  return rows;
}

export interface PlateSplit {
  mode: CostSplit | 'even';
  /** Share of one run's cost per piece, for each entry of the plate's part list. */
  each: number[];
  warnings: string[];
}

export const SPLIT_LABEL: Record<PlateSplit['mode'], string> = { even: 'evenly', grams: 'by grams', percent: 'by percent', cost: 'by cost' };

/**
 * Spreads one run's cost of a plate over the pieces on its part list (QC-3):
 * evenly, by grams or percent per piece (normalized to the run's cost), or by
 * a cost per piece (pieces without one share the rest evenly). The pieces
 * always add up to `runCost`.
 */
export function splitPlateCost(plate: Plate, runCost: number): PlateSplit {
  const parts = plate.parts ?? [];
  const mode = plate.costSplit ?? 'even';
  const warnings: string[] = [];
  const pieces = parts.reduce((sum, p) => sum + p.quantity, 0);
  const evenly = (): PlateSplit => ({ mode, each: parts.map(() => (pieces > 0 ? runCost / pieces : 0)), warnings });
  const sum = (value: (p: (typeof parts)[number]) => number) => parts.reduce((s, p) => s + value(p) * p.quantity, 0);
  const named = (list: typeof parts) => list.map((p) => p.name || '(unnamed)').join(', ');

  if (mode === 'grams' || mode === 'percent') {
    const value = (p: (typeof parts)[number]) => Math.max((mode === 'grams' ? p.grams : p.percent) ?? 0, 0);
    const total = sum(value);
    const missing = parts.filter((p) => !(value(p) > 0));
    if (total <= 0) {
      warnings.push(`no ${mode === 'grams' ? 'grams' : 'percentages'} per part yet, split evenly.`);
      return evenly();
    }
    if (missing.length) warnings.push(`${named(missing)} without ${mode === 'grams' ? 'grams' : 'percentage'}, counted as 0.`);
    if (mode === 'percent' && Math.abs(total - 100) > 0.01) warnings.push(`the part shares add up to ${round2(total)} %, scaled to 100 %.`);
    return { mode, each: parts.map((p) => (runCost * value(p)) / total), warnings };
  }

  if (mode === 'cost') {
    const set = (p: (typeof parts)[number]) => p.cost !== undefined && p.cost >= 0;
    const fixed = sum((p) => (set(p) ? p.cost! : 0));
    const rest = parts.filter((p) => !set(p)).reduce((s, p) => s + p.quantity, 0);
    if (fixed > runCost + 0.005) {
      warnings.push(`the part costs (${fixed.toFixed(2)}) exceed the plate's cost per run (${runCost.toFixed(2)}), scaled down.`);
      return { mode, each: parts.map((p) => (set(p) ? (p.cost! * runCost) / fixed : 0)), warnings };
    }
    if (rest > 0) return { mode, each: parts.map((p) => (set(p) ? p.cost! : (runCost - fixed) / rest)), warnings };
    if (fixed <= 0) return evenly();
    if (fixed < runCost - 0.005) warnings.push(`the part costs (${fixed.toFixed(2)}) are below the plate's cost per run (${runCost.toFixed(2)}), scaled up.`);
    return { mode, each: parts.map((p) => (p.cost! * runCost) / fixed), warnings };
  }

  return evenly();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
