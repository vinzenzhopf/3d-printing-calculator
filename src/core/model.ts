/**
 * The whole app state is one JSON document. It is small (a few hundred KB
 * after years of use), so it is loaded into memory completely and saved as a
 * whole by the storage adapters. Every entity references others by stable id,
 * never by display name.
 */

export const SCHEMA_VERSION = 1;

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
}

export interface Settings {
  currency: string;
  energyPricePerKwh: number;
  hourlyRate: number;
  laborPerPlateMin: number;
  /** Months of purchases that always count for the current filament price (FI-10). */
  filamentPriceWindowMonths: number;
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
  includeMachine: boolean;
  /** Share of the replacement-reserve rate charged, 0..n (1 = 100 %). */
  reserveShare: number;
  failureAllowance: number;
  /** Markup on cost, 0.2 = +20 %. */
  markup: number;
  minimumPrice: number;
  roundTo: number;
}

export interface Customer {
  id: Id;
  name: string;
  tag?: string;
  group?: string;
  defaultPricingProfileId?: Id;
  discountPercent?: number;
  notes?: string;
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
  filaments: PlateFilament[];
  /** Multi-material purge/wipe for the whole plate as reported by the slicer, grams. */
  purgeG?: number;
}

export interface Quote {
  id: Id;
  number: number;
  title: string;
  customerId?: Id;
  /** Missing for quotes imported from the Excel sheets. */
  date?: IsoDate;
  pricingProfileId: Id;
  status: 'draft' | 'sent' | 'accepted' | 'printing' | 'delivered' | 'paid' | 'rejected';
  plates: Plate[];
  notes?: string;
}
