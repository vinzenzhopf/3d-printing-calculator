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

/** A4 sheet of gapless labels centered on the page (the Avery Zweckform top sellers). */
function zweckform(articles: string, cols: number, rows: number, w: number, h: number): LabelLayout {
  const round = (mm: number) => Math.round(mm * 100) / 100;
  const per = cols * rows;
  return {
    id: `zweckform-${articles.split(' / ')[1]}`,
    name: `Avery Zweckform ${articles} – ${w} × ${h} mm, ${per} per sheet`,
    pageWidthMm: 210, pageHeightMm: 297, cols, rows, labelWidthMm: w, labelHeightMm: h,
    marginTopMm: round((297 - rows * h) / 2), marginLeftMm: round((210 - cols * w) / 2), pitchXMm: w, pitchYMm: h,
  };
}

/**
 * Common A4 label sheets. Values follow the manufacturers' templates; check
 * with a test print on plain paper ("outlines" option) before using labels.
 */
export const LABEL_LAYOUTS: LabelLayout[] = [
  // The owner's sheets (default): 4 × 10, no gaps, centered on A4 → 8 mm side and 21 mm top margins.
  { id: 'a4-40-48x25', name: '48.5 × 25.5 mm, 40 per sheet (4 × 10, centered)', pageWidthMm: 210, pageHeightMm: 297, cols: 4, rows: 10, labelWidthMm: 48.5, labelHeightMm: 25.5, marginTopMm: 21, marginLeftMm: 8, pitchXMm: 48.5, pitchYMm: 25.5 },
  // Avery Zweckform top sellers, article numbers for packs of 30 / 100 / 200 sheets.
  zweckform('6119 / 3478 / 3478-200', 1, 1, 210, 297),
  zweckform('6176 / 3655 / 3655-200', 1, 2, 210, 148),
  zweckform('6120 / 3483 / 3483-200', 2, 2, 105, 148),
  zweckform('6138 / 3427 / 3427-200', 2, 4, 105, 74),
  zweckform('4781 / 3659 / 3659-200', 2, 6, 97, 42.3),
  zweckform('6174 / 3652 / 3652-200', 3, 7, 70, 42.3),
  zweckform('3490 / 3475 / 3475-200', 3, 8, 70, 36),
  zweckform('4780 / 3657 / 3657-200', 4, 10, 48.5, 25.4),
  zweckform('4785 / 3667 / 3667-200', 4, 16, 48.5, 16.9),
  zweckform('6121 / 3666 / 3666-200', 5, 13, 38, 21.2),
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
  /** Small text under the code, one line per line break, e.g. "3D Print Calc" and "print.example.com". */
  caption?: string;
  /** Draw label borders, for a test print on plain paper. */
  outlines?: boolean;
  /**
   * Printer correction in mm, applied to everything on the page (codes, texts,
   * outlines): positive moves down/right. For printers that print off-position.
   */
  offsetXMm?: number;
  offsetYMm?: number;
}

const MM_PER_PT = 25.4 / 72;

/** One text line on a label: baseline position relative to the label's top-left corner. */
export interface LabelTextLine {
  text: string;
  xMm: number;
  yMm: number;
  sizePt: number;
  bold: boolean;
}

export interface LabelArtwork {
  pad: number;
  qrSize: number;
  lines: LabelTextLine[];
}

/**
 * Where the QR code and the texts go on one label: the code in bold, the caption
 * lines below it, each as large as fits next to the QR code, and the block
 * centered vertically. Shared by the PDF and the on-screen preview.
 */
export function labelArtwork(layout: LabelLayout, code: string, caption = ''): LabelArtwork {
  const w = layout.labelWidthMm;
  const h = layout.labelHeightMm;
  const pad = Math.min(2, h * 0.1);
  const qrSize = Math.min(h - 2 * pad, w * 0.55);
  const textX = pad + qrSize + pad;
  const textWidth = w - textX - pad;
  const captionLines = h >= 12 ? caption.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];

  const fit = (text: string, start: number, min: number, bold: boolean) => {
    let size = start;
    while (size > min && textWidthMm(text, size, bold) > textWidth) size -= 0.25;
    return size;
  };
  let codeSize = fit(code, 18, 5, true);
  let captionSizes = captionLines.map((l) => fit(l, Math.min(6, codeSize * 0.5), 3, false));
  // Shrink everything when the block is taller than the label.
  const height = () => codeSize * 0.75 * MM_PER_PT + captionSizes.reduce((sum, s) => sum + s * 1.25 * MM_PER_PT, 0);
  const available = h - 2 * pad;
  if (height() > available) {
    const factor = available / height();
    codeSize *= factor;
    captionSizes = captionSizes.map((s) => s * factor);
  }

  let y = (h - height()) / 2 + codeSize * 0.75 * MM_PER_PT;
  const lines: LabelTextLine[] = [{ text: code, xMm: textX, yMm: y, sizePt: codeSize, bold: true }];
  captionLines.forEach((text, i) => {
    y += captionSizes[i]! * 1.25 * MM_PER_PT;
    lines.push({ text, xMm: textX, yMm: y, sizePt: captionSizes[i]!, bold: false });
  });
  return { pad, qrSize, lines };
}

/** One QR code + code text (+ caption lines) per label. */
export function buildLabelPdf(opts: LabelPdfOptions): Uint8Array {
  const { layout } = opts;
  const pdf = new PdfDocument(layout.pageWidthMm, layout.pageHeightMm);
  const positions = labelPositions(layout, opts.codes.length, opts.startAt ?? 0);
  const pages: PdfPage[] = [];

  opts.codes.forEach((code, i) => {
    const at = positions[i]!;
    const pos = { ...at, xMm: at.xMm + (opts.offsetXMm ?? 0), yMm: at.yMm + (opts.offsetYMm ?? 0) };
    while (pages.length <= pos.page) pages.push(pdf.addPage());
    const page = pages[pos.page]!;
    if (opts.outlines) page.outline(pos.xMm, pos.yMm, layout.labelWidthMm, layout.labelHeightMm);
    const art = labelArtwork(layout, code, opts.caption);
    drawQr(page, qrMatrix(opts.urlFor(code)), pos.xMm + art.pad, pos.yMm + (layout.labelHeightMm - art.qrSize) / 2, art.qrSize);
    for (const l of art.lines) page.text(pos.xMm + l.xMm, pos.yMm + l.yMm, l.sizePt, l.text, l.bold);
  });
  if (pages.length === 0) pdf.addPage();
  return pdf.build();
}
