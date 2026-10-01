import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { createEmptyDocument } from '../core/document';
import type { AppDocument } from '../core/model';
import type { StorageAdapter } from '../storage/adapter';

export type StoreStatus = 'loading' | 'ready' | 'saving' | 'conflict' | 'error';

/**
 * Holds the one AppDocument in memory and persists it through a StorageAdapter.
 * Components subscribe via StoreController and re-render on every change.
 */
export class AppStore extends EventTarget {
  doc: AppDocument = createEmptyDocument();
  status: StoreStatus = 'loading';
  error: string | null = null;
  #version: string | null = null;

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
        this.doc = stored.doc;
        this.#version = stored.version;
      }
      this.#set('ready');
    } catch (e) {
      this.#fail(e);
    }
  }

  /** Apply a change to the document and persist it. */
  async update(mutate: (doc: AppDocument) => void): Promise<void> {
    const next = structuredClone(this.doc);
    mutate(next);
    next.updatedAt = new Date().toISOString();
    this.doc = next;
    this.#set('saving');
    try {
      const result = await this.adapter.save(next, this.#version);
      if (result.ok) {
        this.#version = result.version;
        this.#set('ready');
      } else {
        // Another tab/device saved in between. Conflict resolution UI comes with sync (ST-6).
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
