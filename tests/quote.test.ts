import { describe, expect, it } from 'vitest';
import { calculateQuote } from '../src/core/calc/quote';
import { createEmptyDocument } from '../src/core/document';
import type { AppDocument, PowerProfile, PricingProfile, Quote } from '../src/core/model';
import fixture from './fixtures/legacy-quotes.json';

const asOf = '2026-10-01';

function baseProfile(overrides: Partial<PricingProfile> = {}): PricingProfile {
  return { id: 'p', name: 'p', includeLabor: true, includeMachine: true, reserveShare: 1, failureAllowance: 0, markup: 0, minimumPrice: 0, roundTo: 0, ...overrides };
}

/**
 * The Excel model expressed as app data: a paid-off printer whose only machine
 * cost is a fixed-rate reserve equal to Excel's amortization €/h, filaments with
 * a manual price equal to Excel's average price, one profile per Yes/No combination.
 */
function legacyDocument(): AppDocument {
  const s = fixture.settings;
  const doc = createEmptyDocument();
  doc.settings.energyPricePerKwh = s.energyPricePerKwh;
  doc.settings.hourlyRate = s.hourlyRate;
  doc.settings.laborPerPlateMin = s.laborPerPlateMin;
  doc.printers.push({
    id: 'mk3', name: 'MK3S+', technology: 'FDM', status: 'active', paidOff: true, toolheads: 1, toolType: 'single',
    purgeWastePerPlateG: s.purgeWastePerPlateG, purgePerFilamentChangeG: null, firstHourPhaseMin: s.firstHourPhaseMin, powerProfiles: {},
  });
  doc.plannedInvestments.push({ id: 'amort', name: 'Excel amortization', printerId: null, targetAmount: 0, mode: 'fixed-rate', fixedRatePerHour: s.amortizationPerHour, alreadyReserved: 0 });
  for (const [labor, markup] of [[true, true], [false, true], [false, false], [true, false]] as const) {
    doc.pricingProfiles.push(baseProfile({ id: `legacy-${labor}-${markup}`, includeLabor: labor, markup: markup ? s.defaultMarkup : 0 }));
  }
  return doc;
}

