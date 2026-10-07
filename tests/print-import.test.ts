import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { materialIn, parseImport, planImport } from '../src/core/print-import';

const localDate = (iso: string) => iso.slice(0, 10);

describe('parseImport', () => {
  it('reads OctoPrint metadata: one print per history entry, grams from the analysed volume', () => {
    const meta = {
      'hit-turm_0.6n_0.3mm_PLA_MK3S_4h31m.gcode': {
        history: [
          { timestamp: 1786000000, printTime: 16200, success: true },
          { timestamp: 1786100000, success: false },
        ],
        analysis: { filament: { tool0: { length: 37000, volume: 90 } } },
      },
      'empty.gcode': { analysis: {} },
    };
    const r = parseImport(JSON.stringify(meta));
    expect(r.source).toBe('octoprint');
    expect(r.prints).toHaveLength(2);
    expect(r.prints[0]).toMatchObject({ key: 'octoprint-1786000000', durationMin: 270, result: 'success', grams: 111.6, material: 'PLA' });
    expect(r.prints[1]).toMatchObject({ result: 'cancelled', durationMin: 0 });
    expect(r.prints[1]!.grams).toBeUndefined();
  });

  it('reads Moonraker history with weight or filament length', () => {
    const history = { result: { count: 3, jobs: [
      { job_id: '0001', filename: 'bracket.gcode', status: 'completed', start_time: 1786000000, end_time: 1786007200, print_duration: 7000, filament_used: 10000, metadata: { filament_type: 'PETG' } },
      { job_id: '0002', filename: 'cube.gcode', status: 'cancelled', end_time: 1786100000, print_duration: 600, filament_used: 300, metadata: { filament_weight_total: 1.2 } },
      { job_id: '0003', filename: 'now.gcode', status: 'in_progress', start_time: 1786200000 },
    ] } };
    const r = parseImport(JSON.stringify(history));
    expect(r.source).toBe('moonraker');
    expect(r.prints.map((p) => [p.key, p.result, p.durationMin, p.material])).toEqual([
      ['moonraker-0001', 'success', 117, 'PETG'],
      ['moonraker-0002', 'cancelled', 10, undefined],
    ]);
    expect(r.prints[0]!.grams).toBe(30.5); // 10 m PETG at 1.75 mm = 24.05 cm³ × 1.27
    expect(r.prints[1]!.grams).toBe(1.2);
    expect(r.skipped).toHaveLength(1);
  });

  it('reads a CSV with flexible columns, delimiters and formats', () => {
    const csv = [
      'Date;Name;Print time;Weight (g);Status;Material',
      '03.10.2026 12:52;Funnel;1:59;54,1;finished;PLA',
      '2026-10-04T22:40:00;"Tower; base";4h12m;;cancelled;',
      ';no date;10;;;',
    ].join('\n');
    const r = parseImport(csv);
    expect(r.source).toBe('csv');
    expect(r.prints.map((p) => [p.file, p.durationMin, p.grams, p.result, p.material])).toEqual([
      ['Funnel', 119, 54.1, 'success', 'PLA'],
      ['Tower; base', 252, undefined, 'cancelled', undefined],
    ]);
    expect(r.skipped).toEqual(['Row 4: no readable date']);
  });

  it('rejects unknown formats', () => {
    expect(() => parseImport('{"foo": 1}')).toThrow(/Unknown JSON format/);
    expect(() => parseImport('just one line')).toThrow(/header row/);
    expect(materialIn('x_ASA_MK3S')).toBe('ASA');
  });
});

describe('planImport', () => {
  it('creates log entries with untracked filament and skips prints already in the log', () => {
    const doc = createEmptyDocument();
    doc.printJobs.push(
      { id: 'octoprint-1786000000', date: '2026-08-06', printerId: 'p', name: 'old', printTimeMin: 10, result: 'success', filaments: [] },
      { id: 'manual', date: '2026-08-07', printerId: 'p', name: 'cube', printTimeMin: 61, result: 'success', filaments: [] },
    );
    const prints = [
      { key: 'octoprint-1786000000', file: 'old.gcode', startedAt: null, finishedAt: '2026-08-06T10:00:00Z', durationMin: 10, result: 'success' as const },
      { key: 'csv-b', file: 'cube_0.6n_0.3mm_PLA_MK3S_1h0m_20.5g.gcode', startedAt: null, finishedAt: '2026-08-07T10:00:00Z', durationMin: 60, result: 'success' as const },
      { key: 'csv-c', file: 'cube_0.6n_0.3mm_PLA_MK3S_1h0m_20.5g.gcode', startedAt: null, finishedAt: '2026-08-08T10:00:00Z', durationMin: 60, result: 'success' as const },
      { key: 'csv-d', file: 'gear.gcode', startedAt: null, finishedAt: '2026-08-09T10:00:00Z', durationMin: 30, result: 'failed' as const, grams: 4, material: 'PETG' as const },
    ];
    const plan = planImport(doc, prints, { printerId: 'p', localDate, note: 'Imported' });
    expect(plan.duplicates.map((p) => p.key)).toEqual(['octoprint-1786000000', 'csv-b']);
    expect(plan.jobs.map((j) => [j.id, j.name, j.untrackedFilament])).toEqual([
      ['import-csv-c', 'cube', { grams: 20.5, material: 'PLA' }],
      ['import-csv-d', 'gear', { grams: 4, material: 'PETG' }],
    ]);
  });
});
