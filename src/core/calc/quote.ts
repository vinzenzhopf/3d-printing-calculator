import type { AppDocument, Id, IsoDate, PricingProfile, Quote } from '../model';
import { partsPerRun } from '../parts';
import { machineRate } from './machine-rate';
import { computePlateCost, type CostBreakdown } from './plate-cost';
import { resolveFilamentPrice, type PriceSource } from './price-resolution';

export interface CostParts {
  filament: number;
  energy: number;
  machine: number;
  labor: number;
}

export interface PlateResult extends CostParts {
  plateId: Id;
  name: string;
  runs: number;
  parts: number;
  printHours: number;
  filamentG: number;
  energyWh: number;
  /** Cost of this plate (all runs) before failure allowance and markup. */
  cost: number;
  /** Share of the final price, allocated by cost. */
  price: number;
  pricePerPart: number;
}

export interface UsedPrice {
  filamentId: Id;
  pricePerKg: number | null;
  source: PriceSource;
  asOf: IsoDate | null;
  stale: boolean;
}

export interface QuoteResult {
  asOf: IsoDate;
  profileId: Id;
  plates: PlateResult[];
  /** Plate costs summed. */
  production: CostParts;
  laborExtras: number;
  items: number;
  failure: number;
  /** Everything above: what the job costs you with this profile. */
  cost: number;
  markup: number;
  discount: number;
  /** Raised to the minimum price, if any. */
  minimumApplied: number;
  rounding: number;
  /** Final price before VAT (net). */
  net: number;
  vat: number;
  gross: number;
  /** The price shown to the customer (gross or net, per settings). */
  price: number;
  /** Full cost with labor, machine and 100 % reserve, for the "below cost" check (PP-3). */
  fullCost: number;
  printHours: number;
  /** Price per print hour, a quick sanity indicator. */
  pricePerPrintHour: number | null;
  /** Margin on the net price relative to `cost`. */
  margin: number | null;
  prices: UsedPrice[];
  warnings: string[];
}

/**
 * Prices a quote (requirements section 6). Order of operations is fixed:
 * plates → extras → failure allowance → markup → discount → minimum price →
 * rounding → VAT.
 */
export function calculateQuote(doc: AppDocument, quote: Quote, asOf: IsoDate): QuoteResult {
  const profile = doc.pricingProfiles.find((p) => p.id === quote.pricingProfileId);
  if (!profile) throw new Error(`Unknown pricing profile ${quote.pricingProfileId}`);
  const result = calculate(doc, quote, profile, asOf);
  const full = calculate(doc, quote, { ...profile, includeLabor: true, includeMachine: true, reserveShare: Math.max(profile.reserveShare, 1) }, asOf);
  result.fullCost = full.cost;
  if (result.net < full.cost - 0.005) {
    result.warnings.push('Price is below the full cost (labor, machine and reserve included).');
  }
  return result;
}

