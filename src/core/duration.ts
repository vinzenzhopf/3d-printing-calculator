/**
 * Parses a print duration into minutes. Accepts what slicers and humans write:
 * `7:23`, `31:05` (> 24 h), `7h23m`, `7h`, `45m`, `1d 2h 5m`, or plain minutes `443`.
 * Returns null for anything else.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (s === '') return null;

  const colon = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(s);
  if (colon) {
    const [, h, m, sec] = colon;
    return Number(h) * 60 + Number(m) + Math.round(Number(sec ?? 0) / 60);
  }

  if (/^\d+$/.test(s)) return Number(s);

  const units = /^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/.exec(s);
  if (units && (units[1] || units[2] || units[3])) {
    const [, d, h, m] = units;
    return Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0);
  }
  return null;
}

/** Formats minutes as `h:mm`, e.g. 443 -> `7:23`, 1865 -> `31:05`. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
