/**
 * The whole app state is one JSON document. It is small (a few hundred KB
 * after years of use), so it is loaded into memory completely and saved as a
 * whole by the storage adapters. Every entity references others by stable id,
 * never by display name.
 */

import type { QuoteResult } from './calc/quote';

export const SCHEMA_VERSION = 3;

export type Id = string;
/** ISO date `YYYY-MM-DD`. */
export type IsoDate = string;

export interface AppDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  updatedAt: string;
  settings: Settings;
  materialProfiles: MaterialProfile[];
  printers: Printer[];
  productLines: ProductLine[];
  filaments: Filament[];
  purchases: FilamentPurchase[];
  machineCosts: MachineCost[];
  plannedInvestments: PlannedInvestment[];
  pricingProfiles: PricingProfile[];
  customers: Customer[];
  quotes: Quote[];
  /** Since schema 2. */
  spools: Spool[];
  /** Since schema 2. */
  tarePresets: TarePreset[];
  /** Since schema 3. */
  printJobs: PrintJob[];
}

/** One logged print run (JR-2). Drives stock deduction, hour counters and the failure rate. */
export interface PrintJob {
  id: Id;
  date: IsoDate;
  printerId: Id;
  name: string;
  printTimeMin: number;
  result: 'success' | 'failed' | 'cancelled';
  filaments: PrintJobFilament[];
  quoteId?: Id;
  plateId?: Id;
  note?: string;
}

export interface PrintJobFilament {
  filamentId: Id;
  /** Grams actually used incl. waste (for failed prints: what was used until it failed). */
  grams: number;
  /** Spool the filament came from; its stock is reduced. */
  spoolId?: Id;
}

export interface Settings {
  currency: string;
  energyPricePerKwh: number;
  hourlyRate: number;
  laborPerPlateMin: number;
  /** Months of purchases that always count for the current filament price (FI-10). */
  filamentPriceWindowMonths: number;
  /** Next number for printed spool labels (L0001, …), so print runs continue the sequence. */
  labelNextNumber?: number;
  /** Label sheet used for printing: a preset id from core/labels, or "custom" with `labelCustomLayout`. */
  labelLayoutId?: string;
  labelCustomLayout?: import('./labels').LabelLayout;
  /** Business mode shows business details and numbering on quotes (PP-4). */
  businessMode: boolean;
  business: { name: string; address: string; email: string };
  vat: VatSettings;
}

export interface VatSettings {
  enabled: boolean;
  ratePercent: number;
  /** Prices are entered/shown gross (incl. VAT) instead of net. */
  pricesIncludeVat: boolean;
  /** Printed on quotes when VAT is off, e.g. a small-business notice. */
  noVatNote: string;
}

export type BaseMaterial = 'PLA' | 'PETG' | 'ABS' | 'ASA' | 'TPU' | 'Other';

export interface MaterialProfile {
  id: Id;
  name: string;
  baseMaterial: BaseMaterial;
}

export interface PowerProfile {
  heatupMin: number;
  heatupPowerW: number;
  powerFirstHourW: number;
  powerFollowingHoursW: number;
}

export interface Printer {
  id: Id;
  name: string;
  technology: 'FDM' | 'resin';
  status: 'planned' | 'active' | 'retired';
  /** Paid off: no further amortization, only wear parts and reserve count. */
  paidOff?: boolean;
  purchasePrice?: number;
  /** Overrides the print hours per year derived from usage snapshots. */
  hoursPerYearOverride?: number;
  /** Name used by external print detection (e.g. "mk3s" from Home Assistant) for this printer. */
  inboxKey?: string;
  toolheads: number | null;
  toolType: 'single' | 'mmu' | 'toolchanger' | null;
  /** Waste per print run (priming line, skirt), grams. */
  purgeWastePerPlateG: number | null;
  /** Waste per filament/tool change on multi-material plates, grams. */
  purgePerFilamentChangeG: number | null;
  /** Length of the "first hour" power phase, minutes. */
  firstHourPhaseMin: number | null;
  /** Keyed by MaterialProfile id. */
  powerProfiles: Record<Id, PowerProfile>;
  usageStats?: UsageSnapshot[];
  maintenance?: MaintenanceTask[];
}

