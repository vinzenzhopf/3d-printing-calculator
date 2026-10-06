import { LitElement, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { marginFromMarkup } from '../core/calc/pricing';
import type { AppDocument, PricingProfile } from '../core/model';
import { StoreController } from '../state/app-store';
import { store } from '../state/store-instance';
import { numberField, switchField, textField } from './fields';
import { newId, percent } from './format';

/** Fractions are stored (0.2), percentages are shown (20). */
const pct = (v: number) => Math.round(v * 100 * 1e6) / 1e6;

@customElement('pricing-profiles-editor')
export class PricingProfilesEditor extends LitElement {
  #store = new StoreController(this, store());

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    return html`
      <p class="text-body-secondary small">
        Each quote uses one profile. It decides which costs are charged and how the price is built: cost → failure
        allowance → markup → discount → minimum price → rounding.
      </p>
      <div class="row row-cols-1 row-cols-lg-2 g-3">
        ${this.#doc.pricingProfiles.map((p) => html`<div class="col">${this.#profile(p)}</div>`)}
      </div>
      <button class="btn btn-outline-primary mt-3" @click=${this.#add}>Add profile</button>
    `;
  }

  #profile(p: PricingProfile) {
    const s = this.#doc.settings;
    const set = (mutate: (x: PricingProfile) => void) =>
      void this.#store.store.update((d) => mutate(d.pricingProfiles.find((x) => x.id === p.id)!));
    const used = this.#doc.quotes.some((q) => q.pricingProfileId === p.id) || this.#doc.customers.some((c) => c.defaultPricingProfileId === p.id);
    return html`
      <section class="card card-body h-100">
        ${textField('Name', p.name, (v) => set((x) => (x.name = v)))}
        <div class="row">
          <div class="col-sm-6">
            ${switchField('Charge labor', p.includeLabor, (v) => set((x) => (x.includeLabor = v)))}
            ${switchField('Charge machine wear', p.includeMachine, (v) => set((x) => (x.includeMachine = v)))}
            ${switchField('Markup on items', !!p.markupOnItems, (v) => set((x) => (x.markupOnItems = v)), { help: 'Hardware, packaging, shipping.' })}
          </div>
          <div class="col-sm-6">
            ${numberField('Reserve share', pct(p.reserveShare), (v) => set((x) => (x.reserveShare = v / 100)), { suffix: '%', min: 0, step: 10, help: 'Of the replacement reserve rate.' })}
            ${numberField('Failure allowance', pct(p.failureAllowance), (v) => set((x) => (x.failureAllowance = v / 100)), { suffix: '%', min: 0, step: 1 })}
          </div>
          <div class="col-sm-6">
            ${numberField('Markup on cost', pct(p.markup), (v) => set((x) => (x.markup = v / 100)), { suffix: '%', min: 0, step: 5, help: `= ${percent(marginFromMarkup(p.markup), 1)} margin on the price.` })}
            ${numberField('Minimum price', p.minimumPrice, (v) => set((x) => (x.minimumPrice = v)), { suffix: s.currency, min: 0 })}
            ${numberField('Round up to', p.roundTo, (v) => set((x) => (x.roundTo = v)), { suffix: s.currency, min: 0, step: 0.1, help: '0 = no rounding.' })}
          </div>
          <div class="col-sm-6">
            ${numberField('Hourly rate', p.hourlyRate ?? 0, (v) => set((x) => (x.hourlyRate = v > 0 ? v : undefined)), { suffix: `${s.currency}/h`, min: 0, help: `0 = default (${s.hourlyRate}).` })}
            ${numberField('Labor per plate run', p.laborPerPlateMin ?? 0, (v) => set((x) => (x.laborPerPlateMin = v > 0 ? v : undefined)), { suffix: 'min', min: 0, help: `0 = default (${s.laborPerPlateMin} min).` })}
          </div>
        </div>
        ${used
          ? nothing
          : html`<div><button class="btn btn-sm btn-outline-danger" @click=${() => void this.#store.store.update((d) => (d.pricingProfiles = d.pricingProfiles.filter((x) => x.id !== p.id)))}>Delete profile</button></div>`}
      </section>
    `;
  }

  #add = () => {
    void this.#store.store.update((d) =>
      d.pricingProfiles.push({ id: newId(), name: 'New profile', includeLabor: true, includeMachine: true, reserveShare: 1, failureAllowance: 0.05, markup: 0.2, minimumPrice: 0, roundTo: 0 }),
    );
  };
}
