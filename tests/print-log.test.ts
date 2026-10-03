import { describe, expect, it } from 'vitest';
import { printerHours } from '../src/core/calc/machine-rate';
import { createEmptyDocument } from '../src/core/document';
import type { AppDocument, Plate, Printer, PrintJob, Spool } from '../src/core/model';
import { addJob, jobFromPlate, jobStats, removeJob, replaceJob, suggestSpool } from '../src/core/print-log';
import { remainingG, toBuyList } from '../src/core/stock';

const date = '2026-10-02';
let n = 0;
const id = () => `id${n++}`;

const printer: Printer = {
  id: 'mk3', name: 'MK3S+', technology: 'FDM', status: 'active', toolheads: 1, toolType: 'single',
  purgeWastePerPlateG: 10, purgePerFilamentChangeG: 2, firstHourPhaseMin: 60, powerProfiles: {},
  usageStats: [{ source: 'LCD', asOf: '2026-10-01', since: null, printHours: 10000 }],
};

function spool(sid: string, filamentId: string, status: Spool['status'], grams: number | null): Spool {
  return {
    id: sid, filamentId, label: sid, nominalG: 1000, spoolType: 'plastic', status,
    movements: grams === null ? [] : [{ id: id(), date, kind: 'initial', grams }],
  };
}

function doc(): AppDocument {
  const d = createEmptyDocument();
  d.printers.push(printer);
  d.spools.push(spool('full', 'black', 'sealed', 1000), spool('half', 'black', 'open', 400), spool('low', 'black', 'open', 120), spool('w', 'white', 'sealed', 1000));
  return d;
}

const plate: Plate = {
  id: 'pl', name: 'Bins', printerId: 'mk3', printTimeMin: 300, runs: 4,
  filaments: [{ filamentId: 'black', weightG: 150 }, { filamentId: 'white', weightG: 50 }],
  filamentChanges: 5,
};

describe('print log', () => {
  it('suggests the open spool with the least left, else a sealed one', () => {
    expect(suggestSpool(doc(), 'black')).toBe('low');
    expect(suggestSpool(doc(), 'white')).toBe('w');
    expect(suggestSpool(doc(), 'none')).toBeUndefined();
  });

  it('builds one run from a quote plate, incl. waste split by weight', () => {
    const job = jobFromPlate(doc(), plate, { id: 'j', date, quoteId: 'q' });
    // waste = 10 g per run + 5 changes × 2 g = 20 g, split 75/25
    expect(job.filaments).toEqual([
      { filamentId: 'black', grams: 165, spoolId: 'low' },
      { filamentId: 'white', grams: 55, spoolId: 'w' },
    ]);
    expect(job).toMatchObject({ printerId: 'mk3', printTimeMin: 300, quoteId: 'q', plateId: 'pl', result: 'success' });
  });

  it('books filament on the spools and removes it again with the job', () => {
    const d = doc();
    const job = jobFromPlate(d, plate, { id: 'j', date });
    addJob(d, job, id);
    expect(remainingG(d.spools.find((s) => s.id === 'low')!)).toBe(120 - 165);
    const white = d.spools.find((s) => s.id === 'w')!;
    expect(remainingG(white)).toBe(945);
    expect(white.status).toBe('open');

    removeJob(d, 'j');
    expect(d.printJobs).toEqual([]);
    expect(remainingG(d.spools.find((s) => s.id === 'low')!)).toBe(120);
  });

  it('re-books stock when a logged job is edited', () => {
    const d = doc();
    const job = jobFromPlate(d, plate, { id: 'j', date });
    addJob(d, job, id);
    // Corrected: only 100 g black, and from the "half" spool instead of "low".
    replaceJob(d, { ...job, result: 'failed', filaments: [{ filamentId: 'black', grams: 100, spoolId: 'half' }] }, id);
    expect(d.printJobs).toHaveLength(1);
    expect(d.printJobs[0]!.result).toBe('failed');
    expect(remainingG(d.spools.find((s) => s.id === 'low')!)).toBe(120);
    expect(remainingG(d.spools.find((s) => s.id === 'half')!)).toBe(300);
    expect(remainingG(d.spools.find((s) => s.id === 'w')!)).toBe(1000);
  });

  it('measures the failure rate by print time', () => {
    const jobs = [
      { printTimeMin: 540, result: 'success' },
      { printTimeMin: 60, result: 'failed' },
    ].map((j, i) => ({ id: `${i}`, date, printerId: 'mk3', name: 'x', filaments: [{ filamentId: 'black', grams: 10 }], ...j }) as PrintJob);
    expect(jobStats(jobs)).toEqual({ jobs: 2, hours: 10, lostHours: 1, failureRate: 0.1, filamentG: 20 });
  });

  it('adds logged hours after the last lifetime counter reading', () => {
    const jobs = [
      { id: 'a', date: '2026-09-30', printerId: 'mk3', name: 'old', printTimeMin: 600, result: 'success', filaments: [] },
      { id: 'b', date: '2026-10-02', printerId: 'mk3', name: 'new', printTimeMin: 120, result: 'success', filaments: [] },
    ] as PrintJob[];
    expect(printerHours(printer, jobs).lifetimeHours).toBe(10002);
  });
});

describe('toBuyList', () => {
  it('lists owned filaments below their threshold, most urgent first', () => {
    const d = doc();
    d.filaments.push(
      { id: 'black', productLineId: 'l', color: 'Black', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned', lowStockG: 2000 },
      { id: 'white', productLineId: 'l', color: 'White', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned', lowStockG: 1500 },
      { id: 'red', productLineId: 'l', color: 'Red', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned', lowStockG: 500 },
    );
    d.spools.push(spool('unknown', 'red', 'open', null));
    const list = toBuyList(d);
    expect(list.map((x) => x.filamentId)).toEqual(['red', 'white', 'black']);
    expect(list[0]).toMatchObject({ stockG: 0, hasUnknown: true });
  });
});
