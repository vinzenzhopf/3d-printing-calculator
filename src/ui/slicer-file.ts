import { parseGcodeText, parseSliceInfo, type SlicerEstimate } from '../core/slicer';
import { listZip } from '../core/zip';

const HEAD = 256 * 1024;
const TAIL = 512 * 1024;
const latin1 = new TextDecoder('latin1');

/** Head + tail of a (possibly huge) G-code file: the estimates are in comments at either end. */
async function headAndTail(blob: Blob): Promise<string> {
  if (blob.size <= HEAD + TAIL) return latin1.decode(await blob.arrayBuffer());
  const [head, tail] = await Promise.all([blob.slice(0, HEAD).arrayBuffer(), blob.slice(blob.size - TAIL).arrayBuffer()]);
  return `${latin1.decode(head)}\n${latin1.decode(tail)}`;
}

/**
 * Reads slicer estimates from a file picked by the user. The file is parsed
 * locally and never uploaded. Returns one estimate per sliced plate.
 */
export async function readSlicerFile(file: File): Promise<SlicerEstimate[]> {
  if (/\.3mf$/i.test(file.name)) {
    const entries = listZip(new Uint8Array(await file.arrayBuffer()));
    const info = entries.find((e) => e.name.toLowerCase() === 'metadata/slice_info.config');
    if (info) {
      const plates = parseSliceInfo(new TextDecoder().decode(await info.read())).filter((p) => p.printTimeMin !== null || p.filamentG.length > 0);
      if (plates.length > 0) return plates;
    }
    const gcodes = entries.filter((e) => /\.(b?gcode|gco)$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const results: SlicerEstimate[] = [];
    for (const entry of gcodes) {
      const estimate = parseGcodeText(await headAndTail(new Blob([(await entry.read()).slice()])));
      if (estimate) results.push(estimate);
    }
    if (results.length > 0) return results;
    throw new Error('This 3MF contains no slicing results. Slice it first and export the G-code (or a sliced .gcode.3mf).');
  }
  const estimate = parseGcodeText(await headAndTail(file));
  if (!estimate) throw new Error('No print time or filament usage found in this file. Supported: G-code / binary G-code from PrusaSlicer, OrcaSlicer, Bambu Studio, Cura; sliced 3MF.');
  return [estimate];
}
