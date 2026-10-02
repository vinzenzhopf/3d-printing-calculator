import type { AppDocument, Id, IsoDate, Plate, PrintJob } from './model';
import { remainingG } from './stock';

/** Spool to take filament from: the open spool with the least left, else a sealed one. */
export function suggestSpool(doc: AppDocument, filamentId: Id): Id | undefined {
  const spools = doc.spools.filter((s) => s.filamentId === filamentId);
  const open = spools
    .filter((s) => s.status === 'open')
    .sort((a, b) => (remainingG(a) ?? Infinity) - (remainingG(b) ?? Infinity));
  return (open[0] ?? spools.find((s) => s.status === 'sealed'))?.id;
}

/**
 * A print job for one run of a quote plate: grams per filament incl. the
 * printer's per-run waste and the plate's purge, split like the cost calculation.
 */
export function jobFromPlate(doc: AppDocument, plate: Plate, opts: { id: Id; date: IsoDate; quoteId?: Id }): PrintJob {
  const printer = doc.printers.find((p) => p.id === plate.printerId);
  const modelG = plate.filaments.reduce((sum, f) => sum + f.weightG, 0);
  const purge = plate.purgeG ?? (plate.filamentChanges ?? 0) * (printer?.purgePerFilamentChangeG ?? 0);
  const wasteG = (printer?.purgeWastePerPlateG ?? 0) + purge;
  return {
    id: opts.id,
    date: opts.date,
    printerId: plate.printerId,
    name: plate.name,
    printTimeMin: plate.printTimeMin,
    result: 'success',
    filaments: plate.filaments
      .filter((f) => f.filamentId)
      .map((f) => {
        const share = modelG > 0 ? f.weightG / modelG : 1 / plate.filaments.length;
        const spoolId = suggestSpool(doc, f.filamentId);
        return { filamentId: f.filamentId, grams: Math.round((f.weightG + wasteG * share) * 10) / 10, ...(spoolId ? { spoolId } : {}) };
      }),
    ...(opts.quoteId ? { quoteId: opts.quoteId, plateId: plate.id } : {}),
  };
}

/** Adds the job and books its filament on the spools ("print" movements linked to the job). */
export function addJob(doc: AppDocument, job: PrintJob, newId: () => Id): void {
  doc.printJobs.push(job);
  for (const f of job.filaments) {
    const spool = f.spoolId ? doc.spools.find((s) => s.id === f.spoolId) : undefined;
    if (!spool || f.grams <= 0) continue;
    spool.movements.push({ id: newId(), date: job.date, kind: 'print', grams: -f.grams, jobId: job.id, note: job.name });
    if (spool.status === 'sealed') spool.status = 'open';
  }
}

/** Removes the job and the stock it booked. */
export function removeJob(doc: AppDocument, jobId: Id): void {
  doc.printJobs = doc.printJobs.filter((j) => j.id !== jobId);
  for (const s of doc.spools) s.movements = s.movements.filter((m) => m.jobId !== jobId);
}

export interface JobStats {
  jobs: number;
  hours: number;
  /** Hours of failed or cancelled jobs. */
  lostHours: number;
  /** Share of print time lost to failures, null without jobs. */
  failureRate: number | null;
  filamentG: number;
}

export function jobStats(jobs: readonly PrintJob[]): JobStats {
  const hours = jobs.reduce((sum, j) => sum + j.printTimeMin / 60, 0);
  const lostHours = jobs.filter((j) => j.result !== 'success').reduce((sum, j) => sum + j.printTimeMin / 60, 0);
  return {
    jobs: jobs.length,
    hours,
    lostHours,
    failureRate: hours > 0 ? lostHours / hours : null,
    filamentG: jobs.reduce((sum, j) => sum + j.filaments.reduce((s, f) => s + f.grams, 0), 0),
  };
}
