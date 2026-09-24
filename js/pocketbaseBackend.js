// PocketBase implementation of the backend interface js/db.js hands to the
// rest of the app. Method names and return shapes match db.js's demoBackend
// exactly (except confirmPasswordReset, which replaces Supabase's
// updatePassword). Access control is enforced server-side by the rules in
// pb_migrations/, not by anything here.
//
// getSetting()/putSetting() also keep a small offline cache (one storage
// entry per settings key, `ecovite.setting.<key>`) so npn_safety_limits,
// nutrient_targets and production_targets stay available to a rep who's
// signed in but has no signal — the same idea as js/db.js's ingredient
// cache. Only a network failure (status 0) falls back to the cache; a real
// error (403, 500, …) still throws, and a genuinely unset key (404) still
// resolves to `fallback`, not a stale cached value.

import { NUTRIENTS, SPECIES, SUPPLEMENT_TYPES } from './seedData.js';
import {
  recordToIngredient, ingredientToRecord, recordToProfile, recordToMix,
  mergeNutrientTarget, setNpnLimit, describePbError,
} from './pocketbaseMappers.js';

const notFoundToNull = (err) => {
  if (err?.status === 404) return null;
  throw err;
};

// localStorage isn't always there (Node, a private-mode browser that
// disables it, etc.) and can throw just by being touched, so probe it once
// with a real read/write rather than trusting its mere existence.
function defaultStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probeKey = '__ecovite_storage_probe__';
    ls.setItem(probeKey, '1');
    ls.removeItem(probeKey);
    return ls;
  } catch {
    return null;
  }
}

