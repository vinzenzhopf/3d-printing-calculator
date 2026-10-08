import { SPOOLMANDB_URL, type SpoolmanFilament } from '../core/spoolmandb';

let loading: Promise<SpoolmanFilament[]> | null = null;

/** SpoolmanDB's filament list (a few MB), fetched once per session when first needed. */
export function loadSpoolmanDb(): Promise<SpoolmanFilament[]> {
  loading ??= fetch(SPOOLMANDB_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`SpoolmanDB answered ${r.status}.`);
      return r.json() as Promise<SpoolmanFilament[]>;
    })
    .catch((e: unknown) => {
      loading = null;
      throw e instanceof Error ? e : new Error(String(e));
    });
  return loading;
}