function calculate(doc: AppDocument, quote: Quote, profile: PricingProfile, asOf: IsoDate): QuoteResult {
  const s = doc.settings;
  const warnings: string[] = [];
  const hourlyRate = profile.hourlyRate ?? s.hourlyRate;
  const usedPrices = new Map<Id, UsedPrice>();

  const plates: PlateResult[] = [];
  for (const plate of quote.plates) {
    const printer = doc.printers.find((p) => p.id === plate.printerId);
    if (!printer) {
      warnings.push(`${plate.name}: unknown printer.`);
      continue;
    }
    const rate = machineRate(doc, printer.id, asOf);
    warnings.push(...rate.warnings.map((w) => `${printer.name}: ${w}`));
    const reserve = rate.reserves.reduce((sum, r) => sum + r.ratePerHour, 0) * profile.reserveShare;
    const machinePerHour = (profile.includeMachine ? rate.investmentPerHour + rate.wearPerHour + rate.sharedPerHour : 0) + reserve;

    const purgeG = plate.purgeG ?? (plate.filamentChanges ?? 0) * (printer.purgePerFilamentChangeG ?? 0);
    const cost: CostBreakdown = computePlateCost(
      { ...plate, purgeG },
      {
        energyPricePerKwh: s.energyPricePerKwh,
        printer,
        materialProfileOf: (id) => {
          const f = doc.filaments.find((x) => x.id === id);
          return doc.productLines.find((l) => l.id === f?.productLineId)?.materialProfileId;
        },
        pricePerKg: (id, needKg) => {
          const price = resolveFilamentPrice(doc, id, { asOf, needKg });
          usedPrices.set(id, { filamentId: id, pricePerKg: price.pricePerKg, source: price.source, asOf: price.asOf, stale: price.stale });
          if (price.pricePerKg === null) warnings.push(`${plate.name}: no price for a filament, counted as 0.`);
          return price.pricePerKg ?? 0;
        },
        machineRatePerHour: machinePerHour,
        labor: { minutesPerRun: profile.includeLabor ? (profile.laborPerPlateMin ?? s.laborPerPlateMin) : 0, hourlyRate },
      },
    );
    warnings.push(...cost.warnings.map((w) => `${plate.name}: ${w}`));
    const parts = Math.max(plate.runs, 0) * partsPerRun(plate);
    plates.push({
      plateId: plate.id,
      name: plate.name,
      runs: plate.runs,
      parts,
      printHours: (plate.printTimeMin / 60) * Math.max(plate.runs, 0),
      filamentG: cost.filamentG,
      energyWh: cost.energyWh,
      filament: cost.filament,
      energy: cost.energy,
      machine: cost.machine,
      labor: cost.labor,
      cost: cost.total,
      price: 0,
      pricePerPart: 0,
    });
  }

  const production = plates.reduce<CostParts>(
    (sum, p) => ({ filament: sum.filament + p.filament, energy: sum.energy + p.energy, machine: sum.machine + p.machine, labor: sum.labor + p.labor }),
    { filament: 0, energy: 0, machine: 0, labor: 0 },
  );
  const extras = quote.extras ?? [];
  const laborExtras = profile.includeLabor
    ? extras.filter((e) => e.kind === 'labor').reduce((sum, e) => sum + ((e.minutes ?? 0) / 60) * hourlyRate, 0)
    : 0;
  const items = extras.filter((e) => e.kind === 'item').reduce((sum, e) => sum + (e.quantity ?? 1) * (e.unitCost ?? 0), 0);

  const failure = (production.filament + production.energy + production.machine) * profile.failureAllowance;
  const cost = production.filament + production.energy + production.machine + production.labor + laborExtras + items + failure;
  const markupBase = cost - (profile.markupOnItems ? 0 : items);
  const markup = markupBase * profile.markup;
  const discount = (cost + markup) * ((quote.discountPercent ?? 0) / 100);
  const beforeMinimum = cost + markup - discount;
  const afterMinimum = Math.max(beforeMinimum, profile.minimumPrice);

  // Rounding applies to the price the customer sees (gross when prices include VAT).
  const vatRate = s.vat.enabled ? s.vat.ratePercent / 100 : 0;
  const showGross = s.vat.enabled && s.vat.pricesIncludeVat;
  const shown = showGross ? afterMinimum * (1 + vatRate) : afterMinimum;
  const price = profile.roundTo > 0 ? Math.ceil(round6(shown / profile.roundTo)) * profile.roundTo : shown;
  const net = showGross ? price / (1 + vatRate) : price;
  const vat = net * vatRate;

  const printHours = plates.reduce((sum, p) => sum + p.printHours, 0);
  const plateCost = plates.reduce((sum, p) => sum + p.cost, 0);
  for (const p of plates) {
    p.price = plateCost > 0 ? (net * p.cost) / plateCost : 0;
    p.pricePerPart = p.parts > 0 ? p.price / p.parts : 0;
  }

  return {
    asOf,
    profileId: profile.id,
    plates,
    production,
    laborExtras,
    items,
    failure,
    cost,
    markup,
    discount,
    minimumApplied: afterMinimum - beforeMinimum,
    rounding: net - afterMinimum,
    net,
    vat,
    gross: net + vat,
    price,
    fullCost: cost,
    printHours,
    pricePerPrintHour: printHours > 0 ? net / printHours : null,
    margin: net > 0 ? (net - cost) / net : null,
    prices: [...usedPrices.values()],
    warnings: [...new Set(warnings)],
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
