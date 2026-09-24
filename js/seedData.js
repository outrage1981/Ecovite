// Canonical starting data set, transcribed cell-for-cell from the source
// workbook (EcoVite Cost Comparison - 23032026 - AD.xlsx, "Input" sheet,
// rows 11-38). This is the single source of truth for both:
//   - the demo data layer (js/db.js in ?demo mode), and
//   - tools/seed-pocketbase.mjs, which loads it into a fresh PocketBase.
//
// `null` means the source sheet left the cell blank (not analysed) — NOT
// zero. Only cells that actually contained 0 in the workbook are written as
// 0 here. This is what lets the app show "no data" instead of a silently
// wrong 0 for gaps like Soya Oilcake's trace minerals.
//
// npn and me are intentionally absent from every ingredient's `values` —
// they are derived at calculation time (see js/calc.js) from
// (cp, pct_ex_npn) and (tdn) respectively, so they can never drift out of
// sync with their source fields the way the spreadsheet's NPN column did.
//
// bagSizeKg / pricePerBag / pricePerTon are not from the workbook — the
// source sheet had no pricing data. pricePerTon is what the app actually
// uses as the default cost when a rep selects the ingredient; bagSizeKg and
// pricePerBag are a convenience for computing it (pricePerBag / bagSizeKg *
// 1000). All three are generic placeholder figures for you to replace with
// real pricing via the admin Ingredients screen.

export const NUTRIENTS = [
  { id: 'dm', label: 'Dry Matter (DM)', unit: '%', group: 'general' },
  { id: 'cp', label: 'Crude Protein (CP)', unit: '%', group: 'general' },
  { id: 'pct_ex_npn', label: 'NPN Fraction of CP', unit: '%', group: 'general', helpText: 'Percentage of the crude protein figure that is non-protein nitrogen (e.g. urea). Leave blank for conventional protein sources — it defaults to 0.' },
  { id: 'cf', label: 'Crude Fibre (CF)', unit: '%', group: 'general' },
  { id: 'fat', label: 'Fat', unit: '%', group: 'general' },
  { id: 'ca', label: 'Calcium (Ca)', unit: '%', group: 'macro' },
  { id: 'p', label: 'Phosphorus (P)', unit: '%', group: 'macro' },
  { id: 'k', label: 'Potassium (K)', unit: '%', group: 'macro' },
  { id: 'mg', label: 'Magnesium (Mg)', unit: '%', group: 'macro' },
  { id: 's', label: 'Sulphur (S)', unit: '%', group: 'macro' },
  { id: 'salt', label: 'Salt', unit: '%', group: 'macro' },
  { id: 'npn', label: 'NPN', unit: '%', group: 'general', derived: true },
  { id: 'fe', label: 'Iron (Fe)', unit: 'mg/kg', group: 'trace' },
  { id: 'mn', label: 'Manganese (Mn)', unit: 'mg/kg', group: 'trace' },
  { id: 'cu', label: 'Copper (Cu)', unit: 'mg/kg', group: 'trace' },
  { id: 'zn', label: 'Zinc (Zn)', unit: 'mg/kg', group: 'trace' },
  { id: 'co', label: 'Cobalt (Co)', unit: 'mg/kg', group: 'trace' },
  { id: 'iod', label: 'Iodine (I)', unit: 'mg/kg', group: 'trace' },
  { id: 'se', label: 'Selenium (Se)', unit: 'mg/kg', group: 'trace' },
  { id: 'vit_a', label: 'Vitamin A', unit: 'IU/kg', group: 'vitamin' },
  { id: 'vit_e', label: 'Vitamin E', unit: 'IU/kg', group: 'vitamin' },
  { id: 'tdn', label: 'TDN', unit: '%', group: 'energy' },
  { id: 'me', label: 'ME', unit: 'MJ/kg', group: 'energy', derived: true },
];

