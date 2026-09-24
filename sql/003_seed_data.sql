-- Seed data transcribed from EcoVite Cost Comparison - 23032026 - AD.xlsx
-- (Input sheet, rows 11-38). Mirrors js/seedData.js exactly — keep both in
-- sync if you correct a value.

insert into nutrients (id, label, unit, nutrient_group, is_derived, sort_order) values
  ('dm', 'Dry Matter (DM)', '%', 'general', false, 1),
  ('cp', 'Crude Protein (CP)', '%', 'general', false, 2),
  ('pct_ex_npn', 'NPN Fraction of CP', '%', 'general', false, 3),
  ('cf', 'Crude Fibre (CF)', '%', 'general', false, 4),
  ('fat', 'Fat', '%', 'general', false, 5),
  ('ca', 'Calcium (Ca)', '%', 'macro', false, 6),
  ('p', 'Phosphorus (P)', '%', 'macro', false, 7),
  ('k', 'Potassium (K)', '%', 'macro', false, 8),
  ('mg', 'Magnesium (Mg)', '%', 'macro', false, 9),
  ('s', 'Sulphur (S)', '%', 'macro', false, 10),
  ('salt', 'Salt', '%', 'macro', false, 11),
  ('npn', 'NPN', '%', 'general', true, 12),
  ('fe', 'Iron (Fe)', 'mg/kg', 'trace', false, 13),
  ('mn', 'Manganese (Mn)', 'mg/kg', 'trace', false, 14),
  ('cu', 'Copper (Cu)', 'mg/kg', 'trace', false, 15),
  ('zn', 'Zinc (Zn)', 'mg/kg', 'trace', false, 16),
  ('co', 'Cobalt (Co)', 'mg/kg', 'trace', false, 17),
  ('iod', 'Iodine (I)', 'mg/kg', 'trace', false, 18),
  ('se', 'Selenium (Se)', 'mg/kg', 'trace', false, 19),
  ('vit_a', 'Vitamin A', 'IU/kg', 'vitamin', false, 20),
  ('vit_e', 'Vitamin E', 'IU/kg', 'vitamin', false, 21),
  ('tdn', 'TDN', '%', 'energy', false, 22),
  ('me', 'ME', 'MJ/kg', 'energy', true, 23);

insert into species (id, label) values
  ('cattle', 'Cattle'),
  ('sheep', 'Sheep');

insert into supplement_types (id, label) values
  ('maintenance', 'Maintenance'),
  ('production', 'Production');

-- Act 36 maximum safe NPN supplementation, g N/head/day.
insert into npn_safety_limits (species_id, supplement_type_id, max_g_n_per_head_day) values
  ('cattle', 'maintenance', 35),
  ('cattle', 'production', 48),
  ('sheep', 'maintenance', 7),
  ('sheep', 'production', 9);

-- Only the maintenance-cattle targets are defined in the source workbook.
-- Add production/sheep targets via Settings once real figures are available.
insert into nutrient_targets (species_id, supplement_type_id, cp_target_g, cp_reference_note, me_target_mj, me_reference_note, p_target_g, p_reference_note) values
  ('cattle', 'maintenance', 150, 'Total maintenance requirement: 180-220 g/hd/day', 8, 'Total maintenance requirement: 4-6 MJ/hd/day', 6, 'Dry season: 3-8 g/hd/day (8 for young growing stock). Late pregnancy: 6-8 g/hd/day (10 for fresh/first-calf cows). Growing season: 10-14 g/hd/day.'),
  ('cattle', 'production', 200, null, 8, null, 9, null);

-- Production Lick targets — a separate protein+energy pair a production
-- lick must satisfy simultaneously, distinct from the nutrient_targets above.
insert into production_targets (species_id, protein_target_g, energy_target_mj) values
  ('cattle', 350, 7),
  ('sheep', 40, 2);

