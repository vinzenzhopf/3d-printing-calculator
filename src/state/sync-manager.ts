import { parseInboxEntry, type InboxEntry } from '../core/inbox';
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
/** Inbox file contents by git blob sha: a sha never changes content, so only new files are downloaded. */
const INBOX_CACHE_KEY = '3dpc.inbox.cache';
/** Parallel downloads when loading the inbox (GitHub dislikes bursts). */
const INBOX_PARALLEL = 6;
/** Folder in the sync repo where Home Assistant drops detected prints (see docs/home-assistant.md). */
export const INBOX_DIR = 'print-inbox';

export interface InboxItem {
  path: string;
  sha: string;
  /** null when the file could not be read as an inbox entry. */
  entry: InboxEntry | null;
}

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
  #github: GitHubAdapter | null = null;
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
    this.#github = new GitHubAdapter({ ...config.github, token });
    const service = new SyncService(this.store, this.#github, base);
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
    this.#github = null;
  }

  /** Prints detected outside the app, waiting in the sync repo. Empty without GitHub sync. */
  async loadInbox(): Promise<InboxItem[]> {
    const gh = this.#github;
    if (!gh) return [];
    const files = (await gh.listFiles(INBOX_DIR)).filter((f) => f.path.endsWith('.json'));
    const cache = readInboxCache();
    const items: InboxItem[] = new Array(files.length);
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        const f = files[i]!;
        try {
          const raw = f.sha in cache ? cache[f.sha] : (cache[f.sha] = await gh.readJson(f.path));
          items[i] = { ...f, entry: parseInboxEntry(f.path, raw) };
        } catch {
          items[i] = { ...f, entry: null };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(INBOX_PARALLEL, files.length) }, worker));
    // Keep only what is still in the inbox.
    const live = new Set(files.map((f) => f.sha));
    safe.set(local, INBOX_CACHE_KEY, JSON.stringify(Object.fromEntries(Object.entries(cache).filter(([sha]) => live.has(sha)))));
    return items;
  }

  /** Removes a processed (logged or dismissed) inbox file. */
  async removeInboxItem(item: InboxItem, reason: string): Promise<void> {
    await this.#github?.deleteFile(item.path, item.sha, reason);
  }

  get inboxAvailable(): boolean {
    return !!this.#github;
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

function readInboxCache(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(safe.get(local, INBOX_CACHE_KEY) ?? '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
