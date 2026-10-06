import { describe, expect, it } from 'vitest';
import { LABEL_LAYOUTS, buildLabelPdf, labelCodes, labelPositions, qrMatrix } from '../src/core/labels';
import { PdfDocument } from '../src/core/pdf';

const l7651 = LABEL_LAYOUTS.find((l) => l.id === 'avery-l7651')!;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('label codes and positions', () => {
  it('numbers codes with a fixed width', () => {
    expect(labelCodes(41, 3)).toEqual(['L0041', 'L0042', 'L0043']);
  });

  it('fills a sheet row by row and continues on the next page', () => {
    const p = labelPositions(l7651, 67);
    expect(p[0]).toEqual({ page: 0, xMm: 4.75, yMm: 10.7 });
    expect(p[6]).toEqual({ page: 0, xMm: 4.75 + 40.64, yMm: 10.7 + 21.2 });
    expect(p[65]).toEqual({ page: 1, xMm: 4.75, yMm: 10.7 });
  });

  it('skips already used places on a partly used sheet', () => {
    expect(labelPositions(l7651, 1, 7)[0]).toEqual({ page: 0, xMm: 4.75 + 2 * 40.64, yMm: 10.7 + 21.2 });
  });

  it('every preset fits on its page', () => {
    for (const l of LABEL_LAYOUTS) {
      expect(l.marginLeftMm + (l.cols - 1) * l.pitchXMm + l.labelWidthMm).toBeLessThanOrEqual(l.pageWidthMm);
      expect(l.marginTopMm + (l.rows - 1) * l.pitchYMm + l.labelHeightMm).toBeLessThanOrEqual(l.pageHeightMm + 0.01);
    }
  });
});

describe('QR codes', () => {
  it('encodes an app link into a square matrix', () => {
    const m = qrMatrix('https://vinzenzhopf.github.io/3d-printing-calculator/#/spool/L0042');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    // finder pattern corner
    expect(m[0]![0]).toBe(true);
  });
});

describe('PDF', () => {
  it('writes a valid structure with correct xref offsets', () => {
    const pdf = new PdfDocument();
    pdf.addPage().text(10, 10, 12, 'Test (1)');
    const out = text(pdf.build());
    expect(out.startsWith('%PDF-1.4')).toBe(true);
    expect(out).toContain('(Test \\(1\\)) Tj');
    const startxref = Number(/startxref\n(\d+)/.exec(out)![1]);
    expect(out.slice(startxref, startxref + 4)).toBe('xref');
    const firstObj = Number(/\n(\d{10}) 00000 n/.exec(out)![1]);
    expect(out.slice(firstObj, firstObj + 7)).toBe('1 0 obj');
  });

  it('puts one QR code and code per label, on as many pages as needed', () => {
    const out = text(buildLabelPdf({ layout: l7651, codes: labelCodes(1, 70), urlFor: (c) => `https://x/#/spool/${c}`, caption: 'Spool' }));
    expect(out.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(out).toContain('(L0001) Tj');
    expect(out).toContain('(L0070) Tj');
    expect(out.match(/\(Spool\) Tj/g)).toHaveLength(70);
  });
});

describe('default layout (owner\'s 48.5 × 25.5 mm sheets)', () => {
  it('is centered on A4 with 40 labels', () => {
    const l = LABEL_LAYOUTS[0]!;
    expect(l.cols * l.rows).toBe(40);
    const right = 210 - (l.marginLeftMm + (l.cols - 1) * l.pitchXMm + l.labelWidthMm);
    const bottom = 297 - (l.marginTopMm + (l.rows - 1) * l.pitchYMm + l.labelHeightMm);
    expect(right).toBeCloseTo(l.marginLeftMm, 6);
    expect(bottom).toBeCloseTo(l.marginTopMm, 6);
  });
});
