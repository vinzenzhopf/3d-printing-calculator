import { html, nothing, render } from 'lit';
import { hexToHsl, swatchBackground, type ColorLook } from '../core/colors';
import { pickColorFromCamera } from './camera-color';

/** Common filament colors, for a quick start on the phone. */
const PALETTE: [string, string][] = [
  ['White', '#FFFFFF'], ['Ivory', '#F3EFE0'], ['Beige', '#D8C3A0'], ['Silver', '#C4C4C4'], ['Grey', '#808080'], ['Dark grey', '#404040'], ['Black', '#1A1A1A'],
  ['Red', '#C62828'], ['Dark red', '#7F1D1D'], ['Pink', '#F06292'], ['Magenta', '#C2185B'], ['Orange', '#F57C00'], ['Yellow', '#FDD835'], ['Gold', '#C9A227'],
  ['Lime', '#9ACD32'], ['Green', '#2E7D32'], ['Dark green', '#1B5E20'], ['Mint', '#98E0C5'], ['Teal', '#00897B'], ['Light blue', '#64B5F6'], ['Blue', '#1565C0'],
  ['Navy', '#1A237E'], ['Purple', '#6A1B9A'], ['Lilac', '#B39DDB'], ['Brown', '#6D4C41'], ['Copper', '#B87333'], ['Skin', '#F1C27D'], ['Olive', '#6B6B2A'],
];
const FINISHES = ['Matte', 'Silk', 'Transparent', 'Glitter', 'Marble', 'Glow'];

export interface PickedColor {
  colorHex: string;
  colorHex2?: string;
  finish: string | null;
}

const normalize = (v: string) => {
  const t = v.trim();
  const hex = t.startsWith('#') ? t : `#${t}`;
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null;
};

/**
 * Color dialog instead of the browser's color input (hard to use on phones):
 * palette, hex code, camera, a second color for color-shift / dual-color
 * filaments, and the finish. Resolves null when cancelled.
 */
