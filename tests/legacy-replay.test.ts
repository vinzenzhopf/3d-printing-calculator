import { describe, expect, it } from 'vitest';
import { computePlateCost, type CostContext } from '../src/core/calc/plate-cost';
import { applyMarkup } from '../src/core/calc/pricing';
import type { Plate, PowerProfile, Printer } from '../src/core/model';
import fixture from './fixtures/legacy-quotes.json';

/**
 * Replays every row of the old Excel sheets through the new engine,
 * configured the way Excel calculated: all-time average filament price,
 * flat amortization €/h, labor and markup switched per row.
 */
type Toggle = { mode: string; value?: number };
const s = fixture.settings;

const printer: Printer = {
  id: 'legacy',
  name: 'Legacy MK3S+',
  technology: 'FDM',
  status: 'active',
  toolheads: 1,
  toolType: 'single',
  purgeWastePerPlateG: s.purgeWastePerPlateG,
  purgePerFilamentChangeG: null,
  firstHourPhaseMin: s.firstHourPhaseMin,
  powerProfiles: {},
};

function resolve(toggle: Toggle, defaultValue: number): number {
  if (toggle.mode === 'default') return defaultValue;
  if (toggle.mode === 'override') return toggle.value ?? 0;
  return 0;
}

describe('Excel regression (legacy configuration)', () => {
  for (const item of fixture.items) {
    it(`quote ${item.quote}: ${item.name}`, () => {
      const plate: Plate = {
        id: 'p',
        name: item.name,
        printerId: printer.id,
        printTimeMin: item.printTimeMin,
        runs: item.runs,
        filaments: [{ filamentId: 'f', weightG: item.weightG }],
      };
      const ctx: CostContext = {
        energyPricePerKwh: s.energyPricePerKwh,
        printer: { ...printer, powerProfiles: item.power ? { m: item.power as PowerProfile } : {} },
        materialProfileOf: () => 'm',
        pricePerKg: () => item.pricePerKg,
        machineRatePerHour: s.amortizationPerHour,
        labor: { minutesPerRun: s.laborPerPlateMin, hourlyRate: resolve(item.labor, s.hourlyRate) },
      };

      const cost = computePlateCost(plate, ctx);
      const price = applyMarkup(cost.total, resolve(item.markup, s.defaultMarkup));
      const e = item.expected;

      expect(cost.filament).toBeCloseTo(e.filamentCost, 6);
      expect(cost.energy).toBeCloseTo(e.powerCost, 6);
      expect(cost.machine).toBeCloseTo(e.amortization, 6);
      expect(cost.labor).toBeCloseTo(e.labor, 6);
      expect(cost.total).toBeCloseTo(e.costPrice, 6);
      expect(price).toBeCloseTo(e.price, 6);
    });
  }
});
