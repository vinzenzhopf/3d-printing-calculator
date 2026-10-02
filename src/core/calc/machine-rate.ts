import type { AppDocument, Id, IsoDate, PlannedInvestment, PrintJob, Printer } from '../model';

export interface HoursBasis {
  /** Print hours per year, null when unknown. */
  hoursPerYear: number | null;
  hoursPerYearSource: string;
  /** Total print hours of the printer so far, null when unknown. */
  lifetimeHours: number | null;
  lifetimeSource: string;
}

export interface ReserveRate {
  investmentId: Id;
  name: string;
  /** Full rate; pricing profiles charge a share of it (MC-8). */
  ratePerHour: number;
}

export interface MachineRate {
  printerId: Id;
  /** Active investments of this printer per print hour (0 when paid off). */
  investmentPerHour: number;
  /** Wear parts, maintenance and shipping of this printer per print hour. */
  wearPerHour: number;
  /** Costs not tied to one printer (e.g. OctoPrint Pi), spread over all active printers' hours. */
  sharedPerHour: number;
  reserves: ReserveRate[];
  /** Sum of the parts above with the full reserve rates. */
  totalPerHour: number;
  hours: HoursBasis;
  warnings: string[];
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export function yearsBetween(from: IsoDate, to: IsoDate): number {
  return (Date.parse(to) - Date.parse(from)) / YEAR_MS;
}

function addYears(date: IsoDate, years: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Math.round(years * 12));
  return d.toISOString().slice(0, 10);
}

/**
 * Hours per year: manual override, else the usage snapshot covering the longest
 * period. Lifetime hours: the highest lifetime counter reading (since = null)
 * plus print jobs logged after that reading.
 */
export function printerHours(printer: Printer, jobs: readonly PrintJob[] = []): HoursBasis {
  const stats = printer.usageStats ?? [];
  let hoursPerYear: number | null = null;
  let hoursPerYearSource = 'unknown';
  if (printer.hoursPerYearOverride && printer.hoursPerYearOverride > 0) {
    hoursPerYear = printer.hoursPerYearOverride;
    hoursPerYearSource = 'manual';
  } else {
    const periods = stats
      .filter((s) => s.since && yearsBetween(s.since, s.asOf) > 0)
      .sort((a, b) => yearsBetween(b.since!, b.asOf) - yearsBetween(a.since!, a.asOf));
    const best = periods[0];
    if (best) {
      hoursPerYear = best.printHours / yearsBetween(best.since!, best.asOf);
      hoursPerYearSource = `${best.source}, ${best.since} – ${best.asOf}`;
    }
  }

  const lifetime = stats.filter((s) => s.since === null).sort((a, b) => b.printHours - a.printHours)[0];
  const logged = jobs.filter((j) => j.printerId === printer.id && (!lifetime || j.date > lifetime.asOf));
  const loggedHours = logged.reduce((sum, j) => sum + j.printTimeMin / 60, 0);
  return {
    hoursPerYear,
    hoursPerYearSource,
    lifetimeHours: lifetime ? lifetime.printHours + loggedHours : null,
    lifetimeSource: lifetime
      ? `${lifetime.source}, ${lifetime.asOf}${logged.length ? ` + ${logged.length} logged jobs` : ''}`
      : 'unknown',
  };
}

export function reserveRatePerHour(plan: PlannedInvestment, asOf: IsoDate, fallbackHoursPerYear: number | null): number | null {
  const hoursPerYear = plan.expectedHoursPerYear ?? fallbackHoursPerYear;
  switch (plan.mode) {
    case 'fixed-rate':
      return plan.fixedRatePerHour ?? 0;
    case 'lifetime':
      if (!hoursPerYear || !plan.usefulLifeYears) return null;
      return plan.targetAmount / (plan.usefulLifeYears * hoursPerYear);
    case 'target-date': {
      if (!hoursPerYear || !plan.targetDate) return null;
      const remaining = Math.max(plan.targetAmount - plan.alreadyReserved, 0);
      const years = yearsBetween(asOf, plan.targetDate);
      return years > 0 ? remaining / (years * hoursPerYear) : null;
    }
  }
}

const WEAR_KINDS = new Set(['wear-part', 'maintenance', 'shipping']);

/** Machine cost per print hour of one printer (MC-3, MC-8). */
export function machineRate(doc: AppDocument, printerId: Id, asOf: IsoDate): MachineRate {
  const printer = doc.printers.find((p) => p.id === printerId);
  if (!printer) throw new Error(`Unknown printer ${printerId}`);
  const warnings: string[] = [];
  const hours = printerHours(printer, doc.printJobs);
  const own = doc.machineCosts.filter((c) => c.printerId === printerId);

  // Investments: per-year amortization while active, divided by hours per year.
  let investmentPerHour = 0;
  if (!printer.paidOff) {
    const perYear = own
      .filter((c) => c.kind === 'investment' && c.amortizationYears > 0 && addYears(c.date, c.amortizationYears) > asOf)
      .reduce((sum, c) => sum + c.total / c.amortizationYears, 0);
    if (perYear > 0) {
      if (hours.hoursPerYear) investmentPerHour = perYear / hours.hoursPerYear;
      else warnings.push('Investments need print hours per year (usage snapshot or manual value).');
    }
  }

  // Wear: everything ever spent on wear parts over the hours the printer has run.
  const wearTotal = own.filter((c) => WEAR_KINDS.has(c.kind)).reduce((sum, c) => sum + c.total, 0);
  let wearPerHour = 0;
  if (wearTotal > 0) {
    const wearHours = hours.lifetimeHours ?? estimateHoursSince(own.map((c) => c.date), asOf, hours.hoursPerYear);
    if (wearHours) wearPerHour = wearTotal / wearHours;
    else warnings.push('Wear parts need a lifetime hour counter or print hours per year.');
  }

  // Shared costs: spread over the lifetime hours of all active printers.
  const sharedTotal = doc.machineCosts.filter((c) => c.printerId === null).reduce((sum, c) => sum + c.total, 0);
  let sharedPerHour = 0;
  if (sharedTotal > 0) {
    const fleetHours = doc.printers
      .filter((p) => p.status === 'active')
      .reduce((sum, p) => sum + (printerHours(p, doc.printJobs).lifetimeHours ?? 0), 0);
    if (fleetHours > 0) sharedPerHour = sharedTotal / fleetHours;
    else warnings.push('Shared costs need lifetime hour counters on the active printers.');
  }

  // Replacement reserves apply to every printer that is not retired.
  const reserves: ReserveRate[] = [];
  if (printer.status !== 'retired') {
    for (const plan of doc.plannedInvestments) {
      const rate = reserveRatePerHour(plan, asOf, hours.hoursPerYear);
      if (rate === null) warnings.push(`Reserve "${plan.name}": incomplete settings, not charged.`);
      else reserves.push({ investmentId: plan.id, name: plan.name, ratePerHour: rate });
    }
  }

  const reserveTotal = reserves.reduce((sum, r) => sum + r.ratePerHour, 0);
  return {
    printerId,
    investmentPerHour,
    wearPerHour,
    sharedPerHour,
    reserves,
    totalPerHour: investmentPerHour + wearPerHour + sharedPerHour + reserveTotal,
    hours,
    warnings,
  };
}

function estimateHoursSince(dates: IsoDate[], asOf: IsoDate, hoursPerYear: number | null): number | null {
  if (!hoursPerYear || dates.length === 0) return null;
  const first = dates.reduce((a, b) => (a < b ? a : b));
  const years = yearsBetween(first, asOf);
  return years > 0 ? years * hoursPerYear : null;
}