// Soft plausibility ranges for the admin "sanity check on save" warning.
// Not enforced — just a confirmation prompt if a typed value falls outside.
export const PLAUSIBLE_RANGES = {
  dm: [0, 100], cp: [0, 300], pct_ex_npn: [0, 100], cf: [0, 100], fat: [0, 40],
  ca: [0, 40], p: [0, 30], k: [0, 50], mg: [0, 30], s: [0, 30], salt: [0, 100],
  fe: [0, 2000], mn: [0, 2000], cu: [0, 500], zn: [0, 2000], co: [0, 20],
  iod: [0, 60], se: [0, 20], vit_a: [0, 50000], vit_e: [0, 500], tdn: [0, 100],
};

export const SPECIES = [
  { id: 'cattle', label: 'Cattle' },
  { id: 'sheep', label: 'Sheep' },
];

// Labelled "Physiological State" in the UI — this is the animal's own
// production stage, distinct from LICK_FOCUS_OPTIONS below (which is about
// which nutrient the lick itself is built to supplement). Internal id
// (supplementType) kept as-is to avoid a schema rename; only the display
// label changed.
export const SUPPLEMENT_TYPES = [
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'production', label: 'Production' },
];

// Labelled "Supplement Type" in the UI (confusingly close to the id above,
// but that's the name asked for) — which nutrient a lick is built around.
// Drives which of a mix's three scenario cards the Compare report is built
// from. ids match the scenario keys returned by calc.js's computeMixResult.
export const LICK_FOCUS_OPTIONS = [
  { id: 'energy', label: 'Energy Lick' },
  { id: 'phosphorus', label: 'Phosphate Lick' },
  { id: 'protein', label: 'Protein Lick' },
  // Only offered when the Physiological State (supplementType) is 'production'.
  { id: 'production', label: 'Production Lick', requiresState: 'production' },
];

// Act 36 maximum safe NPN supplementation, g N/head/day.
// Source: Input!C122 formula — IF(species="Beeste", IF(type="Onderhoud",35,48), IF(type="Onderhoud",7,9))
export const NPN_SAFETY_LIMITS = {
  cattle: { maintenance: 35, production: 48 },
  sheep: { maintenance: 7, production: 9 },
};

// Lick-contribution targets (g or MJ per head per day) the mix is sized against.
// Only the maintenance-cattle figures are defined in the source workbook
// (Input!C103:C105) — everything else is left for the admin to fill in via
// Settings once real figures are available, rather than guessed here.
export const NUTRIENT_TARGETS = [
  {
    species: 'cattle', supplementType: 'maintenance',
    cp: 150, cpNote: 'Total maintenance requirement: 180-220 g/hd/day',
    me: 8, meNote: 'Total maintenance requirement: 4-6 MJ/hd/day',
    p: 6, pNote: 'Dry season: 3-8 g/hd/day (8 for young growing stock). Late pregnancy: 6-8 g/hd/day (10 for fresh/first-calf cows). Growing season: 10-14 g/hd/day.',
  },
  {
    species: 'cattle', supplementType: 'production',
    cp: 200, me: 8, p: 9,
  },
];

// Production Lick targets (Protein g/hd/day + Energy MJ/hd/day), keyed by
// species only — a separate figure pair from NUTRIENT_TARGETS above, which
// a production lick must satisfy simultaneously (see js/calc.js).
export const PRODUCTION_TARGETS = {
  cattle: { protein: 350, energy: 7 },
  sheep: { protein: 40, energy: 2 },
};

