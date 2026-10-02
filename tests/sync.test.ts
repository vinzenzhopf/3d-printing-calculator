import { SCHEMA_VERSION } from '../src/core/model';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { AppStore } from '../src/state/app-store';
import { SyncService, type SyncBase } from '../src/state/sync';
import { MemoryAdapter } from '../src/storage/memory-adapter';

function memoryBase() {
  let base: SyncBase | null = null;
  return { get: () => base, set: (b: SyncBase | null) => void (base = b) };
}

/** One shared remote, two devices with their own local store and sync base. */
async function setup() {
  const remote = new MemoryAdapter();
  const device = async () => {
    const store = new AppStore(new MemoryAdapter());
    await store.init();
    return { store, sync: new SyncService(store, remote, memoryBase()) };
  };
  return { remote, a: await device(), b: await device() };
}

describe('SyncService', () => {
  it('pushes the first device, pulls on the second, then exchanges changes', async () => {
    const { remote, a, b } = await setup();
    await a.store.update((d) => (d.settings.hourlyRate = 20));
    await a.sync.sync();
    expect(a.sync.status).toBe('synced');
    expect((await remote.load())?.doc.settings.hourlyRate).toBe(20);

    // Device b has no changes of its own: identical defaults would be a conflict
    // only if content differed, so it simply takes the remote copy.
    await b.store.replaceDocument((await remote.load())!.doc, { keepUpdatedAt: true });
    await b.sync.sync();
    expect(b.sync.status).toBe('synced');

    await b.store.update((d) => (d.settings.hourlyRate = 25));
    await b.sync.sync();
    await a.sync.sync();
    expect(a.store.doc.settings.hourlyRate).toBe(25);
    expect(a.sync.hasLocalChanges).toBe(false);
  });

  it('pulls without marking the pulled copy as a local change', async () => {
    const { a, b } = await setup();
    await a.store.update((d) => d.customers.push({ id: 'c', name: 'Alex' }));
    await a.sync.sync();
    await b.sync.sync(); // b: no base yet, both "changed", content differs → conflict
    expect(b.sync.status).toBe('conflict');
    await b.sync.resolve('theirs');
    expect(b.store.doc.customers).toHaveLength(1);
    expect(b.sync.hasLocalChanges).toBe(false);
    await b.sync.sync();
    expect(b.sync.status).toBe('synced');
  });

  it('detects concurrent edits and resolves by keeping this device', async () => {
    const { remote, a, b } = await setup();
    await a.sync.sync();
    await b.sync.sync(); // same content: no conflict
    expect(b.sync.status).toBe('synced');

    await a.store.update((d) => (d.settings.hourlyRate = 30));
    await b.store.update((d) => (d.settings.hourlyRate = 40));
    await a.sync.sync();
    await b.sync.sync();
    expect(b.sync.status).toBe('conflict');
    expect(b.sync.conflict?.remoteDoc.settings.hourlyRate).toBe(30);

    await b.sync.resolve('mine');
    expect(b.sync.status).toBe('synced');
    expect((await remote.load())?.doc.settings.hourlyRate).toBe(40);
    await a.sync.sync();
    expect(a.store.doc.settings.hourlyRate).toBe(40);
  });

  it('reports remote errors without losing local data', async () => {
    const store = new AppStore(new MemoryAdapter());
    await store.init();
    const failing = { id: 'broken', load: () => Promise.reject(new Error('offline')), save: () => Promise.reject(new Error('offline')) };
    const sync = new SyncService(store, failing, memoryBase());
    await store.update((d) => (d.settings.hourlyRate = 21));
    await sync.sync();
    expect(sync.status).toBe('error');
    expect(sync.error).toBe('offline');
    expect(store.doc.settings.hourlyRate).toBe(21);
  });

  it('shares one run between concurrent sync calls', async () => {
    const { remote, a } = await setup();
    let loads = 0;
    const original = remote.load.bind(remote);
    remote.load = () => (loads++, original());
    await Promise.all([a.sync.sync(), a.sync.sync(), a.sync.sync()]);
    expect(loads).toBe(1);
  });

  it('migrates remote documents from older schemas', async () => {
    const { remote, a } = await setup();
    const old = { ...createEmptyDocument(), schemaVersion: 1 } as Record<string, unknown>;
    delete old.spools;
    await remote.save(old as never, null);
    await a.sync.sync();
    await a.sync.resolve('theirs');
    expect(a.store.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(a.store.doc.spools).toEqual([]);
  });
});
