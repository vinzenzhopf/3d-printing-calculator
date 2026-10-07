import { materialIn, parseFileName } from './filename';
import { printName } from './inbox';
import type { AppDocument, BaseMaterial, Id, IsoDate, PrintJob } from './model';
import { DEFAULT_DENSITY, metersToGrams } from './stock';

/**
 * Past prints from a printer's own history, normalized. Readers exist for
 * OctoPrint (`uploads/.metadata.json`), Klipper/Moonraker (`/server/history/list`)
 * and a generic CSV (e.g. exported from Bambuddy or a spreadsheet).
 */
export interface ImportedPrint {
  /** Stable per source, so a repeated import recognizes prints it already added. */
  key: string;
  file: string;
  startedAt: string | null;
  finishedAt: string;
  durationMin: number;
  result: PrintJob['result'];
  /** Filament used, when the source knows it. */
  grams?: number;
  material?: BaseMaterial;
}

export type ImportSource = 'octoprint' | 'moonraker' | 'csv';

export const IMPORT_SOURCES: Record<ImportSource, string> = {
  octoprint: 'OctoPrint (.metadata.json)',
  moonraker: 'Klipper / Moonraker history',
  csv: 'CSV',
};

export interface ImportParse {
  source: ImportSource;
  prints: ImportedPrint[];
  /** Rows that could not be read, with the reason. */
  skipped: string[];
}

export { materialIn };

/** Reads an export file; the format is detected from its content. */
export function parseImport(text: string): ImportParse {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error('The file looks like JSON but cannot be read.');
    }
    const jobs = moonrakerJobs(json);
    if (jobs) return parseMoonraker(jobs);
    if (isOctoPrintMetadata(json)) return parseOctoPrint(json as Record<string, OctoFile>);
    throw new Error('Unknown JSON format. Supported: OctoPrint .metadata.json, Moonraker history.');
  }
  return parseCsv(text);
}

// --- OctoPrint ----------------------------------------------------------------

interface OctoFile {
  display?: string;
  history?: { timestamp: number; printTime?: number; success?: boolean }[];
  analysis?: { filament?: Record<string, { volume?: number }> };
}

function isOctoPrintMetadata(json: unknown): boolean {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false;
  return Object.values(json).some((v) => typeof v === 'object' && v !== null && ('history' in v || 'analysis' in v));
}

function parseOctoPrint(meta: Record<string, OctoFile>): ImportParse {
  const prints: ImportedPrint[] = [];
  for (const [name, file] of Object.entries(meta)) {
    const fileName = file.display ?? name;
    const material = materialIn(fileName);
    const volumeCm3 = Object.values(file.analysis?.filament ?? {}).reduce((sum, t) => sum + (t.volume ?? 0), 0);
    for (const h of file.history ?? []) {
      if (typeof h.timestamp !== 'number') continue;
      const durationMin = h.printTime ? Math.round(h.printTime / 60) : 0;
      const end = new Date(h.timestamp * 1000);
      const success = h.success === true;
      prints.push({
        key: `octoprint-${Math.trunc(h.timestamp)}`,
        file: fileName,
        startedAt: h.printTime ? new Date(end.getTime() - h.printTime * 1000).toISOString() : null,
        finishedAt: end.toISOString(),
        durationMin,
        // OctoPrint does not tell failed from cancelled.
        result: success ? 'success' : 'cancelled',
        ...(success && volumeCm3 > 0 ? { grams: round1(volumeCm3 * densityOf(material)) } : {}),
        ...(material ? { material } : {}),
      });
    }
  }
  return { source: 'octoprint', prints: sortByEnd(prints), skipped: [] };
}

// --- Klipper / Moonraker ------------------------------------------------------------

interface MoonrakerJob {
  job_id?: string;
  filename?: string;
  status?: string;
  start_time?: number;
  end_time?: number;
  print_duration?: number;
  total_duration?: number;
  filament_used?: number;
  metadata?: { filament_weight_total?: number; filament_type?: string; filament_total?: number };
}

