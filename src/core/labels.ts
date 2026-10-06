import { encode } from 'uqr';
import { PdfDocument, textWidthMm, type PdfPage } from './pdf';

/** A sheet of pre-cut labels (A4 unless stated), all sizes in mm. */
export interface LabelLayout {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  cols: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  /** Top-left corner of the first label. */
  marginTopMm: number;
  marginLeftMm: number;
  /** Distance from one label's left/top edge to the next one's. */
  pitchXMm: number;
  pitchYMm: number;
}

/**
 * Common A4 label sheets. Values follow the manufacturers' templates; check
 * with a test print on plain paper ("outlines" option) before using labels.
 */
export const LABEL_LAYOUTS: LabelLayout[] = [
  // The owner's sheets (default): 4 × 10, no gaps, centered on A4 → 8 mm side and 21 mm top margins.
  { id: 'a4-40-48x25', name: '48.5 × 25.5 mm, 40 per sheet (4 × 10, centered)', pageWidthMm: 210, pageHeightMm: 297, cols: 4, rows: 10, labelWidthMm: 48.5, labelHeightMm: 25.5, marginTopMm: 21, marginLeftMm: 8, pitchXMm: 48.5, pitchYMm: 25.5 },
  { id: 'avery-l7651', name: 'Avery L7651 – 38.1 × 21.2 mm, 65 per sheet', pageWidthMm: 210, pageHeightMm: 297, cols: 5, rows: 13, labelWidthMm: 38.1, labelHeightMm: 21.2, marginTopMm: 10.7, marginLeftMm: 4.75, pitchXMm: 40.64, pitchYMm: 21.2 },
  { id: 'avery-l4736', name: 'Avery L4736 – 45.7 × 21.2 mm, 48 per sheet', pageWidthMm: 210, pageHeightMm: 297, cols: 4, rows: 12, labelWidthMm: 45.7, labelHeightMm: 21.2, marginTopMm: 21.6, marginLeftMm: 9.85, pitchXMm: 48.26, pitchYMm: 21.2 },
  { id: 'avery-l4732', name: 'Avery L4732 – 35.6 × 16.9 mm, 80 per sheet', pageWidthMm: 210, pageHeightMm: 297, cols: 5, rows: 16, labelWidthMm: 35.6, labelHeightMm: 16.9, marginTopMm: 13.5, marginLeftMm: 11.0, pitchXMm: 38.1, pitchYMm: 16.9 },
  { id: 'avery-l7160', name: 'Avery L7160 – 63.5 × 38.1 mm, 21 per sheet', pageWidthMm: 210, pageHeightMm: 297, cols: 3, rows: 7, labelWidthMm: 63.5, labelHeightMm: 38.1, marginTopMm: 15.15, marginLeftMm: 7.25, pitchXMm: 66.04, pitchYMm: 38.1 },
];

export const LABEL_PREFIX = 'L';

/** "L0042" */
export function labelCode(n: number): string {
  return `${LABEL_PREFIX}${String(n).padStart(4, '0')}`;
}

/** Codes for a print run of `count` labels starting at number `first`. */
export function labelCodes(first: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => labelCode(first + i));
}

export interface LabelPosition {
  page: number;
  xMm: number;
  yMm: number;
}

/** Positions for `count` labels, skipping the first `startAt` places (partly used sheet). */
export function labelPositions(layout: LabelLayout, count: number, startAt = 0): LabelPosition[] {
  const perPage = layout.cols * layout.rows;
  return Array.from({ length: count }, (_, i) => {
    const slot = i + startAt;
    const onPage = slot % perPage;
    return {
      page: Math.floor(slot / perPage),
      xMm: layout.marginLeftMm + (onPage % layout.cols) * layout.pitchXMm,
      yMm: layout.marginTopMm + Math.floor(onPage / layout.cols) * layout.pitchYMm,
    };
  });
}

/** QR matrix for a text (error correction M: survives scratches on a spool). */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 0 }).data;
}

/** Draws a QR matrix as merged horizontal runs of filled rectangles. */
function drawQr(page: PdfPage, matrix: boolean[][], xMm: number, yMm: number, sizeMm: number): void {
  const module = sizeMm / matrix.length;
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      // Slight overlap avoids hairline gaps between modules in some viewers.
      page.rect(xMm + start * module, yMm + r * module, (c - start) * module + 0.01, module + 0.01);
    }
  });
}

export interface LabelPdfOptions {
  layout: LabelLayout;
  codes: string[];
  /** Content of the QR code for a label code (a link into the app). */
  urlFor: (code: string) => string;
  startAt?: number;
  /** Small text under the code, e.g. "3D Print Calc". */
  caption?: string;
  /** Draw label borders, for a test print on plain paper. */
  outlines?: boolean;
}

/** One QR code + code text per label. */
export function buildLabelPdf(opts: LabelPdfOptions): Uint8Array {
  const { layout } = opts;
  const pdf = new PdfDocument(layout.pageWidthMm, layout.pageHeightMm);
  const positions = labelPositions(layout, opts.codes.length, opts.startAt ?? 0);
  const pages: PdfPage[] = [];
  const pad = Math.min(2, layout.labelHeightMm * 0.1);
  const qrSize = Math.min(layout.labelHeightMm - 2 * pad, layout.labelWidthMm * 0.55);
  const textX = pad + qrSize + pad;
  const textWidth = layout.labelWidthMm - textX - pad;

  opts.codes.forEach((code, i) => {
    const pos = positions[i]!;
    while (pages.length <= pos.page) pages.push(pdf.addPage());
    const page = pages[pos.page]!;
    if (opts.outlines) page.outline(pos.xMm, pos.yMm, layout.labelWidthMm, layout.labelHeightMm);
    drawQr(page, qrMatrix(opts.urlFor(code)), pos.xMm + pad, pos.yMm + (layout.labelHeightMm - qrSize) / 2, qrSize);
    // Largest code text that fits next to the QR code.
    let size = 18;
    while (size > 5 && textWidthMm(code, size, true) > textWidth) size -= 0.5;
    const centerY = pos.yMm + layout.labelHeightMm / 2;
    const captionSize = Math.min(6, size * 0.5);
    const hasCaption = !!opts.caption && layout.labelHeightMm >= 15;
    page.text(pos.xMm + textX, centerY + (hasCaption ? 0 : (size * 0.35) / (72 / 25.4)), size, code, true);
    if (hasCaption) page.text(pos.xMm + textX, centerY + (captionSize * 1.6) / (72 / 25.4), captionSize, opts.caption!);
  });
  if (pages.length === 0) pdf.addPage();
  return pdf.build();
}
