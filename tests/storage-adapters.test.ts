import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import type { StorageAdapter } from '../src/storage/adapter';
import { BrowserAdapter } from '../src/storage/browser-adapter';
import { GitHubAdapter, decodeBase64Utf8, encodeBase64Utf8 } from '../src/storage/github-adapter';
import { MemoryAdapter } from '../src/storage/memory-adapter';
import { fakeGitHub } from './fake-github';

const github = (token = 'good-token') =>
  new GitHubAdapter({ owner: 'me', repo: 'data', branch: '', path: 'data/3dpc.json', token }, fakeGitHub().fetchFn);

/** Every adapter must pass the same contract. */
const adapters: [string, () => StorageAdapter][] = [
  ['MemoryAdapter', () => new MemoryAdapter()],
  ['BrowserAdapter', () => new BrowserAdapter(`test-${crypto.randomUUID()}`)],
  ['GitHubAdapter', () => github()],
];

describe.each(adapters)('%s contract', (_name, make) => {
  it('starts empty, then round-trips a document', async () => {
    const adapter = make();
    expect(await adapter.load()).toBeNull();

    const doc = createEmptyDocument();
    const saved = await adapter.save(doc, null);
    expect(saved.ok).toBe(true);

    const loaded = await adapter.load();
    expect(loaded?.doc).toEqual(doc);
    expect(loaded?.version).toBe(saved.ok && saved.version);
  });

  it('rejects a save based on a stale version and returns the newer document', async () => {
    const adapter = make();
    const first = await adapter.save(createEmptyDocument(), null);
    if (!first.ok) throw new Error('first save failed');

    const deviceA = createEmptyDocument();
    deviceA.settings.hourlyRate = 20;
    expect((await adapter.save(deviceA, first.version)).ok).toBe(true);

    const deviceB = createEmptyDocument();
    deviceB.settings.hourlyRate = 25;
    const result = await adapter.save(deviceB, first.version);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.doc.settings.hourlyRate).toBe(20);
  });

  it('refuses to create when a document already exists', async () => {
    const adapter = make();
    await adapter.save(createEmptyDocument(), null);
    expect((await adapter.save(createEmptyDocument(), null)).ok).toBe(false);
  });
});

describe('GitHubAdapter specifics', () => {
  it('round-trips non-ASCII text through base64', () => {
    const text = 'Weiß, Grün, Ø 1,75 mm, 🔒';
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });

  it('explains auth errors', async () => {
    const adapter = new GitHubAdapter({ owner: 'me', repo: 'data', branch: '', path: 'x.json', token: 'wrong' }, fakeGitHub().fetchFn);
    await expect(adapter.load()).rejects.toThrow(/Token invalid or expired/);
  });

  it('checks repo access and whether the file exists', async () => {
    const adapter = github();
    expect(await adapter.check()).toEqual({ private: true, canWrite: true, fileExists: false });
    await adapter.save(createEmptyDocument(), null);
    expect((await adapter.check()).fileExists).toBe(true);
  });
});
