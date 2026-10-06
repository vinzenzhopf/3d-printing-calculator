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
