import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';
import { AppStore } from './state/app-store';
import { setStore, setSyncManager, store, syncManager } from './state/store-instance';
import { SyncManager } from './state/sync-manager';
import { BrowserAdapter } from './storage/browser-adapter';

setStore(new AppStore(new BrowserAdapter()));
setSyncManager(new SyncManager(store()));
void BrowserAdapter.requestPersistence();
void store()
  .init()
  .then(() => syncManager().restore());

// Loaded after the store exists: defining <app-shell> upgrades the element in
// index.html right away, and its constructor needs the store.
await import('./ui/app-shell');

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const { registerServiceWorker } = await import('./ui/service-worker');
  registerServiceWorker();
}
