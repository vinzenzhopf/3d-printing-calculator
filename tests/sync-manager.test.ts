import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../src/state/app-store';
import { SyncManager } from '../src/state/sync-manager';
import { MemoryAdapter } from '../src/storage/memory-adapter';
import { fakeGitHub } from './fake-github';

/** Browser storage stand-in for Node. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const inboxFile = (end: string) => btoa(JSON.stringify({ version: 1, printer: 'mk3s', file: 'cube.gcode', finishedAt: end, durationMin: 30, result: 'success' }));

describe('SyncManager inbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads detected prints and downloads each file only once', async () => {
    const gh = fakeGitHub();
    const fetchFn = vi.fn(gh.fetchFn);
    vi.stubGlobal('fetch', fetchFn);
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
    gh.files.set('print-inbox/a.json', { content: inboxFile('2026-10-06T23:36:47+02:00'), sha: 'shaA' });
    gh.files.set('print-inbox/b.json', { content: inboxFile('2026-10-07T10:00:00+02:00'), sha: 'shaB' });

    const store = new AppStore(new MemoryAdapter());
    await store.init();
    const m = new SyncManager(store);
    m.connect({ provider: 'github', github: { owner: 'o', repo: 'r', branch: '', path: 'data.json' }, rememberToken: true, autoSync: false }, 'good-token');

    const downloads = () => fetchFn.mock.calls.filter(([url]) => /print-inbox\/.+\.json/.test(String(url))).length;
    const first = await m.loadInbox();
    expect(first.map((i) => i.entry?.finishedAt)).toEqual(['2026-10-06T23:36:47+02:00', '2026-10-07T10:00:00+02:00']);
    expect(downloads()).toBe(2);

    // A new file arrives: only that one is downloaded.
    gh.files.set('print-inbox/c.json', { content: inboxFile('2026-10-07T12:00:00+02:00'), sha: 'shaC' });
    const second = await m.loadInbox();
    expect(second).toHaveLength(3);
    expect(downloads()).toBe(3);
  });
});
