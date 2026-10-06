import type { ReactiveController, ReactiveControllerHost } from 'lit';

export interface Route {
  path: string;
  label: string;
}

/** Navigation entries. Hash routing works on GitHub Pages without a 404 redirect trick. */
export const ROUTES: Route[] = [
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'quotes', label: 'Quotes' },
  { path: 'log', label: 'Print log' },
  { path: 'stats', label: 'Statistics' },
  { path: 'filaments', label: 'Filaments' },
  { path: 'printers', label: 'Printers' },
  { path: 'customers', label: 'Customers' },
  { path: 'settings', label: 'Settings' },
];

/** Routes without a navigation entry, e.g. `#/spool/L0042` (opened from a printed label's QR code). */
export const HIDDEN_ROUTES = ['spool'];

/** Tracks `#/<path>/<sub>` and re-renders the host on change. */
export class HashRouter implements ReactiveController {
  path = '';
  sub = '';
  #onHashChange = () => {
    this.#read();
    this.host.requestUpdate();
  };

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
    this.#read();
  }

  hostConnected(): void {
    window.addEventListener('hashchange', this.#onHashChange);
  }

  hostDisconnected(): void {
    window.removeEventListener('hashchange', this.#onHashChange);
  }

  #read(): void {
    const [path = '', rawSub = ''] = location.hash.replace(/^#\/?/, '').split('/');
    const sub = decodeURIComponent(rawSub);
    this.path = ROUTES.some((r) => r.path === path) || HIDDEN_ROUTES.includes(path) ? path : 'dashboard';
    this.sub = sub;
  }
}
