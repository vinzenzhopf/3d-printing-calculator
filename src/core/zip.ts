/**
 * Minimal ZIP reader (stored and deflated entries), enough for 3MF files.
 * Uses the platform's DecompressionStream; no dependencies.
 */
export interface ZipEntry {
  name: string;
  read(): Promise<Uint8Array>;
}

export function listZip(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // End of central directory: last record with signature 0x06054b50 (comment may follow).
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory.');
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nameLength));
    entries.push({
      name,
      read: async () => {
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const raw = data.subarray(start, start + compressedSize);
        if (method === 0) return raw;
        if (method !== 8) throw new Error(`Unsupported ZIP compression ${method} in ${name}.`);
        const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      },
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
