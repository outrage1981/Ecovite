// Data access layer. Everything above this file (rep.js, admin.js, app.js)
// calls the same `db` interface regardless of whether a real Supabase
// project is configured (js/config.js) or not.
//
// Without a Supabase URL configured, `db` is backed by an in-browser store
// seeded from js/seedData.js and persisted to localStorage — this is what
// lets the app be tried, including the admin ingredient editor, with zero
// setup. Once you point config.js at a real project, the exact same calls
// go over the Supabase REST API instead, with the ingredient set cached on
// the device (see below) so mix-building keeps working offline.

import { IS_CONFIGURED, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { NUTRIENTS, SPECIES, SUPPLEMENT_TYPES, NPN_SAFETY_LIMITS, NUTRIENT_TARGETS, PRODUCTION_TARGETS, INGREDIENTS, PLAUSIBLE_RANGES, SEED_MIXES } from './seedData.js';
import { computeMixResult } from './calc.js';

const CACHE_KEY = 'ecovite.ingredientCache.v1';
const DEMO_STORE_KEY = 'ecovite.demoStore.v1';
const DEMO_SESSION_KEY = 'ecovite.demoSession.v1';

function uuid() {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------
// Demo backend — everything lives in localStorage.
// ---------------------------------------------------------------------

function loadDemoStore() {
  const raw = localStorage.getItem(DEMO_STORE_KEY);
  if (raw) {
    const store = JSON.parse(raw);
    // Backfill fields added to the store shape after this browser last seeded it.
    if (!store.productionTargets) store.productionTargets = { ...PRODUCTION_TARGETS };
    return store;
  }

  const now = new Date().toISOString();
  const ingredients = INGREDIENTS.map((ing) => ({
    id: uuid(),
    name: ing.name,
    is_active: true,
    notes: null,
    bagSizeKg: ing.bagSizeKg ?? null,
    pricePerBag: ing.pricePerBag ?? null,
    pricePerTon: ing.pricePerTon ?? 0,
    values: { ...ing.values },
    updated_at: now,
  }));

  const store = {
    ingredients,
    npnSafetyLimits: NPN_SAFETY_LIMITS,
    nutrientTargets: NUTRIENT_TARGETS,
    productionTargets: { ...PRODUCTION_TARGETS },
    users: [
      { id: 'demo-admin', email: 'admin@demo.local', password: 'admin123', full_name: 'Demo Admin', role: 'admin' },
      { id: 'demo-rep', email: 'rep@demo.local', password: 'rep123', full_name: 'Demo Rep', role: 'rep' },
    ],
    mixes: [], // { id, ownerId, name, speciesId, supplementTypeId, lines, snapshot, savedAt }
  };
  store.mixes = buildSeedMixes(store).reverse(); // newest-savedAt-first, matching how a real save prepends
  saveDemoStore(store);
  return store;
}

// Turns SEED_MIXES (ingredients referenced by name, since ids only exist
// once the demo store has generated them) into full saved-mix records —
// same shape doSave() in rep.js produces — so the demo starts with real,
// browsable/comparable mixes instead of an empty History tab.
function buildSeedMixes(store) {
  const ingredientByName = new Map(store.ingredients.map((i) => [i.name, i]));
  const nutrientIds = NUTRIENTS.map((n) => n.id);
  const now = Date.now();

  return SEED_MIXES.map((seed, idx) => {
    const lines = seed.lines.map((l) => {
      const ing = ingredientByName.get(l.ingredientName);
      return {
        ingredientId: ing.id,
        ingredientName: ing.name,
        inclusionPct: l.inclusionKg, // kg amount — see rep.js's kg-based mix builder
        costPerTon: ing.pricePerTon ?? 0,
        values: ing.values,
      };
    });
    const target = store.nutrientTargets.find((t) => t.species === seed.speciesId && t.supplementType === seed.supplementTypeId) || {};
    const maxNpn = store.npnSafetyLimits?.[seed.speciesId]?.[seed.supplementTypeId] ?? null;
    const productionTarget = store.productionTargets?.[seed.speciesId] ?? null;
    const result = computeMixResult(lines, nutrientIds, target, maxNpn, productionTarget);
    const savedAt = new Date(now - (SEED_MIXES.length - idx) * 60000).toISOString();

    return {
      id: uuid(),
      ownerId: 'demo-rep',
      name: seed.name,
      speciesId: seed.speciesId,
      supplementTypeId: seed.supplementTypeId,
      lines: lines.map((l) => ({ ingredientId: l.ingredientId, inclusionPct: l.inclusionPct, costPerTon: l.costPerTon })),
      snapshot: { mixName: seed.name, speciesId: seed.speciesId, supplementTypeId: seed.supplementTypeId, target, maxSafeNpnGPerHeadDay: maxNpn, lines, result, savedAt },
      savedAt,
    };
  });
}

function saveDemoStore(store) {
  localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store));
}