export function createPocketBaseBackend(pb, { storage = defaultStorage() } = {}) {
  const users = () => pb.collection('users');
  const settingCacheKey = (key) => `ecovite.setting.${key}`;

  function readSettingCache(key) {
    if (!storage) return undefined;
    try {
      const raw = storage.getItem(settingCacheKey(key));
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  function writeSettingCache(key, value) {
    if (!storage) return;
    try {
      storage.setItem(settingCacheKey(key), JSON.stringify(value));
    } catch {
      // Storage full/disabled/etc. — the cache is a convenience, not a
      // requirement, so a failure here shouldn't break the read/write.
    }
  }

  async function getSetting(key, fallback) {
    let row;
    try {
      row = await pb.collection('settings').getFirstListItem(pb.filter('key = {:key}', { key }));
    } catch (err) {
      if (err?.status === 404) return fallback; // genuinely unset — not a cache case
      if (err?.status === 0) {
        const cached = readSettingCache(key);
        return cached === undefined ? fallback : cached;
      }
      throw err;
    }
    writeSettingCache(key, row.value);
    return row.value ?? fallback;
  }

  async function putSetting(key, value) {
    const row = await pb.collection('settings').getFirstListItem(pb.filter('key = {:key}', { key })).catch(notFoundToNull);
    if (row) await pb.collection('settings').update(row.id, { value });
    else await pb.collection('settings').create({ key, value });
    writeSettingCache(key, value);
  }

  const methods = {
    async signIn(email, password) {
      try {
        const { record } = await users().authWithPassword(email, password);
        return recordToProfile(record);
      } catch (err) {
        if (err?.status === 400) throw Object.assign(new Error('Incorrect email or password.'), { status: 400 });
        throw err;
      }
    },

    async signOut() {
      pb.authStore.clear();
    },

    async requestPasswordReset(email) {
      await users().requestPasswordReset(email);
    },

    // The token arrives in the reset email's link (#reset-password=TOKEN,
    // see the template in pb_migrations/). This doesn't sign the user in;
    // they sign in with the new password afterwards.
    async confirmPasswordReset(token, newPassword) {
      await users().confirmPasswordReset(token, newPassword, newPassword);
    },

    // Works offline: the session lives in localStorage. When online, the
    // token is refreshed (extending it another 30 days and picking up role
    // changes); a 401/403/404 means the account was removed or the token
    // revoked, so the stale session is dropped.
    async getProfile() {
      if (!pb.authStore.record) return null;
      if (!pb.authStore.isValid) {
        pb.authStore.clear();
        return null;
      }
      try {
        await users().authRefresh();
      } catch (err) {
        if ([401, 403, 404].includes(err?.status)) {
          pb.authStore.clear();
          return null;
        }
        // status 0 = offline: keep using the cached session.
      }
      return recordToProfile(pb.authStore.record);
    },

    async listUsers() {
      return (await users().getFullList({ sort: 'email' })).map(recordToProfile);
    },

    async createUser({ email, password, fullName, role }) {
      const record = await users().create({
        email, password, passwordConfirm: password, name: fullName || '', role,
        verified: true, emailVisibility: true,
      });
      return recordToProfile(record);
    },

    async deleteUser(id) {
      await users().delete(id);
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
      const page = await pb.collection('ingredients').getList(1, 1, { sort: '-updated', fields: 'updated' });
      return page.items[0]?.updated ?? '';
    },

    async listIngredients({ includeInactive = false } = {}) {
      const records = await pb.collection('ingredients').getFullList({
        filter: includeInactive ? '' : 'is_active = true',
        sort: 'name',
      });
      return records.map(recordToIngredient);
    },

    // The list rule already limits this to the caller's own rows.
    async getPriceOverrides() {
      const result = {};
      for (const row of await pb.collection('price_overrides').getFullList()) {
        result[row.ingredient] = row.price_per_ton;
      }
      return result;
    },

    async setPriceOverride(ingredientId, pricePerTon) {
      const existing = await pb.collection('price_overrides')
        .getFirstListItem(pb.filter('ingredient = {:ingredientId}', { ingredientId }))
        .catch(notFoundToNull);
      if (existing) {
        await pb.collection('price_overrides').update(existing.id, { price_per_ton: pricePerTon });
      } else {
        await pb.collection('price_overrides').create({
          owner: pb.authStore.record?.id, ingredient: ingredientId, price_per_ton: pricePerTon,
        });
      }
    },

    async upsertIngredient(ingredient) {
      const body = ingredientToRecord(ingredient);
      if (ingredient.id) await pb.collection('ingredients').update(ingredient.id, body);
      else await pb.collection('ingredients').create({ ...body, is_active: true });
      return true;
    },

    async setIngredientActive(id, isActive) {
      await pb.collection('ingredients').update(id, { is_active: isActive });
    },

    async getNpnSafetyLimits() {
      return getSetting('npn_safety_limits', {});
    },

    async upsertNpnSafetyLimit(speciesId, supplementTypeId, maxGNPerHeadDay) {
      const current = await getSetting('npn_safety_limits', {});
      await putSetting('npn_safety_limits', setNpnLimit(current, speciesId, supplementTypeId, maxGNPerHeadDay));
    },

    async getNutrientTargets() {
      return getSetting('nutrient_targets', []);
    },

    async upsertNutrientTarget(target) {
      const current = await getSetting('nutrient_targets', []);
      await putSetting('nutrient_targets', mergeNutrientTarget(current, target));
    },

    async getProductionTargets() {
      return getSetting('production_targets', {});
    },

    async upsertProductionTarget(speciesId, protein, energy) {
      const current = await getSetting('production_targets', {});
      await putSetting('production_targets', { ...current, [speciesId]: { protein, energy } });
    },

    async saveMix({ name, speciesId, supplementTypeId, lickFocus, lines, snapshot }) {
      const record = await pb.collection('mixes').create({
        owner: pb.authStore.record?.id,
        name,
        species: speciesId,
        supplement_type: supplementTypeId,
        lick_focus: lickFocus ?? '',
        lines,
        snapshot,
      });
      return recordToMix(record);
    },

    async listSavedMixes() {
      const records = await pb.collection('mixes').getFullList({ sort: '-created', expand: 'owner' });
      return records.map(recordToMix);
    },

    async deleteSavedMix(id) {
      await pb.collection('mixes').delete(id);
    },

    async setMixPublic(id, isPublic) {
      await pb.collection('mixes').update(id, { is_public: isPublic });
    },
  };

  // Every method rejects with a plain Error carrying a readable message,
  // since the UI shows err.message directly.
  const backend = { mode: 'pocketbase' };
  for (const [name, fn] of Object.entries(methods)) {
    backend[name] = async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        throw Object.assign(new Error(describePbError(err)), { status: err?.status });
      }
    };
  }
  return backend;
}
