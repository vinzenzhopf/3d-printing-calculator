import type { AppDocument } from '../core/model';

/**
 * A storage backend holds exactly one AppDocument plus an opaque version
 * (IndexedDB revision, GitHub blob sha, WebDAV ETag, ...). Saving is
 * optimistic: it only succeeds if the stored version is still the one the
 * caller loaded; otherwise the newer stored document comes back as a conflict.
 */
export interface StoredDocument {
  doc: AppDocument;
  version: string;
}

export type SaveResult = { ok: true; version: string } | { ok: false; conflict: StoredDocument };

export interface StorageAdapter {
  /** Stable id, e.g. "browser", "github". */
  readonly id: string;
  /** null when nothing has been stored yet. */
  load(): Promise<StoredDocument | null>;
  /** expectedVersion null = "create; fail if something already exists". */
  save(doc: AppDocument, expectedVersion: string | null): Promise<SaveResult>;
}
