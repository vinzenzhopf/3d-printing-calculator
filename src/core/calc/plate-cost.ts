import type { Id, Plate, PowerProfile, Printer } from '../model';

/**
 * Everything the engine needs besides the plate itself. Lookups that involve
 * policy (which filament price, which machine rate) are resolved by the caller,
 * so this module stays a pure, easily testable formula.
 */
export interface CostContext {
  energyPricePerKwh: number;
  printer: Printer;
  /** Material profile id of a filament, used for the power lookup. */
  materialProfileOf(filamentId: Id): Id | null | undefined;
  /** €/kg for a filament, given how many kg this plate needs in total (FI-10/FI-11). */
  pricePerKg(filamentId: Id, needKg: number): number;
  /** Machine €/h: amortization + wear parts + replacement-reserve share (MC-3, MC-8). */
  machineRatePerHour: number;
  labor: { minutesPerRun: number; hourlyRate: number };
}

export interface CostBreakdown {
  filament: number;
  energy: number;
  machine: number;
  labor: number;
  total: number;
  /** Total grams incl. waste, all runs. */
  filamentG: number;
  /** Total energy, all runs. */
  energyWh: number;
  warnings: string[];
}

const DEFAULT_FIRST_PHASE_MIN = 60;

export function computePlateCost(plate: Plate, ctx: CostContext): CostBreakdown {
  const warnings: string[] = [];
  if (plate.runs <= 0 || plate.filaments.length === 0) {
    return { filament: 0, energy: 0, machine: 0, labor: 0, total: 0, filamentG: 0, energyWh: 0, warnings };
  }
  const hours = plate.printTimeMin / 60;

  // Filament: model weight + waste. Waste (per-run priming + multi-material purge)
  // is split proportionally to the model weight of each filament.
  const modelG = plate.filaments.reduce((sum, f) => sum + f.weightG, 0);
  const wasteG = (ctx.printer.purgeWastePerPlateG ?? 0) + (plate.purgeG ?? 0);
  let filament = 0;
  let filamentG = 0;
  for (const f of plate.filaments) {
    const share = modelG > 0 ? f.weightG / modelG : 1 / plate.filaments.length;
    const grams = (f.weightG + wasteG * share) * plate.runs;
    filament += (grams / 1000) * ctx.pricePerKg(f.filamentId, grams / 1000);
    filamentG += grams;
  }

  // Energy: for mixed plates the most power-hungry material profile wins.
  const power = pickPowerProfile(plate, ctx);
  let energyWh = 0;
  if (power) {
    const phaseH = (ctx.printer.firstHourPhaseMin ?? DEFAULT_FIRST_PHASE_MIN) / 60;
    const perRun =
      (power.heatupMin * power.heatupPowerW) / 60 +
      Math.min(hours, phaseH) * power.powerFirstHourW +
      Math.max(hours - phaseH, 0) * power.powerFollowingHoursW;
    energyWh = perRun * plate.runs;
  } else {
    warnings.push(`No power profile on printer "${ctx.printer.name}" for the plate's material(s); energy counted as 0.`);
  }
  const energy = (energyWh / 1000) * ctx.energyPricePerKwh;

  const machine = hours * plate.runs * ctx.machineRatePerHour;
  const labor = (ctx.labor.minutesPerRun / 60) * plate.runs * ctx.labor.hourlyRate;

  return {
    filament,
    energy,
    machine,
    labor,
    total: filament + energy + machine + labor,
    filamentG,
    energyWh,
    warnings,
  };
}

function pickPowerProfile(plate: Plate, ctx: CostContext): PowerProfile | undefined {
  let best: PowerProfile | undefined;
  for (const f of plate.filaments) {
    const profileId = ctx.materialProfileOf(f.filamentId);
    const p = profileId ? ctx.printer.powerProfiles[profileId] : undefined;
    if (p && (!best || p.powerFollowingHoursW > best.powerFollowingHoursW)) best = p;
  }
  return best;
}
