import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { AppDocument } from '../../../core/model';
import { applyWeight, estimatedSpools, suggestWeights, weightTitle, type SpoolWeight, type WeightSuggestion } from '../../../core/spool-weights';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { newId } from '../../format';
import { PRINTABLES_SOURCE, allSpoolWeights } from '../../spool-weight-dialog';

/**
 * Spools whose empty weight is a guess (generic kind, rough average, none),
 * with a matching entry from SpoolmanDB / the Printables catalog to take over.
 */
@customElement('spool-weight-suggestions')
export class SpoolWeightSuggestions extends LitElement {
  #store = new StoreController(this, store());
  @state() private weights: SpoolWeight[] | null = null;
  @state() private loading = false;
  @state() private error = '';
  /** Per suggestion (keyed by its first entry id): checked, and an alternative entry chosen instead. */
  @state() private checked: Record<string, boolean> = {};
  @state() private choice: Record<string, string> = {};
  @state() private done = '';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  async #load() {
    this.loading = true;
    this.error = '';
    try {
      this.weights = await allSpoolWeights();
    } catch (e) {
      this.error = `SpoolmanDB could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.loading = false;
    }
  }

  override render() {
    const doc = this.#doc;
    const estimated = estimatedSpools(doc).length;
    const intro = html`<p class="small text-body-secondary">
      ${estimated} spool(s) in stock have a guessed empty weight (generic, rough average or none) and weren't weighed empty.
      Known weights for their brand and size come from <a href="https://github.com/Donkie/SpoolmanDB" target="_blank" rel="noopener">SpoolmanDB</a>
      ${doc.settings.printablesCatalogPersonalUse
        ? html`and the <a href=${PRINTABLES_SOURCE.url} target="_blank" rel="noopener">${PRINTABLES_SOURCE.title}</a> (${PRINTABLES_SOURCE.author}, ${PRINTABLES_SOURCE.license}).`
        : html`(more for non-commercial use: <a href="#/settings">Settings → Third-party data</a>).`}</p>`;
    if (!this.weights) {
      return html`${intro}
        <button class="btn btn-sm btn-outline-primary" ?disabled=${this.loading || estimated === 0} @click=${() => void this.#load()}>
          ${this.loading ? html`<span class="spinner-border spinner-border-sm"></span> Loading…` : 'Suggest empty spool weights'}</button>
        ${this.error ? html`<div class="text-danger small mt-2">${this.error}</div>` : nothing}
        ${this.done ? html`<div class="text-success small mt-2">${this.done}</div>` : nothing}`;
    }
    const suggestions = suggestWeights(doc, this.weights);
    const keyOf = (g: WeightSuggestion) => g.weight.id;
    const chosen = (g: WeightSuggestion) => [g.weight, ...g.alternatives].find((w) => w.id === this.choice[keyOf(g)]) ?? g.weight;
    const isChecked = (g: WeightSuggestion) => this.checked[keyOf(g)] ?? g.preselect;
    const selected = suggestions.filter(isChecked);
    const spoolText = (ids: string[]) => ids.map((id) => doc.spools.find((s) => s.id === id)).filter(Boolean).map((s) => {
      const kind = doc.spoolKinds.find((k) => k.id === s!.kindId);
      return `${s!.label} (${kind ? `${kind.name}, ${kind.emptyG} g` : 'no empty spool'})`;
    });
    return html`${intro}
      ${suggestions.length === 0
        ? html`<p class="small">No known weights for the brands and sizes of these spools.</p>`
        : html`<div class="list-group mb-2">${suggestions.map((g) => {
            const w = chosen(g);
            const brandOf = (x: SpoolWeight) => `${x.brand} ${weightTitle(x)} · ${x.emptyG} g${x.minG !== undefined ? ` (${x.minG}–${x.maxG})` : ''} · ${x.source === 'spoolmandb' ? 'SpoolmanDB' : 'Printables'}`;
            return html`<div class="list-group-item d-flex gap-2 align-items-start">
              <input type="checkbox" class="form-check-input mt-1 flex-shrink-0" aria-label="Use this" .checked=${isChecked(g)}
                @change=${(e: Event) => (this.checked = { ...this.checked, [keyOf(g)]: (e.target as HTMLInputElement).checked })} />
              <span class="flex-grow-1 min-w-0">
                ${g.alternatives.length
                  ? html`<select class="form-select form-select-sm mb-1" aria-label="Empty spool entry"
                      @change=${(e: Event) => (this.choice = { ...this.choice, [keyOf(g)]: (e.target as HTMLSelectElement).value })}>
                      ${[g.weight, ...g.alternatives].map((x) => html`<option value=${x.id} ?selected=${x.id === w.id}>${brandOf(x)}</option>`)}
                    </select>`
                  : html`<div class="fw-semibold small">${brandOf(w)}</div>`}
                <span class="small text-body-secondary d-block">${g.spoolIds.length} spool(s): ${spoolText(g.spoolIds).join(', ')}</span>
                ${g.preselect ? nothing : html`<span class="small text-warning-emphasis d-block">Not pre-selected: some are on an empty spool you set up yourself.</span>`}
              </span>
            </div>`;
          })}</div>`}
      <div class="d-flex flex-wrap gap-2 align-items-center">
        <button class="btn btn-sm btn-primary" ?disabled=${selected.length === 0} @click=${() => void this.#apply(selected.map((g) => ({ weight: chosen(g), spoolIds: g.spoolIds })))}>
          Use for ${selected.reduce((n, g) => n + g.spoolIds.length, 0)} spool(s)</button>
        <button class="btn btn-sm btn-link" @click=${() => (this.weights = null)}>Close</button>
      </div>`;
  }

  async #apply(items: { weight: SpoolWeight; spoolIds: string[] }[]) {
    await this.#store.store.update((d) => {
      for (const { weight, spoolIds } of items) applyWeight(d, weight, spoolIds, newId);
    });
    const n = items.reduce((sum, i) => sum + i.spoolIds.length, 0);
    this.checked = {};
    this.choice = {};
    this.weights = null;
    this.done = `${n} spool(s) now use the known empty weight. Weighing a spool empty later still replaces it.`;
  }
}
