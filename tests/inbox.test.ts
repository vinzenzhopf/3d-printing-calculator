import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { jobFromInbox, parseInboxEntry, printName } from '../src/core/inbox';
import type { AppDocument } from '../src/core/model';

const file = 'flexi_75_segment_0.6n_0.3mm_PLA_MK3S_4h17m.gcode';
const raw = {
  version: 1, source: 'octoprint', printer: 'mk3s', file,
  startedAt: '2026-10-03T08:00:00+02:00', finishedAt: '2026-10-03T12:20:00+02:00', durationMin: 260, result: 'success',
};
const localDate = (iso: string) => iso.slice(0, 10);

function doc(): AppDocument {
  const d = createEmptyDocument();
  const printer = { technology: 'FDM' as const, toolheads: 1, toolType: 'single' as const, purgeWastePerPlateG: 10, purgePerFilamentChangeG: null, firstHourPhaseMin: 60, powerProfiles: {} };
  d.printers.push({ ...printer, id: 'core', name: 'CORE One', status: 'active', inboxKey: 'coreone' }, { ...printer, id: 'mk3', name: 'MK3S+', status: 'active', inboxKey: 'MK3S' });
  return d;
}

describe('parseInboxEntry', () => {
  it('reads a Home Assistant inbox file', () => {
    expect(parseInboxEntry('print-inbox/a.json', raw)).toEqual({
      path: 'print-inbox/a.json', printer: 'mk3s', file, startedAt: raw.startedAt, finishedAt: raw.finishedAt, durationMin: 260, result: 'success',
    });
  });

  it('derives the duration from start/end and defaults unknown results to success', () => {
    const e = parseInboxEntry('x', { ...raw, durationMin: 'n/a', result: 'weird' })!;
    expect(e.durationMin).toBe(260);
    expect(e.result).toBe('success');
  });

  it.each([null, 'text', { ...raw, version: 2 }, { ...raw, finishedAt: 'never' }])('rejects %j', (input) => {
    expect(parseInboxEntry('x', input)).toBeNull();
  });
});

describe('jobFromInbox', () => {
  it('maps the printer by its inbox key (case-insensitive) and pre-fills time and result', () => {
    const job = jobFromInbox(doc(), parseInboxEntry('p', { ...raw, result: 'cancelled' })!, { id: 'j', localDate });
    expect(job).toMatchObject({ id: 'j', date: '2026-10-03', printerId: 'mk3', name: printName(file), printTimeMin: 260, result: 'cancelled', filaments: [] });
  });

  it('falls back to the first active printer for unknown keys', () => {
    expect(jobFromInbox(doc(), parseInboxEntry('p', { ...raw, printer: 'other' })!, { id: 'j', localDate }).printerId).toBe('core');
  });

  it('takes filaments and the quote link from a quote plate named like the file', () => {
    const d = doc();
    d.quotes.push({
      id: 'q', number: 3, title: 'Flexi', pricingProfileId: 'standard', status: 'accepted',
      plates: [{ id: 'pl', name: printName(file), printerId: 'mk3', printTimeMin: 257, runs: 2, filaments: [{ filamentId: 'black', weightG: 80 }] }],
    });
    const job = jobFromInbox(d, parseInboxEntry('p', raw)!, { id: 'j', localDate });
    expect(job).toMatchObject({ quoteId: 'q', plateId: 'pl', printTimeMin: 260, filaments: [{ filamentId: 'black', grams: 90 }] });
  });
});

describe('printName', () => {
  it('strips folders and slicer extensions', () => {
    expect(printName('folder/part.gcode.3mf')).toBe('part');
    expect(printName('part.bgcode')).toBe('part');
  });
});
