import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import type { StorageAdapter } from '../src/storage/adapter';
import { BrowserAdapter } from '../src/storage/browser-adapter';
import { MemoryAdapter } from '../src/storage/memory-adapter';

/** Every adapter must pass the same contract. */
const adapters: [string, () => StorageAdapter][] = [
  ['MemoryAdapter', () => new MemoryAdapter()],
  ['BrowserAdapter', () => new BrowserAdapter(`test-${crypto.randomUUID()}`)],
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
