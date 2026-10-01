import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';
import { AppStore } from './state/app-store';
import { setStore, store } from './state/store-instance';
import { BrowserAdapter } from './storage/browser-adapter';

setStore(new AppStore(new BrowserAdapter()));
void BrowserAdapter.requestPersistence();
void store().init();

// Loaded after the store exists: defining <app-shell> upgrades the element in
// index.html right away, and its constructor needs the store.
await import('./ui/app-shell');