// 28 ingredients, transcribed row-for-row from Input!A11:Y38. Pricing
// (bagSizeKg / pricePerBag / pricePerTon) is generic placeholder data — see
// note above.
export const INGREDIENTS = [
  { name: 'EcoVite Drimol (V34430)', bagSizeKg: 25, pricePerBag: 450, pricePerTon: 18000, values: { dm: 95, cp: 4, pct_ex_npn: null, cf: 5, fat: null, ca: 6.5, p: 0.1, k: 2, mg: null, s: null, salt: null, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: 45 } },
  { name: 'EcoVite Drifos P12 (V35079)', bagSizeKg: 25, pricePerBag: 550, pricePerTon: 22000, values: { dm: 95, cp: 4, pct_ex_npn: null, cf: 5, fat: null, ca: 12, p: 12, k: 1.2, mg: null, s: null, salt: null, fe: 100, mn: 1200, cu: 300, zn: 1200, co: 6, iod: 30, se: 6, vit_a: null, vit_e: null, tdn: 45 } },
  { name: 'EcoVite Drifos P6', bagSizeKg: 25, pricePerBag: 500, pricePerTon: 20000, values: { dm: 95, cp: 2, pct_ex_npn: null, cf: null, fat: null, ca: 6, p: 6, k: 1.4, mg: null, s: null, salt: 20, fe: 100, mn: 600, cu: 150, zn: 600, co: 3, iod: 15, se: 3, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'EcoVite Drifos P5-25', bagSizeKg: 25, pricePerBag: 600, pricePerTon: 24000, values: { dm: 95, cp: 25, pct_ex_npn: 94, cf: 4, fat: null, ca: 5.4, p: 5, k: 1.2, mg: null, s: null, salt: null, fe: 100, mn: 600, cu: 150, zn: 600, co: 3, iod: 15, se: 3, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'EcoVite DriPro 64 (V35164)', bagSizeKg: 25, pricePerBag: 950, pricePerTon: 38000, values: { dm: 95.9, cp: 64.5, pct_ex_npn: 91.5, cf: 1.6, fat: null, ca: 4, p: 0.08, k: 1.58, mg: 0.08, s: 0.83, salt: null, fe: 100, mn: 600, cu: 150, zn: 600, co: 2, iod: 20, se: 4, vit_a: 20000, vit_e: null, tdn: 36 } },
  { name: 'CMS 450', bagSizeKg: 25, pricePerBag: 380, pricePerTon: 15200, values: { dm: 45, cp: 5, pct_ex_npn: null, cf: 0.1, fat: null, ca: 9.1, p: 1.1, k: 45, mg: 6, s: 11, salt: null, fe: 150, mn: 54, cu: 4.5, zn: 5, co: 1, iod: null, se: null, vit_a: null, vit_e: null, tdn: 58 } },
  { name: 'MCP 22.7', bagSizeKg: 50, pricePerBag: 450, pricePerTon: 9000, values: { dm: 99, cp: null, pct_ex_npn: null, cf: null, fat: null, ca: 16.4, p: 22.7, k: null, mg: 1.6, s: 1.2, salt: null, fe: 25, mn: 10, cu: 5, zn: 10, co: 0.2, iod: null, se: null, vit_a: null, vit_e: null, tdn: null } },
  { name: 'Salt', bagSizeKg: 50, pricePerBag: 120, pricePerTon: 2400, values: { dm: 99, cp: null, pct_ex_npn: null, cf: null, fat: null, ca: null, p: null, k: null, mg: null, s: null, salt: 99.5, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'Feed Lime', bagSizeKg: 50, pricePerBag: 100, pricePerTon: 2000, values: { dm: 99, cp: null, pct_ex_npn: null, cf: null, fat: null, ca: 36, p: null, k: null, mg: 0.1, s: 0.02, salt: null, fe: 10, mn: 12, cu: 0.3, zn: 1, co: 0.01, iod: null, se: null, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'Urea', bagSizeKg: 50, pricePerBag: 550, pricePerTon: 11000, values: { dm: 99.5, cp: 287, pct_ex_npn: 100, cf: null, fat: null, ca: null, p: null, k: null, mg: null, s: null, salt: null, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'Ammonium Chloride', bagSizeKg: 50, pricePerBag: 600, pricePerTon: 12000, values: { dm: 99, cp: 162.5, pct_ex_npn: 100, cf: null, fat: null, ca: null, p: null, k: null, mg: null, s: null, salt: null, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: null } },
  { name: 'Ammonium Sulphate', bagSizeKg: 50, pricePerBag: 400, pricePerTon: 8000, values: { dm: 99, cp: 132, pct_ex_npn: 100, cf: null, fat: null, ca: null, p: null, k: null, mg: null, s: 24, salt: null, fe: 8, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'Maize (8%)', bagSizeKg: 50, pricePerBag: 200, pricePerTon: 4000, values: { dm: 88, cp: 7.5, pct_ex_npn: null, cf: 3, fat: 4, ca: 0.03, p: 0.25, k: 0.33, mg: 0.11, s: 0.12, salt: 0.1, fe: 32, mn: 5, cu: 3, zn: 17, co: 0.01, iod: 0.1, se: 0.1, vit_a: null, vit_e: null, tdn: 82 } },
  { name: 'Molasses Meal', bagSizeKg: 50, pricePerBag: 230, pricePerTon: 4600, values: { dm: 86.22, cp: 3.9, pct_ex_npn: null, cf: 13, fat: 0.51, ca: 0.53, p: 0.07, k: 2.83, mg: 0.27, s: 0.41, salt: 0.2, fe: 151, mn: 35, cu: 20, zn: 12, co: 0.3, iod: 0.9, se: 0.01, vit_a: null, vit_e: null, tdn: 69 } },
  { name: 'Hominy Chop', bagSizeKg: 40, pricePerBag: 160, pricePerTon: 4000, values: { dm: 86, cp: 9, pct_ex_npn: null, cf: 7, fat: 7, ca: 0.05, p: 0.45, k: 0.6, mg: 0.2, s: 0.03, salt: 0.1, fe: 72, mn: 11, cu: 9, zn: 22, co: 0.1, iod: 0.1, se: 0.1, vit_a: null, vit_e: null, tdn: 80 } },
  { name: 'Cotton Seed Oilcake', bagSizeKg: 50, pricePerBag: 325, pricePerTon: 6500, values: { dm: 90, cp: 34, pct_ex_npn: null, cf: 18, fat: 3.7, ca: 0.29, p: 1.12, k: 1.35, mg: 0.5, s: 0.34, salt: 0.1, fe: 135, mn: 18, cu: 16, zn: 54, co: 0.1, iod: 0.1, se: 0.6, vit_a: null, vit_e: null, tdn: 68 } },
  { name: 'Soya Oilcake', bagSizeKg: 50, pricePerBag: 325, pricePerTon: 6500, values: { dm: 88, cp: 47, pct_ex_npn: null, cf: 7, fat: 2, ca: 0.35, p: 0.7, k: 1.1, mg: 0.26, s: 0.34, salt: 0.1, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: 78 } },
  { name: 'Molatek Meester 20', bagSizeKg: 25, pricePerBag: 250, pricePerTon: 10000, values: { dm: 85, cp: 20, pct_ex_npn: 72.66, cf: 10, fat: 1.2, ca: 1, p: 0.6, k: 1.9, mg: 0.31, s: 0.49, salt: 0.1, fe: 25, mn: 100, cu: 20, zn: 150, co: 1, iod: 1.5, se: 1, vit_a: 15000, vit_e: null, tdn: 60 } },
  { name: 'Voermol Super 18', bagSizeKg: 25, pricePerBag: 230, pricePerTon: 9200, values: { dm: 84, cp: 18, pct_ex_npn: 77.3, cf: 10, fat: 0.03, ca: 6, p: 6, k: 2, mg: 3.3, s: 4.5, salt: 0.1, fe: 28, mn: 120, cu: 50, zn: 150, co: 0.6, iod: 2, se: 1, vit_a: 10000, vit_e: null, tdn: 58 } },
  { name: 'Yara Kalori 3000', bagSizeKg: 25, pricePerBag: 475, pricePerTon: 19000, values: { dm: 95, cp: 4, pct_ex_npn: null, cf: 5, fat: 0.01, ca: 10, p: 0.1, k: 2, mg: 0.1, s: 0.8, salt: 0.1, fe: 35, mn: 5, cu: 4, zn: 5, co: 0.1, iod: null, se: null, vit_a: null, vit_e: null, tdn: 45 } },
  { name: 'Yara SelfMix 100', bagSizeKg: 25, pricePerBag: 575, pricePerTon: 23000, values: { dm: 95, cp: 100, pct_ex_npn: 96, cf: null, fat: 0.01, ca: 6, p: 3, k: 1, mg: 6, s: 1.2, salt: null, fe: 100, mn: 1200, cu: 300, zn: 1200, co: 6, iod: 30, se: 6, vit_a: null, vit_e: null, tdn: 23 } },
  { name: 'Yara Kynofos 21', bagSizeKg: 40, pricePerBag: 160, pricePerTon: 4000, values: { dm: 98, cp: null, pct_ex_npn: null, cf: null, fat: null, ca: 16.8, p: 21, k: 1, mg: 1.3, s: 0.8, salt: null, fe: 19, mn: 10, cu: 5, zn: 8, co: 0.02, iod: null, se: null, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'Yara Kimtrafos P12', bagSizeKg: 40, pricePerBag: 480, pricePerTon: 12000, values: { dm: 85.1, cp: 0.56, pct_ex_npn: null, cf: null, fat: 0.01, ca: 16.3, p: 12, k: 3.3, mg: 1.39, s: 1.29, salt: 4.5, fe: 120, mn: 1200, cu: 300, zn: 1200, co: 6, iod: 30, se: 6, vit_a: null, vit_e: null, tdn: 12 } },
  { name: 'Yara Kimtrafos P6', bagSizeKg: 40, pricePerBag: 320, pricePerTon: 8000, values: { dm: 85, cp: 0.3, pct_ex_npn: null, cf: null, fat: 0.01, ca: 12, p: 6, k: 1.6, mg: 0.7, s: 0.65, salt: 25, fe: 120, mn: 600, cu: 150, zn: 600, co: 3, iod: 15, se: 3, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'Premix (generiese plekhouer)', bagSizeKg: 10, pricePerBag: 440, pricePerTon: 44000, values: { dm: 99, cp: null, pct_ex_npn: null, cf: null, fat: null, ca: null, p: null, k: null, mg: null, s: null, salt: null, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'Sulphur', bagSizeKg: 50, pricePerBag: 175, pricePerTon: 3500, values: { dm: 99, cp: null, pct_ex_npn: null, cf: null, fat: null, ca: null, p: null, k: null, mg: null, s: 99.9, salt: null, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: 0 } },
  { name: 'PEG4000', bagSizeKg: 25, pricePerBag: 625, pricePerTon: 25000, values: { dm: 99, cp: null, pct_ex_npn: null, cf: null, fat: null, ca: null, p: null, k: null, mg: null, s: null, salt: null, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: null } },
  { name: 'Water', bagSizeKg: null, pricePerBag: null, pricePerTon: 0, values: { dm: 0, cp: null, pct_ex_npn: null, cf: null, fat: null, ca: null, p: null, k: null, mg: null, s: null, salt: null, fe: null, mn: null, cu: null, zn: null, co: null, iod: null, se: null, vit_a: null, vit_e: null, tdn: null } },
];

// Pre-built cattle licks (3 each of Energy/Phosphate/Protein/Production) so
// the demo has real saved mixes to browse/compare right away instead of an
// empty History tab. Ingredients are referenced by name (not id) because
// ids are only assigned when the demo store seeds its ingredients — see
// js/db.js's loadDemoStore(), which resolves these into full saved-mix
// records (with a computed result) at that point. Energy/Phosphate/Protein
// licks use the 'maintenance' physiological state (matching the only
// pre-filled nutrient targets); Production licks use 'production' so their
// Production-driven scenario has real targets to size against.
export const SEED_MIXES = [
  {
    name: 'Energy Lick - Maize Base', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'Maize (8%)', inclusionKg: 60 },
      { ingredientName: 'Molasses Meal', inclusionKg: 30 },
      { ingredientName: 'Urea', inclusionKg: 5 },
      { ingredientName: 'Salt', inclusionKg: 5 },
    ],
  },
  {
    name: 'Energy Lick - Molasses Blend', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'Molasses Meal', inclusionKg: 50 },
      { ingredientName: 'Hominy Chop', inclusionKg: 30 },
      { ingredientName: 'Urea', inclusionKg: 10 },
      { ingredientName: 'Feed Lime', inclusionKg: 5 },
      { ingredientName: 'Salt', inclusionKg: 5 },
    ],
  },
  {
    name: 'Energy Lick - Hominy Mix', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'Hominy Chop', inclusionKg: 55 },
      { ingredientName: 'Maize (8%)', inclusionKg: 25 },
      { ingredientName: 'Urea', inclusionKg: 8 },
      { ingredientName: 'Salt', inclusionKg: 7 },
      { ingredientName: 'MCP 22.7', inclusionKg: 5 },
    ],
  },
  {
    name: 'Phosphate Lick - MCP Base', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'MCP 22.7', inclusionKg: 30 },
      { ingredientName: 'Molasses Meal', inclusionKg: 40 },
      { ingredientName: 'Maize (8%)', inclusionKg: 15 },
      { ingredientName: 'Salt', inclusionKg: 15 },
    ],
  },
  {
    name: 'Phosphate Lick - Kynofos Blend', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'Yara Kynofos 21', inclusionKg: 30 },
      { ingredientName: 'Molasses Meal', inclusionKg: 35 },
      { ingredientName: 'Urea', inclusionKg: 10 },
      { ingredientName: 'Maize (8%)', inclusionKg: 10 },
      { ingredientName: 'Salt', inclusionKg: 15 },
    ],
  },
  {
    name: 'Phosphate Lick - EcoVite Drifos P12', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'EcoVite Drifos P12 (V35079)', inclusionKg: 30 },
      { ingredientName: 'Molasses Meal', inclusionKg: 40 },
      { ingredientName: 'Maize (8%)', inclusionKg: 15 },
      { ingredientName: 'Salt', inclusionKg: 15 },
    ],
  },
  {
    name: 'Protein Lick - Urea Base', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'Molasses Meal', inclusionKg: 40 },
      { ingredientName: 'Maize (8%)', inclusionKg: 20 },
      { ingredientName: 'Urea', inclusionKg: 20 },
      { ingredientName: 'Feed Lime', inclusionKg: 10 },
      { ingredientName: 'Salt', inclusionKg: 10 },
    ],
  },
  {
    name: 'Protein Lick - Oilcake Blend', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'Soya Oilcake', inclusionKg: 40 },
      { ingredientName: 'Cotton Seed Oilcake', inclusionKg: 20 },
      { ingredientName: 'Molasses Meal', inclusionKg: 30 },
      { ingredientName: 'Salt', inclusionKg: 10 },
    ],
  },
  {
    name: 'Protein Lick - DriPro 64', speciesId: 'cattle', supplementTypeId: 'maintenance',
    lines: [
      { ingredientName: 'EcoVite DriPro 64 (V35164)', inclusionKg: 30 },
      { ingredientName: 'Molasses Meal', inclusionKg: 40 },
      { ingredientName: 'Urea', inclusionKg: 10 },
      { ingredientName: 'Feed Lime', inclusionKg: 10 },
      { ingredientName: 'Salt', inclusionKg: 10 },
    ],
  },
  {
    name: 'Production Lick - Balanced A', speciesId: 'cattle', supplementTypeId: 'production',
    lines: [
      { ingredientName: 'Molasses Meal', inclusionKg: 35 },
      { ingredientName: 'Maize (8%)', inclusionKg: 25 },
      { ingredientName: 'Soya Oilcake', inclusionKg: 15 },
      { ingredientName: 'Urea', inclusionKg: 15 },
      { ingredientName: 'Salt', inclusionKg: 10 },
    ],
  },
  {
    name: 'Production Lick - High Energy', speciesId: 'cattle', supplementTypeId: 'production',
    lines: [
      { ingredientName: 'Hominy Chop', inclusionKg: 35 },
      { ingredientName: 'Molasses Meal', inclusionKg: 25 },
      { ingredientName: 'Cotton Seed Oilcake', inclusionKg: 15 },
      { ingredientName: 'Urea', inclusionKg: 15 },
      { ingredientName: 'Salt', inclusionKg: 10 },
    ],
  },
  {
    name: 'Production Lick - DriPro Blend', speciesId: 'cattle', supplementTypeId: 'production',
    lines: [
      { ingredientName: 'EcoVite DriPro 64 (V35164)', inclusionKg: 20 },
      { ingredientName: 'Molasses Meal', inclusionKg: 35 },
      { ingredientName: 'Maize (8%)', inclusionKg: 25 },
      { ingredientName: 'Urea', inclusionKg: 10 },
      { ingredientName: 'Salt', inclusionKg: 10 },
    ],
  },
];
