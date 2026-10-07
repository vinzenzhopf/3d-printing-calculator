import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import type { AppDocument } from '../src/core/model';
import { compareQuote, createQuote, quoteResult, quoteSummaryText, setQuoteStatus } from '../src/core/quotes';

const asOf = '2026-10-02';
const now = new Date('2026-10-02T10:00:00Z');

function doc(): AppDocument {
  const d = createEmptyDocument();
  d.settings.energyPricePerKwh = 0;
  d.settings.laborPerPlateMin = 0;
  d.printers.push({ id: 'pr', name: 'P', technology: 'FDM', status: 'active', paidOff: true, toolheads: 1, toolType: 'single', purgeWastePerPlateG: 0, purgePerFilamentChangeG: null, firstHourPhaseMin: 60, powerProfiles: {} });
  d.productLines.push({ id: 'l', manufacturer: 'x', name: 'x', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 });
  d.filaments.push({ id: 'f', productLineId: 'l', color: 'c', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned', manualPrice: { pricePerKg: 20, asOf } });
  d.customers.push({ id: 'c', name: 'Alex', defaultPricingProfileId: 'own-use', discountPercent: 10 });
  return d;
}

describe('createQuote', () => {
  it('numbers sequentially and takes the customer defaults', () => {
    const d = doc();
    d.quotes.push({ ...createQuote(d, { id: 'q1', date: asOf }), number: 7 });
    const q = createQuote(d, { id: 'q2', date: asOf, customerId: 'c' });
    expect(q.number).toBe(8);
    expect(q.pricingProfileId).toBe('own-use');
    expect(q.discountPercent).toBe(10);
    expect(createQuote(doc(), { id: 'q', date: asOf }).pricingProfileId).toBe('standard');
  });
});

describe('setQuoteStatus', () => {
  it('freezes the price when leaving draft and keeps it when inputs change later', () => {
    const d = doc();
    const q = createQuote(d, { id: 'q', date: asOf });
    q.pricingProfileId = 'own-use';
    q.plates.push({ id: 'p', name: 'Plate', printerId: 'pr', printTimeMin: 60, runs: 1, filaments: [{ filamentId: 'f', weightG: 500 }] });

    setQuoteStatus(d, q, 'sent', asOf, now);
    expect(q.snapshot?.result.net).toBeCloseTo(10, 6);

    d.filaments[0]!.manualPrice = { pricePerKg: 40, asOf };
    expect(quoteResult(d, q, asOf)?.net).toBeCloseTo(10, 6);

    setQuoteStatus(d, q, 'accepted', asOf, now);
    expect(q.snapshot?.result.net).toBeCloseTo(10, 6);

    setQuoteStatus(d, q, 'draft', asOf, now);
    expect(q.snapshot).toBeUndefined();
    expect(quoteResult(d, q, asOf)?.net).toBeCloseTo(20, 6);
  });

  it('freezes imported non-draft quotes on their next status change', () => {
    const d = doc();
    const q = { ...createQuote(d, { id: 'q', date: asOf }), status: 'delivered' as const };
    setQuoteStatus(d, q, 'paid', asOf, now);
    expect(q.snapshot).toBeDefined();
  });
});

describe('quoteSummaryText', () => {
  it('lists positions with parts and the total, without internal costs', () => {
    const d = doc();
    d.settings.vat.noVatNote = 'No VAT charged.';
    const q = createQuote(d, { id: 'q', date: asOf });
    q.title = 'Bins';
    q.pricingProfileId = 'own-use';
    q.plates.push({ id: 'p', name: 'Bin 1x1', printerId: 'pr', printTimeMin: 60, runs: 2, partsPerRun: 3, filaments: [{ filamentId: 'f', weightG: 300 }] });
    const text = quoteSummaryText(d, q, quoteResult(d, q, asOf)!, (n) => `${n.toFixed(2)} €`);
    expect(text).toBe(['Quote #1: Bins', '', '- Bin 1x1: 6 × 2.00 € = 12.00 €', '', 'Total: 12.00 €', 'No VAT charged.'].join('\n'));
  });

  it('lists the agreed part prices when the quote is priced by parts', () => {
    const d = doc();
    const q = createQuote(d, { id: 'q', date: asOf });
    q.title = 'Track';
    q.plates.push({ id: 'p', name: 'Plate 1', printerId: 'pr', printTimeMin: 60, runs: 1, parts: [{ name: 'Start', quantity: 1 }, { name: 'Middle', quantity: 3 }], filaments: [{ filamentId: 'f', weightG: 100 }] });
    q.requiredParts = [{ name: 'Start', quantity: 1, price: 6 }, { name: 'Middle', quantity: 2, price: 4.5 }, { name: 'Spare', quantity: 0, price: 1 }];
    const text = quoteSummaryText(d, q, quoteResult(d, q, asOf)!, (n) => `${n.toFixed(2)} €`);
    expect(text).toBe(['Quote #1: Track', '', '- Start: 6.00 €', '- Middle: 2 × 4.50 € = 9.00 €', '', 'Total: 15.00 €'].join('\n'));
  });
});

describe('compareQuote', () => {
  it('prices the quote with every profile and on every printer that is not retired', () => {
    const d = doc();
    d.printers.push({ ...d.printers[0]!, id: 'core', name: 'CORE One', status: 'planned', paidOff: false });
    d.printers.push({ ...d.printers[0]!, id: 'old', name: 'Old', status: 'retired' });
    d.plannedInvestments.push({ id: 'r', name: 'Reserve', printerId: 'core', targetAmount: 0, mode: 'fixed-rate', fixedRatePerHour: 1, alreadyReserved: 0 });
    d.machineCosts.push({ id: 'w', date: '2026-01-01', store: '', description: 'nozzle', quantity: 1, total: 100, amortizationYears: 0, kind: 'wear-part', printerId: 'core' });
    d.printers[1]!.usageStats = [{ source: 'x', asOf, since: null, printHours: 100 }];
    const q = createQuote(d, { id: 'q', date: asOf });
    q.pricingProfileId = 'own-use';
    q.plates.push({ id: 'p', name: 'Plate', printerId: 'pr', printTimeMin: 120, runs: 1, filaments: [{ filamentId: 'f', weightG: 500 }] });

    const c = compareQuote(d, q, asOf);
    expect(c.profiles.map((p) => p.id)).toEqual(d.pricingProfiles.map((p) => p.id));
    expect(c.profiles.find((p) => p.id === 'own-use')?.price).toBeCloseTo(10, 6);
    expect(c.printers.map((p) => p.name)).toEqual(['P', 'CORE One']);
    // Own use charges neither machine nor reserve, so both printers cost the same here …
    expect(c.printers[0]!.price).toBeCloseTo(c.printers[1]!.price!, 6);
    // … while Standard charges the CORE One's wear (100 € / 100 h) and the full reserve.
    const std = compareQuote(d, { ...q, pricingProfileId: 'standard' }, asOf).printers;
    expect(std[1]!.cost! - std[0]!.cost!).toBeCloseTo(2 * 1 * 1.05, 6);
  });
});