describe('calculateQuote reproduces the Excel quotes', () => {
  const items = fixture.items.filter((i) => i.labor.mode !== 'override' && i.markup.mode !== 'override' && i.runs > 0);

  for (const [n, item] of items.entries()) {
    it(`quote ${item.quote}: ${item.name}`, () => {
      const doc = legacyDocument();
      doc.materialProfiles.push({ id: `m${n}`, name: 'm', baseMaterial: 'PLA' });
      doc.printers[0]!.powerProfiles[`m${n}`] = item.power as PowerProfile;
      doc.productLines.push({ id: 'line', manufacturer: 'x', name: 'x', baseMaterial: 'PLA', materialProfileId: `m${n}`, diameterMm: 1.75 });
      doc.filaments.push({ id: 'f', productLineId: 'line', color: 'c', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned', manualPrice: { pricePerKg: item.pricePerKg, asOf } });
      const quote: Quote = {
        id: 'q', number: 1, title: 't', status: 'draft',
        pricingProfileId: `legacy-${item.labor.mode === 'default'}-${item.markup.mode === 'default'}`,
        plates: [{ id: 'pl', name: item.name, printerId: 'mk3', printTimeMin: item.printTimeMin, runs: item.runs, filaments: [{ filamentId: 'f', weightG: item.weightG }] }],
      };

      const r = calculateQuote(doc, quote, asOf);
      expect(r.cost).toBeCloseTo(item.expected.costPrice, 6);
      expect(r.net).toBeCloseTo(item.expected.price, 6);
    });
  }
});

describe('pricing steps', () => {
  function doc(profile: Partial<PricingProfile> = {}): AppDocument {
    const d = createEmptyDocument();
    d.settings.energyPricePerKwh = 0;
    d.settings.hourlyRate = 30;
    d.settings.laborPerPlateMin = 0;
    d.printers.push({ id: 'pr', name: 'P', technology: 'FDM', status: 'active', paidOff: true, toolheads: 4, toolType: 'toolchanger', purgeWastePerPlateG: 0, purgePerFilamentChangeG: 1, firstHourPhaseMin: 60, powerProfiles: {} });
    d.productLines.push({ id: 'l', manufacturer: 'x', name: 'x', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 });
    for (const id of ['a', 'b']) {
      d.filaments.push({ id, productLineId: 'l', color: id, finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned', manualPrice: { pricePerKg: 20, asOf } });
    }
    d.pricingProfiles = [baseProfile(profile)];
    return d;
  }
  // 500 g of filament at 20 €/kg = 10 € cost, 2 h print.
  const quote = (extra: Partial<Quote> = {}): Quote => ({
    id: 'q', number: 1, title: 't', status: 'draft', pricingProfileId: 'p',
    plates: [{ id: 'pl', name: 'Plate', printerId: 'pr', printTimeMin: 120, runs: 1, partsPerRun: 4, filaments: [{ filamentId: 'a', weightG: 500 }] }],
    ...extra,
  });

  it('adds failure allowance on production cost, then markup', () => {
    const r = calculateQuote(doc({ failureAllowance: 0.1, markup: 0.5 }), quote(), asOf);
    expect(r.failure).toBeCloseTo(1, 6);
    expect(r.cost).toBeCloseTo(11, 6);
    expect(r.net).toBeCloseTo(16.5, 6);
    expect(r.margin).toBeCloseTo(5.5 / 16.5, 6);
  });

  it('charges labor extras at the hourly rate, items without markup unless enabled', () => {
    const extras = [
      { id: 'e1', kind: 'labor' as const, description: 'Design', minutes: 30 },
      { id: 'e2', kind: 'item' as const, description: 'Magnets', quantity: 10, unitCost: 0.2 },
    ];
    expect(calculateQuote(doc({ markup: 1 }), quote({ extras }), asOf).net).toBeCloseTo((10 + 15) * 2 + 2, 6);
    expect(calculateQuote(doc({ markup: 1, markupOnItems: true }), quote({ extras }), asOf).net).toBeCloseTo((10 + 15 + 2) * 2, 6);
    expect(calculateQuote(doc({ includeLabor: false }), quote({ extras }), asOf).laborExtras).toBe(0);
  });

  it('applies the highest quantity tier reached by the number of parts, before the customer discount', () => {
    const tiers = [{ fromParts: 4, discountPercent: 10 }, { fromParts: 10, discountPercent: 20 }];
    const r = calculateQuote(doc({ markup: 1, quantityTiers: tiers }), quote({ discountPercent: 10 }), asOf); // 4 parts
    expect(r.quantityTier).toEqual({ fromParts: 4, discountPercent: 10 });
    expect(r.quantityDiscount).toBeCloseTo(2, 6); // 10 % of 20
    expect(r.discount).toBeCloseTo(1.8, 6); // 10 % of 18
    expect(r.net).toBeCloseTo(16.2, 6);
    const big = quote();
    big.plates[0]!.runs = 3; // 12 parts → 20 %
    expect(calculateQuote(doc({ markup: 1, quantityTiers: tiers }), big, asOf).quantityTier?.discountPercent).toBe(20);
    expect(calculateQuote(doc({ quantityTiers: tiers }), quote({ plates: [{ ...quote().plates[0]!, partsPerRun: 1 }] }), asOf).quantityTier).toBeNull();
  });

  it('derives the markup from a target price for the whole quote', () => {
    const total = calculateQuote(doc({ markup: 1, minimumPrice: 50, roundTo: 5 }), quote({ targetPrice: 14 }), asOf);
    expect(total.net).toBe(14);
    expect(total.markup).toBeCloseTo(4, 6);
    expect(total.minimumApplied).toBe(0);
    expect(total.explain?.target).toEqual({ kind: 'quote', total: 14 });
    expect(total.explain?.profit).toBeCloseTo(4, 6);
    expect(calculateQuote(doc(), quote({ targetPrice: 8 }), asOf).warnings).toContain('The target price is below the cost of this quote.');
  });

  it('prices by required parts, with cost and profit per piece from how the plates produce them', () => {
    // Plate 1 (500 g, 10 €): 2 × "Start" + 2 × "Middle" per run, 1 run. Plate 2 (250 g, 5 €): 1 × "End", 2 runs.
    const plates: Quote['plates'] = [
      { id: 'p1', name: 'Plate 1', printerId: 'pr', printTimeMin: 0, runs: 1, parts: [{ name: 'Start', quantity: 2 }, { name: 'Middle', quantity: 2 }], filaments: [{ filamentId: 'a', weightG: 500 }] },
      { id: 'p2', name: 'Plate 2', printerId: 'pr', printTimeMin: 0, runs: 2, parts: [{ name: 'end', quantity: 1 }], filaments: [{ filamentId: 'a', weightG: 125 }] },
    ];
    const requiredParts = [{ name: 'Start', quantity: 1, price: 6 }, { name: 'Middle', quantity: 2, price: 5 }, { name: 'End', quantity: 2, price: 4 }];
    const r = calculateQuote(doc({ markup: 3, failureAllowance: 0.1 }), quote({ plates, requiredParts }), asOf);
    expect(r.explain?.target).toEqual({ kind: 'parts', total: 24 });
    expect(r.net).toBe(24);
    expect(r.cost).toBeCloseTo(16.5, 6); // 15 € plates + 10 % failure allowance
    // Plate 1: 11 € incl. overhead over 4 pieces; plate 2: 5.50 € over 2 pieces.
    expect(r.parts?.map((p) => [p.name, p.required, p.planned, p.price, p.costEach, p.profitEach])).toEqual([
      ['Start', 1, 2, 6, 2.75, 3.25],
      ['Middle', 2, 2, 5, 2.75, 2.25],
      ['End', 2, 2, 4, 2.75, 1.25],
    ]);
    expect(r.warnings.filter((w) => !w.includes('power profile'))).toEqual([]);
    // A missing price is counted as 0 and reported; quotes without prices keep the profile's markup.
    const unpriced = calculateQuote(doc({ markup: 1 }), quote({ plates, requiredParts: [{ name: 'Start', quantity: 1, price: 6 }, { name: 'Middle', quantity: 3 }] }), asOf);
    expect(unpriced.warnings).toEqual(expect.arrayContaining(['Not enough planned: Middle.', 'No price yet: Middle (counted as 0).']));
    expect(calculateQuote(doc({ markup: 1 }), quote({ plates, requiredParts: [{ name: 'Start', quantity: 1 }] }), asOf).explain?.target).toBeNull();
  });

  it('counts no parts for a plate without filament', () => {
    const empty = { id: 'e', name: 'Plate 2', printerId: 'pr', printTimeMin: 0, runs: 1, filaments: [] };
    const r = calculateQuote(doc(), quote({ plates: [...quote().plates, empty], targetPrice: undefined }), asOf);
    expect(r.plates.map((p) => p.parts)).toEqual([4, 0]);
    expect(r.explain?.parts).toBe(4);
  });

  it('explains each cost with its inputs', () => {
    const d = doc({ failureAllowance: 0.1 });
    d.printers[0]!.purgeWastePerPlateG = 10;
    const r = calculateQuote(d, quote(), asOf);
    const e = r.plates[0]!.explain!;
    expect(e.filaments).toEqual([{ filamentId: 'a', modelG: 500, wasteG: 10, grams: 510, pricePerKg: 20, cost: 10.2 }]);
    expect(e.primingG).toBe(10);
    expect(e.hoursPerRun).toBe(2);
    expect(r.explain).toMatchObject({ failureRate: 0.1, failureBase: 10.2, parts: 4 });
  });

  it('applies discount, then minimum price, then rounding', () => {
    expect(calculateQuote(doc({ markup: 1 }), quote({ discountPercent: 10 }), asOf).net).toBeCloseTo(18, 6);
    const min = calculateQuote(doc({ minimumPrice: 15 }), quote(), asOf);
    expect(min.net).toBe(15);
    expect(min.minimumApplied).toBeCloseTo(5, 6);
    expect(calculateQuote(doc({ markup: 0.23, roundTo: 0.5 }), quote(), asOf).net).toBe(12.5);
  });

  it('rounds the gross price when prices include VAT', () => {
    const d = doc({ roundTo: 1 });
    d.settings.vat = { enabled: true, ratePercent: 19, pricesIncludeVat: true, noVatNote: '' };
    const r = calculateQuote(d, quote(), asOf);
    expect(r.price).toBe(12); // 10 × 1.19 = 11.90 → 12
    expect(r.net).toBeCloseTo(12 / 1.19, 6);
    expect(r.gross).toBeCloseTo(12, 6);
  });

  it('adds VAT on top of net prices', () => {
    const d = doc();
    d.settings.vat = { enabled: true, ratePercent: 19, pricesIncludeVat: false, noVatNote: '' };
    const r = calculateQuote(d, quote(), asOf);
    expect(r.price).toBeCloseTo(10, 6);
    expect(r.vat).toBeCloseTo(1.9, 6);
  });

  it('estimates multi-material purge from filament changes and splits it by weight', () => {
    const q = quote();
    q.plates[0]!.filaments = [{ filamentId: 'a', weightG: 300 }, { filamentId: 'b', weightG: 100 }];
    q.plates[0]!.filamentChanges = 100; // × 1 g per change
    expect(calculateQuote(doc(), q, asOf).plates[0]!.filamentG).toBeCloseTo(500, 6);
  });

  it('reports price per part and flags prices below full cost', () => {
    const r = calculateQuote(doc({ includeLabor: false, laborPerPlateMin: 60 }), quote(), asOf);
    expect(r.plates[0]!.pricePerPart).toBeCloseTo(2.5, 6);
    expect(r.fullCost).toBeCloseTo(40, 6);
    expect(r.warnings).toContain('Price is below the full cost (labor, machine and reserve included).');
  });
});
