import { DEFAULT_SPOOL_KINDS, createEmptyDocument } from './document';
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
  1: (doc) => ({ ...doc, spools: doc.spools ?? [], tarePresets: doc.tarePresets ?? LEGACY_TARE_PRESETS }),
  // 3: print log (JR-2).
  2: (doc) => ({ ...doc, printJobs: doc.printJobs ?? [] }),
  // 4: empty-spool kinds chosen per spool, instead of presets by brand/line/type.
  3: migrateTarePresets,
};

interface LegacyTarePreset {
  id: string;
  manufacturer: string | null;
  productLineId: string | null;
  spoolType: string;
  emptyG: number;
  source: string;
}

const LEGACY_TARE_PRESETS: LegacyTarePreset[] = [
  { id: 'tare-sunlu-plastic', manufacturer: 'SUNLU', productLineId: null, spoolType: 'plastic', emptyG: 130, source: 'SpoolmanDB' },
  { id: 'tare-any-plastic', manufacturer: null, productLineId: null, spoolType: 'plastic', emptyG: 200, source: 'rough average' },
  { id: 'tare-any-cardboard', manufacturer: null, productLineId: null, spoolType: 'cardboard', emptyG: 140, source: 'rough average' },
  { id: 'tare-any-refill', manufacturer: null, productLineId: null, spoolType: 'refill', emptyG: 0, source: 'refills without a core' },
];

/**
 * Every preset becomes a spool kind (same id), and every spool gets the kind the
 * old lookup (line → brand → generic, by spool type) gave it, so no weight changes.
 */
function migrateTarePresets(doc: Raw): Raw {
  const { tarePresets, ...rest } = doc;
  const presets = (Array.isArray(tarePresets) ? tarePresets : LEGACY_TARE_PRESETS) as LegacyTarePreset[];
  const lines = (Array.isArray(doc.productLines) ? doc.productLines : []) as { id: string; manufacturer: string; name: string }[];
  const filaments = (Array.isArray(doc.filaments) ? doc.filaments : []) as { id: string; productLineId: string }[];
  const generic: Record<string, string> = { plastic: 'Plastic spool', cardboard: 'Cardboard spool', refill: 'Refill without spool' };
  const brands = [...new Set(lines.map((l) => l.manufacturer))].sort((a, b) => b.length - a.length);
  const kinds = presets.map((p) => {
    const line = lines.find((l) => l.id === p.productLineId);
    // The brand field was also used for descriptions ("SUNLU Full Plastic"): keep that as the name, and the
    // known brand it starts with as the brand, so suggestions find it.
    const text = line ? `${line.manufacturer} ${line.name}` : p.manufacturer;
    const name = !text ? (generic[p.spoolType] ?? p.spoolType)
      : text.toLowerCase().includes(p.spoolType) ? text : `${text} ${p.spoolType}`;
    const brand = line?.manufacturer ?? brands.find((b) => p.manufacturer?.toLowerCase().startsWith(b.toLowerCase())) ?? null;
    return { id: p.id, name, manufacturer: brand, emptyG: p.emptyG, source: p.source };
  });
  const spools = ((Array.isArray(doc.spools) ? doc.spools : []) as Raw[]).map(({ spoolType, ...spool }) => {
    const type = typeof spoolType === 'string' ? spoolType : 'plastic';
    const line = lines.find((l) => l.id === filaments.find((f) => f.id === spool.filamentId)?.productLineId);
    const ofType = presets.filter((p) => p.spoolType === type);
    const preset =
      (line && ofType.find((p) => p.productLineId === line.id)) ||
      (line && ofType.find((p) => p.productLineId === null && p.manufacturer?.toLowerCase() === line.manufacturer.toLowerCase())) ||
      ofType.find((p) => p.productLineId === null && p.manufacturer === null);
    return preset ? { ...spool, kindId: preset.id } : spool;
  });
  // Purchases: "refill" becomes the refill kind; plastic/cardboard are left to the suggestion.
  const refill = presets.find((p) => p.spoolType === 'refill' && p.productLineId === null);
  const purchases = ((Array.isArray(doc.purchases) ? doc.purchases : []) as Raw[]).map(({ spoolType, ...purchase }) =>
    spoolType === 'refill' && refill ? { ...purchase, kindId: refill.id } : purchase,
  );
  return { ...rest, spoolKinds: kinds, spools, purchases };
}

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
  'spoolKinds',
  'printJobs',
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
  const kinds = ids(doc.spoolKinds);

  const check = (ok: boolean, message: string) => {
    if (!ok) warnings.push(message);
  };
  for (const f of doc.filaments) check(lines.has(f.productLineId), `Filament ${f.id}: unknown product line ${f.productLineId}`);
  for (const x of [...doc.productLines, ...doc.filaments]) {
    const known = 'productLineId' in x ? filaments : lines;
    check(!x.predecessorId || known.has(x.predecessorId), `${x.id}: unknown predecessor ${x.predecessorId}`);
    check(!x.successorId || known.has(x.successorId), `${x.id}: unknown successor ${x.successorId}`);
  }
  for (const s of doc.spools) check(filaments.has(s.filamentId), `Spool ${s.label}: unknown filament ${s.filamentId}`);
  for (const j of doc.printJobs) {
    for (const f of j.filaments) check(!f.filamentId || filaments.has(f.filamentId), `Print ${j.date} ${j.name}: unknown filament ${f.filamentId}`);
  }
  for (const s of doc.spools) check(!s.kindId || kinds.has(s.kindId), `Spool ${s.label}: unknown empty spool kind ${s.kindId}`);
  for (const p of doc.purchases) check(filaments.has(p.filamentId), `Purchase ${p.id}: unknown filament ${p.filamentId}`);
  for (const p of doc.purchases) check(!p.kindId || kinds.has(p.kindId), `Purchase ${p.id}: unknown empty spool kind ${p.kindId}`);
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
