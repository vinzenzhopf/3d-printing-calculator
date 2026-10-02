import { loadDocument } from '../core/migrations';
import type { AppDocument } from '../core/model';
import type { StorageAdapter, StoredDocument } from '../storage/adapter';
import type { AppStore } from './app-store';

/** What both sides looked like after the last successful sync. */
export interface SyncBase {
  remoteVersion: string;
  docUpdatedAt: string;
}

export interface SyncBaseStore {
  get(): SyncBase | null;
  set(base: SyncBase | null): void;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'conflict' | 'error';

export interface SyncConflict {
  remote: StoredDocument;
  remoteDoc: AppDocument;
}

/**
 * Keeps the local working copy (AppStore) and one remote adapter in step (ST-6).
 * Local edits always go to the browser first; sync compares both sides with the
 * state of the last sync: only remote changed → pull, only local changed → push,
 * both changed → conflict for the user to resolve.
 */
export class SyncService extends EventTarget {
  status: SyncStatus = 'idle';
  error: string | null = null;
  lastSyncAt: Date | null = null;
  conflict: SyncConflict | null = null;
  #running: Promise<void> | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly remote: StorageAdapter,
    private readonly base: SyncBaseStore,
  ) {
    super();
  }

  get remoteId(): string {
    return this.remote.id;
  }

  /** True when the local copy has changes that were not synced yet. */
  get hasLocalChanges(): boolean {
    return this.store.doc.updatedAt !== this.base.get()?.docUpdatedAt;
  }

  /** Runs one sync; concurrent calls share the running one. */
  sync(): Promise<void> {
    if (this.status === 'conflict') return Promise.resolve();
    this.#running ??= this.#sync().finally(() => (this.#running = null));
    return this.#running;
  }

  async #sync(): Promise<void> {
    this.#set('syncing');
    try {
      const remote = await this.remote.load();
      const local = this.store.doc;
      const base = this.base.get();
      if (!remote) {
        await this.#push(local, null);
        return;
      }
      const remoteDoc = loadDocument(remote.doc).doc;
      const remoteChanged = !base || remote.version !== base.remoteVersion;
      const localChanged = !base || local.updatedAt !== base.docUpdatedAt;

      if (remoteChanged && localChanged && !sameContent(local, remoteDoc)) {
        this.conflict = { remote, remoteDoc };
        this.#set('conflict');
      } else if (remoteChanged && localChanged) {
        this.#done({ remoteVersion: remote.version, docUpdatedAt: local.updatedAt });
      } else if (remoteChanged) {
        await this.#pull(remote, remoteDoc);
      } else if (localChanged) {
        await this.#push(local, remote.version);
      } else {
        this.#done(base!);
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.#set('error');
    }
  }

  /** Resolve a conflict: keep this device's data, or take the remote copy. */
  async resolve(choice: 'mine' | 'theirs'): Promise<void> {
    const conflict = this.conflict;
    if (!conflict) return;
    this.conflict = null;
    this.#set('syncing');
    try {
      if (choice === 'theirs') await this.#pull(conflict.remote, conflict.remoteDoc);
      else await this.#push(this.store.doc, conflict.remote.version);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.#set('error');
    }
  }

  async #push(local: AppDocument, expectedVersion: string | null): Promise<void> {
    const result = await this.remote.save(local, expectedVersion);
    if (result.ok) {
      this.#done({ remoteVersion: result.version, docUpdatedAt: local.updatedAt });
    } else {
      // Someone saved in between: treat like a fresh comparison.
      this.conflict = { remote: result.conflict, remoteDoc: loadDocument(result.conflict.doc).doc };
      this.#set('conflict');
    }
  }

  async #pull(remote: StoredDocument, remoteDoc: AppDocument): Promise<void> {
    await this.store.replaceDocument(remoteDoc, { keepUpdatedAt: true });
    this.#done({ remoteVersion: remote.version, docUpdatedAt: remoteDoc.updatedAt });
  }

  #done(base: SyncBase): void {
    this.base.set(base);
    this.error = null;
    this.lastSyncAt = new Date();
    this.#set('synced');
  }

  #set(status: SyncStatus): void {
    this.status = status;
    this.dispatchEvent(new Event('change'));
  }
}

function sameContent(a: AppDocument, b: AppDocument): boolean {
  return JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' });
}
