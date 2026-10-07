import { describe, expect, it } from 'vitest';
import { createDemoDocument, isEmptyDocument } from '../src/core/demo';
import { createEmptyDocument } from '../src/core/document';
import { findDanglingReferences, loadDocument } from '../src/core/migrations';
import { calculateQuote } from '../src/core/calc/quote';
import { remainingG } from '../src/core/stock';
import { totals } from '../src/core/statistics';

const today = '2026-10-07';

describe('demo data', () => {
  const doc = createDemoDocument(today, new Date('2026-10-07T10:00:00Z'));

  it('is a complete, consistent document marked as demo', () => {
    expect(doc.settings.demo).toBe(true);
    expect(findDanglingReferences(doc)).toEqual([]);
    expect(loadDocument(JSON.parse(JSON.stringify(doc))).doc.printJobs.length).toBe(doc.printJobs.length);
    expect(isEmptyDocument(doc)).toBe(false);
    expect(isEmptyDocument(createEmptyDocument())).toBe(true);
  });

  it('is deterministic', () => {
    expect(createDemoDocument(today, new Date('2026-10-07T10:00:00Z'))).toEqual(doc);
  });

  it('has a year of prints, stock and quotes that calculate', () => {
    const t = totals(doc, '2025-10-07');
    expect(t.prints).toBeGreaterThan(100);
    expect(t.spent).toBeGreaterThan(0);
    expect(doc.printJobs.every((j) => j.date <= today && j.date >= '2025-10-07')).toBe(true);
    expect(doc.spools.some((s) => s.status === 'open' && (remainingG(s) ?? 0) > 0)).toBe(true);
    expect(new Set(doc.spools.map((s) => s.label)).size).toBe(doc.spools.length);
    for (const q of doc.quotes) expect(calculateQuote(doc, q, today).net).toBeGreaterThan(0);
    expect(doc.quotes.filter((q) => q.status !== 'draft').every((q) => q.snapshot)).toBe(true);
  });
});
