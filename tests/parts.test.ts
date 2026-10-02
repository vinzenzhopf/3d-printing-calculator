import { describe, expect, it } from 'vitest';
import type { Quote } from '../src/core/model';
import { partsPerRun, planParts } from '../src/core/parts';

const plate = (id: string, runs: number, parts: [string, number][]) => ({
  id, name: id, printerId: 'p', printTimeMin: 60, runs, filaments: [], parts: parts.map(([name, quantity]) => ({ name, quantity })),
});

describe('part planner', () => {
  it('reproduces the Gridfinity planner from the Excel sheet #5', () => {
    const quote: Quote = {
      id: 'q', number: 5, title: 'GF', pricingProfileId: 'x', status: 'draft',
      requiredParts: [['1x1', 15], ['1x2', 10], ['1x3', 10], ['1x4', 3], ['2x2', 8], ['2x3', 5]].map(([name, quantity]) => ({ name: name as string, quantity: quantity as number })),
      plates: [
        plate('Print #1', 1, [['1x4', 3], ['2x2', 3], ['2x3', 3]]),
        plate('Print #2', 1, [['1x1', 15], ['1x2', 10], ['1x3', 5], ['2x2', 5], ['2x3', 5]]),
      ],
    };
    expect(planParts(quote)).toEqual([
      { name: '1x1', required: 15, planned: 15, diff: 0 },
      { name: '1x2', required: 10, planned: 10, diff: 0 },
      { name: '1x3', required: 10, planned: 5, diff: -5 },
      { name: '1x4', required: 3, planned: 3, diff: 0 },
      { name: '2x2', required: 8, planned: 8, diff: 0 },
      { name: '2x3', required: 5, planned: 8, diff: 3 },
    ]);
  });

  it('multiplies by runs, matches names loosely and lists unrequested parts', () => {
    const quote: Quote = {
      id: 'q', number: 1, title: 't', pricingProfileId: 'x', status: 'draft',
      requiredParts: [{ name: 'Clip ', quantity: 10 }],
      plates: [plate('a', 4, [['clip', 2], ['Spacer', 1]])],
    };
    expect(planParts(quote)).toEqual([
      { name: 'Clip', required: 10, planned: 8, diff: -2 },
      { name: 'Spacer', required: 0, planned: 4, diff: 4 },
    ]);
  });

  it('counts parts per run from the list, else the simple number', () => {
    expect(partsPerRun(plate('a', 1, [['x', 3], ['y', 2]]))).toBe(5);
    expect(partsPerRun({ ...plate('b', 1, []), partsPerRun: 4 })).toBe(4);
    expect(partsPerRun({ ...plate('c', 1, []), parts: undefined })).toBe(1);
  });
});
