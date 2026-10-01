import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import { AppStore } from '../src/state/app-store';
import { MemoryAdapter } from '../src/storage/memory-adapter';

describe('AppStore', () => {
  it('persists quick successive updates without conflicting with itself', async () => {
    const adapter = new MemoryAdapter();
    const store = new AppStore(adapter);
    await store.init();

    // Not awaited in between, like fast typing in two fields.
    void store.update((d) => (d.settings.hourlyRate = 20));
    void store.update((d) => (d.settings.energyPricePerKwh = 0.35));
    await store.update((d) => (d.settings.laborPerPlateMin = 5));

    expect(store.status).toBe('ready');
    const stored = await adapter.load();
    expect(stored?.doc.settings).toMatchObject({ hourlyRate: 20, energyPricePerKwh: 0.35, laborPerPlateMin: 5 });
  });

  it('loads and normalizes what the adapter has stored', async () => {
    const adapter = new MemoryAdapter();
    const old = createEmptyDocument();
    old.settings.hourlyRate = 22;
    // Simulate a document saved before a settings field existed.
    delete (old.settings as Partial<typeof old.settings>).business;
    await adapter.save(old, null);

    const store = new AppStore(adapter);
    await store.init();
    expect(store.doc.settings.hourlyRate).toBe(22);
    expect(store.doc.settings.business).toEqual({ name: '', address: '', email: '' });
  });

  it('replaces the whole document', async () => {
    const adapter = new MemoryAdapter();
    const store = new AppStore(adapter);
    await store.init();
    const doc = createEmptyDocument();
    doc.customers.push({ id: 'c1', name: 'Alex' });
    await store.replaceDocument(doc);
    expect((await adapter.load())?.doc.customers).toHaveLength(1);
  });
});
