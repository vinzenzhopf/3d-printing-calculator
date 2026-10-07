import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { jobFromInbox, jobFromInboxAsIs, parseInboxEntry, printName } from '../src/core/inbox';
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
    expect(job).toMatchObject({ id: 'j', date: '2026-10-03', printerId: 'mk3', name: 'flexi_75_segment', printTimeMin: 260, result: 'cancelled', filaments: [] });
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

describe('jobFromInbox with grams in the file name', () => {
  const withGrams = 'hit-turm-handy_0.6n_0.3mm_PLA_MK3S_4h31m_110.526g.gcode';

  it('uses the model name and pre-fills a filament row with the slicer grams', () => {
    const job = jobFromInbox(doc(), parseInboxEntry('p', { ...raw, file: withGrams, durationMin: 275 })!, { id: 'j', localDate });
    expect(job).toMatchObject({ name: 'hit-turm-handy', printTimeMin: 275, filaments: [{ filamentId: '', grams: 110.526 }] });
    expect(job.note).toContain('slicer estimate 4h31m');
    expect(job.note).toContain('110.526 g');
  });

  it('matches a quote plate by model name and takes the file grams over the plate grams', () => {
    const d = doc();
    d.quotes.push({
      id: 'q', number: 4, title: 'Tower', pricingProfileId: 'standard', status: 'accepted',
      plates: [{ id: 'pl', name: 'hit-turm-handy_0.4n_0.2mm_PLA_MK3S_6h02m_101.2g', printerId: 'mk3', printTimeMin: 362, runs: 1, filaments: [{ filamentId: 'black', weightG: 101.2 }] }],
    });
    const job = jobFromInbox(d, parseInboxEntry('p', { ...raw, file: withGrams })!, { id: 'j', localDate });
    expect(job).toMatchObject({ quoteId: 'q', plateId: 'pl', filaments: [{ filamentId: 'black', grams: 110.526 }] });
  });
});

describe('printName', () => {
  it('strips folders and slicer extensions', () => {
    expect(printName('folder/part.gcode.3mf')).toBe('part');
    expect(printName('part.bgcode')).toBe('part');
  });
});

describe('grams from the source and "Add all"', () => {
  const bambu = { ...raw, source: 'home-assistant/bambulab', printer: 'a1', file: 'Lamp shade.3mf', grams: 87.46, material: 'petg' };

  it('reads optional grams and material', () => {
    expect(parseInboxEntry('b', bambu)).toMatchObject({ grams: 87.5, material: 'PETG' });
    expect(parseInboxEntry('b', { ...bambu, grams: 0, material: 'wood' })).not.toHaveProperty('grams');
  });

  it('uses the source grams when the file name has none, and keeps them as unknown color for "Add all"', () => {
    const entry = parseInboxEntry('b', bambu)!;
    expect(jobFromInbox(doc(), entry, { id: 'j', localDate }).filaments).toEqual([{ filamentId: '', grams: 87.5 }]);
    const job = jobFromInboxAsIs(doc(), entry, { id: 'j', localDate });
    expect(job.filaments).toEqual([]);
    expect(job.untrackedFilament).toEqual({ grams: 87.5, material: 'PETG' });
    // Without any grams there is nothing to keep.
    expect(jobFromInboxAsIs(doc(), parseInboxEntry('p', raw)!, { id: 'j', localDate }).untrackedFilament).toBeUndefined();
  });
});
