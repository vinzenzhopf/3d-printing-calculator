import type { AppDocument, Id, IsoDate, PrintJob } from './model';
import { jobFromPlate } from './print-log';

/**
 * A print detected outside the app (e.g. Home Assistant watching OctoPrint),
 * written as one small JSON file per print into the sync repo's `print-inbox/`.
 * It only pre-creates a print log entry; filament details are added by hand.
 */
export interface InboxEntry {
  /** Path in the repo; also the identity of the entry. */
  path: string;
  printer: string;
  file: string;
  startedAt: string | null;
  finishedAt: string;
  durationMin: number | null;
  result: PrintJob['result'];
}

const RESULTS = new Set(['success', 'failed', 'cancelled']);

/** Validates one inbox file (format version 1). Returns null for anything unusable. */
export function parseInboxEntry(path: string, raw: unknown): InboxEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const finishedAt = typeof r.finishedAt === 'string' && !Number.isNaN(Date.parse(r.finishedAt)) ? r.finishedAt : null;
  if (r.version !== 1 || !finishedAt) return null;
  const startedAt = typeof r.startedAt === 'string' && !Number.isNaN(Date.parse(r.startedAt)) ? r.startedAt : null;
  const duration = Number(r.durationMin);
  return {
    path,
    printer: typeof r.printer === 'string' ? r.printer : '',
    file: typeof r.file === 'string' ? r.file : '',
    startedAt,
    finishedAt,
    durationMin: Number.isFinite(duration) && duration >= 0
      ? Math.round(duration)
      : startedAt ? Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 60000) : null,
    result: RESULTS.has(r.result as string) ? (r.result as PrintJob['result']) : 'success',
  };
}

/** "flexi_75_segment_0.6n_0.3mm_PLA_MK3S_4h17m.gcode" → "flexi_75_segment_0.6n_0.3mm_PLA_MK3S_4h17m" */
export function printName(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/(\.gcode)?\.(b?gcode|gco|3mf)$/i, '') || 'Print';
}

/**
 * Turns an inbox entry into a print log draft. The printer comes from the
 * printers' inbox keys (else the first active printer). If a quote plate has
 * the same name as the file (plates imported from slicer files are named after
 * it), its filaments, grams and quote link are taken over.
 */
export function jobFromInbox(doc: AppDocument, entry: InboxEntry, opts: { id: Id; localDate: (iso: string) => IsoDate }): PrintJob {
  const key = entry.printer.trim().toLowerCase();
  const printer =
    doc.printers.find((p) => (p.inboxKey ?? '').trim().toLowerCase() === key && key) ??
    doc.printers.find((p) => p.status === 'active') ??
    doc.printers[0];
  const name = printName(entry.file);
  const date = opts.localDate(entry.finishedAt);

  const match = doc.quotes
    .filter((q) => q.status !== 'rejected')
    .flatMap((q) => q.plates.map((plate) => ({ q, plate })))
    .find(({ plate }) => printName(plate.name).toLowerCase() === name.toLowerCase());
  const base = match
    ? jobFromPlate(doc, match.plate, { id: opts.id, date, quoteId: match.q.id })
    : { id: opts.id, date, printerId: printer?.id ?? '', name, printTimeMin: 0, result: 'success' as const, filaments: [] };

  return {
    ...base,
    printerId: printer?.id ?? base.printerId,
    name,
    printTimeMin: entry.durationMin ?? base.printTimeMin,
    result: entry.result,
    note: `Detected by ${entry.printer || 'printer'}${entry.startedAt ? `, started ${entry.startedAt}` : ''}`,
  };
}
