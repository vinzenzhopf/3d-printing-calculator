import type { AppDocument, Id, IsoDate, PricingProfile, QuantityTier, Quote } from '../model';
import { partsPerRun, planParts, splitPlateCost, type PlateSplit } from '../parts';
import { machineRate } from './machine-rate';
import { computePlateCost, type CostBreakdown, type EnergyDetail, type FilamentRow } from './plate-cost';
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
  /** The inputs behind each cost, for showing the calculation. Missing in snapshots frozen by older versions. */
  explain?: PlateExplain;
  /** How the cost is spread over the part list (cost per piece before overhead). Missing without a part list and in older snapshots. */
  split?: { mode: PlateSplit['mode']; parts: { name: string; quantity: number; each: number }[] };
}

export interface PlateExplain {
  printer: string;
  hoursPerRun: number;
  /** Waste per run: printer priming line/skirt and multi-material purge. */
  primingG: number;
  purgeG: number;
  filaments: FilamentRow[];
  energy: EnergyDetail & { pricePerKwh: number };
  machine: MachineExplain;
  labor: { minutesPerRun: number; hourlyRate: number };
  /** Replacement reserves charged for this plate (all runs), per planned investment. */
  reserves: { investmentId: Id; name: string; amount: number }[];
}

/** Machine €/h of the plate's printer as charged by the profile. */
export interface MachineExplain {
  includeMachine: boolean;
  investmentPerHour: number;
  wearPerHour: number;
  sharedPerHour: number;
  /** Full reserve rate; the profile charges `reserveShare` of it. */
  reservePerHour: number;
  reserveShare: number;
  ratePerHour: number;
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
  /** Quantity tier reached by the number of parts, if any. */
  quantityTier: QuantityTier | null;
  quantityDiscount: number;
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
  /** The rules applied, for showing the calculation. Missing in snapshots frozen by older versions. */
  explain?: QuoteExplain;
  /** Per required/planned part: price, cost and profit per piece (when the quote uses the part planner). */
  parts?: PartEconomics[];
}

/**
 * One part of the part planner. The cost of a plate is spread over the pieces
 * it produces (evenly or per its `costSplit`, see splitPlateCost), and the
 * quote's other costs (failure allowance, extra labor, items) proportionally
 * on top, so the pieces add up to the total cost.
 */
export interface PartEconomics {
  name: string;
  required: number;
  planned: number;
  /** Price per piece, if set. */
  price: number | null;
  /** Cost per planned piece; null when no plate produces it. */
  costEach: number | null;
  /** (price − cost) per piece; null without price or cost. */
  profitEach: number | null;
}

export interface QuoteExplain {
  profileName: string;
  hourlyRate: number;
  failureRate: number;
  /** Filament + energy + machine: what the failure allowance applies to. */
  failureBase: number;
  markupRate: number;
  markupBase: number;
  markupOnItems: boolean;
  discountPercent: number;
  minimumPrice: number;
  roundTo: number;
  vatRate: number;
  showGross: boolean;
  /** Set when a target price or part prices replaced markup, discounts, minimum and rounding. */
  target: { kind: 'quote' | 'parts'; total: number } | null;
  parts: number;
  profit: number;
}

