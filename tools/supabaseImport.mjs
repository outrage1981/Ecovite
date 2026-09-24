// Turns a raw Supabase export (tools/export-supabase.mjs) into PocketBase
// records and writes them, remapping old UUIDs to new PocketBase ids.

const num = (v) => (v == null ? null : Number(v));
const DERIVED_NUTRIENTS = ['npn', 'me'];

export function transformSupabaseExport(exp) {
  const users = exp.profiles.map((p) => ({
    oldId: p.id, email: p.email, name: p.full_name ?? '', role: p.role === 'admin' ? 'admin' : 'rep',
  }));

  const ingredients = exp.ingredients.map((row) => {
    const values = {};
    for (const n of exp.ingredient_nutrients) {
      if (n.ingredient_id === row.id && !DERIVED_NUTRIENTS.includes(n.nutrient_id)) values[n.nutrient_id] = num(n.value);
    }
    return {
      oldId: row.id,
      record: {
        name: row.name, is_active: row.is_active, notes: row.notes ?? '',
        bag_size_kg: num(row.bag_size_kg), price_per_bag: num(row.price_per_bag),
        price_per_ton: num(row.price_per_ton) ?? 0, values,
      },
    };
  });

  const priceOverrides = exp.ingredient_price_overrides.map((o) => ({
    oldOwnerId: o.owner_id, oldIngredientId: o.ingredient_id, price_per_ton: num(o.price_per_ton),
  }));

  const npnSafetyLimits = {};
  for (const r of exp.npn_safety_limits) {
    npnSafetyLimits[r.species_id] = npnSafetyLimits[r.species_id] || {};
    npnSafetyLimits[r.species_id][r.supplement_type_id] = num(r.max_g_n_per_head_day);
  }
  const nutrientTargets = exp.nutrient_targets.map((t) => ({
    species: t.species_id, supplementType: t.supplement_type_id,
    cp: num(t.cp_target_g), cpNote: t.cp_reference_note,
    me: num(t.me_target_mj), meNote: t.me_reference_note,
    p: num(t.p_target_g), pNote: t.p_reference_note,
  }));
  const productionTargets = {};
  for (const r of exp.production_targets) {
    productionTargets[r.species_id] = { protein: num(r.protein_target_g), energy: num(r.energy_target_mj) };
  }

  const latestSnapshot = new Map();
  for (const s of exp.mix_snapshots) {
    const current = latestSnapshot.get(s.mix_id);
    if (!current || s.created_at > current.created_at) latestSnapshot.set(s.mix_id, s);
  }
  const mixes = [];
  let skippedMixes = 0;
  // Oldest first, so PocketBase's `created` order (History sorts on it)
  // matches the original save order.
  for (const m of [...exp.mixes].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const snap = latestSnapshot.get(m.id);
    if (!snap) { skippedMixes++; continue; } // never-saved drafts: nothing to show
    const lines = exp.mix_lines
      .filter((l) => l.mix_id === m.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({ ingredientId: l.ingredient_id, inclusionPct: num(l.inclusion_pct), costPerTon: num(l.cost_per_ton) }));
    mixes.push({
      oldOwnerId: m.owner_id, name: m.name, species: m.species_id, supplement_type: m.supplement_type_id,
      lick_focus: m.lick_focus ?? '', is_public: !!m.is_public, lines, snapshot: snap.snapshot,
    });
  }

  return {
    users, ingredients, priceOverrides,
    settings: { npn_safety_limits: npnSafetyLimits, nutrient_targets: nutrientTargets, production_targets: productionTargets },
    mixes, skippedMixes,
  };
}

export function remapIngredientIds(mix, ingredientIdMap) {
  const remap = (id) => ingredientIdMap.get(id) ?? id;
  return {
    ...mix,
    lines: mix.lines.map((l) => ({ ...l, ingredientId: remap(l.ingredientId) })),
    snapshot: {
      ...mix.snapshot,
      lines: (mix.snapshot?.lines ?? []).map((l) => ({ ...l, ingredientId: remap(l.ingredientId) })),
    },
  };
}

export async function importIntoPocketBase(pb, data, { generatePassword, onUserCreated }) {
  const [existingIngredients, existingUsers] = await Promise.all([
    pb.collection('ingredients').getList(1, 1),
    pb.collection('users').getList(1, 1),
  ]);
  if (existingIngredients.totalItems > 0 || existingUsers.totalItems > 0) {
    throw new Error(
      'Target database already has ingredients or users. Import into a fresh PocketBase '
      + '(delete pb_data and redeploy) — do not run the seed script or create any users first. '
      + 'If a previous import failed partway through, start over from a fresh pb_data; the '
      + 'passwords of any users it already created are in migration-export/temp-passwords.csv.'
    );
  }

  const userIds = new Map();
  const tempPasswords = [];
  for (const u of data.users) {
    const password = generatePassword();
    const rec = await pb.collection('users').create({
      email: u.email, password, passwordConfirm: password, name: u.name, role: u.role,
      verified: true, emailVisibility: true,
    });
    userIds.set(u.oldId, rec.id);
    const entry = { email: u.email, password };
    tempPasswords.push(entry);
    onUserCreated?.(entry);
  }

  const ingredientIds = new Map();
  for (const i of data.ingredients) {
    const rec = await pb.collection('ingredients').create(i.record);
    ingredientIds.set(i.oldId, rec.id);
  }

  let priceOverrideCount = 0;
  for (const o of data.priceOverrides) {
    const owner = userIds.get(o.oldOwnerId);
    const ingredient = ingredientIds.get(o.oldIngredientId);
    if (owner && ingredient) {
      await pb.collection('price_overrides').create({ owner, ingredient, price_per_ton: o.price_per_ton });
      priceOverrideCount++;
    }
  }

  for (const [key, value] of Object.entries(data.settings)) {
    const found = await pb.collection('settings').getFirstListItem(pb.filter('key = {:key}', { key })).catch(() => null);
    if (found) await pb.collection('settings').update(found.id, { value });
    else await pb.collection('settings').create({ key, value });
  }

  let mixCount = 0;
  let mixesSkippedUnknownOwner = 0;
  for (const m of data.mixes) {
    const owner = userIds.get(m.oldOwnerId);
    if (!owner) { mixesSkippedUnknownOwner++; continue; }
    const { oldOwnerId, ...mix } = remapIngredientIds(m, ingredientIds);
    await pb.collection('mixes').create({ ...mix, owner });
    mixCount++;
  }

  return {
    tempPasswords,
    counts: {
      users: userIds.size, ingredients: ingredientIds.size, priceOverrides: priceOverrideCount,
      mixes: mixCount, mixesSkippedUnknownOwner,
    },
  };
}