-- Pricing (bag_size_kg / price_per_bag / price_per_ton) is generic
-- placeholder data — the source workbook had none. price_per_ton =
-- price_per_bag / bag_size_kg * 1000; replace via the admin Ingredients
-- screen with real figures whenever you have them.
insert into ingredients (name, bag_size_kg, price_per_bag, price_per_ton) values
  ('EcoVite Drimol (V34430)', 25, 450, 18000),
  ('EcoVite Drifos P12 (V35079)', 25, 550, 22000),
  ('EcoVite Drifos P6', 25, 500, 20000),
  ('EcoVite Drifos P5-25', 25, 600, 24000),
  ('EcoVite DriPro 64 (V35164)', 25, 950, 38000),
  ('CMS 450', 25, 380, 15200),
  ('MCP 22.7', 50, 450, 9000),
  ('Salt', 50, 120, 2400),
  ('Feed Lime', 50, 100, 2000),
  ('Urea', 50, 550, 11000),
  ('Ammonium Chloride', 50, 600, 12000),
  ('Ammonium Sulphate', 50, 400, 8000),
  ('Maize (8%)', 50, 200, 4000),
  ('Molasses Meal', 50, 230, 4600),
  ('Hominy Chop', 40, 160, 4000),
  ('Cotton Seed Oilcake', 50, 325, 6500),
  ('Soya Oilcake', 50, 325, 6500),
  ('Molatek Meester 20', 25, 250, 10000),
  ('Voermol Super 18', 25, 230, 9200),
  ('Yara Kalori 3000', 25, 475, 19000),
  ('Yara SelfMix 100', 25, 575, 23000),
  ('Yara Kynofos 21', 40, 160, 4000),
  ('Yara Kimtrafos P12', 40, 480, 12000),
  ('Yara Kimtrafos P6', 40, 320, 8000),
  ('Premix (generiese plekhouer)', 10, 440, 44000),
  ('Sulphur', 50, 175, 3500),
  ('PEG4000', 25, 625, 25000),
  ('Water', null, null, 0);

