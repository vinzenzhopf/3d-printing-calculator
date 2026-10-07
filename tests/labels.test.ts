import { describe, expect, it } from 'vitest';
import { LABEL_LAYOUTS, buildLabelPdf, labelArtwork, labelCodes, labelPositions, qrMatrix } from '../src/core/labels';
import { PdfDocument, textWidthMm } from '../src/core/pdf';

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

  it('preset ids are unique', () => {
    expect(new Set(LABEL_LAYOUTS.map((l) => l.id)).size).toBe(LABEL_LAYOUTS.length);
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

  it('moves everything by the printer offset', () => {
    const l = LABEL_LAYOUTS[0]!;
    const textPos = (out: string) => /([\d.]+) ([\d.]+) Td \(L0001\) Tj/.exec(out)!.slice(1).map(Number) as [number, number];
    const plain = textPos(text(buildLabelPdf({ layout: l, codes: ['L0001'], urlFor: (c) => c })));
    const moved = textPos(text(buildLabelPdf({ layout: l, codes: ['L0001'], urlFor: (c) => c, offsetYMm: 3.7, offsetXMm: -1 })));
    const pt = 72 / 25.4;
    expect(plain[1] - moved[1]).toBeCloseTo(3.7 * pt, 1); // PDF y grows upwards: down on paper = smaller y
    expect(moved[0] - plain[0]).toBeCloseTo(-1 * pt, 1);
  });

  it('stacks a multi-line caption below the code, inside the label and next to the QR code', () => {
    const l = LABEL_LAYOUTS[0]!; // 48.5 × 25.5 mm
    const art = labelArtwork(l, 'L0042', '3D-Print-Calc\n3dp.example.com\n\n');
    expect(art.lines.map((x) => [x.text, x.bold])).toEqual([['L0042', true], ['3D-Print-Calc', false], ['3dp.example.com', false]]);
    const ys = art.lines.map((x) => x.yMm);
    expect(ys).toEqual([...ys].sort((a, b) => a - b)); // top to bottom
    expect(ys[0]! - (art.lines[0]!.sizePt * 25.4) / 72).toBeGreaterThanOrEqual(art.pad - 0.01);
    expect(ys.at(-1)!).toBeLessThanOrEqual(l.labelHeightMm - art.pad + 0.01);
    for (const x of art.lines) expect(x.xMm + textWidthMm(x.text, x.sizePt, x.bold)).toBeLessThanOrEqual(l.labelWidthMm - art.pad + 0.01);
    const out = text(buildLabelPdf({ layout: l, codes: ['L0042'], urlFor: (c) => c, caption: '3D-Print-Calc\n3dp.example.com' }));
    expect(out).toContain('(3D-Print-Calc) Tj');
    expect(out).toContain('(3dp.example.com) Tj');
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
