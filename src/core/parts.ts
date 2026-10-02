import type { Plate, Quote } from './model';

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
