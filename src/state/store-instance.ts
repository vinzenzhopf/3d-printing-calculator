import type { AppStore } from './app-store';

let instance: AppStore | undefined;

/** The app-wide store, set once in main.ts. */
export function store(): AppStore {
  if (!instance) throw new Error('AppStore not initialized');
  return instance;
}

export function setStore(s: AppStore): void {
  instance = s;
}