function getDemoSession() {
  const raw = localStorage.getItem(DEMO_SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setDemoSession(user) {
  if (user) localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
  else localStorage.removeItem(DEMO_SESSION_KEY);
}

const demoBackend = {
  mode: 'demo',

  async signIn(email, password) {
    const store = loadDemoStore();
    const user = store.users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!user) throw new Error('Incorrect email or password.');
    setDemoSession(user);
    return { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
  },

  async signOut() {
    setDemoSession(null);
  },

  // Demo mode has no real mail server to send a reset link through, so
  // there's nothing meaningful to do here — this only exists so the UI's
  // call to backend.requestPasswordReset() doesn't need a mode-specific
  // branch, matching the pattern used elsewhere in this file.
  async requestPasswordReset() {
    throw new Error('Password reset isn’t available in demo mode — sign in with one of the demo accounts shown below.');
  },

  async getProfile() {
    const session = getDemoSession();
    if (!session) return null;
    return { id: session.id, email: session.email, full_name: session.full_name, role: session.role };
  },

  async listUsers() {
    const store = loadDemoStore();
    return store.users.map((u) => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role }));
  },

  async createUser({ email, password, fullName, role }) {
    const store = loadDemoStore();
    if (store.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('A user with that email already exists.');
    }
    const user = { id: uuid(), email, password, full_name: fullName || '', role };
    store.users.push(user);
    saveDemoStore(store);
    return { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
  },

  async deleteUser(id) {
    const store = loadDemoStore();
    store.users = store.users.filter((u) => u.id !== id);
    // Mirrors the real schema's owner_id -> profiles cascade: removing a
    // user also removes whatever they'd saved, rather than leaving orphaned
    // mixes pointing at a user that no longer exists.
    store.mixes = store.mixes.filter((m) => m.ownerId !== id);
    saveDemoStore(store);
  },

  async listNutrients() {
    return NUTRIENTS;
  },

  async listSpecies() {
    return SPECIES;
  },

  async listSupplementTypes() {
    return SUPPLEMENT_TYPES;
  },

  async getIngredientsUpdatedAt() {
    const store = loadDemoStore();
    return store.ingredients.reduce((max, i) => (i.updated_at > max ? i.updated_at : max), '');
  },

  async listIngredients({ includeInactive = false } = {}) {
    const store = loadDemoStore();
    return store.ingredients
      .filter((i) => includeInactive || i.is_active)
      .map((i) => ({ ...i, values: { ...i.values } }));
  },

  // Keyed by ingredient id -> the caller's own custom price, sized for
  // their area. Separate from ingredients[].pricePerTon (the shared admin
  // default) — never overwrites it.
  async getPriceOverrides() {
    const store = loadDemoStore();
    const session = getDemoSession();
    if (!session) return {};
    const result = {};
    (store.priceOverrides?.[session.id] || []).forEach((o) => {
      result[o.ingredientId] = o.pricePerTon;
    });
    return result;
  },

  async setPriceOverride(ingredientId, pricePerTon) {
    const store = loadDemoStore();
    const session = getDemoSession();
    if (!session) return;
    store.priceOverrides = store.priceOverrides || {};
    const list = (store.priceOverrides[session.id] = store.priceOverrides[session.id] || []);
    const existing = list.find((o) => o.ingredientId === ingredientId);
    if (existing) existing.pricePerTon = pricePerTon;
    else list.push({ ingredientId, pricePerTon });
    saveDemoStore(store);
  },

  async upsertIngredient(ingredient) {
    const store = loadDemoStore();
    const now = new Date().toISOString();
    if (ingredient.id) {
      const idx = store.ingredients.findIndex((i) => i.id === ingredient.id);
      if (idx === -1) throw new Error('Ingredient not found.');
      store.ingredients[idx] = { ...store.ingredients[idx], ...ingredient, updated_at: now };
    } else {
      store.ingredients.push({
        id: uuid(),
        is_active: true,
        notes: null,
        ...ingredient,
        updated_at: now,
      });
    }
    saveDemoStore(store);
    return true;
  },

  async setIngredientActive(id, isActive) {
    const store = loadDemoStore();
    const ing = store.ingredients.find((i) => i.id === id);
    if (ing) {
      ing.is_active = isActive;
      ing.updated_at = new Date().toISOString();
      saveDemoStore(store);
    }
  },

  async getNpnSafetyLimits() {
    const store = loadDemoStore();
    return store.npnSafetyLimits;
  },

  async upsertNpnSafetyLimit(speciesId, supplementTypeId, maxGNPerHeadDay) {
    const store = loadDemoStore();
    store.npnSafetyLimits[speciesId] = store.npnSafetyLimits[speciesId] || {};
    store.npnSafetyLimits[speciesId][supplementTypeId] = maxGNPerHeadDay;
    saveDemoStore(store);
  },

  async getNutrientTargets() {
    const store = loadDemoStore();
    return store.nutrientTargets;
  },

  async upsertNutrientTarget(target) {
    const store = loadDemoStore();
    const idx = store.nutrientTargets.findIndex(
      (t) => t.species === target.species && t.supplementType === target.supplementType
    );
    if (idx === -1) store.nutrientTargets.push(target);
    else store.nutrientTargets[idx] = { ...store.nutrientTargets[idx], ...target };
    saveDemoStore(store);
  },

  async getProductionTargets() {
    const store = loadDemoStore();
    return store.productionTargets;
  },

  async upsertProductionTarget(speciesId, protein, energy) {
    const store = loadDemoStore();
    store.productionTargets[speciesId] = { protein, energy };
    saveDemoStore(store);
  },

  async saveMix({ name, speciesId, supplementTypeId, lickFocus, lines, snapshot }) {
    const store = loadDemoStore();
    const session = getDemoSession();
    const record = {
      id: uuid(),
      ownerId: session?.id ?? 'unknown',
      name,
      speciesId,
      supplementTypeId,
      lickFocus: lickFocus ?? null,
      lines,
      snapshot,
      savedAt: new Date().toISOString(),
    };
    store.mixes.unshift(record);
    saveDemoStore(store);
    return record;
  },

  async listSavedMixes() {
    const store = loadDemoStore();
    const session = getDemoSession();
    if (!session) return [];
    const withOwnerName = (m) => {
      const owner = store.users.find((u) => u.id === m.ownerId);
      return { ...m, ownerName: owner?.full_name ?? 'Unknown', ownerEmail: owner?.email ?? null };
    };
    if (session.role === 'admin') return store.mixes.map(withOwnerName);
    return store.mixes.filter((m) => m.ownerId === session.id || m.isPublic).map(withOwnerName);
  },

  async deleteSavedMix(id) {
    const store = loadDemoStore();
    const session = getDemoSession();
    const mix = store.mixes.find((m) => m.id === id);
    if (mix && mix.ownerId !== session?.id) throw new Error('You can only delete your own mixes.');
    store.mixes = store.mixes.filter((m) => m.id !== id);
    saveDemoStore(store);
  },

  async setMixPublic(id, isPublic) {
    const store = loadDemoStore();
    const mix = store.mixes.find((m) => m.id === id);
    if (mix) {
      mix.isPublic = isPublic;
      saveDemoStore(store);
    }
  },
};

// ---------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------

async function buildSupabaseBackend() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function rowsToIngredient(ingredientRow, nutrientRows) {
    const values = {};
    for (const n of NUTRIENTS) values[n.id] = null;
    for (const row of nutrientRows) values[row.nutrient_id] = row.value;
    return {
      id: ingredientRow.id,
      name: ingredientRow.name,
      is_active: ingredientRow.is_active,
      notes: ingredientRow.notes,
      bagSizeKg: ingredientRow.bag_size_kg,
      pricePerBag: ingredientRow.price_per_bag,
      pricePerTon: ingredientRow.price_per_ton ?? 0,
      updated_at: ingredientRow.updated_at,
      values,
    };
  }

  return {
    mode: 'supabase',

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data.user;
    },

    async signOut() {
      await client.auth.signOut();
    },

    // Supabase emails a link back to redirectTo with a recovery token
    // attached — app.js's boot() checks for that token on load and shows
    // the "set a new password" screen instead of the normal app. Using the
    // app's own current URL (rather than a hardcoded one) means this keeps
    // working whether it's opened at localhost during testing or at
    // whatever real domain it ends up hosted on later.
    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw error;
    },

    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },

    async getProfile() {
      const { data: sessionData } = await client.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) return null;
      const { data, error } = await client.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      return { id: user.id, email: user.email, full_name: data.full_name, role: data.role };
    },

    async listUsers() {
      const { data, error } = await client.from('profiles').select('id, full_name, email, role').order('email');
      if (error) throw error;
      return data;
    },

    // Creating/deleting real auth accounts needs Supabase's admin API,
    // which needs the service-role secret key — that can never sit in
    // browser code, so both go through the 'admin-users' Edge Function
    // instead (see supabase/functions/admin-users), which holds that key
    // server-side and re-checks the caller is actually an admin itself.
    async createUser({ email, password, fullName, role }) {
      const { data, error } = await client.functions.invoke('admin-users', {
        body: { action: 'create', email, password, fullName, role },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },

    async deleteUser(id) {
      const { data, error } = await client.functions.invoke('admin-users', {
        body: { action: 'delete', userId: id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },

    async listNutrients() {
      const { data, error } = await client.from('nutrients').select('*').order('sort_order');
      if (error) throw error;
      return data.map((n) => ({ id: n.id, label: n.label, unit: n.unit, group: n.nutrient_group, derived: n.is_derived }));
    },

    async listSpecies() {
      const { data, error } = await client.from('species').select('*');
      if (error) throw error;
      return data;
    },

    async listSupplementTypes() {
      const { data, error } = await client.from('supplement_types').select('*');
      if (error) throw error;
      return data;
    },

    async getIngredientsUpdatedAt() {
      const { data, error } = await client
        .from('ingredients')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.updated_at ?? '';
    },

    async listIngredients({ includeInactive = false } = {}) {
      let query = client.from('ingredients').select('*');
      if (!includeInactive) query = query.eq('is_active', true);
      const { data: ingredientRows, error } = await query;
      if (error) throw error;

      const { data: nutrientRows, error: nErr } = await client.from('ingredient_nutrients').select('*');
      if (nErr) throw nErr;

      return ingredientRows.map((row) =>
        rowsToIngredient(
          row,
          nutrientRows.filter((n) => n.ingredient_id === row.id)
        )
      );
    },

    // RLS restricts this to the caller's own rows, so a rep's custom
    // pricing is never visible to (or overwritten by) anyone else.
    async getPriceOverrides() {
      const { data, error } = await client.from('ingredient_price_overrides').select('ingredient_id, price_per_ton');
      if (error) throw error;
      const result = {};
      for (const row of data) result[row.ingredient_id] = row.price_per_ton;
      return result;
    },

    async setPriceOverride(ingredientId, pricePerTon) {
      const { data: sessionData } = await client.auth.getSession();
      const ownerId = sessionData?.session?.user?.id;
      const { error } = await client.from('ingredient_price_overrides').upsert(
        { owner_id: ownerId, ingredient_id: ingredientId, price_per_ton: pricePerTon, updated_at: new Date().toISOString() },
        { onConflict: 'owner_id,ingredient_id' }
      );
      if (error) throw error;
    },

    async upsertIngredient(ingredient) {
      const now = new Date().toISOString();
      let ingredientId = ingredient.id;
      const priceFields = {
        bag_size_kg: ingredient.bagSizeKg ?? null,
        price_per_bag: ingredient.pricePerBag ?? null,
        price_per_ton: ingredient.pricePerTon ?? 0,
      };
      if (ingredientId) {
        const { error } = await client
          .from('ingredients')
          .update({ name: ingredient.name, notes: ingredient.notes ?? null, ...priceFields, updated_at: now })
          .eq('id', ingredientId);
        if (error) throw error;
      } else {
        const { data, error } = await client
          .from('ingredients')
          .insert({ name: ingredient.name, notes: ingredient.notes ?? null, ...priceFields })
          .select()
          .single();
        if (error) throw error;
        ingredientId = data.id;
      }

      await client.from('ingredient_nutrients').delete().eq('ingredient_id', ingredientId);
      const rows = Object.entries(ingredient.values || {})
        .filter(([nutrientId, value]) => value != null && !['npn', 'me'].includes(nutrientId))
        .map(([nutrient_id, value]) => ({ ingredient_id: ingredientId, nutrient_id, value }));
      if (rows.length) {
        const { error } = await client.from('ingredient_nutrients').insert(rows);
        if (error) throw error;
      }
      return true;
    },

    async setIngredientActive(id, isActive) {
      const { error } = await client
        .from('ingredients')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },

    async getNpnSafetyLimits() {
      const { data, error } = await client.from('npn_safety_limits').select('*');
      if (error) throw error;
      const result = {};
      for (const row of data) {
        result[row.species_id] = result[row.species_id] || {};
        result[row.species_id][row.supplement_type_id] = row.max_g_n_per_head_day;
      }
      return result;
    },

    async upsertNpnSafetyLimit(speciesId, supplementTypeId, maxGNPerHeadDay) {
      const { error } = await client.from('npn_safety_limits').upsert({
        species_id: speciesId,
        supplement_type_id: supplementTypeId,
        max_g_n_per_head_day: maxGNPerHeadDay,
      });
      if (error) throw error;
    },

    async getNutrientTargets() {
      const { data, error } = await client.from('nutrient_targets').select('*');
      if (error) throw error;
      return data.map((t) => ({
        species: t.species_id,
        supplementType: t.supplement_type_id,
        cp: t.cp_target_g,
        cpNote: t.cp_reference_note,
        me: t.me_target_mj,
        meNote: t.me_reference_note,
        p: t.p_target_g,
        pNote: t.p_reference_note,
      }));
    },

    async getProductionTargets() {
      const { data, error } = await client.from('production_targets').select('*');
      if (error) throw error;
      const result = {};
      for (const row of data) result[row.species_id] = { protein: row.protein_target_g, energy: row.energy_target_mj };
      return result;
    },

    async upsertProductionTarget(speciesId, protein, energy) {
      const { error } = await client.from('production_targets').upsert({
        species_id: speciesId,
        protein_target_g: protein,
        energy_target_mj: energy,
      });
      if (error) throw error;
    },

    async upsertNutrientTarget(target) {
      const { error } = await client.from('nutrient_targets').upsert({
        species_id: target.species,
        supplement_type_id: target.supplementType,
        cp_target_g: target.cp,
        cp_reference_note: target.cpNote,
        me_target_mj: target.me,
        me_reference_note: target.meNote,
        p_target_g: target.p,
        p_reference_note: target.pNote,
      });
      if (error) throw error;
    },

    async saveMix({ name, speciesId, supplementTypeId, lickFocus, lines, snapshot }) {
      const { data: sessionData } = await client.auth.getSession();
      const ownerId = sessionData?.session?.user?.id;
      const { data: mixRow, error } = await client
        .from('mixes')
        .insert({ name, species_id: speciesId, supplement_type_id: supplementTypeId, lick_focus: lickFocus ?? null, owner_id: ownerId, status: 'saved' })
        .select()
        .single();
      if (error) throw error;

      const lineRows = lines.map((l, idx) => ({
        mix_id: mixRow.id,
        ingredient_id: l.ingredientId,
        inclusion_pct: l.inclusionPct,
        cost_per_ton: l.costPerTon,
        sort_order: idx,
      }));
      if (lineRows.length) {
        const { error: lErr } = await client.from('mix_lines').insert(lineRows);
        if (lErr) throw lErr;
      }

      const { error: sErr } = await client.from('mix_snapshots').insert({ mix_id: mixRow.id, snapshot });
      if (sErr) throw sErr;

      return mixRow;
    },

    async listSavedMixes() {
      // profiles(full_name) is embedded via the mixes.owner_id -> profiles.id
      // foreign key. RLS on `mixes` already restricts this to the caller's
      // own rows unless they're an admin, so a rep can never fetch another
      // rep's mixes even by tampering with this query client-side.
      const { data, error } = await client
        .from('mixes')
        .select('*, mix_snapshots(*), profiles(full_name, email)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map((m) => ({
        id: m.id,
        name: m.name,
        ownerId: m.owner_id,
        ownerName: m.profiles?.full_name ?? 'Unknown',
        ownerEmail: m.profiles?.email ?? null,
        speciesId: m.species_id,
        supplementTypeId: m.supplement_type_id,
        lickFocus: m.lick_focus,
        savedAt: m.created_at,
        snapshot: m.mix_snapshots?.[0]?.snapshot,
        isPublic: m.is_public,
      }));
    },

    async deleteSavedMix(id) {
      const { error } = await client.from('mixes').delete().eq('id', id);
      if (error) throw error;
    },

    async setMixPublic(id, isPublic) {
      const { error } = await client.from('mixes').update({ is_public: isPublic }).eq('id', id);
      if (error) throw error;
    },
  };
}

let backendPromise = null;
export function getBackend() {
  if (!backendPromise) {
    backendPromise = IS_CONFIGURED ? buildSupabaseBackend() : Promise.resolve(demoBackend);
  }
  return backendPromise;
}

// Demo mode seeds itself once per browser and then persists in localStorage
// indefinitely — it never re-seeds from js/seedData.js on its own, so a
// browser that already tried the app before a seed-data change (e.g. adding
// ingredient pricing) keeps showing the old data forever. This wipes the
// demo database, session, and ingredient cache back to a clean slate. Has
// no effect (and isn't shown) once a real Supabase project is configured.
export function resetDemoData() {
  localStorage.removeItem(DEMO_STORE_KEY);
  localStorage.removeItem(DEMO_SESSION_KEY);
  localStorage.removeItem(CACHE_KEY);
}

// ---------------------------------------------------------------------
// Offline ingredient cache: pulls the full ingredient list once, keeps it
// in localStorage, and only re-fetches when the server's latest updated_at
// timestamp has moved on. This is what lets a rep build mixes with no
// signal, and is also what makes "clean and instant" possible even on a
// live connection — the calculation never waits on a network round trip.
// ---------------------------------------------------------------------

export async function getIngredients({ forceRefresh = false } = {}) {
  const backend = await getBackend();
  const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  const serverVersion = await backend.getIngredientsUpdatedAt().catch(() => null);

  if (!forceRefresh && cached && serverVersion && cached.version === serverVersion) {
    return cached;
  }
  if (!forceRefresh && cached && serverVersion == null) {
    // offline: serve what we have
    return cached;
  }

  try {
    const ingredients = await backend.listIngredients();
    const payload = { version: serverVersion, fetchedAt: new Date().toISOString(), ingredients };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    return payload;
  } catch (e) {
    if (cached) return cached; // offline fallback
    throw e;
  }
}

export function clearIngredientCache() {
  localStorage.removeItem(CACHE_KEY);
}

export { PLAUSIBLE_RANGES };
