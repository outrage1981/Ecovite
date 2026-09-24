import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP_REASON, startPocketBase, createUser, clientFor, newClient } from './helpers/pocketbaseServer.mjs';

describe('PocketBase access rules', { skip: SKIP_REASON }, () => {
  let server, admin, repA, repB;
  const ids = {};
  const mixBody = (owner, extra = {}) => ({
    owner, name: 'Mix', species: 'cattle', supplement_type: 'maintenance',
    lines: [], snapshot: { savedAt: '2026-01-01T00:00:00.000Z' }, ...extra,
  });

  before(async () => {
    server = await startPocketBase({ port: 8091 });
    const su = server.superuser;
    ids.admin = (await createUser(su, { email: 'admin@test.local', role: 'admin' })).id;
    ids.repA = (await createUser(su, { email: 'a@test.local' })).id;
    ids.repB = (await createUser(su, { email: 'b@test.local' })).id;
    admin = await clientFor(server.url, 'admin@test.local');
    repA = await clientFor(server.url, 'a@test.local');
    repB = await clientFor(server.url, 'b@test.local');
    ids.ingredient = (await su.collection('ingredients').create({ name: 'Urea', is_active: true, price_per_ton: 100, values: { cp: 287 } })).id;
  });
  after(() => server?.stop());

  test('ingredients: signed-in users read, anonymous see nothing', async () => {
    assert.equal((await repA.collection('ingredients').getFullList()).length, 1);
    assert.equal((await newClient(server.url).collection('ingredients').getFullList()).length, 0);
  });

  test('ingredients: reps cannot write, admins can', async () => {
    await assert.rejects(repA.collection('ingredients').create({ name: 'Rep-made', price_per_ton: 1 }));
    await assert.rejects(repA.collection('ingredients').update(ids.ingredient, { price_per_ton: 1 }));
    const rec = await admin.collection('ingredients').create({ name: 'Admin-made', price_per_ton: 1 });
    assert.ok(rec.id);
  });

  test('ingredients: names are unique', async () => {
    await assert.rejects(admin.collection('ingredients').create({ name: 'Urea', price_per_ton: 1 }));
  });

  test('users: reps see only themselves', async () => {
    const list = await repA.collection('users').getFullList();
    assert.deepEqual(list.map((u) => u.id), [ids.repA]);
  });

  test('users: reps cannot create users or promote themselves', async () => {
    await assert.rejects(repA.collection('users').create({
      email: 'sneaky@test.local', password: 'password123', passwordConfirm: 'password123', role: 'admin',
    }));
    await assert.rejects(repA.collection('users').update(ids.repA, { role: 'admin' }));
  });

  test('users: admins see everyone with emails, can create users, cannot delete themselves', async () => {
    const list = await admin.collection('users').getFullList();
    assert.ok(list.length >= 3);
    assert.ok(list.every((u) => u.email));
    const created = await admin.collection('users').create({
      email: 'new@test.local', password: 'password123', passwordConfirm: 'password123',
      role: 'rep', verified: true, emailVisibility: true,
    });
    assert.equal(created.role, 'rep');
    await assert.rejects(admin.collection('users').delete(ids.admin));
  });

  test('mixes: you can only create mixes as yourself', async () => {
    await assert.rejects(repA.collection('mixes').create(mixBody(ids.repB)));
    assert.ok((await repA.collection('mixes').create(mixBody(ids.repA))).id);
  });

  test('mixes: private to owner + admins, public mixes visible to all signed-in users', async () => {
    const priv = await repA.collection('mixes').create(mixBody(ids.repA, { name: 'private' }));
    const pub = await admin.collection('mixes').create(mixBody(ids.admin, { name: 'public', is_public: true }));
    const bSees = (await repB.collection('mixes').getFullList()).map((m) => m.id);
    assert.ok(!bSees.includes(priv.id));
    assert.ok(bSees.includes(pub.id));
    const adminSees = (await admin.collection('mixes').getFullList()).map((m) => m.id);
    assert.ok(adminSees.includes(priv.id));
  });

  test('mixes: only the owner can delete, admins included', async () => {
    const m = await repA.collection('mixes').create(mixBody(ids.repA));
    await assert.rejects(admin.collection('mixes').delete(m.id));
    await assert.rejects(repB.collection('mixes').delete(m.id));
    await repA.collection('mixes').delete(m.id);
  });

  test('mixes: snapshot, lines and owner are immutable; is_public can change', async () => {
    const m = await repA.collection('mixes').create(mixBody(ids.repA));
    await assert.rejects(repA.collection('mixes').update(m.id, { snapshot: { tampered: true } }));
    await assert.rejects(repA.collection('mixes').update(m.id, { lines: [{ tampered: true }] }));
    await assert.rejects(repA.collection('mixes').update(m.id, { owner: ids.repB }));
    const updated = await repA.collection('mixes').update(m.id, { is_public: true });
    assert.equal(updated.is_public, true);
  });

  test('price_overrides: strictly owner-only, admins included', async () => {
    await repA.collection('price_overrides').create({ owner: ids.repA, ingredient: ids.ingredient, price_per_ton: 50 });
    assert.equal((await repA.collection('price_overrides').getFullList()).length, 1);
    assert.equal((await repB.collection('price_overrides').getFullList()).length, 0);
    assert.equal((await admin.collection('price_overrides').getFullList()).length, 0);
    await assert.rejects(repB.collection('price_overrides').create({ owner: ids.repA, ingredient: ids.ingredient, price_per_ton: 1 }));
  });

  test('settings: signed-in users read, only admins write', async () => {
    await admin.collection('settings').create({ key: 'k1', value: { a: 1 } });
    const row = await repA.collection('settings').getFirstListItem('key = "k1"');
    assert.deepEqual(row.value, { a: 1 });
    await assert.rejects(repA.collection('settings').update(row.id, { value: {} }));
    await assert.rejects(repA.collection('settings').create({ key: 'k2', value: {} }));
  });

  test('deleting a user deletes their mixes and price overrides', async () => {
    const doomed = await createUser(server.superuser, { email: 'doomed@test.local' });
    const c = await clientFor(server.url, 'doomed@test.local');
    const m = await c.collection('mixes').create(mixBody(doomed.id));
    const o = await c.collection('price_overrides').create({ owner: doomed.id, ingredient: ids.ingredient, price_per_ton: 5 });
    await admin.collection('users').delete(doomed.id);
    await assert.rejects(server.superuser.collection('mixes').getOne(m.id));
    await assert.rejects(server.superuser.collection('price_overrides').getOne(o.id));
  });
});
