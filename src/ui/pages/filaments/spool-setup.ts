import { LitElement, html, nothing, svg } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LABEL_LAYOUTS, buildLabelPdf, labelCode, labelCodes, qrMatrix, type LabelLayout } from '../../../core/labels';
import type { AppDocument, SpoolType, TarePreset } from '../../../core/model';
import { isLabelCode } from '../../../core/stock';
import { StoreController } from '../../../state/app-store';
import { store } from '../../../state/store-instance';
import { cellNumber, cellSelect, cellText, numberField, selectField, switchField, textField, type Option } from '../../fields';
import { newId } from '../../format';
import { SPOOL_TYPES, lineLabel } from './labels';

const CUSTOM = 'custom';

/** Spool setup: printing QR labels for spools, and the empty-spool weights. */
@customElement('spool-setup')
export class SpoolSetup extends LitElement {
  #store = new StoreController(this, store());
  @state() private count = 0;
  @state() private startAt = 1;
  @state() private first = 0;
  @state() private caption = '3D Print Calc';
  @state() private outlines = false;
  @state() private baseUrl = `${location.origin}${location.pathname}`;
  @state() private done = '';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  #update(mutate: (doc: AppDocument) => void) {
    return this.#store.store.update(mutate);
  }

  override render() {
    return html`
      <div class="row g-3">
        <div class="col-xl-7">${this.#labels()}</div>
        <div class="col-xl-5">${this.#presets()}</div>
      </div>
    `;
  }

  // --- Label printing ---------------------------------------------------------

  #layout(): LabelLayout {
    const s = this.#doc.settings;
    if (s.labelLayoutId === CUSTOM && s.labelCustomLayout) return s.labelCustomLayout;
    return LABEL_LAYOUTS.find((l) => l.id === s.labelLayoutId) ?? LABEL_LAYOUTS[0]!;
  }

  /** Next free label number: the stored counter, but never below codes already in use. */
  #nextNumber(): number {
    const used = this.#doc.spools.filter((s) => isLabelCode(s.label)).map((s) => Number(s.label.slice(1)));
    return Math.max(this.#doc.settings.labelNextNumber ?? 1, ...used.map((n) => n + 1), 1);
  }

  #labels() {
    const doc = this.#doc;
    const layout = this.#layout();
    const perPage = layout.cols * layout.rows;
    const count = this.count || perPage - (this.startAt - 1);
    const first = this.first || this.#nextNumber();
    const options: Option[] = [...LABEL_LAYOUTS.map((l) => ({ value: l.id, label: l.name })), { value: CUSTOM, label: 'Custom…' }];
    const isCustom = doc.settings.labelLayoutId === CUSTOM;
    const setCustom = (mutate: (l: LabelLayout) => void) =>
      void this.#update((d) => {
        const l = d.settings.labelCustomLayout ?? { ...layout, id: CUSTOM, name: 'Custom' };
        mutate(l);
        d.settings.labelCustomLayout = l;
      });
    return html`
      <section class="card card-body">
        <h2 class="h5">Spool labels</h2>
        <p class="small text-body-secondary">
          Prints QR codes with label numbers (${labelCode(first)}…). Stick one on a spool and scan it with the phone
          camera: the first scan asks which spool it is, later scans open that spool to weigh it.
        </p>
        ${selectField('Label sheet', isCustom ? CUSTOM : layout.id, options, (v) =>
          void this.#update((d) => {
            d.settings.labelLayoutId = v;
            if (v === CUSTOM && !d.settings.labelCustomLayout) d.settings.labelCustomLayout = { ...layout, id: CUSTOM, name: 'Custom' };
          }))}
        ${isCustom
          ? html`<div class="row g-2 mb-3 small">
              ${([
                ['Columns', 'cols', 1], ['Rows', 'rows', 1], ['Label width (mm)', 'labelWidthMm', 0.1], ['Label height (mm)', 'labelHeightMm', 0.1],
                ['Top margin (mm)', 'marginTopMm', 0.1], ['Left margin (mm)', 'marginLeftMm', 0.1], ['Horizontal pitch (mm)', 'pitchXMm', 0.01], ['Vertical pitch (mm)', 'pitchYMm', 0.01],
              ] as [string, keyof LabelLayout, number][]).map(([label, key, step]) => html`<div class="col-6 col-md-3"><label class="d-block">${label}${cellNumber(layout[key] as number, (v) => v && setCustom((l) => ((l[key] as number) = v)), { min: 0, step, title: label })}</label></div>`)}
              <div class="col-12 form-text">Pitch = distance from one label's edge to the next label's edge (label size + gap).</div>
            </div>`
          : nothing}
        <div class="row g-2">
          <div class="col-6 col-md-3">${numberField('Labels', count, (v) => (this.count = Math.max(1, Math.round(v))), { min: 1, step: 1, help: `${perPage} per sheet` })}</div>
          <div class="col-6 col-md-3">${numberField('Start at place', this.startAt, (v) => (this.startAt = Math.min(perPage, Math.max(1, Math.round(v)))), { min: 1, max: perPage, step: 1, help: 'for partly used sheets' })}</div>
          <div class="col-6 col-md-3">${numberField('First number', first, (v) => (this.first = Math.max(1, Math.round(v))), { min: 1, step: 1, help: `next free: ${this.#nextNumber()}` })}</div>
          <div class="col-6 col-md-3">${textField('Caption', this.caption, (v) => (this.caption = v))}</div>
        </div>
        ${textField('Link in the QR code', this.baseUrl, (v) => (this.baseUrl = v || `${location.origin}${location.pathname}`), { help: 'The app address the phone opens. Keep the default unless you host the app elsewhere.' })}
        ${switchField('Test print: draw label outlines', this.outlines, (v) => (this.outlines = v), { help: 'Print on plain paper and hold it against a label sheet to check the alignment. Set the printer to 100 % / actual size.' })}
        <div class="d-flex flex-wrap gap-3 align-items-center">
          ${this.#preview(layout, labelCode(first))}
          <div>
            <div class="mb-2">${labelCode(first)} – ${labelCode(first + count - 1)} · ${Math.ceil((count + this.startAt - 1) / perPage)} sheet(s)</div>
            <button class="btn btn-primary" @click=${() => this.#download(layout, first, count)}>Download PDF</button>
            ${this.done ? html`<div class="small text-success mt-2">${this.done}</div>` : nothing}
          </div>
        </div>
      </section>
    `;
  }

  /** One label at real proportions, as on the sheet. */
  #preview(layout: LabelLayout, code: string) {
    const m = qrMatrix(this.#url(code));
    const scale = 3; // px per mm
    const w = layout.labelWidthMm;
    const h = layout.labelHeightMm;
    const pad = Math.min(2, h * 0.1);
    const qr = Math.min(h - 2 * pad, w * 0.55);
    const cell = qr / m.length;
    return html`<svg width=${w * scale} height=${h * scale} viewBox="0 0 ${w} ${h}" role="img" aria-label="Label preview"
      style="border: 1px dashed var(--bs-border-color); border-radius: 2px; background: #fff">
      ${m.flatMap((row, r) => row.map((on, c) => (on ? svg`<rect x=${pad + c * cell} y=${(h - qr) / 2 + r * cell} width=${cell + 0.01} height=${cell + 0.01} fill="#000"></rect>` : nothing)))}
      <text x=${pad + qr + pad} y=${h / 2} font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size=${Math.min(6.3, (w - qr - 3 * pad) / (code.length * 0.6))} fill="#000">${code}</text>
      ${this.caption ? svg`<text x=${pad + qr + pad} y=${h / 2 + 3.4} font-family="Helvetica, Arial, sans-serif" font-size="2.1" fill="#000">${this.caption}</text>` : nothing}
    </svg>`;
  }

  #url(code: string): string {
    return `${this.baseUrl.replace(/#.*$/, '')}#/spool/${code}`;
  }

  #download(layout: LabelLayout, first: number, count: number) {
    const codes = labelCodes(first, count);
    const pdf = buildLabelPdf({ layout, codes, urlFor: (c) => this.#url(c), startAt: this.startAt - 1, caption: this.caption || undefined, outlines: this.outlines });
    const url = URL.createObjectURL(new Blob([pdf.slice()], { type: 'application/pdf' }));
    const name = this.outlines ? `labels-test-${codes[0]}.pdf` : `labels-${codes[0]}-${codes.at(-1)}.pdf`;
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (!this.outlines) {
      // Continue the sequence next time (test prints don't use up numbers).
      void this.#update((d) => (d.settings.labelNextNumber = Math.max(d.settings.labelNextNumber ?? 1, first + count)));
      this.first = 0;
      this.done = `Downloaded ${name}. Next print continues at ${labelCode(first + count)}.`;
    } else {
      this.done = `Downloaded ${name} (test print, numbers not used up).`;
    }
  }

  // --- Empty-spool weights ------------------------------------------------------

  #presets() {
    const doc = this.#doc;
    const lines: Option[] = [{ value: '', label: 'any line' }, ...doc.productLines.map((l) => ({ value: l.id, label: lineLabel(l) }))];
    const set = (id: string, mutate: (p: TarePreset) => void) => void this.#update((d) => mutate(d.tarePresets.find((p) => p.id === id)!));
    return html`
      <section class="card card-body">
        <h2 class="h5">Empty-spool weights</h2>
        <p class="small text-body-secondary">Turn scale readings into filament weight. A spool's own measured weight wins, then product line, then brand, then the generic values. Weighing an empty spool ("This is the empty spool") updates them.</p>
        <div class="table-responsive"><table class="table table-sm align-middle">
          <thead><tr><th>Brand</th><th>Product line</th><th>Spool</th><th>Empty (g)</th><th title="Verified">✓</th><th></th></tr></thead>
          <tbody>
            ${doc.tarePresets.map((p) => html`<tr title=${p.source}>
              <td>${cellText(p.manufacturer, (v) => set(p.id, (x) => (x.manufacturer = v || null)), { title: 'Brand', placeholder: 'any' })}</td>
              <td>${cellSelect(p.productLineId ?? '', lines, (v) => set(p.id, (x) => (x.productLineId = v || null)), true, 'Product line')}</td>
              <td>${cellSelect(p.spoolType, SPOOL_TYPES, (v) => set(p.id, (x) => (x.spoolType = v as SpoolType)), true, 'Spool type')}</td>
              <td style="width: 6rem">${cellNumber(p.emptyG, (v) => set(p.id, (x) => (x.emptyG = v ?? 0)), { min: 0, title: 'Empty grams' })}</td>
              <td><input class="form-check-input" type="checkbox" aria-label="Verified" .checked=${p.verified} @change=${(e: Event) => set(p.id, (x) => (x.verified = (e.target as HTMLInputElement).checked))} /></td>
              <td><button class="btn btn-sm btn-link text-danger" title="Delete" @click=${() => void this.#update((d) => (d.tarePresets = d.tarePresets.filter((x) => x.id !== p.id)))}>✕</button></td>
            </tr>`)}
          </tbody>
        </table></div>
        <div><button class="btn btn-sm btn-outline-primary" @click=${() => void this.#update((d) => d.tarePresets.push({ id: newId(), manufacturer: null, productLineId: null, spoolType: 'plastic', emptyG: 200, source: 'manual', verified: false }))}>+ Add weight</button></div>
      </section>
    `;
  }
}