export function pickColor(initial: ColorLook): Promise<PickedColor | null> {
  return new Promise((resolve) => {
    const state = {
      colors: [initial.colorHex && hexToHsl(initial.colorHex) ? initial.colorHex.toUpperCase() : '#808080', initial.colorHex2?.toUpperCase() ?? ''] as [string, string],
      two: !!initial.colorHex2,
      slot: 0 as 0 | 1,
      finish: initial.finish ?? '',
      hexDraft: null as string | null,
    };
    const dialog = document.createElement('dialog');
    dialog.className = 'border-0 rounded-3 shadow p-0';
    dialog.style.maxWidth = 'min(26rem, calc(100vw - 1rem))';
    document.body.append(dialog);

    const close = (result: PickedColor | null) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.addEventListener('cancel', () => close(null));
    const setColor = (hex: string) => {
      state.colors[state.slot] = hex;
      state.hexDraft = null;
      draw();
    };
    const camera = async () => {
      dialog.close();
      const hex = await pickColorFromCamera();
      dialog.showModal();
      if (hex) setColor(hex);
    };

    const draw = () => {
      const [c1, c2] = state.colors;
      const current = state.colors[state.slot] || '#808080';
      const look = { colorHex: c1, colorHex2: state.two ? c2 || undefined : undefined, finish: state.finish };
      const slotButton = (i: 0 | 1, label: string) => html`<button type="button"
        class="btn btn-sm d-flex align-items-center gap-2 ${state.slot === i ? 'btn-outline-primary active' : 'btn-outline-secondary'}"
        @click=${() => { state.slot = i; state.hexDraft = null; draw(); }}>
        <span class="rounded-circle border" style="width:1.25rem;height:1.25rem;background:${state.colors[i] || 'transparent'}"></span>${label}</button>`;
      render(html`
        <div class="p-3 bg-body text-body">
          <div class="d-flex align-items-center gap-3 mb-3">
            <span class="rounded-circle border flex-shrink-0" style="width:4rem;height:4rem;background:${swatchBackground(look)}"></span>
            <div class="flex-grow-1">
              <label class="form-label small mb-1">Hex code</label>
              <div class="d-flex gap-1">
                <input class="form-control font-monospace" aria-label="Hex code" maxlength="7" autocapitalize="characters"
                  .value=${state.hexDraft ?? current}
                  @input=${(e: Event) => { const v = (e.target as HTMLInputElement).value; state.hexDraft = v; const hex = normalize(v); if (hex) { state.colors[state.slot] = hex; draw(); } }} />
                <input type="color" class="form-control form-control-color flex-shrink-0" title="System color picker" aria-label="System color picker"
                  .value=${current.toLowerCase()} @input=${(e: Event) => setColor((e.target as HTMLInputElement).value.toUpperCase())} />
              </div>
            </div>
          </div>
          <div class="d-flex flex-wrap gap-1 mb-2" role="group" aria-label="Palette">
            ${PALETTE.map(([name, hex]) => html`<button type="button" class="btn p-0 rounded-circle border ${current === hex ? 'border-primary border-3' : ''}"
              style="width:2.1rem;height:2.1rem;background:${hex}" title=${name} aria-label=${name} @click=${() => setColor(hex)}></button>`)}
          </div>
          <button type="button" class="btn btn-outline-secondary w-100 mb-3" @click=${camera}>📷 Take the color from the camera</button>

          <div class="form-check form-switch mb-2">
            <input class="form-check-input" type="checkbox" role="switch" id="color-two" .checked=${state.two}
              @change=${(e: Event) => { state.two = (e.target as HTMLInputElement).checked; state.slot = state.two ? 1 : 0; if (state.two && !state.colors[1]) state.colors[1] = state.colors[0]; draw(); }} />
            <label class="form-check-label" for="color-two">Two colors (color shift, dual color, gradient)</label>
          </div>
          ${state.two ? html`<div class="d-flex gap-2 mb-3">${slotButton(0, 'Color 1')}${slotButton(1, 'Color 2')}</div>` : nothing}

          <label class="form-label small mb-1">Finish</label>
          <div class="d-flex flex-wrap gap-1 mb-1">
            ${FINISHES.map((f) => html`<button type="button" class="btn btn-sm ${state.finish.toLowerCase() === f.toLowerCase() ? 'btn-primary' : 'btn-outline-secondary'}"
              @click=${() => { state.finish = state.finish.toLowerCase() === f.toLowerCase() ? '' : f; draw(); }}>${f}</button>`)}
          </div>
          <input class="form-control form-control-sm mb-3" aria-label="Finish" placeholder="or type, e.g. Silk dual color" .value=${state.finish}
            @input=${(e: Event) => { state.finish = (e.target as HTMLInputElement).value; draw(); }} />

          <div class="d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-outline-secondary" @click=${() => close(null)}>Cancel</button>
            <button type="button" class="btn btn-primary" @click=${() => close({
              colorHex: c1,
              ...(state.two && c2 && c2 !== c1 ? { colorHex2: c2 } : {}),
              finish: state.finish.trim() || null,
            })}>Use</button>
          </div>
        </div>`, dialog);
    };
    draw();
    dialog.showModal();
  });
}

/** Swatch button that opens the color dialog. */
export function colorButton(look: ColorLook, onPick: (picked: PickedColor) => void, opts: { size?: string; title?: string } = {}) {
  const size = opts.size ?? '1.75rem';
  return html`<button type="button" class="btn p-0 rounded-circle border flex-shrink-0" title=${opts.title ?? 'Change color'} aria-label=${opts.title ?? 'Change color'}
    style="width:${size};height:${size};background:${swatchBackground(look)}"
    @click=${async () => { const picked = await pickColor(look); if (picked) onPick(picked); }}></button>`;
}

/** Applies a picked color to a filament (second color removed when there is none). */
export function applyColor(f: { colorHex?: string; colorHex2?: string; finish: string | null }, picked: PickedColor): void {
  f.colorHex = picked.colorHex;
  if (picked.colorHex2) f.colorHex2 = picked.colorHex2;
  else delete f.colorHex2;
  f.finish = picked.finish;
}
