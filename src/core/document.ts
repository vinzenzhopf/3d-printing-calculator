import { SCHEMA_VERSION, type AppDocument, type PricingProfile, type TarePreset } from './model';

/** Starting pricing profiles (requirements PP-2). All editable by the user. */
export const DEFAULT_PRICING_PROFILES: PricingProfile[] = [
  { id: 'own-use', name: 'Own use', includeLabor: false, includeMachine: false, reserveShare: 0, failureAllowance: 0, markup: 0, minimumPrice: 0, roundTo: 0 },
  { id: 'friends-family', name: 'Friends & family', includeLabor: false, includeMachine: true, reserveShare: 0, failureAllowance: 0.05, markup: 0, minimumPrice: 0, roundTo: 0.5 },
  { id: 'standard', name: 'Standard', includeLabor: true, includeMachine: true, reserveShare: 1, failureAllowance: 0.05, markup: 0.2, minimumPrice: 5, roundTo: 0.5 },
  { id: 'commercial', name: 'Commercial', includeLabor: true, includeMachine: true, reserveShare: 1, failureAllowance: 0.1, markup: 0.4, minimumPrice: 10, roundTo: 1 },
  { id: 'rush', name: 'Rush', includeLabor: true, includeMachine: true, reserveShare: 1, failureAllowance: 0.05, markup: 0.5, minimumPrice: 10, roundTo: 0.5 },
];

/**
 * Empty-spool weights to start with (FI-6a). Brand values come from the community
 * SpoolmanDB; generic ones are rough averages. All unverified: weigh an empty spool
 * once and save it as a preset.
 */
export const DEFAULT_TARE_PRESETS: TarePreset[] = [
  { id: 'tare-sunlu-plastic', manufacturer: 'SUNLU', productLineId: null, spoolType: 'plastic', emptyG: 130, source: 'SpoolmanDB', verified: false },
  { id: 'tare-any-plastic', manufacturer: null, productLineId: null, spoolType: 'plastic', emptyG: 200, source: 'rough average', verified: false },
  { id: 'tare-any-cardboard', manufacturer: null, productLineId: null, spoolType: 'cardboard', emptyG: 140, source: 'rough average', verified: false },
  { id: 'tare-any-refill', manufacturer: null, productLineId: null, spoolType: 'refill', emptyG: 0, source: 'refills have no spool; set the weight of the reusable spool you use', verified: false },
];

export function createEmptyDocument(now = new Date()): AppDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    settings: {
      currency: 'EUR',
      energyPricePerKwh: 0.3,
      hourlyRate: 15,
      laborPerPlateMin: 10,
      filamentPriceWindowMonths: 12,
      businessMode: false,
      business: { name: '', address: '', email: '' },
      vat: { enabled: false, ratePercent: 19, pricesIncludeVat: true, noVatNote: '' },
    },
    materialProfiles: [],
    printers: [],
    productLines: [],
    filaments: [],
    purchases: [],
    machineCosts: [],
    plannedInvestments: [],
    pricingProfiles: structuredClone(DEFAULT_PRICING_PROFILES),
    customers: [],
    quotes: [],
    spools: [],
    tarePresets: structuredClone(DEFAULT_TARE_PRESETS),
    printJobs: [],
  };
}