/** The job list of a Moonraker history response (`{result: {jobs}}`, `{jobs}` or a plain list). */
function moonrakerJobs(json: unknown): MoonrakerJob[] | null {
  const r = json as { result?: { jobs?: unknown }; jobs?: unknown };
  const list = Array.isArray(json) ? json : Array.isArray(r?.result?.jobs) ? r.result!.jobs : Array.isArray(r?.jobs) ? r.jobs : null;
  const jobs = (list ?? []) as unknown[];
  if (!list || !jobs.every((j) => typeof j === 'object' && j !== null) || !jobs.some((j) => 'end_time' in (j as object) || 'print_duration' in (j as object))) return null;
  return list as MoonrakerJob[];
}

function parseMoonraker(jobs: MoonrakerJob[]): ImportParse {
  const prints: ImportedPrint[] = [];
  const skipped: string[] = [];
  for (const j of jobs) {
    if (!j.end_time || j.status === 'in_progress') {
      skipped.push(`${j.filename ?? j.job_id ?? '?'}: not finished`);
      continue;
    }
    const file = j.filename ?? 'Print';
    const material = materialIn(j.metadata?.filament_type ?? '') ?? materialIn(file);
    const weight = j.metadata?.filament_weight_total;
    const grams = weight && weight > 0 ? weight : j.filament_used ? metersToGrams(j.filament_used / 1000, densityOf(material), 1.75) : undefined;
    prints.push({
      key: `moonraker-${j.job_id ?? Math.trunc(j.end_time)}`,
      file,
      startedAt: j.start_time ? new Date(j.start_time * 1000).toISOString() : null,
      finishedAt: new Date(j.end_time * 1000).toISOString(),
      durationMin: Math.round((j.print_duration ?? j.total_duration ?? 0) / 60),
      result: j.status === 'completed' ? 'success' : j.status === 'cancelled' ? 'cancelled' : 'failed',
      ...(grams ? { grams: round1(grams) } : {}),
      ...(material ? { material } : {}),
    });
  }
  return { source: 'moonraker', prints: sortByEnd(prints), skipped };
}

// --- Generic CSV ------------------------------------------------------------------

/** Column names we understand (lower case); the first match wins. */
const COLUMNS = {
  end: ['finished', 'finishedat', 'end', 'end time', 'endtime', 'ended', 'date', 'datum'],
  start: ['started', 'startedat', 'start', 'start time', 'starttime'],
  file: ['file', 'filename', 'file name', 'name', 'model', 'job', 'task', 'print'],
  duration: ['minutes', 'duration', 'print time', 'printtime', 'time', 'duration (min)', 'durationmin', 'dauer'],
  grams: ['grams', 'weight', 'filament (g)', 'filament g', 'weight (g)', 'filament', 'gramm', 'used (g)'],
  result: ['result', 'status', 'state', 'success'],
  material: ['material', 'filament type', 'type'],
};

export function parseCsv(text: string): ImportParse {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('The CSV needs a header row and at least one print.');
  const delimiter = [';', '\t', ','].map((d) => [d, lines[0]!.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const header = splitCsv(lines[0]!, delimiter).map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const c = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, col(names)])) as Record<keyof typeof COLUMNS, number>;
  if (c.end < 0 && c.start < 0) throw new Error(`The CSV needs a date column (e.g. "date" or "finished"). Found: ${header.join(', ')}`);
  const prints: ImportedPrint[] = [];
  const skipped: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsv(line, delimiter);
    const get = (index: number) => (index >= 0 ? (cells[index] ?? '').trim() : '');
    const start = parseDate(get(c.start));
    const duration = parseDurationCell(get(c.duration));
    const end = parseDate(get(c.end)) ?? (start && duration !== null ? new Date(start.getTime() + duration * 60_000) : null);
    if (!end) {
      skipped.push(`Row ${i + 2}: no readable date`);
      return;
    }
    const file = get(c.file) || 'Print';
    const grams = parseNumber(get(c.grams));
    const material = materialIn(get(c.material)) ?? materialIn(file);
    prints.push({
      key: `csv-${end.toISOString()}-${file}`,
      file,
      startedAt: start?.toISOString() ?? (duration !== null ? new Date(end.getTime() - duration * 60_000).toISOString() : null),
      finishedAt: end.toISOString(),
      durationMin: duration ?? (start ? Math.round((end.getTime() - start.getTime()) / 60_000) : 0),
      result: parseResult(get(c.result)),
      ...(grams !== null && grams > 0 ? { grams } : {}),
      ...(material ? { material } : {}),
    });
  });
  return { source: 'csv', prints: sortByEnd(prints), skipped };
}

