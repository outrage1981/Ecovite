import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSupabaseExport, remapIngredientIds } from '../tools/supabaseImport.mjs';
import { FIXTURE } from './fixtures/supabaseExport.mjs';

test('transform maps users, ingredients and overrides', () => {
  const out = transformSupabaseExport(FIXTURE);
  assert.deepEqual(out.users, [
    { oldId: 'u-admin', email: 'ada@test.local', name: 'Ada', role: 'admin' },
    { oldId: 'u-rep', email: 'rep@test.local', name: '', role: 'rep' },
  ]);
  assert.deepEqual(out.ingredients[0], {
    oldId: 'i-urea',
    record: { name: 'Urea', is_active: true, notes: '', bag_size_kg: 50, price_per_bag: 550, price_per_ton: 11000, values: { cp: 287, tdn: 0 } },
  });
  assert.deepEqual(out.ingredients[1].record.values, {});
  assert.equal(out.ingredients[1].record.is_active, false);
  assert.deepEqual(out.priceOverrides, [{ oldOwnerId: 'u-rep', oldIngredientId: 'i-urea', price_per_ton: 12000 }]);
});

test('transform maps settings into the app shapes', () => {
  const { settings } = transformSupabaseExport(FIXTURE);
  assert.deepEqual(settings.npn_safety_limits, { cattle: { maintenance: 35 }, sheep: { production: 9 } });
  assert.deepEqual(settings.nutrient_targets, [
    { species: 'cattle', supplementType: 'maintenance', cp: 150, cpNote: 'note', me: null, meNote: null, p: 6, pNote: null },
  ]);
  assert.deepEqual(settings.production_targets, { cattle: { protein: 350, energy: 7 } });
});

test('transform orders mixes oldest first, uses the latest snapshot, skips snapshot-less mixes', () => {
  const out = transformSupabaseExport(FIXTURE);
  assert.deepEqual(out.mixes.map((m) => m.name), ['Older', 'Newer']);
  assert.equal(out.skippedMixes, 1);
  assert.deepEqual(out.mixes[0], {
    oldOwnerId: 'u-rep', name: 'Older', species: 'cattle', supplement_type: 'maintenance',
    lick_focus: 'protein', is_public: true,
    lines: [{ ingredientId: 'i-urea', inclusionPct: 100, costPerTon: 11000 }],
    snapshot: { savedAt: '2026-01-01T00:00:00Z', lines: [{ ingredientId: 'i-urea' }] },
  });
  assert.equal(out.mixes[1].snapshot.savedAt, 'second');
  assert.equal(out.mixes[1].lick_focus, '');
});

test('remapIngredientIds rewrites lines and snapshot lines, leaves unknown ids', () => {
  const mix = { lines: [{ ingredientId: 'i-urea' }, { ingredientId: 'gone' }], snapshot: { savedAt: 'x', lines: [{ ingredientId: 'i-urea', ingredientName: 'Urea' }] } };
  const out = remapIngredientIds(mix, new Map([['i-urea', 'pb123']]));
  assert.deepEqual(out.lines, [{ ingredientId: 'pb123' }, { ingredientId: 'gone' }]);
  assert.deepEqual(out.snapshot, { savedAt: 'x', lines: [{ ingredientId: 'pb123', ingredientName: 'Urea' }] });
  assert.equal(mix.lines[0].ingredientId, 'i-urea');
});
