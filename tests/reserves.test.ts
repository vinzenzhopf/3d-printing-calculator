import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../src/core/document';
import type { AppDocument, Quote } from '../src/core/model';
import { reserveProgress } from '../src/core/reserves';

const asOf = '2026-10-01';

function doc(): AppDocument {
  const d = createEmptyDocument();
  d.settings.energyPricePerKwh = 0;
  d.printers.push({ id: 'pr', name: 'P', technology: 'FDM', status: 'active', paidOff: true, toolheads: 1, toolType: 'single', purgeWastePerPlateG: 0, purgePerFilamentChangeG: null, firstHourPhaseMin: 60, powerProfiles: {} });
  d.productLines.push({ id: 'l', manufacturer: 'x', name: 'x', baseMaterial: 'PLA', materialProfileId: null, diameterMm: 1.75 });
  d.filaments.push({ id: 'f', productLineId: 'l', color: 'c', finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned', manualPrice: { pricePerKg: 20, asOf } });
  // 1 €/h reserve, 1,000 € target, 100 € set aside by hand.
  d.plannedInvestments.push({ id: 'res', name: 'Next', printerId: null, targetAmount: 1000, mode: 'fixed-rate', fixedRatePerHour: 1, alreadyReserved: 100 });
  return d;
}

const quote = (id: string, status: Quote['status'], date: string, hours: number, profile = 'standard'): Quote => ({
  id, number: 1, title: id, date, status, pricingProfileId: profile,
  plates: [{ id: `${id}-p`, name: 'p', printerId: 'pr', printTimeMin: hours * 60, runs: 1, filaments: [{ filamentId: 'f', weightG: 100 }] }],
});

describe('reserveProgress', () => {
  it('adds the reserve share of delivered and paid quotes to the amount set aside, with a pace', () => {
    const d = doc();
    d.quotes.push(
      quote('a', 'paid', '2026-04-01', 50), // standard: 100 % share → 50 €
      quote('b', 'delivered', '2026-07-01', 30), // 30 €
      quote('c', 'sent', '2026-09-01', 500), // not billed yet
      quote('d', 'paid', '2026-08-01', 40, 'own-use'), // own use charges no reserve
    );
    const [p] = reserveProgress(d, asOf);
    expect(p).toMatchObject({ billed: 80, quotes: 2, collected: 180, alreadyReserved: 100 });
    expect(p!.share).toBeCloseTo(0.18, 6);
    expect(p!.perMonth).toBeCloseTo(80 / 6, 0); // ~6 months since the first billed quote
    expect(p!.eta! > '2031-01-01' && p!.eta! < '2031-12-31').toBe(true); // 820 € left at ~13 €/month
  });

  it('has no pace without billed quotes', () => {
    expect(reserveProgress(doc(), asOf)[0]).toMatchObject({ billed: 0, collected: 100, perMonth: null, eta: null });
  });
});
