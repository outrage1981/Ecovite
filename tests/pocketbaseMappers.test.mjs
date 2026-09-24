import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordToIngredient, ingredientToRecord, recordToProfile, recordToMix,
  mergeNutrientTarget, setNpnLimit, describePbError,
} from '../js/pocketbaseMappers.js';
import { NUTRIENTS } from '../js/seedData.js';

test('recordToIngredient fills every nutrient, keeps zero vs no-data, strips derived values', () => {
  const ing = recordToIngredient({
    id: 'abc', name: 'Urea', is_active: true, notes: '',
    bag_size_kg: 0, price_per_bag: 0, price_per_ton: 11000,
    updated: '2026-09-24 10:00:00.000Z',
    values: { cp: 287, pct_ex_npn: 100, tdn: 0, npn: 999, me: 999 },
  });
  assert.equal(ing.id, 'abc');
  assert.equal(ing.name, 'Urea');
  assert.equal(ing.is_active, true);
  assert.equal(ing.notes, null);
  assert.equal(ing.bagSizeKg, null);
  assert.equal(ing.pricePerBag, null);
  assert.equal(ing.pricePerTon, 11000);
  assert.equal(ing.updated_at, '2026-09-24 10:00:00.000Z');
  assert.deepEqual(Object.keys(ing.values).sort(), NUTRIENTS.map((n) => n.id).sort());
  assert.equal(ing.values.cp, 287);
  assert.equal(ing.values.tdn, 0);
  assert.equal(ing.values.fat, null);
  assert.equal(ing.values.npn, null);
  assert.equal(ing.values.me, null);
});

test('recordToIngredient tolerates a missing values field', () => {
  const ing = recordToIngredient({ id: 'x', name: 'Water', is_active: false, price_per_ton: 0, updated: '' });
  assert.equal(ing.values.cp, null);
  assert.equal(ing.pricePerTon, 0);
});

test('ingredientToRecord drops null and derived values and maps pricing names', () => {
  const rec = ingredientToRecord({
    id: 'ignored', name: 'Salt', notes: null, bagSizeKg: 50, pricePerBag: 120, pricePerTon: 2400,
    values: { dm: 99, salt: 99.5, tdn: 0, cp: null, npn: 1, me: 2 },
  });
  assert.deepEqual(rec, {
    name: 'Salt', notes: '', bag_size_kg: 50, price_per_bag: 120, price_per_ton: 2400,
    values: { dm: 99, salt: 99.5, tdn: 0 },
  });
});

test('ingredientToRecord defaults missing pricing', () => {
  const rec = ingredientToRecord({ name: 'Water', values: {} });
  assert.equal(rec.bag_size_kg, null);
  assert.equal(rec.price_per_bag, null);
  assert.equal(rec.price_per_ton, 0);
});

test('recordToProfile maps name to full_name', () => {
  assert.deepEqual(
    recordToProfile({ id: 'u1', email: 'a@b.c', name: 'Anna', role: 'admin', verified: true }),
    { id: 'u1', email: 'a@b.c', full_name: 'Anna', role: 'admin' }
  );
});

test('recordToMix uses the expanded owner and the snapshot save time', () => {
  const snapshot = { savedAt: '2026-01-02T03:04:05.000Z', lines: [] };
  const mix = recordToMix({
    id: 'm1', name: 'Mix A', owner: 'u1', species: 'cattle', supplement_type: 'maintenance',
    lick_focus: 'protein', is_public: true, snapshot, created: '2026-09-24 10:00:00.000Z',
    expand: { owner: { name: 'Anna', email: 'a@b.c' } },
  });
  assert.deepEqual(mix, {
    id: 'm1', name: 'Mix A', ownerId: 'u1', ownerName: 'Anna', ownerEmail: 'a@b.c',
    speciesId: 'cattle', supplementTypeId: 'maintenance', lickFocus: 'protein',
    savedAt: '2026-01-02T03:04:05.000Z', snapshot, isPublic: true,
  });
});

test('recordToMix without an expanded owner or snapshot time', () => {
  const mix = recordToMix({
    id: 'm2', name: 'B', owner: 'u9', species: 'sheep', supplement_type: 'production',
    lick_focus: '', is_public: false, snapshot: {}, created: '2026-09-24 10:00:00.000Z',
  });
  assert.equal(mix.ownerName, 'Unknown');
  assert.equal(mix.ownerEmail, null);
  assert.equal(mix.lickFocus, null);
  assert.equal(mix.savedAt, '2026-09-24 10:00:00.000Z');
});

test('mergeNutrientTarget merges an existing target without mutating the input', () => {
  const list = [{ species: 'cattle', supplementType: 'maintenance', cp: 150, cpNote: 'n' }];
  const next = mergeNutrientTarget(list, { species: 'cattle', supplementType: 'maintenance', cp: 160 });
  assert.deepEqual(next, [{ species: 'cattle', supplementType: 'maintenance', cp: 160, cpNote: 'n' }]);
  assert.equal(list[0].cp, 150);
});

test('mergeNutrientTarget appends a new species/state pair', () => {
  const next = mergeNutrientTarget([], { species: 'sheep', supplementType: 'maintenance', cp: null });
  assert.deepEqual(next, [{ species: 'sheep', supplementType: 'maintenance', cp: null }]);
});

test('setNpnLimit sets one cell without mutating the input', () => {
  const map = { cattle: { maintenance: 35, production: 48 } };
  const next = setNpnLimit(map, 'cattle', 'maintenance', 40);
  assert.deepEqual(next, { cattle: { maintenance: 40, production: 48 } });
  assert.equal(map.cattle.maintenance, 35);
  assert.deepEqual(setNpnLimit({}, 'sheep', 'production', 9), { sheep: { production: 9 } });
});

test('describePbError prefers the first field error', () => {
  const err = { status: 400, response: { message: 'Failed to create record.', data: { name: { code: 'validation_not_unique', message: 'Value must be unique.' } } } };
  assert.equal(describePbError(err), 'name: Value must be unique.');
});

test('describePbError explains network failures', () => {
  assert.equal(describePbError({ status: 0, response: {} }), "Can't reach the server — check your connection.");
});

test('describePbError falls back to the server or plain message', () => {
  assert.equal(describePbError({ status: 403, response: { message: 'Only superusers can perform this action.', data: {} } }), 'Only superusers can perform this action.');
  assert.equal(describePbError(new Error('boom')), 'boom');
  assert.equal(describePbError(undefined), 'Something went wrong.');
});
