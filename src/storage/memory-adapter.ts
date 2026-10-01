import type { AppDocument } from '../core/model';
import type { SaveResult, StorageAdapter, StoredDocument } from './adapter';

/** In-memory adapter for tests and as a reference implementation of the contract. */
export class MemoryAdapter implements StorageAdapter {
  readonly id = 'memory';
  #stored: StoredDocument | null = null;

  async load(): Promise<StoredDocument | null> {
    return this.#stored ? structuredClone(this.#stored) : null;
  }

  async save(doc: AppDocument, expectedVersion: string | null): Promise<SaveResult> {
    const currentVersion = this.#stored?.version ?? null;
    if (currentVersion !== expectedVersion) {
      return { ok: false, conflict: structuredClone(this.#stored!) };
    }
    const version = String(Number(currentVersion ?? 0) + 1);
    this.#stored = { doc: structuredClone(doc), version };
    return { ok: true, version };
  }
}
