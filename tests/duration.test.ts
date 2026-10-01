import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../src/core/duration';

describe('parseDuration', () => {
  it.each([
    ['7:23', 443],
    ['31:05', 1865],
    ['7:23:40', 444],
    ['7h23m', 443],
    ['7h 23min', 443],
    ['7h', 420],
    ['45m', 45],
    ['1d 2h 5m', 1565],
    ['443', 443],
    [' 7:23 ', 443],
  ])('%s -> %i min', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'abc', '7:75', '7.5h'])('rejects %j', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats hours over 24 without wrapping', () => {
    expect(formatDuration(1865)).toBe('31:05');
    expect(formatDuration(5)).toBe('0:05');
  });
});
