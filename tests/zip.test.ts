import { describe, expect, it } from 'vitest';
import { listZip } from '../src/core/zip';

/** Builds a small ZIP with one stored and one deflated entry (CRC not checked by the reader). */
async function makeZip(files: { name: string; text: string; deflate: boolean }[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = enc.encode(f.text);
    const data = f.deflate
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
      : raw;
    const name = enc.encode(f.name);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, f.deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, f.deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

describe('listZip', () => {
  it('lists entries and reads stored and deflated content', async () => {
    const zip = await makeZip([
      { name: '[Content_Types].xml', text: '<Types/>', deflate: false },
      { name: 'Metadata/slice_info.config', text: '<config>'.padEnd(5000, 'x') + '</config>', deflate: true },
    ]);
    const entries = listZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['[Content_Types].xml', 'Metadata/slice_info.config']);
    expect(new TextDecoder().decode(await entries[0]!.read())).toBe('<Types/>');
    const info = new TextDecoder().decode(await entries[1]!.read());
    expect(info.startsWith('<config>xxx')).toBe(true);
    expect(info.length).toBe(5009);
  });

  it('rejects non-ZIP data', () => {
    expect(() => listZip(new TextEncoder().encode('G28\nG1 X0'.padEnd(100, ' ')))).toThrow('Not a ZIP file.');
  });
});