insert into ingredient_nutrients (ingredient_id, nutrient_id, value)
select i.id, v.nutrient_id, v.value
from (values
  ('EcoVite Drimol (V34430)', 'dm', 95), ('EcoVite Drimol (V34430)', 'cp', 4), ('EcoVite Drimol (V34430)', 'cf', 5), ('EcoVite Drimol (V34430)', 'ca', 6.5), ('EcoVite Drimol (V34430)', 'p', 0.1), ('EcoVite Drimol (V34430)', 'k', 2), ('EcoVite Drimol (V34430)', 'tdn', 45),

  ('EcoVite Drifos P12 (V35079)', 'dm', 95), ('EcoVite Drifos P12 (V35079)', 'cp', 4), ('EcoVite Drifos P12 (V35079)', 'cf', 5), ('EcoVite Drifos P12 (V35079)', 'ca', 12), ('EcoVite Drifos P12 (V35079)', 'p', 12), ('EcoVite Drifos P12 (V35079)', 'k', 1.2), ('EcoVite Drifos P12 (V35079)', 'fe', 100), ('EcoVite Drifos P12 (V35079)', 'mn', 1200), ('EcoVite Drifos P12 (V35079)', 'cu', 300), ('EcoVite Drifos P12 (V35079)', 'zn', 1200), ('EcoVite Drifos P12 (V35079)', 'co', 6), ('EcoVite Drifos P12 (V35079)', 'iod', 30), ('EcoVite Drifos P12 (V35079)', 'se', 6), ('EcoVite Drifos P12 (V35079)', 'tdn', 45),

  ('EcoVite Drifos P6', 'dm', 95), ('EcoVite Drifos P6', 'cp', 2), ('EcoVite Drifos P6', 'ca', 6), ('EcoVite Drifos P6', 'p', 6), ('EcoVite Drifos P6', 'k', 1.4), ('EcoVite Drifos P6', 'salt', 20), ('EcoVite Drifos P6', 'fe', 100), ('EcoVite Drifos P6', 'mn', 600), ('EcoVite Drifos P6', 'cu', 150), ('EcoVite Drifos P6', 'zn', 600), ('EcoVite Drifos P6', 'co', 3), ('EcoVite Drifos P6', 'iod', 15), ('EcoVite Drifos P6', 'se', 3), ('EcoVite Drifos P6', 'tdn', 0),

  ('EcoVite Drifos P5-25', 'dm', 95), ('EcoVite Drifos P5-25', 'cp', 25), ('EcoVite Drifos P5-25', 'pct_ex_npn', 94), ('EcoVite Drifos P5-25', 'cf', 4), ('EcoVite Drifos P5-25', 'ca', 5.4), ('EcoVite Drifos P5-25', 'p', 5), ('EcoVite Drifos P5-25', 'k', 1.2), ('EcoVite Drifos P5-25', 'fe', 100), ('EcoVite Drifos P5-25', 'mn', 600), ('EcoVite Drifos P5-25', 'cu', 150), ('EcoVite Drifos P5-25', 'zn', 600), ('EcoVite Drifos P5-25', 'co', 3), ('EcoVite Drifos P5-25', 'iod', 15), ('EcoVite Drifos P5-25', 'se', 3), ('EcoVite Drifos P5-25', 'tdn', 0),

  ('EcoVite DriPro 64 (V35164)', 'dm', 95.9), ('EcoVite DriPro 64 (V35164)', 'cp', 64.5), ('EcoVite DriPro 64 (V35164)', 'pct_ex_npn', 91.5), ('EcoVite DriPro 64 (V35164)', 'cf', 1.6), ('EcoVite DriPro 64 (V35164)', 'ca', 4), ('EcoVite DriPro 64 (V35164)', 'p', 0.08), ('EcoVite DriPro 64 (V35164)', 'k', 1.58), ('EcoVite DriPro 64 (V35164)', 'mg', 0.08), ('EcoVite DriPro 64 (V35164)', 's', 0.83), ('EcoVite DriPro 64 (V35164)', 'fe', 100), ('EcoVite DriPro 64 (V35164)', 'mn', 600), ('EcoVite DriPro 64 (V35164)', 'cu', 150), ('EcoVite DriPro 64 (V35164)', 'zn', 600), ('EcoVite DriPro 64 (V35164)', 'co', 2), ('EcoVite DriPro 64 (V35164)', 'iod', 20), ('EcoVite DriPro 64 (V35164)', 'se', 4), ('EcoVite DriPro 64 (V35164)', 'vit_a', 20000), ('EcoVite DriPro 64 (V35164)', 'tdn', 36),

  ('CMS 450', 'dm', 45), ('CMS 450', 'cp', 5), ('CMS 450', 'cf', 0.1), ('CMS 450', 'ca', 9.1), ('CMS 450', 'p', 1.1), ('CMS 450', 'k', 45), ('CMS 450', 'mg', 6), ('CMS 450', 's', 11), ('CMS 450', 'fe', 150), ('CMS 450', 'mn', 54), ('CMS 450', 'cu', 4.5), ('CMS 450', 'zn', 5), ('CMS 450', 'co', 1), ('CMS 450', 'tdn', 58),

  ('MCP 22.7', 'dm', 99), ('MCP 22.7', 'ca', 16.4), ('MCP 22.7', 'p', 22.7), ('MCP 22.7', 'mg', 1.6), ('MCP 22.7', 's', 1.2), ('MCP 22.7', 'fe', 25), ('MCP 22.7', 'mn', 10), ('MCP 22.7', 'cu', 5), ('MCP 22.7', 'zn', 10), ('MCP 22.7', 'co', 0.2),

  ('Salt', 'dm', 99), ('Salt', 'salt', 99.5), ('Salt', 'tdn', 0),

  ('Feed Lime', 'dm', 99), ('Feed Lime', 'ca', 36), ('Feed Lime', 'mg', 0.1), ('Feed Lime', 's', 0.02), ('Feed Lime', 'fe', 10), ('Feed Lime', 'mn', 12), ('Feed Lime', 'cu', 0.3), ('Feed Lime', 'zn', 1), ('Feed Lime', 'co', 0.01), ('Feed Lime', 'tdn', 0),

  ('Urea', 'dm', 99.5), ('Urea', 'cp', 287), ('Urea', 'pct_ex_npn', 100), ('Urea', 'tdn', 0),

  ('Ammonium Chloride', 'dm', 99), ('Ammonium Chloride', 'cp', 162.5), ('Ammonium Chloride', 'pct_ex_npn', 100),

  ('Ammonium Sulphate', 'dm', 99), ('Ammonium Sulphate', 'cp', 132), ('Ammonium Sulphate', 'pct_ex_npn', 100), ('Ammonium Sulphate', 's', 24), ('Ammonium Sulphate', 'fe', 8), ('Ammonium Sulphate', 'tdn', 0),

  ('Maize (8%)', 'dm', 88), ('Maize (8%)', 'cp', 7.5), ('Maize (8%)', 'cf', 3), ('Maize (8%)', 'fat', 4), ('Maize (8%)', 'ca', 0.03), ('Maize (8%)', 'p', 0.25), ('Maize (8%)', 'k', 0.33), ('Maize (8%)', 'mg', 0.11), ('Maize (8%)', 's', 0.12), ('Maize (8%)', 'salt', 0.1), ('Maize (8%)', 'fe', 32), ('Maize (8%)', 'mn', 5), ('Maize (8%)', 'cu', 3), ('Maize (8%)', 'zn', 17), ('Maize (8%)', 'co', 0.01), ('Maize (8%)', 'iod', 0.1), ('Maize (8%)', 'se', 0.1), ('Maize (8%)', 'tdn', 82),

  ('Molasses Meal', 'dm', 86.22), ('Molasses Meal', 'cp', 3.9), ('Molasses Meal', 'cf', 13), ('Molasses Meal', 'fat', 0.51), ('Molasses Meal', 'ca', 0.53), ('Molasses Meal', 'p', 0.07), ('Molasses Meal', 'k', 2.83), ('Molasses Meal', 'mg', 0.27), ('Molasses Meal', 's', 0.41), ('Molasses Meal', 'salt', 0.2), ('Molasses Meal', 'fe', 151), ('Molasses Meal', 'mn', 35), ('Molasses Meal', 'cu', 20), ('Molasses Meal', 'zn', 12), ('Molasses Meal', 'co', 0.3), ('Molasses Meal', 'iod', 0.9), ('Molasses Meal', 'se', 0.01), ('Molasses Meal', 'tdn', 69),

  ('Hominy Chop', 'dm', 86), ('Hominy Chop', 'cp', 9), ('Hominy Chop', 'cf', 7), ('Hominy Chop', 'fat', 7), ('Hominy Chop', 'ca', 0.05), ('Hominy Chop', 'p', 0.45), ('Hominy Chop', 'k', 0.6), ('Hominy Chop', 'mg', 0.2), ('Hominy Chop', 's', 0.03), ('Hominy Chop', 'salt', 0.1), ('Hominy Chop', 'fe', 72), ('Hominy Chop', 'mn', 11), ('Hominy Chop', 'cu', 9), ('Hominy Chop', 'zn', 22), ('Hominy Chop', 'co', 0.1), ('Hominy Chop', 'iod', 0.1), ('Hominy Chop', 'se', 0.1), ('Hominy Chop', 'tdn', 80),

  ('Cotton Seed Oilcake', 'dm', 90), ('Cotton Seed Oilcake', 'cp', 34), ('Cotton Seed Oilcake', 'cf', 18), ('Cotton Seed Oilcake', 'fat', 3.7), ('Cotton Seed Oilcake', 'ca', 0.29), ('Cotton Seed Oilcake', 'p', 1.12), ('Cotton Seed Oilcake', 'k', 1.35), ('Cotton Seed Oilcake', 'mg', 0.5), ('Cotton Seed Oilcake', 's', 0.34), ('Cotton Seed Oilcake', 'salt', 0.1), ('Cotton Seed Oilcake', 'fe', 135), ('Cotton Seed Oilcake', 'mn', 18), ('Cotton Seed Oilcake', 'cu', 16), ('Cotton Seed Oilcake', 'zn', 54), ('Cotton Seed Oilcake', 'co', 0.1), ('Cotton Seed Oilcake', 'iod', 0.1), ('Cotton Seed Oilcake', 'se', 0.6), ('Cotton Seed Oilcake', 'tdn', 68),

  ('Soya Oilcake', 'dm', 88), ('Soya Oilcake', 'cp', 47), ('Soya Oilcake', 'cf', 7), ('Soya Oilcake', 'fat', 2), ('Soya Oilcake', 'ca', 0.35), ('Soya Oilcake', 'p', 0.7), ('Soya Oilcake', 'k', 1.1), ('Soya Oilcake', 'mg', 0.26), ('Soya Oilcake', 's', 0.34), ('Soya Oilcake', 'salt', 0.1), ('Soya Oilcake', 'tdn', 78),

  ('Molatek Meester 20', 'dm', 85), ('Molatek Meester 20', 'cp', 20), ('Molatek Meester 20', 'pct_ex_npn', 72.66), ('Molatek Meester 20', 'cf', 10), ('Molatek Meester 20', 'fat', 1.2), ('Molatek Meester 20', 'ca', 1), ('Molatek Meester 20', 'p', 0.6), ('Molatek Meester 20', 'k', 1.9), ('Molatek Meester 20', 'mg', 0.31), ('Molatek Meester 20', 's', 0.49), ('Molatek Meester 20', 'salt', 0.1), ('Molatek Meester 20', 'fe', 25), ('Molatek Meester 20', 'mn', 100), ('Molatek Meester 20', 'cu', 20), ('Molatek Meester 20', 'zn', 150), ('Molatek Meester 20', 'co', 1), ('Molatek Meester 20', 'iod', 1.5), ('Molatek Meester 20', 'se', 1), ('Molatek Meester 20', 'vit_a', 15000), ('Molatek Meester 20', 'tdn', 60),

  ('Voermol Super 18', 'dm', 84), ('Voermol Super 18', 'cp', 18), ('Voermol Super 18', 'pct_ex_npn', 77.3), ('Voermol Super 18', 'cf', 10), ('Voermol Super 18', 'fat', 0.03), ('Voermol Super 18', 'ca', 6), ('Voermol Super 18', 'p', 6), ('Voermol Super 18', 'k', 2), ('Voermol Super 18', 'mg', 3.3), ('Voermol Super 18', 's', 4.5), ('Voermol Super 18', 'salt', 0.1), ('Voermol Super 18', 'fe', 28), ('Voermol Super 18', 'mn', 120), ('Voermol Super 18', 'cu', 50), ('Voermol Super 18', 'zn', 150), ('Voermol Super 18', 'co', 0.6), ('Voermol Super 18', 'iod', 2), ('Voermol Super 18', 'se', 1), ('Voermol Super 18', 'vit_a', 10000), ('Voermol Super 18', 'tdn', 58),

  ('Yara Kalori 3000', 'dm', 95), ('Yara Kalori 3000', 'cp', 4), ('Yara Kalori 3000', 'cf', 5), ('Yara Kalori 3000', 'fat', 0.01), ('Yara Kalori 3000', 'ca', 10), ('Yara Kalori 3000', 'p', 0.1), ('Yara Kalori 3000', 'k', 2), ('Yara Kalori 3000', 'mg', 0.1), ('Yara Kalori 3000', 's', 0.8), ('Yara Kalori 3000', 'salt', 0.1), ('Yara Kalori 3000', 'fe', 35), ('Yara Kalori 3000', 'mn', 5), ('Yara Kalori 3000', 'cu', 4), ('Yara Kalori 3000', 'zn', 5), ('Yara Kalori 3000', 'co', 0.1), ('Yara Kalori 3000', 'tdn', 45),

  ('Yara SelfMix 100', 'dm', 95), ('Yara SelfMix 100', 'cp', 100), ('Yara SelfMix 100', 'pct_ex_npn', 96), ('Yara SelfMix 100', 'fat', 0.01), ('Yara SelfMix 100', 'ca', 6), ('Yara SelfMix 100', 'p', 3), ('Yara SelfMix 100', 'k', 1), ('Yara SelfMix 100', 'mg', 6), ('Yara SelfMix 100', 's', 1.2), ('Yara SelfMix 100', 'fe', 100), ('Yara SelfMix 100', 'mn', 1200), ('Yara SelfMix 100', 'cu', 300), ('Yara SelfMix 100', 'zn', 1200), ('Yara SelfMix 100', 'co', 6), ('Yara SelfMix 100', 'iod', 30), ('Yara SelfMix 100', 'se', 6), ('Yara SelfMix 100', 'tdn', 23),

  ('Yara Kynofos 21', 'dm', 98), ('Yara Kynofos 21', 'ca', 16.8), ('Yara Kynofos 21', 'p', 21), ('Yara Kynofos 21', 'k', 1), ('Yara Kynofos 21', 'mg', 1.3), ('Yara Kynofos 21', 's', 0.8), ('Yara Kynofos 21', 'fe', 19), ('Yara Kynofos 21', 'mn', 10), ('Yara Kynofos 21', 'cu', 5), ('Yara Kynofos 21', 'zn', 8), ('Yara Kynofos 21', 'co', 0.02), ('Yara Kynofos 21', 'tdn', 0),

  ('Yara Kimtrafos P12', 'dm', 85.1), ('Yara Kimtrafos P12', 'cp', 0.56), ('Yara Kimtrafos P12', 'fat', 0.01), ('Yara Kimtrafos P12', 'ca', 16.3), ('Yara Kimtrafos P12', 'p', 12), ('Yara Kimtrafos P12', 'k', 3.3), ('Yara Kimtrafos P12', 'mg', 1.39), ('Yara Kimtrafos P12', 's', 1.29), ('Yara Kimtrafos P12', 'salt', 4.5), ('Yara Kimtrafos P12', 'fe', 120), ('Yara Kimtrafos P12', 'mn', 1200), ('Yara Kimtrafos P12', 'cu', 300), ('Yara Kimtrafos P12', 'zn', 1200), ('Yara Kimtrafos P12', 'co', 6), ('Yara Kimtrafos P12', 'iod', 30), ('Yara Kimtrafos P12', 'se', 6), ('Yara Kimtrafos P12', 'tdn', 12),

  ('Yara Kimtrafos P6', 'dm', 85), ('Yara Kimtrafos P6', 'cp', 0.3), ('Yara Kimtrafos P6', 'fat', 0.01), ('Yara Kimtrafos P6', 'ca', 12), ('Yara Kimtrafos P6', 'p', 6), ('Yara Kimtrafos P6', 'k', 1.6), ('Yara Kimtrafos P6', 'mg', 0.7), ('Yara Kimtrafos P6', 's', 0.65), ('Yara Kimtrafos P6', 'salt', 25), ('Yara Kimtrafos P6', 'fe', 120), ('Yara Kimtrafos P6', 'mn', 600), ('Yara Kimtrafos P6', 'cu', 150), ('Yara Kimtrafos P6', 'zn', 600), ('Yara Kimtrafos P6', 'co', 3), ('Yara Kimtrafos P6', 'iod', 15), ('Yara Kimtrafos P6', 'se', 3), ('Yara Kimtrafos P6', 'tdn', 0),

  ('Premix (generiese plekhouer)', 'dm', 99), ('Premix (generiese plekhouer)', 'tdn', 0),

  ('Sulphur', 'dm', 99), ('Sulphur', 's', 99.9), ('Sulphur', 'tdn', 0),

  ('PEG4000', 'dm', 99),

  ('Water', 'dm', 0)
) as v(ingredient_name, nutrient_id, value)
join ingredients i on i.name = v.ingredient_name;
