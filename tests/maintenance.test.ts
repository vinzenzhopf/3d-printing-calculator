import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { maintenanceStatus, markDone } from '../src/core/maintenance';
import type { AppDocument } from '../src/core/model';

function doc(): AppDocument {
  const d = createEmptyDocument();
  d.printers.push({
    id: 'mk3', name: 'MK3S+', technology: 'FDM', status: 'active', toolheads: 1, toolType: 'single',
    purgeWastePerPlateG: 10, purgePerFilamentChangeG: null, firstHourPhaseMin: 60, powerProfiles: {},
    usageStats: [{ source: 'LCD', asOf: '2026-10-01', since: null, printHours: 10245 }],
    maintenance: [
      { id: 'lube', task: 'Lubricate rods', everyHours: 200, lastDoneHours: 10100 },
      { id: 'nozzle', task: 'Replace nozzle', everyHours: 500, lastDoneHours: 9700 },
      { id: 'belts', task: 'Check belts', everyHours: 300, lastDoneHours: null },
    ],
  });
  d.printJobs.push({ id: 'j', date: '2026-10-02', printerId: 'mk3', name: 'x', printTimeMin: 600, result: 'success', filaments: [] });
  return d;
}

describe('maintenance', () => {
  it('counts down by print hours incl. logged prints, never-recorded first', () => {
    expect(maintenanceStatus(doc()).map((r) => [r.taskId, r.dueInHours])).toEqual([
      ['belts', null],
      ['nozzle', -55], // 9700 + 500 − 10255
      ['lube', 45], // 10100 + 200 − 10255
    ]);
  });

  it('marks a task done at the current hour counter', () => {
    const d = doc();
    const p = d.printers[0]!;
    markDone(d, p, p.maintenance![1]!, '2026-10-02');
    expect(p.maintenance![1]).toMatchObject({ lastDoneHours: 10255, lastDoneDate: '2026-10-02' });
    expect(maintenanceStatus(d).find((r) => r.taskId === 'nozzle')?.dueInHours).toBe(500);
  });

  it('ignores retired printers', () => {
    const d = doc();
    d.printers[0]!.status = 'retired';
    expect(maintenanceStatus(d)).toEqual([]);
  });
});
