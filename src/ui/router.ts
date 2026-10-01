import type { ReactiveController, ReactiveControllerHost } from 'lit';

export interface Route {
  path: string;
  label: string;
}

/** Navigation entries. Hash routing works on GitHub Pages without a 404 redirect trick. */
export const ROUTES: Route[] = [
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'quotes', label: 'Quotes' },
  { path: 'filaments', label: 'Filaments' },
  { path: 'printers', label: 'Printers' },
  { path: 'customers', label: 'Customers' },
  { path: 'settings', label: 'Settings' },
];

/** Tracks `#/<path>` and re-renders the host on change. */
export class HashRouter implements ReactiveController {
  path = currentPath();
  #onHashChange = () => {
    this.path = currentPath();
    this.host.requestUpdate();
  };

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    window.addEventListener('hashchange', this.#onHashChange);
  }

  hostDisconnected(): void {
    window.removeEventListener('hashchange', this.#onHashChange);
  }
}

function currentPath(): string {
  const path = location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return ROUTES.some((r) => r.path === path) ? path : 'dashboard';
}
