import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { createEmptyDocument } from '../core/document';
import { loadDocument } from '../core/migrations';
import type { AppDocument } from '../core/model';
import type { StorageAdapter } from '../storage/adapter';

export type StoreStatus = 'loading' | 'ready' | 'saving' | 'conflict' | 'error';

/**
 * Holds the one AppDocument in memory and persists it through a StorageAdapter.
 * Changes apply to memory immediately; saves run one after another and always
 * write the latest document, so quick successive edits never conflict with
 * each other. Components subscribe via StoreController.
 */
export class AppStore extends EventTarget {
  doc: AppDocument = createEmptyDocument();
  status: StoreStatus = 'loading';
  error: string | null = null;
  #version: string | null = null;
  #saves: Promise<void> = Promise.resolve();
  #dirty = false;

  constructor(private readonly adapter: StorageAdapter) {
    super();
  }

  get adapterId(): string {
    return this.adapter.id;
  }

  async init(): Promise<void> {
    try {
      const stored = await this.adapter.load();
      if (stored) {
        this.doc = loadDocument(stored.doc).doc;
        this.#version = stored.version;
      }
      this.#set('ready');
    } catch (e) {
      this.#fail(e);
    }
  }

  /** Apply a change to the document and persist it. Resolves when saved. */
  update(mutate: (doc: AppDocument) => void): Promise<void> {
    const next = structuredClone(this.doc);
    mutate(next);
    return this.#commit(next);
  }

  /** Replace the whole document (import, reset). Resolves when saved. */
  replaceDocument(doc: AppDocument): Promise<void> {
    return this.#commit(structuredClone(doc));
  }

  #commit(next: AppDocument): Promise<void> {
    next.updatedAt = new Date().toISOString();
    this.doc = next;
    this.#dirty = true;
    this.#set('saving');
    this.#saves = this.#saves.then(() => this.#persist());
    return this.#saves;
  }

  async #persist(): Promise<void> {
    if (!this.#dirty) return; // an earlier queued save already wrote the latest doc
    this.#dirty = false;
    try {
      const result = await this.adapter.save(this.doc, this.#version);
      if (result.ok) {
        this.#version = result.version;
        if (!this.#dirty) this.#set('ready');
      } else {
        // Another tab/device saved in between. Resolution UI comes with sync (ST-6).
        this.#set('conflict');
      }
    } catch (e) {
      this.#fail(e);
    }
  }

  #set(status: StoreStatus): void {
    this.status = status;
    this.dispatchEvent(new Event('change'));
  }

  #fail(e: unknown): void {
    this.error = e instanceof Error ? e.message : String(e);
    this.#set('error');
  }
}

/** Re-renders a Lit component whenever the store changes. */
export class StoreController implements ReactiveController {
  #onChange = () => this.host.requestUpdate();

  constructor(
    private readonly host: ReactiveControllerHost,
    readonly store: AppStore,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    this.store.addEventListener('change', this.#onChange);
  }

  hostDisconnected(): void {
    this.store.removeEventListener('change', this.#onChange);
  }
}
