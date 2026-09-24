// Pure conversions between PocketBase records and the shapes the rest of
// the app already uses (the same shapes the demo backend in db.js returns).
// No SDK, no DOM, no network, so everything here is unit-tested in Node.

import { NUTRIENTS } from './seedData.js';

// Always calculated in js/calc.js, never stored (see calc.js header).
const DERIVED_NUTRIENTS = ['npn', 'me'];

// PocketBase datetimes look like "2026-09-24 10:00:00.000Z" — a space
// instead of ISO 8601's 'T'. Safari's `Date` parser (and `new Date(...)`
// generally, per spec) rejects that form, so anywhere one of these values
// is handed to the UI it needs normalising first.
function toIso(pbDateTime) {
  if (!pbDateTime) return pbDateTime;
  return pbDateTime.replace(' ', 'T');
}

export function recordToIngredient(record) {
  const values = {};
  for (const n of NUTRIENTS) values[n.id] = null;
  for (const [nutrientId, value] of Object.entries(record.values || {})) {
    if (value != null && !DERIVED_NUTRIENTS.includes(nutrientId)) values[nutrientId] = value;
  }
  return {
    id: record.id,
    name: record.name,
    is_active: record.is_active,
    notes: record.notes || null,
    // PocketBase number fields store "empty" as 0; a 0 kg bag or R0 bag
    // price is meaningless, so read it back as "not entered".
    bagSizeKg: record.bag_size_kg || null,
    pricePerBag: record.price_per_bag || null,
    pricePerTon: record.price_per_ton ?? 0,
    updated_at: toIso(record.updated),
    values,
  };
}

export function ingredientToRecord(ingredient) {
  const values = {};
  for (const [nutrientId, value] of Object.entries(ingredient.values || {})) {
    if (value != null && !DERIVED_NUTRIENTS.includes(nutrientId)) values[nutrientId] = value;
  }
  return {
    name: ingredient.name,
    notes: ingredient.notes ?? '',
    bag_size_kg: ingredient.bagSizeKg ?? null,
    price_per_bag: ingredient.pricePerBag ?? null,
    price_per_ton: ingredient.pricePerTon ?? 0,
    values,
  };
}

export function recordToProfile(record) {
  return { id: record.id, email: record.email, full_name: record.name, role: record.role };
}

export function recordToMix(record) {
  const owner = record.expand?.owner;
  return {
    id: record.id,
    name: record.name,
    ownerId: record.owner,
    ownerName: owner?.name ?? 'Unknown',
    ownerEmail: owner?.email ?? null,
    speciesId: record.species,
    supplementTypeId: record.supplement_type,
    lickFocus: record.lick_focus || null,
    // The snapshot's own timestamp survives a data import; `created` is
    // reset to the import time for mixes brought over from Supabase. Leave
    // the snapshot's own savedAt as-is (it's already ISO); only the
    // PocketBase-format `created` fallback needs normalising.
    savedAt: record.snapshot?.savedAt ?? toIso(record.created),
    snapshot: record.snapshot,
    isPublic: record.is_public,
  };
}

export function mergeNutrientTarget(list, target) {
  const idx = list.findIndex((t) => t.species === target.species && t.supplementType === target.supplementType);
  if (idx === -1) return [...list, target];
  return list.map((t, i) => (i === idx ? { ...t, ...target } : t));
}

export function setNpnLimit(map, speciesId, supplementTypeId, value) {
  return { ...map, [speciesId]: { ...(map[speciesId] || {}), [supplementTypeId]: value } };
}

export function describePbError(err) {
  const fieldErrors = err?.response?.data;
  if (fieldErrors && typeof fieldErrors === 'object') {
    const [field, detail] = Object.entries(fieldErrors)[0] ?? [];
    if (field && detail?.message) return `${field}: ${detail.message}`;
  }
  if (err?.status === 0) return "Can't reach the server — check your connection.";
  return err?.response?.message || err?.message || 'Something went wrong.';
}
