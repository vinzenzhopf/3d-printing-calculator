/**
 * Minimal PDF writer: pages with filled rectangles and Helvetica text, in
 * millimeters from the top-left corner. Enough for label sheets; no dependencies.
 */
const PT_PER_MM = 72 / 25.4;
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

export class PdfPage {
  readonly ops: string[] = [];
  constructor(readonly heightMm: number) {}

  /** Filled black rectangle. */
  rect(xMm: number, yMm: number, wMm: number, hMm: number): void {
    const y = this.heightMm - yMm - hMm;
    this.ops.push(`${fmt(xMm * PT_PER_MM)} ${fmt(y * PT_PER_MM)} ${fmt(wMm * PT_PER_MM)} ${fmt(hMm * PT_PER_MM)} re f`);
  }

  /** Text with its baseline at yMm. ASCII only (codes, numbers). */
  text(xMm: number, yMm: number, sizePt: number, text: string, bold = false): void {
    const safe = text.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
    const y = (this.heightMm - yMm) * PT_PER_MM;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${fmt(sizePt)} Tf ${fmt(xMm * PT_PER_MM)} ${fmt(y)} Td (${safe}) Tj ET`);
  }

  /** Thin outline (for test prints of a layout). */
  outline(xMm: number, yMm: number, wMm: number, hMm: number): void {
    const y = this.heightMm - yMm - hMm;
    this.ops.push(`0.2 w ${fmt(xMm * PT_PER_MM)} ${fmt(y * PT_PER_MM)} ${fmt(wMm * PT_PER_MM)} ${fmt(hMm * PT_PER_MM)} re S`);
  }
}

/** Approximate Helvetica text width (for fitting text into a label). */
export function textWidthMm(text: string, sizePt: number, bold = false): number {
  const avg = bold ? 0.6 : 0.55; // average glyph width in em for digits/capitals
  return (text.length * avg * sizePt) / PT_PER_MM;
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];
  constructor(
    readonly widthMm = 210,
    readonly heightMm = 297,
  ) {}

  addPage(): PdfPage {
    const page = new PdfPage(this.heightMm);
    this.pages.push(page);
    return page;
  }

  build(): Uint8Array {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object number
    const catalog = add('');
    const pages = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids: number[] = [];
    const box = `[0 0 ${fmt(this.widthMm * PT_PER_MM)} ${fmt(this.heightMm * PT_PER_MM)}]`;
    for (const page of this.pages) {
      const stream = page.ops.join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox ${box} /Contents ${content} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
    objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out); // ASCII only, so string offsets = byte offsets
  }
}
