// Data access layer. Everything above this file (rep.js, admin.js, app.js)
// calls the same `db` interface regardless of whether it's talking to the
// real PocketBase server (the normal case, see js/config.js) or running in
// demo mode (?demo in the URL).
//
// In demo mode, `db` is backed by an in-browser store seeded from
// js/seedData.js and persisted to localStorage, so the app, including the
// admin ingredient editor, can be tried with zero setup. Otherwise the same
// calls go to PocketBase (js/pocketbaseBackend.js), with the ingredient set
// cached on the device (see below) so mix-building keeps working offline.

import PocketBase from './vendor/pocketbase.es.mjs';
import { IS_CONFIGURED, POCKETBASE_URL } from './config.js';
import { createPocketBaseBackend } from './pocketbaseBackend.js';
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
// PocketBase backend (js/pocketbaseBackend.js)
// ---------------------------------------------------------------------

function buildPocketBaseBackend() {
  const pb = new PocketBase(POCKETBASE_URL);
  // The SDK cancels a pending request when another one to the same
  // endpoint starts; the app fires several reads in parallel (Promise.all
  // in rep.js/admin.js), so that behaviour has to be off.
  pb.autoCancellation(false);
  return createPocketBaseBackend(pb);
}

let backendPromise = null;
export function getBackend() {
  if (!backendPromise) {
    backendPromise = Promise.resolve(IS_CONFIGURED ? buildPocketBaseBackend() : demoBackend);
  }
  return backendPromise;
}

// Demo mode seeds itself once per browser and then persists in localStorage
// indefinitely — it never re-seeds from js/seedData.js on its own, so a
// browser that already tried the app before a seed-data change (e.g. adding
// ingredient pricing) keeps showing the old data forever. This wipes the
// demo database, session, and ingredient cache back to a clean slate. Has
// no effect (and isn't shown) outside demo mode.
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
