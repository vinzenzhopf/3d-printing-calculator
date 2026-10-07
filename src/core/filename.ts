import type { BaseMaterial } from './model';
import { parseSlicerDuration } from './slicer';

const MATERIALS: BaseMaterial[] = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];

/** Material named in a file name or text ("…_PETG_MK3S_…"), if any. */
export function materialIn(text: string): BaseMaterial | undefined {
  const tokens = new Set(text.toUpperCase().split(/[^A-Z0-9+]+/));
  return MATERIALS.find((m) => tokens.has(m));
}

/**
 * Print facts encoded in a G-code file name by the slicer's output template, e.g.
 * PrusaSlicer `{input_filename_base}_0.6n_{layer_height}mm_{printing_filament_types}_{printer_model}_{print_time}_{total_weight}g`
 * → `hit-turm-handy_0.6n_0.3mm_PLA_MK3S_4h31m_110.526g.gcode`.
 *
 * Parts are recognized by their shape, not their position, so other templates work as long as the parts are
 * separated by "_": grams `110.5g`, time `4h31m`, layer `0.3mm`, nozzle `0.6n`. The model name is everything
 * before the first recognized part.
 */
export interface FileNameInfo {
  /** Model name, e.g. "hit-turm-handy". */
  base: string;
  grams?: number;
  estimatedMin?: number;
  layerMm?: number;
  nozzleMm?: number;
  /** Tokens between layer height and print time, e.g. ["PLA", "MK3S"] (materials and printer model). */
  extras: string[];
}

const GRAMS = /^(\d+(?:\.\d+)?)g$/i;
const TIME = /^(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:\d+s)?$/i;
const LAYER = /^(\d*\.\d+|\d+)mm$/i;
const NOZZLE = /^(\d*\.\d+|\d+)n$/i;

export function parseFileName(file: string): FileNameInfo {
  const name = (file.split(/[\\/]/).pop() ?? file).replace(/(\.gcode)?\.(b?gcode|gco|3mf)$/i, '');
  const tokens = name.split('_');
  const info: FileNameInfo = { base: name, extras: [] };
  let first = -1;
  tokens.forEach((t, i) => {
    let m: RegExpExecArray | null;
    if ((m = GRAMS.exec(t))) info.grams = Number(m[1]);
    else if (t && TIME.test(t) && /\d/.test(t)) info.estimatedMin = parseSlicerDuration(t) ?? undefined;
    else if ((m = LAYER.exec(t))) info.layerMm = Number(m[1]);
    else if ((m = NOZZLE.exec(t))) info.nozzleMm = Number(m[1]);
    else {
      if (first >= 0) info.extras.push(t);
      return;
    }
    if (first < 0) first = i;
  });
  // Tokens before the first technical part are the model name (it may itself contain "_").
  if (first > 0) {
    info.base = tokens.slice(0, first).join('_');
    info.extras = info.extras.filter((t) => tokens.indexOf(t) > first);
  }
  return info;
}
