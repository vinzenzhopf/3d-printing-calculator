import { describe, expect, it } from 'vitest';
import { parseFileName } from '../src/core/filename';

describe('parseFileName', () => {
  it('reads the owner\'s PrusaSlicer template', () => {
    expect(parseFileName('hit-turm-handy_0.6n_0.3mm_PLA_MK3S_4h31m_110.526g.gcode')).toEqual({
      base: 'hit-turm-handy', nozzleMm: 0.6, layerMm: 0.3, extras: ['PLA', 'MK3S'], estimatedMin: 271, grams: 110.526,
    });
  });

  it('works without grams (older files) and with "_" in the model name', () => {
    expect(parseFileName('flexi_75_segment_0.6n_0.3mm_PLA_MK3S_4h17m.gcode')).toEqual({
      base: 'flexi_75_segment', nozzleMm: 0.6, layerMm: 0.3, extras: ['PLA', 'MK3S'], estimatedMin: 257,
    });
  });

  it('handles other orders, days and seconds, binary G-code and folders', () => {
    expect(parseFileName('jobs/vase_1d2h3m_PETG_0.2mm_35g.bgcode')).toMatchObject({
      base: 'vase', estimatedMin: 1563, layerMm: 0.2, grams: 35,
    });
  });

  it('keeps plain names as they are', () => {
    expect(parseFileName('test_cube.gcode')).toEqual({ base: 'test_cube', extras: [] });
  });
});