/** The highest tier reached by the number of parts. */
export function quantityTierFor(tiers: readonly QuantityTier[] | undefined, parts: number): QuantityTier | null {
  return (tiers ?? []).filter((t) => t.fromParts > 0 && parts >= t.fromParts).sort((a, b) => b.fromParts - a.fromParts)[0] ?? null;
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
    const reserveFull = rate.reserves.reduce((sum, r) => sum + r.ratePerHour, 0);
    const reserve = reserveFull * profile.reserveShare;
    const machinePerHour = (profile.includeMachine ? rate.investmentPerHour + rate.wearPerHour + rate.sharedPerHour : 0) + reserve;
    const laborMinutes = profile.includeLabor ? (profile.laborPerPlateMin ?? s.laborPerPlateMin) : 0;

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
        labor: { minutesPerRun: laborMinutes, hourlyRate },
      },
    );
    warnings.push(...cost.warnings.map((w) => `${plate.name}: ${w}`));
    // A plate without filament (just added, not filled in yet) prints nothing.
    const parts = plate.filaments.length > 0 ? Math.max(plate.runs, 0) * partsPerRun(plate) : 0;
    const runHours = (plate.printTimeMin / 60) * Math.max(plate.runs, 0);
    const explain: PlateExplain = {
      printer: printer.name,
      hoursPerRun: plate.printTimeMin / 60,
      primingG: printer.purgeWastePerPlateG ?? 0,
      purgeG,
      filaments: cost.filamentRows,
      energy: { ...cost.energyDetail, pricePerKwh: s.energyPricePerKwh },
      machine: {
        includeMachine: profile.includeMachine,
        investmentPerHour: rate.investmentPerHour,
        wearPerHour: rate.wearPerHour,
        sharedPerHour: rate.sharedPerHour,
        reservePerHour: reserveFull,
        reserveShare: profile.reserveShare,
        ratePerHour: machinePerHour,
      },
      labor: { minutesPerRun: laborMinutes, hourlyRate },
      reserves: rate.reserves.map((r) => ({ investmentId: r.investmentId, name: r.name, amount: r.ratePerHour * profile.reserveShare * runHours })),
    };
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
      explain,
      ...(plate.parts?.length && plate.runs > 0 ? { split: plateSplit(plate, cost.total / plate.runs, warnings) } : {}),
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
  const totalParts = plates.reduce((sum, p) => sum + p.parts, 0);
  const vatRate = s.vat.enabled ? s.vat.ratePercent / 100 : 0;
  const showGross = s.vat.enabled && s.vat.pricesIncludeVat;

  let markup: number, quantityTier: QuantityTier | null, quantityDiscount: number, discount: number;
  let minimumApplied: number, rounding: number, price: number, net: number;
  let target: QuoteExplain['target'] = null;
  const priced = (quote.requiredParts ?? []).filter((r) => r.name.trim() && (r.price ?? 0) > 0);
  if (quote.targetPrice && quote.targetPrice > 0) target = { kind: 'quote', total: quote.targetPrice };
  else if (priced.length) target = { kind: 'parts', total: priced.reduce((sum, r) => sum + r.quantity * r.price!, 0) };
  if (target) {
    // Fixed price: the markup is whatever is left between cost and the price you want.
    price = target.total;
    net = showGross ? price / (1 + vatRate) : price;
    markup = net - cost;
    quantityTier = null;
    quantityDiscount = discount = minimumApplied = rounding = 0;
    if (net < cost - 0.005) warnings.push(target.kind === 'parts' ? 'The part prices are below the cost of this quote.' : 'The target price is below the cost of this quote.');
  } else {
    markup = markupBase * profile.markup;
    quantityTier = quantityTierFor(profile.quantityTiers, totalParts);
    quantityDiscount = (cost + markup) * ((quantityTier?.discountPercent ?? 0) / 100);
    discount = (cost + markup - quantityDiscount) * ((quote.discountPercent ?? 0) / 100);
    const beforeMinimum = cost + markup - quantityDiscount - discount;
    const afterMinimum = Math.max(beforeMinimum, profile.minimumPrice);
    minimumApplied = afterMinimum - beforeMinimum;
    // Rounding applies to the price the customer sees (gross when prices include VAT).
    const shown = showGross ? afterMinimum * (1 + vatRate) : afterMinimum;
    price = profile.roundTo > 0 ? Math.ceil(round6(shown / profile.roundTo)) * profile.roundTo : shown;
    net = showGross ? price / (1 + vatRate) : price;
    rounding = net - afterMinimum;
  }
  const vat = net * vatRate;

  const printHours = plates.reduce((sum, p) => sum + p.printHours, 0);
  const plateCost = plates.reduce((sum, p) => sum + p.cost, 0);
  const parts = partEconomics(quote, plates, plateCost > 0 ? cost / plateCost : 0);
  if (target?.kind === 'parts' && parts) {
    const missing = parts.filter((p) => p.planned < p.required).map((p) => p.name);
    if (missing.length) warnings.push(`Not enough planned: ${missing.join(', ')}.`);
    const unpriced = parts.filter((p) => p.required > 0 && p.price === null).map((p) => p.name);
    if (unpriced.length) warnings.push(`No price yet: ${unpriced.join(', ')} (counted as 0).`);
    const unassigned = quote.plates.filter((p) => !p.parts?.length && p.runs > 0).map((p) => p.name);
    if (unassigned.length) warnings.push(`No part list on ${unassigned.join(', ')}: its cost is in the total, but not in a part.`);
  }
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
    quantityTier,
    quantityDiscount,
    discount,
    minimumApplied,
    rounding,
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
    ...(parts ? { parts } : {}),
    explain: {
      profileName: profile.name,
      hourlyRate,
      failureRate: profile.failureAllowance,
      failureBase: production.filament + production.energy + production.machine,
      markupRate: profile.markup,
      markupBase,
      markupOnItems: !!profile.markupOnItems,
      discountPercent: quote.discountPercent ?? 0,
      minimumPrice: profile.minimumPrice,
      roundTo: profile.roundTo,
      vatRate,
      showGross,
      target,
      parts: totalParts,
      profit: net - cost,
    },
  };
}

/** Price, cost and profit per part (see PartEconomics); undefined without a part planner. */
function partEconomics(quote: Quote, plates: PlateResult[], overhead: number): PartEconomics[] | undefined {
  const rows = planParts(quote);
  if (rows.length === 0) return undefined;
  const key = (name: string) => name.trim().toLowerCase();
  const costOf = new Map<string, number>();
  quote.plates.forEach((plate) => {
    const split = plates.find((p) => p.plateId === plate.id)?.split;
    if (!split) return;
    for (const part of split.parts) {
      const k = key(part.name);
      if (k) costOf.set(k, (costOf.get(k) ?? 0) + part.each * overhead * part.quantity * plate.runs);
    }
  });
  const prices = new Map((quote.requiredParts ?? []).map((r) => [key(r.name), r.price]));
  return rows.map((r) => {
    const price = prices.get(key(r.name));
    const costEach = r.planned > 0 ? (costOf.get(key(r.name)) ?? 0) / r.planned : null;
    const p = price !== undefined && price > 0 ? price : null;
    return { name: r.name, required: r.required, planned: r.planned, price: p, costEach, profitEach: p !== null && costEach !== null ? p - costEach : null };
  });
}

function plateSplit(plate: Quote['plates'][number], runCost: number, warnings: string[]): NonNullable<PlateResult['split']> {
  const split = splitPlateCost(plate, runCost);
  warnings.push(...split.warnings.map((w) => `${plate.name}: ${w}`));
  return { mode: split.mode, parts: (plate.parts ?? []).map((p, i) => ({ name: p.name, quantity: p.quantity, each: split.each[i]! })) };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
