import { DEFAULT_TARE_PRESETS, createEmptyDocument } from './document';
import { SCHEMA_VERSION, type AppDocument } from './model';

export class DocumentError extends Error {}

export interface LoadedDocument {
  doc: AppDocument;
  /** Non-fatal findings, e.g. references to missing entities. */
  warnings: string[];
}

type Raw = Record<string, unknown>;

/**
 * Migrations from version n to n+1, indexed by n. Every schema change adds one
 * step here and bumps SCHEMA_VERSION. Steps get the raw object and return it updated.
 */
const MIGRATIONS: Record<number, (doc: Raw) => Raw> = {
  // 2: spool stock (FI-5/6) and empty-spool presets (FI-6a).
  1: (doc) => ({ ...doc, spools: doc.spools ?? [], tarePresets: doc.tarePresets ?? structuredClone(DEFAULT_TARE_PRESETS) }),
};

const COLLECTIONS = [
  'materialProfiles',
  'printers',
  'productLines',
  'filaments',
  'purchases',
  'machineCosts',
  'plannedInvestments',
  'pricingProfiles',
  'customers',
  'quotes',
  'spools',
  'tarePresets',
] as const satisfies readonly (keyof AppDocument)[];

/**
 * Turns anything parsed from storage or an import file into a current AppDocument:
 * checks the format, runs migrations, fills missing collections/settings with
 * defaults, and reports dangling references as warnings.
 */
export function loadDocument(input: unknown): LoadedDocument {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DocumentError('Not a 3D Printing Calculator data file.');
  }
  let raw = input as Raw;
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DocumentError('Not a 3D Printing Calculator data file (missing schemaVersion).');
  }
  if (version > SCHEMA_VERSION) {
    throw new DocumentError(
      `This file was saved by a newer app version (schema ${version}, this app supports ${SCHEMA_VERSION}). Update the app first.`,
    );
  }
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new DocumentError(`No migration from schema ${v} to ${v + 1}.`);
    raw = { ...step(raw), schemaVersion: v + 1 };
  }

  const defaults = createEmptyDocument();
  for (const key of COLLECTIONS) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      throw new DocumentError(`"${key}" must be a list.`);
    }
  }
  const settings = (raw.settings ?? {}) as Partial<AppDocument['settings']>;
  const doc = {
    ...defaults,
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : defaults.updatedAt,
    settings: {
      ...defaults.settings,
      ...settings,
      business: { ...defaults.settings.business, ...settings.business },
      vat: { ...defaults.settings.vat, ...settings.vat },
    },
    pricingProfiles: Array.isArray(raw.pricingProfiles) && raw.pricingProfiles.length > 0
      ? raw.pricingProfiles
      : defaults.pricingProfiles,
  } as AppDocument;

  return { doc, warnings: findDanglingReferences(doc) };
}

export function findDanglingReferences(doc: AppDocument): string[] {
  const warnings: string[] = [];
  const ids = (list: { id: string }[]) => new Set(list.map((x) => x.id));
  const lines = ids(doc.productLines);
  const filaments = ids(doc.filaments);
  const printers = ids(doc.printers);
  const profiles = ids(doc.pricingProfiles);
  const customers = ids(doc.customers);

  const check = (ok: boolean, message: string) => {
    if (!ok) warnings.push(message);
  };
  for (const f of doc.filaments) check(lines.has(f.productLineId), `Filament ${f.id}: unknown product line ${f.productLineId}`);
  for (const p of doc.purchases) check(filaments.has(p.filamentId), `Purchase ${p.id}: unknown filament ${p.filamentId}`);
  for (const m of doc.machineCosts) check(m.printerId === null || printers.has(m.printerId), `Machine cost ${m.id}: unknown printer ${m.printerId}`);
  for (const q of doc.quotes) {
    check(profiles.has(q.pricingProfileId), `Quote ${q.number}: unknown pricing profile ${q.pricingProfileId}`);
    check(!q.customerId || customers.has(q.customerId), `Quote ${q.number}: unknown customer ${q.customerId}`);
    for (const plate of q.plates) {
      check(printers.has(plate.printerId), `Quote ${q.number} / ${plate.name}: unknown printer ${plate.printerId}`);
      for (const pf of plate.filaments) {
        check(filaments.has(pf.filamentId), `Quote ${q.number} / ${plate.name}: unknown filament ${pf.filamentId}`);
      }
    }
  }
  return warnings;
}
