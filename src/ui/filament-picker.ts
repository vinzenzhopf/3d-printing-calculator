import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { isFilamentDeprecated } from '../core/catalog-cleanup';
import type { BaseMaterial, Filament, ProductLine } from '../core/model';
import { store } from '../state/store-instance';
import { newId } from './format';
import { colorButton } from './color-dialog';
import { swatch } from './pages/filaments/labels';

const NEW = '__new__';
const BASE_MATERIALS: BaseMaterial[] = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Other'];

/**
 * Two-step filament choice: product line (grouped by brand), then color.
 * Both lists end with "+ New …", which opens an inline form and creates the
 * entry right away, so nobody has to leave the current form for the catalog.
 * Fires `filament-change` with `detail` = filament id ('' while incomplete).
 */
@customElement('filament-picker')
export class FilamentPicker extends LitElement {
  @property() value = '';
  /** Line chosen without a color yet. */
  @state() private pendingLine = '';
  @state() private creating: 'line' | 'color' | null = null;
  @state() private draft = { manufacturer: '', line: '', base: 'PLA' as BaseMaterial, color: '', hex: '#888888', hex2: '', finish: '' };

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    store().addEventListener('change', this.#onStore);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    store().removeEventListener('change', this.#onStore);
  }

  #onStore = () => this.requestUpdate();

