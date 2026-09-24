// A tiny Supabase export in the exact shape tools/export-supabase.mjs writes.
// PostgREST returns numeric columns as strings, hence the quoted numbers.
export const FIXTURE = {
  profiles: [
    { id: 'u-admin', full_name: 'Ada', email: 'ada@test.local', role: 'admin' },
    { id: 'u-rep', full_name: null, email: 'rep@test.local', role: 'rep' },
  ],
  ingredients: [
    { id: 'i-urea', name: 'Urea', is_active: true, notes: null, bag_size_kg: '50', price_per_bag: '550', price_per_ton: '11000' },
    { id: 'i-water', name: 'Water', is_active: false, notes: 'free', bag_size_kg: null, price_per_bag: null, price_per_ton: '0' },
  ],
  ingredient_nutrients: [
    { ingredient_id: 'i-urea', nutrient_id: 'cp', value: '287' },
    { ingredient_id: 'i-urea', nutrient_id: 'tdn', value: '0' },
  ],
  ingredient_price_overrides: [{ owner_id: 'u-rep', ingredient_id: 'i-urea', price_per_ton: '12000' }],
  npn_safety_limits: [
    { species_id: 'cattle', supplement_type_id: 'maintenance', max_g_n_per_head_day: '35' },
    { species_id: 'sheep', supplement_type_id: 'production', max_g_n_per_head_day: '9' },
  ],
  nutrient_targets: [
    { species_id: 'cattle', supplement_type_id: 'maintenance', cp_target_g: '150', cp_reference_note: 'note', me_target_mj: null, me_reference_note: null, p_target_g: '6', p_reference_note: null },
  ],
  production_targets: [{ species_id: 'cattle', protein_target_g: '350', energy_target_mj: '7' }],
  mixes: [
    { id: 'm-new', owner_id: 'u-rep', name: 'Newer', species_id: 'cattle', supplement_type_id: 'maintenance', lick_focus: null, is_public: false, created_at: '2026-02-01T00:00:00Z' },
    { id: 'm-old', owner_id: 'u-rep', name: 'Older', species_id: 'cattle', supplement_type_id: 'maintenance', lick_focus: 'protein', is_public: true, created_at: '2026-01-01T00:00:00Z' },
    { id: 'm-draft', owner_id: 'u-rep', name: 'Draft', species_id: 'cattle', supplement_type_id: 'maintenance', lick_focus: null, is_public: false, created_at: '2026-01-15T00:00:00Z' },
    // Owner not present in `profiles` (e.g. a since-deleted Supabase user) —
    // transform still carries it through (it has a snapshot, so it isn't a
    // draft), but importIntoPocketBase must skip it: there's no PocketBase
    // user id to attach it to.
    { id: 'm-orphan', owner_id: 'u-ghost', name: 'Orphan', species_id: 'cattle', supplement_type_id: 'maintenance', lick_focus: null, is_public: false, created_at: '2026-03-01T00:00:00Z' },
  ],
  mix_lines: [
    { mix_id: 'm-old', ingredient_id: 'i-urea', inclusion_pct: '100', cost_per_ton: '11000', sort_order: 0 },
  ],
  mix_snapshots: [
    { mix_id: 'm-old', created_at: '2026-01-01T00:00:00Z', snapshot: { savedAt: '2026-01-01T00:00:00Z', lines: [{ ingredientId: 'i-urea' }] } },
    { mix_id: 'm-new', created_at: '2026-02-01T00:00:00Z', snapshot: { savedAt: 'first', lines: [] } },
    { mix_id: 'm-new', created_at: '2026-02-02T00:00:00Z', snapshot: { savedAt: 'second', lines: [] } },
    { mix_id: 'm-orphan', created_at: '2026-03-01T00:00:00Z', snapshot: { savedAt: 'third', lines: [] } },
  ],
};
