import { describe, expect, it } from 'vitest';
import { machineRate, printerHours, reserveRatePerHour } from '../src/core/calc/machine-rate';
import { createEmptyDocument } from '../src/core/document';
import type { AppDocument, MachineCost, PlannedInvestment, Printer } from '../src/core/model';

const asOf = '2026-10-01';

function printer(overrides: Partial<Printer> = {}): Printer {
  return {
    id: 'mk3',
    name: 'MK3S+',
    technology: 'FDM',
    status: 'active',
    toolheads: 1,
    toolType: 'single',
    purgeWastePerPlateG: 10,
    purgePerFilamentChangeG: null,
    firstHourPhaseMin: 60,
    powerProfiles: {},
    usageStats: [
      { source: 'OctoPrint', asOf: '2026-10-01', since: '2024-08-26', printHours: 2779.73 },
      { source: 'OctoPrint', asOf: '2026-10-01', since: '2026-01-01', printHours: 864.29 },
      { source: 'LCD', asOf: '2026-10-01', since: null, printHours: 10245.12 },
    ],
    ...overrides,
  };
}

let n = 0;
function cost(kind: MachineCost['kind'], total: number, date = '2024-02-27', years = 2, printerId: string | null = 'mk3'): MachineCost {
  return { id: `c${n++}`, date, store: 'x', description: kind, quantity: 1, total, amortizationYears: years, kind, printerId };
}

const reserve: PlannedInvestment = {
  id: 'core-one',
  name: 'CORE One + INDX',
  printerId: null,
  targetAmount: 2000,
  mode: 'lifetime',
  usefulLifeYears: 5,
  expectedHoursPerYear: 1250,
  alreadyReserved: 0,
};

function doc(p: Printer, costs: MachineCost[], plans: PlannedInvestment[] = []): AppDocument {
  return { ...createEmptyDocument(), printers: [p], machineCosts: costs, plannedInvestments: plans };
}

describe('printerHours', () => {
  it('takes hours per year from the longest snapshot period and lifetime from the counter', () => {
    const h = printerHours(printer());
    expect(h.hoursPerYear).toBeCloseTo(2779.73 / (766 / 365.25), 1); // ≈ 1325 h/yr
    expect(h.lifetimeHours).toBe(10245.12);
  });

  it('prefers a manual override', () => {
    expect(printerHours(printer({ hoursPerYearOverride: 1000 })).hoursPerYear).toBe(1000);
  });
});

describe('machineRate', () => {
  it('paid-off printer: only wear parts over lifetime hours plus the reserve (requirements MC-3/MC-8)', () => {
    const r = machineRate(
      doc(printer({ paidOff: true }), [cost('investment', 778.33, '2019-08-16', 5), cost('wear-part', 286.14), cost('shipping', 41.07)], [reserve]),
      'mk3',
      asOf,
    );
    expect(r.investmentPerHour).toBe(0);
    expect(r.wearPerHour).toBeCloseTo(327.21 / 10245.12, 6); // ≈ 0.032 €/h
    expect(r.reserves).toEqual([{ investmentId: 'core-one', name: 'CORE One + INDX', ratePerHour: 0.32 }]);
    expect(r.totalPerHour).toBeCloseTo(r.wearPerHour + 0.32, 6);
    expect(r.warnings).toEqual([]);
  });

  it('amortizes only investments that are still within their period', () => {
    const p = printer({ hoursPerYearOverride: 1000 });
    const r = machineRate(doc(p, [cost('investment', 1000, '2025-01-01', 5), cost('investment', 778, '2019-08-16', 5)]), 'mk3', asOf);
    expect(r.investmentPerHour).toBeCloseTo(200 / 1000, 6);
  });

  it('spreads shared costs over all active printers', () => {
    const r = machineRate(doc(printer(), [cost('wear-part', 102.45, '2025-01-10', 5, null)]), 'mk3', asOf);
    expect(r.sharedPerHour).toBeCloseTo(0.01, 6);
  });

  it('charges no reserve on retired printers', () => {
    expect(machineRate(doc(printer({ status: 'retired' }), [], [reserve]), 'mk3', asOf).reserves).toEqual([]);
  });

  it('warns instead of guessing when hours are unknown', () => {
    const r = machineRate(doc(printer({ usageStats: [] }), [cost('wear-part', 100)]), 'mk3', asOf);
    expect(r.wearPerHour).toBe(0);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('reserveRatePerHour', () => {
  it('lifetime: amount / (years × hours per year)', () => {
    expect(reserveRatePerHour(reserve, asOf, null)).toBeCloseTo(0.32, 6);
    expect(reserveRatePerHour({ ...reserve, usefulLifeYears: 4 }, asOf, null)).toBeCloseTo(0.4, 6);
  });

  it('target date: remaining amount over the hours until then', () => {
    const plan: PlannedInvestment = { ...reserve, mode: 'target-date', targetDate: '2028-10-01', alreadyReserved: 400, expectedHoursPerYear: 1200 };
    expect(reserveRatePerHour(plan, asOf, null)).toBeCloseTo(1600 / (2 * 1200), 2);
  });

  it('fixed rate', () => {
    expect(reserveRatePerHour({ ...reserve, mode: 'fixed-rate', fixedRatePerHour: 0.25 }, asOf, null)).toBe(0.25);
  });
});
