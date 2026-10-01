import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { DocumentError, loadDocument } from '../src/core/migrations';
import { SCHEMA_VERSION } from '../src/core/model';
import { parseDocument, serializeDocument } from '../src/core/transfer';

describe('loadDocument', () => {
  it.each([null, 42, 'text', [], {}])('rejects %j', (input) => {
    expect(() => loadDocument(input)).toThrow(DocumentError);
  });

  it('rejects documents from a newer app version', () => {
    expect(() => loadDocument({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer app version/);
  });

  it('rejects a collection that is not a list', () => {
    expect(() => loadDocument({ schemaVersion: 1, quotes: {} })).toThrow(/"quotes" must be a list/);
  });

  it('fills missing collections, settings and pricing profiles with defaults', () => {
    const { doc, warnings } = loadDocument({ schemaVersion: 1, settings: { hourlyRate: 20, vat: { enabled: true } } });
    const defaults = createEmptyDocument();
    expect(doc.quotes).toEqual([]);
    expect(doc.pricingProfiles).toEqual(defaults.pricingProfiles);
    expect(doc.settings.hourlyRate).toBe(20);
    expect(doc.settings.energyPricePerKwh).toBe(defaults.settings.energyPricePerKwh);
    expect(doc.settings.vat).toEqual({ ...defaults.settings.vat, enabled: true });
    expect(warnings).toEqual([]);
  });

  it('warns about references to missing entities', () => {
    const { warnings } = loadDocument({
      schemaVersion: 1,
      purchases: [{ id: 'p1', filamentId: 'nope' }],
    });
    expect(warnings).toEqual(['Purchase p1: unknown filament nope']);
  });
});

describe('export / import', () => {
  it('round-trips a document losslessly', () => {
    const doc = createEmptyDocument();
    doc.settings.business.name = 'Print shop';
    doc.customers.push({ id: 'c1', name: 'Alex', tag: 'AX', discountPercent: 10 });
    expect(parseDocument(serializeDocument(doc)).doc).toEqual(doc);
  });

  it('reports invalid JSON as a DocumentError', () => {
    expect(() => parseDocument('{nope')).toThrow(DocumentError);
  });

  // Private data (git-ignored): only runs where tools/extract_excel.py was executed.
  const seed = 'data/seed/document.json';
  it.skipIf(!existsSync(seed))('imports the Excel seed document without warnings', () => {
    const { doc, warnings } = parseDocument(readFileSync(seed, 'utf8'));
    expect(warnings).toEqual([]);
    expect(doc.filaments.length).toBeGreaterThan(0);
    expect(parseDocument(serializeDocument(doc)).doc).toEqual(doc);
  });
});
