import { parseFileName } from './filename';
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
 * printers' inbox keys (else the first active printer). The name is the model
 * name from the file name; grams encoded in the file name (slicer output
 * template) are taken as the actual usage. If a quote plate belongs to the file
 * (same file name, else same model name), its filaments and quote link are taken
 * over as well.
 */
export function jobFromInbox(doc: AppDocument, entry: InboxEntry, opts: { id: Id; localDate: (iso: string) => IsoDate }): PrintJob {
  const key = entry.printer.trim().toLowerCase();
  const printer =
    doc.printers.find((p) => (p.inboxKey ?? '').trim().toLowerCase() === key && key) ??
    doc.printers.find((p) => p.status === 'active') ??
    doc.printers[0];
  const fileName = printName(entry.file);
  const info = parseFileName(entry.file);
  const name = info.base || fileName;
  const date = opts.localDate(entry.finishedAt);

  const plates = doc.quotes
    .filter((q) => q.status !== 'rejected')
    .flatMap((q) => q.plates.map((plate) => ({ q, plate })));
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const match =
    plates.find(({ plate }) => same(printName(plate.name), fileName)) ??
    plates.find(({ plate }) => same(parseFileName(plate.name).base, name));
  const base = match
    ? jobFromPlate(doc, match.plate, { id: opts.id, date, quoteId: match.q.id })
    : { id: opts.id, date, printerId: printer?.id ?? '', name, printTimeMin: 0, result: 'success' as const, filaments: [] };

  // Slicer grams from the file name: the exact value for this file (one row; multi-material totals go to the first).
  let filaments = base.filaments;
  if (info.grams !== undefined) {
    filaments = filaments.length > 0
      ? filaments.map((f, i) => (i === 0 && filaments.length === 1 ? { ...f, grams: info.grams! } : f))
      : [{ filamentId: '', grams: info.grams }];
  }
  const slicer = [
    info.estimatedMin !== undefined ? `slicer estimate ${Math.floor(info.estimatedMin / 60)}h${String(info.estimatedMin % 60).padStart(2, '0')}m` : '',
    info.grams !== undefined ? `${info.grams} g` : '',
    info.extras.join(' '),
  ].filter(Boolean).join(', ');
  return {
    ...base,
    printerId: printer?.id ?? base.printerId,
    name,
    printTimeMin: entry.durationMin ?? base.printTimeMin,
    result: entry.result,
    filaments,
    note: [`Detected by ${entry.printer || 'printer'}${entry.startedAt ? `, started ${entry.startedAt}` : ''}`, fileName !== name ? `file ${fileName}` : '', slicer]
      .filter(Boolean).join(' · '),
  };
}
