import type { AppStore } from './app-store';
import type { SyncManager } from './sync-manager';

let instance: AppStore | undefined;
let syncInstance: SyncManager | undefined;

/** The app-wide store, set once in main.ts. */
export function store(): AppStore {
  if (!instance) throw new Error('AppStore not initialized');
  return instance;
}

export function setStore(s: AppStore): void {
  instance = s;
}

/** The app-wide sync manager, set once in main.ts. */
export function syncManager(): SyncManager {
  if (!syncInstance) throw new Error('SyncManager not initialized');
  return syncInstance;
}

export function setSyncManager(m: SyncManager): void {
  syncInstance = m;
}
