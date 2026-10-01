import { DocumentError, loadDocument, type LoadedDocument } from './migrations';
import type { AppDocument } from './model';

/** Export format: the AppDocument as pretty-printed JSON (diff-friendly in a git repo). */
export function serializeDocument(doc: AppDocument): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

export function parseDocument(text: string): LoadedDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DocumentError('The file is not valid JSON.');
  }
  return loadDocument(parsed);
}

export function exportFileName(now = new Date()): string {
  return `3d-printing-calculator-${now.toISOString().slice(0, 10)}.json`;
}

export interface DocumentSummary {
  quotes: number;
  filaments: number;
  purchases: number;
  printers: number;
  customers: number;
  updatedAt: string;
}

export function summarize(doc: AppDocument): DocumentSummary {
  return {
    quotes: doc.quotes.length,
    filaments: doc.filaments.length,
    purchases: doc.purchases.length,
    printers: doc.printers.length,
    customers: doc.customers.length,
    updatedAt: doc.updatedAt,
  };
}
