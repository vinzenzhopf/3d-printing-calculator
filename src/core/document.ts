import { SCHEMA_VERSION, type AppDocument, type PricingProfile } from './model';

/** Starting pricing profiles (requirements PP-2). All editable by the user. */
export const DEFAULT_PRICING_PROFILES: PricingProfile[] = [
  { id: 'own-use', name: 'Own use', includeLabor: false, includeMachine: false, reserveShare: 0, failureAllowance: 0, markup: 0, minimumPrice: 0, roundTo: 0 },
  { id: 'friends-family', name: 'Friends & family', includeLabor: false, includeMachine: true, reserveShare: 0, failureAllowance: 0.05, markup: 0, minimumPrice: 0, roundTo: 0.5 },
  { id: 'standard', name: 'Standard', includeLabor: true, includeMachine: true, reserveShare: 1, failureAllowance: 0.05, markup: 0.2, minimumPrice: 5, roundTo: 0.5 },
  { id: 'commercial', name: 'Commercial', includeLabor: true, includeMachine: true, reserveShare: 1, failureAllowance: 0.1, markup: 0.4, minimumPrice: 10, roundTo: 1 },
  { id: 'rush', name: 'Rush', includeLabor: true, includeMachine: true, reserveShare: 1, failureAllowance: 0.05, markup: 0.5, minimumPrice: 10, roundTo: 0.5 },
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
      vat: { enabled: false, ratePercent: 19, pricesIncludeVat: true },
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
  };
}
