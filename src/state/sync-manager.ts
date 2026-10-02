import { GitHubAdapter, type GitHubConfig } from '../storage/github-adapter';
import type { AppStore } from './app-store';
import { SyncService, type SyncBase } from './sync';

/** Per-device sync settings. Kept outside the synced document (and out of exports). */
export interface SyncConfig {
  provider: 'github';
  github: Omit<GitHubConfig, 'token'>;
  /** Keep the token across browser sessions (localStorage) instead of only this session. */
  rememberToken: boolean;
  autoSync: boolean;
}

const CONFIG_KEY = '3dpc.sync.config';
const TOKEN_KEY = '3dpc.sync.token';
const BASE_KEY = '3dpc.sync.base';
const AUTO_SYNC_DELAY_MS = 30_000;

/** Storage access that never throws (private windows, blocked site data). */
const safe = {
  get(storage: () => Storage, key: string): string | null {
    try {
      return storage().getItem(key);
    } catch {
      return null;
    }
  },
  set(storage: () => Storage, key: string, value: string | null): void {
    try {
      if (value === null) storage().removeItem(key);
      else storage().setItem(key, value);
    } catch {
      // ignore
    }
  },
};
const local = () => localStorage;
const session = () => sessionStorage;

function identity(c: SyncConfig): string {
  return `${c.provider}:${c.github.owner}/${c.github.repo}@${c.github.branch}:${c.github.path}`;
}

/** Owns the SyncService for the configured remote and its automatic triggers. */
export class SyncManager extends EventTarget {
  config: SyncConfig | null = null;
  service: SyncService | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastSeenUpdatedAt = '';
  #cleanup: (() => void)[] = [];

  constructor(private readonly store: AppStore) {
    super();
  }

  /** Restore the connection saved on this device, if the token is available. */
  restore(): void {
    const raw = safe.get(local, CONFIG_KEY);
    if (!raw) return;
    try {
      this.config = JSON.parse(raw) as SyncConfig;
    } catch {
      return;
    }
    const token = this.token();
    if (token) this.#start(token);
    this.#emit();
  }

  token(): string | null {
    return safe.get(local, TOKEN_KEY) ?? safe.get(session, TOKEN_KEY);
  }

  /** Needs the token again (it was only kept for the last session). */
  get locked(): boolean {
    return !!this.config && !this.service;
  }

  async test(github: GitHubConfig) {
    return new GitHubAdapter(github).check();
  }

  connect(config: SyncConfig, token: string): void {
    const previous = this.config && identity(this.config);
    this.#stop();
    this.config = config;
    safe.set(local, CONFIG_KEY, JSON.stringify(config));
    if (previous !== identity(config)) safe.set(local, BASE_KEY, null);
    this.unlock(token);
  }

  unlock(token: string): void {
    if (!this.config) return;
    safe.set(local, TOKEN_KEY, this.config.rememberToken ? token : null);
    safe.set(session, TOKEN_KEY, this.config.rememberToken ? null : token);
    this.#start(token);
    this.#emit();
  }

  disconnect(): void {
    this.#stop();
    this.config = null;
    for (const key of [CONFIG_KEY, TOKEN_KEY, BASE_KEY]) safe.set(local, key, null);
    safe.set(session, TOKEN_KEY, null);
    this.#emit();
  }

  #start(token: string): void {
    const config = this.config!;
    const base = {
      get: (): SyncBase | null => {
        const raw = safe.get(local, BASE_KEY);
        const parsed = raw ? (JSON.parse(raw) as SyncBase & { identity: string }) : null;
        return parsed && parsed.identity === identity(config) ? parsed : null;
      },
      set: (b: SyncBase | null) => safe.set(local, BASE_KEY, b ? JSON.stringify({ ...b, identity: identity(config) }) : null),
    };
    const service = new SyncService(this.store, new GitHubAdapter({ ...config.github, token }), base);
    this.service = service;

    const forward = () => this.#emit();
    service.addEventListener('change', forward);
    this.#cleanup.push(() => service.removeEventListener('change', forward));
    if (config.autoSync) this.#wireAutoSync(service);
    void service.sync();
  }

  #wireAutoSync(service: SyncService): void {
    this.#lastSeenUpdatedAt = this.store.doc.updatedAt;
    const onStoreChange = () => {
      if (this.store.doc.updatedAt === this.#lastSeenUpdatedAt) return;
      this.#lastSeenUpdatedAt = this.store.doc.updatedAt;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void service.sync(), AUTO_SYNC_DELAY_MS);
    };
    const syncNow = () => void service.sync();
    const onHide = () => {
      if (document.visibilityState === 'hidden' && service.hasLocalChanges) void service.sync();
    };
    this.store.addEventListener('change', onStoreChange);
    window.addEventListener('focus', syncNow);
    window.addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', onHide);
    this.#cleanup.push(() => {
      clearTimeout(this.#timer);
      this.store.removeEventListener('change', onStoreChange);
      window.removeEventListener('focus', syncNow);
      window.removeEventListener('online', syncNow);
      document.removeEventListener('visibilitychange', onHide);
    });
  }

  #stop(): void {
    for (const fn of this.#cleanup.splice(0)) fn();
    this.service = null;
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}