  override render() {
    const doc = store().doc;
    const current = doc.filaments.find((f) => f.id === this.value);
    const lineId = current?.productLineId ?? this.pendingLine;
    // Deprecated lines/colors (FI-2b) are only listed when already chosen, so existing records still show them.
    const lines = doc.productLines.filter((l) => !l.deprecatedAt || l.id === lineId).sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name));
    const brands = [...new Set(lines.map((l) => l.manufacturer))];
    const colors = doc.filaments
      .filter((f) => f.productLineId === lineId && (!isFilamentDeprecated(doc, f) || f.id === this.value))
      .sort((a, b) => a.color.localeCompare(b.color));

    return html`
      <div class="d-flex gap-1">
        <select class="form-select form-select-sm" aria-label="Product line" @change=${this.#pickLine}>
          <option value="" ?selected=${!lineId}>Product line…</option>
          ${brands.map((brand) => html`<optgroup label=${brand}>
            ${lines.filter((l) => l.manufacturer === brand).map((l) => html`<option value=${l.id} ?selected=${l.id === lineId}>${l.manufacturer} ${l.name}${l.deprecatedAt ? ' · deprecated' : ''}</option>`)}
          </optgroup>`)}
          <option value=${NEW} ?selected=${this.creating === 'line'}>+ New product line…</option>
        </select>
        <select class="form-select form-select-sm" aria-label="Color" ?disabled=${!lineId || this.creating === 'line'} @change=${this.#pickColor}>
          <option value="" ?selected=${!current}>Color…</option>
          ${colors.map((f) => html`<option value=${f.id} ?selected=${f.id === this.value}>${colorLabel(f)}</option>`)}
          ${lineId ? html`<option value=${NEW} ?selected=${this.creating === 'color'}>+ New color…</option>` : nothing}
        </select>
        ${current?.colorHex ? html`<span class="align-self-center">${swatch(current, '1rem', current.color)}</span>` : nothing}
      </div>
      ${this.creating ? this.#form(lines) : nothing}
    `;
  }

  #form(lines: ProductLine[]) {
    const d = this.draft;
    const set = (patch: Partial<typeof d>) => (this.draft = { ...d, ...patch });
    const input = (key: keyof typeof d) => (e: Event) => set({ [key]: (e.target as HTMLInputElement).value } as Partial<typeof d>);
    const brands = [...new Set(lines.map((l) => l.manufacturer))];
    const valid = d.color.trim() && (this.creating === 'color' || (d.manufacturer.trim() && d.line.trim()));
    return html`
      <div class="border rounded p-2 mt-1 bg-body-tertiary" @change=${(e: Event) => e.stopPropagation()}>
        ${this.creating === 'line'
          ? html`<div class="row g-1 mb-1">
              <div class="col-5"><input class="form-control form-control-sm" placeholder="Brand, e.g. SUNLU" aria-label="Brand" list="picker-brands" .value=${d.manufacturer} @input=${input('manufacturer')} />
                <datalist id="picker-brands">${brands.map((b) => html`<option value=${b}></option>`)}</datalist></div>
              <div class="col-4"><input class="form-control form-control-sm" placeholder="Line, e.g. PLA+ 2.0" aria-label="Product line" .value=${d.line} @input=${input('line')} /></div>
              <div class="col-3"><select class="form-select form-select-sm" aria-label="Base material" @change=${input('base')}>
                ${BASE_MATERIALS.map((b) => html`<option ?selected=${b === d.base}>${b}</option>`)}
              </select></div>
            </div>`
          : nothing}
        <div class="d-flex gap-1">
          <input class="form-control form-control-sm" placeholder="Color, e.g. Black" aria-label="Color name" .value=${d.color} @input=${input('color')}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && valid) { e.preventDefault(); void this.#create(); } }} />
          <span class="align-self-center">${colorButton({ colorHex: d.hex, colorHex2: d.hex2 || undefined, finish: d.finish }, (c) => set({ hex: c.colorHex, hex2: c.colorHex2 ?? '', finish: c.finish ?? '' }), { size: '1.6rem', title: 'Color and finish' })}</span>
          <input class="form-control form-control-sm" style="max-width: 7rem" placeholder="Finish (opt.)" aria-label="Finish" .value=${d.finish} @input=${input('finish')} />
          <button class="btn btn-sm btn-primary" ?disabled=${!valid} @click=${this.#create}>Add</button>
          <button class="btn btn-sm btn-link" @click=${() => (this.creating = null)}>Cancel</button>
        </div>
      </div>
    `;
  }

  #pickLine = (e: Event) => {
    e.stopPropagation();
    const v = (e.target as HTMLSelectElement).value;
    if (v === NEW) {
      this.creating = 'line';
      return;
    }
    this.creating = null;
    this.pendingLine = v;
    // A new line means the old color no longer applies; preselect the only color if there is one.
    const doc = store().doc;
    const colors = doc.filaments.filter((f) => f.productLineId === v && !isFilamentDeprecated(doc, f));
    this.#emit(colors.length === 1 ? colors[0]!.id : '');
  };

  #pickColor = (e: Event) => {
    e.stopPropagation();
    const v = (e.target as HTMLSelectElement).value;
    if (v === NEW) {
      this.creating = 'color';
      return;
    }
    this.creating = null;
    this.#emit(v);
  };

  #create = async () => {
    const d = this.draft;
    const doc = store().doc;
    let lineId = doc.filaments.find((f) => f.id === this.value)?.productLineId ?? this.pendingLine;
    const filamentId = newId();
    await store().update((doc) => {
      if (this.creating === 'line') {
        const existing = doc.productLines.find((l) => l.manufacturer.toLowerCase() === d.manufacturer.trim().toLowerCase() && l.name.toLowerCase() === d.line.trim().toLowerCase());
        lineId = existing?.id ?? newId();
        if (!existing) {
          doc.productLines.push({ id: lineId, manufacturer: d.manufacturer.trim(), name: d.line.trim(), baseMaterial: d.base, materialProfileId: matchingProfile(doc.materialProfiles, d.base), diameterMm: 1.75 });
        }
      }
      doc.filaments.push({
        id: filamentId, productLineId: lineId, color: d.color.trim(), colorHex: d.hex, ...(d.hex2 ? { colorHex2: d.hex2 } : {}), finish: d.finish.trim() || null,
        link: null, asin: null, status: 'owned',
      });
    });
    this.creating = null;
    this.pendingLine = lineId;
    this.draft = { ...d, color: '', hex2: '', finish: '' };
    this.#emit(filamentId);
  };

  #emit(id: string) {
    this.value = id;
    this.dispatchEvent(new CustomEvent('filament-change', { detail: id, bubbles: true, composed: true }));
  }
}

function colorLabel(f: Filament): string {
  return `${f.color}${f.finish ? ` (${f.finish})` : ''}${f.status === 'wishlist' ? ' · wishlist' : ''}${f.deprecatedAt ? ' · deprecated' : ''}`;
}

/** A new line gets the material profile named like its base material, if there is one (for the power table). */
function matchingProfile(profiles: { id: string; name: string; baseMaterial: BaseMaterial }[], base: BaseMaterial): string | null {
  return (profiles.find((p) => p.name === base) ?? profiles.find((p) => p.baseMaterial === base))?.id ?? null;
}

/** Template helper: `${pickFilament(value, (id) => …)}`. */
export function pickFilament(value: string, onChange: (filamentId: string) => void) {
  return html`<filament-picker .value=${value} @filament-change=${(e: CustomEvent<string>) => onChange(e.detail)}></filament-picker>`;
}
