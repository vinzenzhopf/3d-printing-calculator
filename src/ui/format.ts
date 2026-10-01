import type { IsoDate } from '../core/model';

/** Local calendar date (not UTC, which is a day off around midnight). */
export function today(): IsoDate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newId(): string {
  return crypto.randomUUID();
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function money(value: number | null | undefined, currency: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const key = `${currency}/${digits}`;
  let fmt = moneyFormats.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    moneyFormats.set(key, fmt);
  }
  return fmt.format(value);
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function percent(value: number, digits = 0): string {
  return `${num(value * 100, digits)} %`;
}
