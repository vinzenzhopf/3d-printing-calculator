/** Hue 0–360, saturation and lightness 0–1; null for anything that isn't `#rgb` / `#rrggbb`. */
export function hexToHsl(hex: string | undefined | null): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return null;
  const v = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/**
 * Sort key that arranges colors like a color picker: chromatic colors by hue
 * (red → yellow → green → blue → purple), then greys from white to black,
 * then filaments without a color.
 */
export function colorOrder(hex: string | undefined | null): number[] {
  const c = hexToHsl(hex);
  if (!c) return [2, 0, 0];
  if (c.s < 0.12 || c.l < 0.08 || c.l > 0.94) return [1, -c.l, 0];
  return [0, Math.round(c.h), -c.l];
}

export function compareColors(a: string | undefined | null, b: string | undefined | null): number {
  const ka = colorOrder(a);
  const kb = colorOrder(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
  return 0;
}

/** How a filament's surface looks, read from its free-text finish ("Silk", "translucent", "Galaxy"…). */
export type FinishLook = 'silk' | 'transparent' | 'glitter' | 'matte' | 'plain';

export function finishLook(finish: string | null | undefined): FinishLook {
  const f = finish?.toLowerCase() ?? '';
  if (/silk|satin|shiny|metallic/.test(f)) return 'silk';
  if (/transp|transl|clear/.test(f)) return 'transparent';
  if (/glitter|sparkle|galaxy|star|shimmer/.test(f)) return 'glitter';
  if (/matt/.test(f)) return 'matte';
  return 'plain';
}

export interface ColorLook {
  colorHex?: string;
  /** Second color of a color-shift / dual-color / gradient filament. */
  colorHex2?: string;
  finish?: string | null;
}

const CHECKER = 'repeating-conic-gradient(#d0d0d0 0 25%, #ffffff 0 50%) 0 0 / 8px 8px';
const SHEEN = 'linear-gradient(135deg, rgba(255,255,255,0) 25%, rgba(255,255,255,.6) 48%, rgba(255,255,255,0) 70%)';
const SPARKLES = [
  'radial-gradient(circle at 22% 30%, #fff 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 68% 22%, #fff 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 45% 64%, #fff 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 78% 72%, #fff 0 1px, transparent 1.6px)',
].join(', ');

/**
 * CSS `background` for a swatch: one color or a gradient of two, a sheen for
 * silk, a checkerboard shining through for transparent, sparkles for glitter.
 */
export function swatchBackground(look: ColorLook): string {
  const valid = (hex: string | undefined) => (hex && hexToHsl(hex) ? hex : undefined);
  const c1 = valid(look.colorHex);
  if (!c1) return 'transparent';
  const c2 = valid(look.colorHex2);
  const kind = finishLook(look.finish);
  const alpha = (hex: string) => (kind === 'transparent' ? `${hex}99` : hex);
  const base = c2 ? `linear-gradient(135deg, ${alpha(c1)}, ${alpha(c2)})` : `linear-gradient(${alpha(c1)}, ${alpha(c1)})`;
  if (kind === 'silk') return `${SHEEN}, ${base}`;
  if (kind === 'glitter') return `${SPARKLES}, ${base}`;
  if (kind === 'transparent') return `${base}, ${CHECKER}`;
  return c2 ? base : c1;
}

/** "#RRGGBB" from RGBA pixel data: the per-channel median, so a highlight or shadow in the sample doesn't skew it. */
export function medianColor(rgba: ArrayLike<number>): string {
  const channels: number[][] = [[], [], []];
  for (let i = 0; i + 3 < rgba.length; i += 4) for (let c = 0; c < 3; c++) channels[c]!.push(rgba[i + c]!);
  if (channels[0]!.length === 0) return '#000000';
  const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
  return `#${channels.map((v) => median(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
