import { describe, expect, it } from 'vitest';
import { finishLook, medianColor, swatchBackground } from '../src/core/colors';

describe('swatches', () => {
  it('reads the look from the finish text', () => {
    expect(['Silk', 'translucent', 'Galaxy', 'Matte', 'blend', null].map(finishLook)).toEqual(['silk', 'transparent', 'glitter', 'matte', 'plain', 'plain']);
  });

  it('draws one color, a gradient for two, and overlays for the finish', () => {
    expect(swatchBackground({ colorHex: '#ff0000' })).toBe('#ff0000');
    expect(swatchBackground({ colorHex: '#ff0000', colorHex2: '#0000ff' })).toBe('linear-gradient(135deg, #ff0000, #0000ff)');
    expect(swatchBackground({ colorHex: '#ff0000', finish: 'Silk' })).toMatch(/rgba\(255,255,255,.6\).*#ff0000/);
    expect(swatchBackground({ colorHex: '#ff0000', finish: 'Transparent' })).toMatch(/#ff000099.*repeating-conic-gradient/);
    expect(swatchBackground({})).toBe('transparent');
    expect(swatchBackground({ colorHex: 'nope' })).toBe('transparent');
  });
});

describe('medianColor', () => {
  it('ignores outliers like a highlight', () => {
    const px = [200, 10, 10, 255, 202, 12, 8, 255, 255, 255, 255, 255, 198, 9, 11, 255, 201, 10, 10, 255];
    expect(medianColor(px)).toBe('#C90A0A');
  });
});