/** Recurring maintenance by print hours (MC-5), e.g. "Lubricate rods every 200 h". */
export interface MaintenanceTask {
  id: Id;
  task: string;
  everyHours: number;
  /** Printer hour counter when last done; null = never recorded. */
  lastDoneHours: number | null;
  lastDoneDate?: IsoDate;
}

/** A print-hour counter reading, e.g. from OctoPrint or the printer's statistics menu (MC-4). */
export interface UsageSnapshot {
  source: string;
  asOf: IsoDate;
  /** Start of the counted period; null = printer lifetime. */
  since: IsoDate | null;
  printHours: number;
  printHoursFinished?: number;
  prints?: number;
  printsFinished?: number;
  filamentUsedM?: number;
  reliability?: string;
}

export interface ProductLine {
  id: Id;
  manufacturer: string;
  name: string;
  baseMaterial: BaseMaterial;
  materialProfileId: Id | null;
  diameterMm: number;
  densityGcm3?: number;
  aliases?: string[];
  predecessorId?: Id;
  successorId?: Id;
  notes?: string;
  /** Price list entry for all colors of this line (FI-11). */
  manualPrice?: ManualPrice;
}

/** A hand-maintained price (FI-11), e.g. the current shop price. */
export interface ManualPrice {
  pricePerKg: number;
  asOf: IsoDate;
}

export interface Filament {
  id: Id;
  productLineId: Id;
  color: string;
  colorHex?: string;
  finish: string | null;
  link: string | null;
  asin: string | null;
  acquisition: 'purchase' | 'gift' | 'sample';
  status: 'owned' | 'wishlist';
  /** Price list entry for this color, overrides the product line's (FI-11). */
  manualPrice?: ManualPrice;
  /** Warn and put on the to-buy list below this stock (FI-7). */
  lowStockG?: number;
}

export type SpoolType = 'plastic' | 'cardboard' | 'refill';

/** One physical spool (FI-5). Its stock is the sum of its movements (FI-6). */
export interface Spool {
  id: Id;
  filamentId: Id;
  purchaseId?: Id;
  /** Short label written on the spool, e.g. "S12". */
  label: string;
  /** Net filament weight when new, grams. */
  nominalG: number;
  spoolType: SpoolType | null;
  /** Measured empty-spool weight of this spool; overrides presets. */
  tareG?: number;
  status: 'sealed' | 'open' | 'empty' | 'discarded';
  location?: string;
  openedAt?: IsoDate;
  driedAt?: IsoDate;
  /** No movements = stock unknown (e.g. found on the shelf, not weighed yet). */
  movements: StockMovement[];
}

export interface StockMovement {
  id: Id;
  date: IsoDate;
  kind: 'initial' | 'print' | 'weigh-in' | 'adjust' | 'discard';
  /** Change in net filament grams (negative = used). */
  grams: number;
  /** Weigh-ins: what the scale showed, incl. spool. */
  grossG?: number;
  tareG?: number;
  quoteId?: Id;
  /** Set for "print" movements booked by a print job; removed with the job. */
  jobId?: Id;
  note?: string;
}

/** Empty-spool weight preset (FI-6a). Lookup: product line → manufacturer → any. */
export interface TarePreset {
  id: Id;
  /** null = any manufacturer. */
  manufacturer: string | null;
  /** null = any line of the manufacturer. */
  productLineId: Id | null;
  spoolType: SpoolType;
  emptyG: number;
  source: string;
  verified: boolean;
}

export interface FilamentPurchase {
  id: Id;
  date: IsoDate;
  store: string;
  description: string;
  listingTitle?: string | null;
  asin?: string | null;
  filamentId: Id;
  spoolType?: 'plastic' | 'cardboard' | 'refill' | null;
  /** Size of the pack as sold (e.g. 4 for a 4 x 1 kg bundle split into colors); defaults to packageWeightKg. */
  packSizeKg?: number;
  packageWeightKg: number;
  quantity: number;
  totalPrice: number;
  totalKg: number;
}

