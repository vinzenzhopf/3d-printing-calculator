import { html, nothing, render } from 'lit';
import { printablesWeights, searchWeights, spoolmanWeights, weightTitle, type PrintablesCatalog, type SpoolWeight } from '../core/spool-weights';
import { store } from '../state/store-instance';
import { loadSpoolmanDb } from './spoolmandb-client';

/** Shown for attribution; the data itself is only loaded after the non-commercial confirmation in Settings. */
export const PRINTABLES_SOURCE = {
  title: 'Empty Spool Weight Catalog',
  author: 'Scuk',
  url: 'https://www.printables.com/model/464663-empty-spool-weight-catalog',
  license: 'CC BY-NC-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
};

const printablesEnabled = () => !!store().doc.settings.printablesCatalogPersonalUse;

let printables: SpoolWeight[] | null = null;
let spoolman: SpoolWeight[] | null = null;

/** The Printables catalog (a separate chunk), when enabled in Settings; else none. */
async function printablesList(): Promise<SpoolWeight[]> {
  if (!printablesEnabled()) return [];
  printables ??= printablesWeights((await import('../third-party/printables-spool-weights.json')).default as PrintablesCatalog);
  return printables;
}

/** SpoolmanDB, plus the Printables catalog if enabled. */
export async function allSpoolWeights(): Promise<SpoolWeight[]> {
  spoolman ??= spoolmanWeights(await loadSpoolmanDb());
  return [...(await printablesList()), ...spoolman];
}

export interface WeightHint {
  brand?: string;
  lineName?: string;
  sizeG?: number;
}

/**
 * Search dialog over the known empty-spool weights (SpoolmanDB and the
 * Printables catalog). Resolves with the chosen entry, 'manual' for "enter by
 * hand", or null when cancelled.
 */
export function pickSpoolWeight(hint: WeightHint = {}): Promise<SpoolWeight | 'manual' | null> {
  return new Promise((resolve) => {
    let query = hint.brand ? hint.brand.split(/\s+/)[0]!.toLowerCase() : '';
    let all: SpoolWeight[] = [];
    let status = 'Loading SpoolmanDB…';
    const withPrintables = printablesEnabled();
    const dialog = document.createElement('dialog');
    dialog.className = 'border-0 rounded-3 shadow p-0';
    dialog.style.cssText = 'width: min(34rem, calc(100vw - 1rem)); max-height: calc(100vh - 2rem);';
    document.body.append(dialog);
    const close = (result: SpoolWeight | 'manual' | null) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.addEventListener('cancel', () => close(null));

    const draw = () => {
      const results = searchWeights(all, query, hint).slice(0, 60);
      render(html`
        <div class="p-3 bg-body text-body d-flex flex-column gap-2" style="max-height: calc(100vh - 2rem)">
          <div class="d-flex align-items-center"><h2 class="h6 mb-0 me-auto">Find the empty spool</h2>
            <button type="button" class="btn-close" aria-label="Close" @click=${() => close(null)}></button></div>
          <input class="form-control" type="search" placeholder="Brand, size, type… e.g. esun 2.5" aria-label="Search" .value=${query}
            @input=${(e: Event) => { query = (e.target as HTMLInputElement).value; draw(); }} />
          <div class="small text-body-secondary">${results.length === 60 ? 'First 60 matches' : `${results.length} matches`}${status ? ` · ${status}` : ''}</div>
          <div class="list-group overflow-auto" style="min-height: 8rem">
            ${results.map((w) => html`<button type="button" class="list-group-item list-group-item-action d-flex gap-2 align-items-center" @click=${() => close(w)}>
              <span class="me-auto text-start"><span class="fw-semibold">${w.brand}</span> ${weightTitle(w)}
                <span class="d-block small text-body-secondary">${w.source === 'spoolmandb' ? `SpoolmanDB${w.count ? ` · ${w.count} filaments` : ''}` : 'Printables catalog'}</span></span>
              <span class="text-nowrap fw-semibold">${w.emptyG} g</span>
              ${w.minG !== undefined ? html`<span class="small text-body-secondary text-nowrap">${w.minG}–${w.maxG}</span>` : nothing}
            </button>`)}
          </div>
          <div class="d-flex gap-2 align-items-center">
            <span class="form-text me-auto mt-0">Sources: <a href="https://github.com/Donkie/SpoolmanDB" target="_blank" rel="noopener">SpoolmanDB</a> (MIT)${withPrintables
              ? html`, <a href=${PRINTABLES_SOURCE.url} target="_blank" rel="noopener">${PRINTABLES_SOURCE.title}</a> by ${PRINTABLES_SOURCE.author} (${PRINTABLES_SOURCE.license}).`
              : html`. More weights for non-commercial use: <a href="#/settings" @click=${() => close(null)}>Settings → Third-party data</a>.`}</span>
            <button type="button" class="btn btn-outline-secondary btn-sm text-nowrap" @click=${() => close('manual')}>Enter by hand</button>
          </div>
        </div>`, dialog);
    };
    draw();
    dialog.showModal();
    // The catalog is local: show it while SpoolmanDB is still loading.
    void printablesList().then((w) => { if (status) { all = w; draw(); } });
    allSpoolWeights().then(
      (w) => { all = w; status = ''; draw(); },
      () => { status = withPrintables ? 'SpoolmanDB not reachable, only the Printables catalog' : 'SpoolmanDB not reachable'; draw(); },
    );
  });
}