function splitCsv(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') (cur += '"'), i++;
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) (out.push(cur), (cur = ''));
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** ISO dates, "2026-10-03 12:52", German "03.10.2026 12:52", or Unix seconds. */
function parseDate(s: string): Date | null {
  if (!s) return null;
  if (/^\d{9,11}(\.\d+)?$/.test(s)) return new Date(Number(s) * 1000);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (de) return new Date(Number(de[3]), Number(de[2]) - 1, Number(de[1]), Number(de[4] ?? 12), Number(de[5] ?? 0), Number(de[6] ?? 0));
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s.replace(' ', 'T');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Minutes from "245", "4:05", "4h5m" or "4.08 h". */
function parseDurationCell(s: string): number | null {
  if (!s) return null;
  const hm = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]) + Math.round(Number(hm[3] ?? 0) / 60);
  const parts = /^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/i.exec(s.replace(/\s+/g, ''));
  if (parts && (parts[1] || parts[2] || parts[3])) return Number(parts[1] ?? 0) * 1440 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
  const hours = /^([\d.,]+)\s*h$/i.exec(s);
  if (hours) return Math.round(Number(hours[1]!.replace(',', '.')) * 60);
  const n = parseNumber(s);
  return n === null ? null : Math.round(n);
}

function parseNumber(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseResult(s: string): PrintJob['result'] {
  const v = s.toLowerCase();
  if (!v || /^(success|successful|completed|complete|finish|finished|done|ok|true|yes|1)$/.test(v)) return 'success';
  if (/cancel|abort|stopp?ed/.test(v)) return 'cancelled';
  return 'failed';
}

// --- Into the print log -------------------------------------------------------------

export interface ImportPlan {
  jobs: PrintJob[];
  /** Prints that are already in the log (imported before or logged by hand). */
  duplicates: ImportedPrint[];
}

/**
 * Print log entries for imported prints. The model name comes from the file name;
 * the filament (grams and material, color unknown) counts in the statistics and
 * can be assigned to a filament later. Prints already in the log are left out:
 * the same import key, or the same date and name with a print time within 2 minutes.
 */
export function planImport(
  doc: AppDocument,
  prints: readonly ImportedPrint[],
  opts: { printerId: Id; localDate: (iso: string) => IsoDate; note: string },
): ImportPlan {
  const ids = new Set(doc.printJobs.map((j) => j.id));
  const logged = doc.printJobs.map((j) => ({ date: j.date, name: j.name, min: j.printTimeMin }));
  const jobs: PrintJob[] = [];
  const duplicates: ImportedPrint[] = [];
  for (const p of prints) {
    const id = `import-${p.key}`;
    const date = opts.localDate(p.finishedAt);
    const info = parseFileName(p.file);
    const name = info.base || printName(p.file);
    if (ids.has(id) || ids.has(p.key) || logged.some((l) => l.date === date && l.name === name && Math.abs(l.min - p.durationMin) <= 2)) {
      duplicates.push(p);
      continue;
    }
    ids.add(id);
    const grams = p.grams ?? (p.result === 'success' ? info.grams : undefined);
    const material = p.material ?? materialIn(p.file);
    jobs.push({
      id,
      date,
      printerId: opts.printerId,
      name,
      printTimeMin: p.durationMin,
      result: p.result,
      filaments: [],
      ...(grams ? { untrackedFilament: { grams, ...(material ? { material } : {}) } } : {}),
      note: `${opts.note} · file ${printName(p.file)}`,
    });
  }
  return { jobs, duplicates };
}

function densityOf(material: BaseMaterial | undefined): number {
  return DEFAULT_DENSITY[material ?? 'PLA'] ?? 1.24;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sortByEnd(prints: ImportedPrint[]): ImportedPrint[] {
  return prints.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
}