export interface MachineCost {
  id: Id;
  date: IsoDate;
  store: string;
  description: string;
  quantity: number;
  total: number;
  amortizationYears: number;
  kind: 'investment' | 'wear-part' | 'maintenance' | 'shipping';
  /** null = shared between printers. */
  printerId: Id | null;
}

export interface PlannedInvestment {
  id: Id;
  name: string;
  printerId: Id | null;
  targetAmount: number;
  mode: 'lifetime' | 'target-date' | 'fixed-rate';
  usefulLifeYears?: number;
  expectedHoursPerYear?: number;
  targetDate?: IsoDate | null;
  fixedRatePerHour?: number;
  alreadyReserved: number;
}

export interface PricingProfile {
  id: Id;
  name: string;
  includeLabor: boolean;
  /** Machine wear, amortization and shared costs. */
  includeMachine: boolean;
  /** Share of the replacement-reserve rate charged, 0..n (1 = 100 %). */
  reserveShare: number;
  /** On filament, energy and machine cost; 0.05 = +5 %. */
  failureAllowance: number;
  /** Markup on cost, 0.2 = +20 %. */
  markup: number;
  /** Also apply the markup to pass-through items (hardware, packaging, shipping). */
  markupOnItems?: boolean;
  /** Overrides settings.hourlyRate. */
  hourlyRate?: number;
  /** Overrides settings.laborPerPlateMin. */
  laborPerPlateMin?: number;
  minimumPrice: number;
  /** Round the final price up to this step (0 = no rounding). */
  roundTo: number;
}

export interface Customer {
  id: Id;
  name: string;
  /** Short tag, e.g. initials. */
  tag?: string;
  /** family, friends, colleagues, business, ... */
  group?: string;
  email?: string;
  phone?: string;
  messenger?: string;
  address?: string;
  defaultPricingProfileId?: Id;
  discountPercent?: number;
  paymentPreference?: string;
  notes?: string;
}

export interface PartCount {
  name: string;
  quantity: number;
}

export interface PlateFilament {
  filamentId: Id;
  weightG: number;
}

export interface Plate {
  id: Id;
  name: string;
  printerId: Id;
  printTimeMin: number;
  runs: number;
  /** Parts produced per run, for the cost per part (ignored when `parts` is set). */
  partsPerRun?: number;
  /** What one run produces, by part name (QC-3). */
  parts?: PartCount[];
  filaments: PlateFilament[];
  /** Multi-material purge/wipe for the whole plate as reported by the slicer, grams. */
  purgeG?: number;
  /** Used to estimate purge when purgeG is not given: changes × printer purge per change. */
  filamentChanges?: number;
}

/** Additional quote positions (QC-4). */
export interface QuoteExtra {
  id: Id;
  kind: 'labor' | 'item';
  description: string;
  /** Labor: minutes (charged with the hourly rate). */
  minutes?: number;
  /** Item: quantity × unit cost (hardware, packaging, shipping, fees). */
  quantity?: number;
  unitCost?: number;
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'printing' | 'delivered' | 'paid' | 'rejected';

export interface Quote {
  id: Id;
  number: number;
  title: string;
  customerId?: Id;
  /** Missing for quotes imported from the Excel sheets. */
  date?: IsoDate;
  pricingProfileId: Id;
  status: QuoteStatus;
  plates: Plate[];
  extras?: QuoteExtra[];
  /** Parts the customer needs, for the part planner (QC-3). */
  requiredParts?: PartCount[];
  discountPercent?: number;
  notes?: string;
  /** Result frozen when the quote left draft status (QC-5). Shown instead of a live recalculation. */
  snapshot?: QuoteSnapshot;
}

export interface QuoteSnapshot {
  frozenAt: string;
  /** The full calculation result at that time, incl. the filament prices used. */
  result: QuoteResult;
}
