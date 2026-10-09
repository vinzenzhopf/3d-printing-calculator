/**
 * The whole app state is one JSON document. It is small (a few hundred KB
 * after years of use), so it is loaded into memory completely and saved as a
 * whole by the storage adapters. Every entity references others by stable id,
 * never by display name.
 */

import type { QuoteResult } from './calc/quote';

export const SCHEMA_VERSION = 5;

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
  /** Since schema 4 (replaces the tare presets of schema 2). */
  spoolKinds: SpoolKind[];
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
  /**
   * Filament used whose color/spool isn't known, e.g. from imported printer history.
   * Counts in totals and per material, but not per filament or in stock.
   */
  untrackedFilament?: { grams: number; material?: BaseMaterial };
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
  /** Printer correction for label PDFs in mm: positive moves everything down/right. */
  labelOffsetXMm?: number;
  labelOffsetYMm?: number;
  /** Small text on spool labels below the code, one line per line break (default "3D Print Calc"). */
  labelCaption?: string;
  /** What the QR code on spool labels holds: a link the phone camera opens (default), or just the code. */
  labelQrContent?: 'link' | 'code';
  /** Business mode shows business details and numbering on quotes (PP-4). */
  businessMode: boolean;
  business: { name: string; address: string; email: string };
  /**
   * The owner confirmed using the Printables spool weight catalog (CC BY-NC-SA)
   * only non-commercially; without it the catalog is not loaded.
   */
  printablesCatalogPersonalUse?: boolean;
  /** Demo data (core/demo) is loaded: shown with a banner and never synced. */
  demo?: boolean;
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
  /** Deprecated since (FI-2b): kept for history, hidden from pickers, the color overview and the to-buy list. */
  deprecatedAt?: IsoDate;
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
  /** Second color of a color-shift / dual-color / gradient filament. */
  colorHex2?: string;
  finish: string | null;
  link: string | null;
  asin: string | null;
  status: 'owned' | 'wishlist';
  /** Price list entry for this color, overrides the product line's (FI-11). */
  manualPrice?: ManualPrice;
  /** Warn and put on the to-buy list below this stock (FI-7). */
  lowStockG?: number;
  /** Deprecated since (FI-2b), see ProductLine.deprecatedAt. A deprecated line deprecates all its colors. */
  deprecatedAt?: IsoDate;
  predecessorId?: Id;
  successorId?: Id;
  /** Ids of duplicates merged into this one (FI-2b), so frozen quote snapshots still show a name. */
  mergedIds?: Id[];
  /** Free text, e.g. print settings that work well. */
  notes?: string;
  /** Print temperatures, e.g. from SpoolmanDB. */
  nozzleC?: number;
  bedC?: number;
  /** SpoolmanDB entry it was checked against. */
  spoolmanId?: string;
}

/** One physical spool (FI-5). Its stock is the sum of its movements (FI-6). */
export interface Spool {
  id: Id;
  filamentId: Id;
  purchaseId?: Id;
  /** Short label written on the spool, e.g. "S12". */
  label: string;
  /** Labels it had before (e.g. on the wrapping of a sealed spool); scanning them still finds it. */
  previousLabels?: string[];
  /** Net filament weight when new, grams. */
  nominalG: number;
  /** What kind of empty spool it is on (gives the empty weight). Unset = unknown. */
  kindId?: Id;
  /** Measured empty weight of this very spool; overrides its kind. */
  tareG?: number;
  status: 'sealed' | 'open' | 'empty' | 'discarded';
  location?: string;
  openedAt?: IsoDate;
  driedAt?: IsoDate;
  /** The manufacturer's code on the spool, e.g. the Prusament QR link. */
  code?: string;
  note?: string;
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

/**
 * A kind of empty spool, e.g. "SUNLU plastic + cardboard" (FI-6a). Every spool
 * points to one; its weight turns scale readings into filament weight.
 */
export interface SpoolKind {
  id: Id;
  name: string;
  /** Brand it comes with, for suggestions. null = generic. */
  manufacturer: string | null;
  emptyG: number;
  /** Filament it holds when new, e.g. 2500 for a big spool: the default size of its spools. */
  capacityG?: number;
  /** Where the weight comes from, e.g. "SpoolmanDB" or "measured 2026-10-06". */
  source: string;
}

export interface FilamentPurchase {
  id: Id;
  date: IsoDate;
  store: string;
  description: string;
  listingTitle?: string | null;
  asin?: string | null;
  filamentId: Id;
  /** Unset = bought. Gifts and samples cost `totalPrice` (often 0, or just shipping). */
  acquisition?: 'gift' | 'sample';
  /** What a gift or sample is worth: used for the filament price instead of what was paid. */
  value?: number;
  /** Empty spool its spools come on (e.g. refills with a cardboard inlay). Unset = suggested per spool. */
  kindId?: Id;
  /** Size of the pack as sold (e.g. 4 for a 4 x 1 kg bundle split into colors); defaults to packageWeightKg. */
  packSizeKg?: number;
  /** Filament per spool, e.g. 2.5 for one big spool. Defaults to 1 kg (or the whole purchase if less). */
  spoolKg?: number;
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
  /** Discount by the number of parts in a quote, e.g. from 5 parts −10 %. The highest reached tier applies. */
  quantityTiers?: QuantityTier[];
}

export interface QuantityTier {
  fromParts: number;
  discountPercent: number;
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
  /** Price per piece, for required parts: the quote's price then follows from the part prices. */
  price?: number;
  /** Plate parts, per piece, used by the plate's `costSplit`: grams (from the slicer), percent of a run's cost, or cost. */
  grams?: number;
  percent?: number;
  cost?: number;
}

/** How a plate's cost is spread over its parts; unset = evenly per piece. */
export type CostSplit = 'grams' | 'percent' | 'cost';

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
  /** Splits the plate's cost over `parts` by their grams, percent or cost; unset = evenly. */
  costSplit?: CostSplit;
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
  /** A price for the whole quote: the markup follows from it (instead of the profile's markup, discounts and rounding). */
  targetPrice?: number;
  notes?: string;
  /** Result frozen when the quote left draft status (QC-5). Shown instead of a live recalculation. */
  snapshot?: QuoteSnapshot;
}

export interface QuoteSnapshot {
  frozenAt: string;
  /** The full calculation result at that time, incl. the filament prices used. */
  result: QuoteResult;
}
