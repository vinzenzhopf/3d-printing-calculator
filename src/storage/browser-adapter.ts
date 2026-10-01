import { openDB, type IDBPDatabase } from 'idb';
import type { AppDocument } from '../core/model';
import type { SaveResult, StorageAdapter, StoredDocument } from './adapter';

const DB_NAME = '3d-printing-calculator';
const STORE = 'documents';
const KEY = 'main';

interface Row {
  doc: AppDocument;
  revision: number;
}

/** Local working copy in IndexedDB. Always active, also when a remote adapter syncs. */
export class BrowserAdapter implements StorageAdapter {
  readonly id = 'browser';
  #db: Promise<IDBPDatabase>;

  constructor(dbName = DB_NAME) {
    this.#db = openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore(STORE);
      },
    });
  }

  async load(): Promise<StoredDocument | null> {
    const row = (await (await this.#db).get(STORE, KEY)) as Row | undefined;
    return row ? { doc: row.doc, version: String(row.revision) } : null;
  }

  async save(doc: AppDocument, expectedVersion: string | null): Promise<SaveResult> {
    // One readwrite transaction makes check-and-write atomic across tabs.
    const tx = (await this.#db).transaction(STORE, 'readwrite');
    const current = (await tx.store.get(KEY)) as Row | undefined;
    const currentVersion = current ? String(current.revision) : null;
    if (currentVersion !== expectedVersion) {
      await tx.done;
      return { ok: false, conflict: { doc: current!.doc, version: currentVersion! } };
    }
    const revision = (current?.revision ?? 0) + 1;
    await tx.store.put({ doc, revision } satisfies Row, KEY);
    await tx.done;
    return { ok: true, version: String(revision) };
  }

  /** Ask the browser not to evict our data under storage pressure (Firefox prompts once). */
  static async requestPersistence(): Promise<boolean> {
    return (await navigator.storage?.persist?.()) ?? false;
  }
}
