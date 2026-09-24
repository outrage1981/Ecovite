import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP_REASON, startPocketBase } from './helpers/pocketbaseServer.mjs';
import { seed } from '../tools/seed-pocketbase.mjs';
import { INGREDIENTS, NPN_SAFETY_LIMITS, NUTRIENT_TARGETS, PRODUCTION_TARGETS } from '../js/seedData.js';

describe('seed', { skip: SKIP_REASON }, () => {
  let server;
  before(async () => { server = await startPocketBase({ port: 8093 }); });
  after(() => server?.stop());

  test('fills an empty database', async () => {
    const result = await seed(server.superuser);
    assert.deepEqual(result, { ingredientsCreated: INGREDIENTS.length, settingsCreated: 3 });
    const ingredients = await server.superuser.collection('ingredients').getFullList();
    assert.equal(ingredients.length, INGREDIENTS.length);
    assert.ok(ingredients.every((i) => i.is_active));
    const urea = ingredients.find((i) => i.name === 'Urea');
    assert.equal(urea.price_per_ton, 11000);
    assert.equal(urea.values.cp, 287);
    assert.equal('fat' in urea.values, false);
    const get = async (key) => (await server.superuser.collection('settings').getFirstListItem(`key = "${key}"`)).value;
    assert.deepEqual(await get('npn_safety_limits'), NPN_SAFETY_LIMITS);
    assert.deepEqual(await get('nutrient_targets'), NUTRIENT_TARGETS);
    assert.deepEqual(await get('production_targets'), PRODUCTION_TARGETS);
  });

  test('running it again changes nothing', async () => {
    assert.deepEqual(await seed(server.superuser), { ingredientsCreated: 0, settingsCreated: 0 });
  });
});
