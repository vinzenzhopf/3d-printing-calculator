import { createEmptyDocument } from './document';
import type { AppDocument, Filament, FilamentPurchase, IsoDate, PrintJob, Quote, QuoteStatus, Spool } from './model';
import { setQuoteStatus } from './quotes';

/**
 * A fictional workshop to try the app with: printers, a filament catalog with
 * purchases and labeled spools, a year of prints, customers and quotes. Dates
 * are relative to `today`, so statistics always look current. Deterministic
 * (seeded), and marked with `settings.demo` so it can't be synced by accident.
 */
export function createDemoDocument(today: IsoDate, now = new Date()): AppDocument {
  const rand = mulberry32(20261007);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const between = (min: number, max: number) => min + rand() * (max - min);
  const day = (offset: number): IsoDate => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  let seq = 0;
  const id = (prefix: string) => `demo-${prefix}-${++seq}`;

  const doc = createEmptyDocument(now);
  doc.settings.demo = true;
  doc.settings.business = { name: 'Demo Print Workshop', address: '', email: '' };

  // --- Printers -----------------------------------------------------------------
  doc.materialProfiles.push({ id: 'demo-pla', name: 'PLA', baseMaterial: 'PLA' }, { id: 'demo-petg', name: 'PETG', baseMaterial: 'PETG' });
  const power = {
    'demo-pla': { heatupMin: 4, heatupPowerW: 220, powerFirstHourW: 110, powerFollowingHoursW: 85 },
    'demo-petg': { heatupMin: 5, heatupPowerW: 240, powerFirstHourW: 125, powerFollowingHoursW: 95 },
  };
  doc.printers.push(
    {
      id: 'demo-mk4s', name: 'Prusa MK4S', technology: 'FDM', status: 'active', purchasePrice: 1100, inboxKey: 'mk4s',
      toolheads: 1, toolType: 'single', purgeWastePerPlateG: 8, purgePerFilamentChangeG: null, firstHourPhaseMin: 60,
      powerProfiles: power,
      maintenance: [
        { id: 'demo-mt-1', task: 'Lubricate linear rails', everyHours: 200, lastDoneHours: 1560, lastDoneDate: day(-40) },
        { id: 'demo-mt-2', task: 'Clean and re-texture the sheet', everyHours: 400, lastDoneHours: 1320, lastDoneDate: day(-110) },
      ],
    },
    {
      id: 'demo-xl', name: 'Prusa XL (2 toolheads)', technology: 'FDM', status: 'active', purchasePrice: 2499, inboxKey: 'xl',
      toolheads: 2, toolType: 'toolchanger', purgeWastePerPlateG: 10, purgePerFilamentChangeG: 1, firstHourPhaseMin: 60,
      powerProfiles: {
        'demo-pla': { heatupMin: 6, heatupPowerW: 420, powerFirstHourW: 190, powerFollowingHoursW: 150 },
        'demo-petg': { heatupMin: 7, heatupPowerW: 450, powerFirstHourW: 210, powerFollowingHoursW: 165 },
      },
    },
    {
      id: 'demo-next', name: 'Next printer (planned)', technology: 'FDM', status: 'planned', purchasePrice: 1500,
      toolheads: 1, toolType: 'single', purgeWastePerPlateG: 8, purgePerFilamentChangeG: null, firstHourPhaseMin: 60, powerProfiles: power,
    },
  );
  doc.machineCosts.push(
    { id: 'demo-mc-1', date: day(-520), store: 'Prusa', description: 'Prusa MK4S kit', quantity: 1, total: 1099, amortizationYears: 3, kind: 'investment', printerId: 'demo-mk4s' },
    { id: 'demo-mc-2', date: day(-300), store: 'Prusa', description: 'Prusa XL, 2 toolheads', quantity: 1, total: 2499, amortizationYears: 4, kind: 'investment', printerId: 'demo-xl' },
    { id: 'demo-mc-3', date: day(-150), store: 'Online shop', description: 'Hardened nozzles (2×)', quantity: 2, total: 38, amortizationYears: 1, kind: 'wear-part', printerId: 'demo-mk4s' },
    { id: 'demo-mc-4', date: day(-90), store: 'Online shop', description: 'PEI sheet', quantity: 1, total: 32, amortizationYears: 1, kind: 'wear-part', printerId: null },
  );
  doc.plannedInvestments.push({ id: 'demo-reserve', name: 'Reserve for the next printer', printerId: 'demo-next', targetAmount: 1500, mode: 'lifetime', usefulLifeYears: 5, alreadyReserved: 120 });

  // --- Filaments ----------------------------------------------------------------
  doc.spoolKinds.push(
    { id: 'demo-kind-prusament', name: 'Prusament spool', manufacturer: 'Prusament', emptyG: 193, source: 'measured ' + day(-200) },
    { id: 'demo-kind-polymaker', name: 'Polymaker cardboard spool', manufacturer: 'Polymaker', emptyG: 145, source: 'measured ' + day(-180) },
  );
  const lines = [
    { id: 'demo-l-prusa-pla', manufacturer: 'Prusament', name: 'PLA', baseMaterial: 'PLA', profile: 'demo-pla', price: [24, 28], kind: 'demo-kind-prusament' },
    { id: 'demo-l-prusa-petg', manufacturer: 'Prusament', name: 'PETG', baseMaterial: 'PETG', profile: 'demo-petg', price: [25, 29], kind: 'demo-kind-prusament' },
    { id: 'demo-l-polyterra', manufacturer: 'Polymaker', name: 'PolyTerra PLA', baseMaterial: 'PLA', profile: 'demo-pla', price: [17, 21], kind: 'demo-kind-polymaker' },
    { id: 'demo-l-elegoo', manufacturer: 'Elegoo', name: 'PLA+', baseMaterial: 'PLA', profile: 'demo-pla', price: [14, 17], kind: 'tare-any-plastic' },
  ] as const;
  for (const l of lines) {
    doc.productLines.push({ id: l.id, manufacturer: l.manufacturer, name: l.name, baseMaterial: l.baseMaterial, materialProfileId: l.profile, diameterMm: 1.75 });
  }
  const colors: [string, string, string, number][] = [
    // line, color, hex, how often it is used (weight)
    ['demo-l-prusa-pla', 'Galaxy Black', '#2B2B33', 5],
    ['demo-l-prusa-pla', 'Signal White', '#F2F2EE', 4],
    ['demo-l-prusa-pla', 'Prusa Orange', '#FA6831', 3],
    ['demo-l-prusa-pla', 'Lipstick Red', '#C8102E', 1],
    ['demo-l-prusa-pla', 'Azure Blue', '#1F6FD1', 2],
    ['demo-l-prusa-petg', 'Urban Grey', '#6B6E70', 3],
    ['demo-l-prusa-petg', 'Clear', '#DCE8EC', 1],
    ['demo-l-prusa-petg', 'Ultramarine Blue', '#2541B2', 1],
    ['demo-l-polyterra', 'Charcoal Black', '#333333', 3],
    ['demo-l-polyterra', 'Arctic Teal', '#3FB8AF', 2],
    ['demo-l-polyterra', 'Savannah Yellow', '#E8C547', 2],
    ['demo-l-polyterra', 'Forest Green', '#2F6B3A', 2],
    ['demo-l-polyterra', 'Lavender Violet', '#9B87C9', 1],
    ['demo-l-polyterra', 'Sakura Pink', '#F2A7C3', 1],
    ['demo-l-elegoo', 'Grey', '#8A8D91', 3],
    ['demo-l-elegoo', 'Beige', '#D9C7A3', 1],
  ];
  const weighted: string[] = [];
  for (const [lineId, color, hex, weight] of colors) {
    const f: Filament = { id: id('f'), productLineId: lineId, color, colorHex: hex, finish: null, link: null, asin: null, acquisition: 'purchase', status: 'owned' };
    doc.filaments.push(f);
    for (let i = 0; i < weight; i++) weighted.push(f.id);
  }
  doc.filaments.push({ id: 'demo-f-wish', productLineId: 'demo-l-prusa-pla', color: 'Pearl Mouse', colorHex: '#A59E95', finish: 'blend', link: null, asin: null, acquisition: 'purchase', status: 'wishlist' });
  const lineOf = (filamentId: string) => lines.find((l) => l.id === doc.filaments.find((f) => f.id === filamentId)!.productLineId)!;

  // --- Purchases and spools -----------------------------------------------------------
  let label = 0;
  const stores = ['Prusa shop', 'Online shop', 'Local maker store'];
  for (const f of doc.filaments.filter((x) => x.status === 'owned')) {
    const line = lineOf(f.id);
    const uses = weighted.filter((x) => x === f.id).length;
    const purchases: FilamentPurchase[] = [];
    for (let i = 0; i < Math.min(1 + uses, 4); i++) {
      const kg = line.manufacturer === 'Elegoo' ? 2 : 1;
      const perKg = between(line.price[0], line.price[1]);
      purchases.push({
        id: id('p'), date: day(-Math.round(between(20, 540))), store: pick(stores), description: `${line.manufacturer} ${line.name} ${f.color} ${kg} kg`,
        filamentId: f.id, packageWeightKg: kg, quantity: 1, totalKg: kg, totalPrice: Math.round(perKg * kg * 100) / 100,
      });
    }
    purchases.sort((a, b) => a.date.localeCompare(b.date));
    doc.purchases.push(...purchases);
    // Older purchases are used up; the newest one is on the shelf: one spool open, the rest sealed.
    purchases.forEach((p, pi) => {
      const spools = p.totalKg;
      for (let s = 0; s < spools; s++) {
        const newest = pi === purchases.length - 1;
        const status: Spool['status'] = !newest ? 'empty' : s === 0 ? 'open' : 'sealed';
        const spool: Spool = {
          id: id('s'), filamentId: f.id, purchaseId: p.id, label: `L${String(++label).padStart(4, '0')}`, nominalG: 1000, kindId: line.kind, status,
          movements: [{ id: id('m'), date: p.date, kind: 'initial', grams: 1000, note: `Purchase ${p.date}` }],
        };
        if (status !== 'sealed') {
          const left = status === 'empty' ? 0 : Math.round(between(uses > 2 ? 60 : 250, 900));
          spool.openedAt = p.date;
          spool.movements.push({ id: id('m'), date: day(-Math.round(between(1, 20))), kind: 'weigh-in', grams: left - 1000, grossG: left + 190, tareG: 190 });
          spool.location = pick(['Dry box 1', 'Dry box 2', 'Shelf']);
        }
        doc.spools.push(spool);
      }
    });
    if (uses >= 3) f.lowStockG = 400;
  }
  doc.settings.labelNextNumber = label + 1;

  // --- A year of prints -------------------------------------------------------------
  const models = [
    'Cable clip set', 'Gridfinity bin 2x3', 'Spiral planter', 'Phone stand', 'Desk organizer', 'Lithophane lamp', 'Drawer divider',
    'Wall hook set', 'Raspberry Pi case', 'Headphone hanger', 'Plant labels', 'Dice tower', 'Cookie cutter', 'Shelf bracket', 'Filament clip',
  ];
  const jobs: PrintJob[] = [];
  for (let i = 0; i < 140; i++) {
    const xl = rand() < 0.3;
    const minutes = Math.round(between(25, xl ? 900 : 620));
    const r = rand();
    const result: PrintJob['result'] = r < 0.05 ? 'failed' : r < 0.08 ? 'cancelled' : 'success';
    const share = result === 'success' ? 1 : between(0.1, 0.6);
    const grams = Math.round(minutes * between(0.18, 0.32) * share * 10) / 10;
    const filamentIds = xl && rand() < 0.5 ? [pick(weighted), pick(weighted)] : [pick(weighted)];
    jobs.push({
      id: id('j'), date: day(-Math.round(between(0, 365))), printerId: xl ? 'demo-xl' : 'demo-mk4s', name: pick(models), printTimeMin: Math.round(minutes * (0.3 + 0.7 * share)),
      result, filaments: [...new Set(filamentIds)].map((filamentId, _, all) => ({ filamentId, grams: Math.round((grams / all.length) * 10) / 10 })),
    });
  }
  doc.printJobs = jobs.sort((a, b) => a.date.localeCompare(b.date));
  const hours = (printerId: string, since?: IsoDate) =>
    Math.round(doc.printJobs.filter((j) => j.printerId === printerId && (!since || j.date >= since)).reduce((s, j) => s + j.printTimeMin / 60, 0));
  doc.printers[0]!.usageStats = [
    { source: 'Printer statistics menu', asOf: today, since: null, printHours: 1610 + hours('demo-mk4s', day(-40)) },
    { source: 'OctoPrint', asOf: today, since: day(-365), prints: doc.printJobs.filter((j) => j.printerId === 'demo-mk4s').length, printHours: hours('demo-mk4s') },
  ];
  doc.printers[1]!.usageStats = [
    { source: 'Printer statistics menu', asOf: today, since: day(-300), prints: doc.printJobs.filter((j) => j.printerId === 'demo-xl' && j.date >= day(-300)).length, printHours: hours('demo-xl', day(-300)) },
  ];

  // --- Customers and quotes ------------------------------------------------------------
  doc.customers.push(
    { id: 'demo-c-club', name: 'Robotics club', group: 'clubs', defaultPricingProfileId: 'friends-family', notes: 'Fictional demo customer' },
    { id: 'demo-c-cafe', name: 'Café Lindenblatt', group: 'business', defaultPricingProfileId: 'standard', email: 'hello@example.com' },
    { id: 'demo-c-sam', name: 'Sam (neighbor)', group: 'friends', defaultPricingProfileId: 'friends-family' },
    { id: 'demo-c-space', name: 'Makerspace North', group: 'business', defaultPricingProfileId: 'commercial', discountPercent: 5 },
  );
  const f = (color: string) => doc.filaments.find((x) => x.color === color)!.id;
  const quotes: [string, string | undefined, QuoteStatus, number, Quote['plates']][] = [
    ['Sensor housings (10×)', 'demo-c-space', 'paid', -150, [
      { id: id('pl'), name: 'Housing bottoms', printerId: 'demo-mk4s', printTimeMin: 410, runs: 2, parts: [{ name: 'Bottom', quantity: 5 }], filaments: [{ filamentId: f('Galaxy Black'), weightG: 182 }] },
      { id: id('pl'), name: 'Housing lids', printerId: 'demo-mk4s', printTimeMin: 260, runs: 2, parts: [{ name: 'Lid', quantity: 5 }], filaments: [{ filamentId: f('Prusa Orange'), weightG: 96 }] },
    ]],
    ['Table number stands', 'demo-c-cafe', 'delivered', -60, [
      { id: id('pl'), name: 'Stands 1–12', printerId: 'demo-xl', printTimeMin: 290, runs: 1, partsPerRun: 12, filamentChanges: 24, filaments: [{ filamentId: f('Forest Green'), weightG: 118 }, { filamentId: f('Signal White'), weightG: 22 }] },
    ]],
    ['Garden planters', 'demo-c-sam', 'printing', -9, [
      { id: id('pl'), name: 'Spiral planter', printerId: 'demo-mk4s', printTimeMin: 340, runs: 3, partsPerRun: 1, filaments: [{ filamentId: f('Arctic Teal'), weightG: 145 }] },
    ]],
    ['Tool wall holders', 'demo-c-space', 'accepted', -5, [
      { id: id('pl'), name: 'Holders', printerId: 'demo-mk4s', printTimeMin: 520, runs: 2, partsPerRun: 8, filaments: [{ filamentId: f('Urban Grey'), weightG: 240 }] },
    ]],
    ['Name badges', 'demo-c-club', 'sent', -3, [
      { id: id('pl'), name: 'Badges', printerId: 'demo-xl', printTimeMin: 150, runs: 2, partsPerRun: 15, filamentChanges: 30, filaments: [{ filamentId: f('Azure Blue'), weightG: 40 }, { filamentId: f('Signal White'), weightG: 18 }] },
    ]],
    ['Lamp shade prototype', undefined, 'draft', -1, [
      // Shade and socket rings on one plate: the cost is split by the grams per object from the slicer.
      { id: id('pl'), name: 'Shade + rings', printerId: 'demo-mk4s', printTimeMin: 600, runs: 1, costSplit: 'grams', filaments: [{ filamentId: f('Clear'), weightG: 210 }],
        parts: [{ name: 'Shade', quantity: 1, grams: 168 }, { name: 'Socket ring', quantity: 2, grams: 17.5 }] },
    ]],
  ];
  quotes.forEach(([title, customerId, status, offset, plates], i) => {
    const customer = doc.customers.find((c) => c.id === customerId);
    const quote: Quote = {
      id: id('q'), number: i + 1, title, date: day(offset), pricingProfileId: customer?.defaultPricingProfileId ?? 'standard', status: 'draft', plates,
      extras: [{ id: id('x'), kind: 'item', description: 'Packaging', quantity: 1, unitCost: 1.5 }],
      // The sensor housings are sold by the piece: the part prices set the price, the plates the cost.
      ...(title.startsWith('Sensor housings') ? { requiredParts: [{ name: 'Bottom', quantity: 10, price: 4.9 }, { name: 'Lid', quantity: 10, price: 2.9 }] } : {}),
      ...(title.startsWith('Lamp shade') ? { requiredParts: [{ name: 'Shade', quantity: 1 }, { name: 'Socket ring', quantity: 2 }] } : {}),
      ...(customer ? { customerId: customer.id } : {}),
      ...(customer?.discountPercent ? { discountPercent: customer.discountPercent } : {}),
    };
    doc.quotes.push(quote);
    if (status !== 'draft') setQuoteStatus(doc, quote, status, day(offset), now);
  });

  return doc;
}

/** Small seeded PRNG, so the demo looks the same every time. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when there is nothing to lose: no printers, filaments, purchases, quotes or prints. */
export function isEmptyDocument(doc: AppDocument): boolean {
  return doc.printers.length + doc.filaments.length + doc.purchases.length + doc.quotes.length + doc.printJobs.length === 0;
}
