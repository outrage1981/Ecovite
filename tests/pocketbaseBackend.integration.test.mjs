import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP_REASON, startPocketBase, createUser, newClient } from './helpers/pocketbaseServer.mjs';
import { seed } from '../tools/seed-pocketbase.mjs';
import { createPocketBaseBackend } from '../js/pocketbaseBackend.js';
import { NUTRIENTS, SPECIES, SUPPLEMENT_TYPES, NPN_SAFETY_LIMITS, PRODUCTION_TARGETS } from '../js/seedData.js';

describe('createPocketBaseBackend', { skip: SKIP_REASON }, () => {
  let server, adminB, repA, repB;
  const backendFor = async (email, password = 'password123') => {
    const b = createPocketBaseBackend(newClient(server.url));
    await b.signIn(email, password);
    return b;
  };
  const snapshot = (name) => ({ mixName: name, savedAt: '2026-03-01T08:00:00.000Z', lines: [], result: { costPerTon: 1 } });

  before(async () => {
    server = await startPocketBase({ port: 8092 });
    await seed(server.superuser);
    await createUser(server.superuser, { email: 'admin@test.local', role: 'admin', name: 'Ada Admin' });
    await createUser(server.superuser, { email: 'a@test.local', name: 'Rep A' });
    await createUser(server.superuser, { email: 'b@test.local', name: 'Rep B' });
    adminB = await backendFor('admin@test.local');
    repA = await backendFor('a@test.local');
    repB = await backendFor('b@test.local');
  });
  after(() => server?.stop());

  test('signIn + getProfile return the app profile shape', async () => {
    const profile = await repA.getProfile();
    assert.equal(profile.email, 'a@test.local');
    assert.equal(profile.full_name, 'Rep A');
    assert.equal(profile.role, 'rep');
    assert.ok(profile.id);
    assert.equal(repA.mode, 'pocketbase');
  });

  test('a wrong password gives a readable error', async () => {
    const b = createPocketBaseBackend(newClient(server.url));
    await assert.rejects(b.signIn('a@test.local', 'nope-nope'), { message: 'Incorrect email or password.' });
  });

  test('signOut clears the session', async () => {
    const b = await backendFor('a@test.local');
    await b.signOut();
    assert.equal(await b.getProfile(), null);
  });

  test('reference data comes from seedData', async () => {
    assert.deepEqual(await repA.listNutrients(), NUTRIENTS);
    assert.deepEqual(await repA.listSpecies(), SPECIES);
    assert.deepEqual(await repA.listSupplementTypes(), SUPPLEMENT_TYPES);
  });

  test('listIngredients returns seeded ingredients in app shape', async () => {
    const list = await repA.listIngredients();
    assert.equal(list.length, 28);
    const urea = list.find((i) => i.name === 'Urea');
    assert.equal(urea.pricePerTon, 11000);
    assert.equal(urea.bagSizeKg, 50);
    assert.equal(urea.values.cp, 287);
    assert.equal(urea.values.fat, null);
    assert.equal(urea.values.npn, null);
  });

  test('admins create and update ingredients; updatedAt moves', async () => {
    const before = await adminB.getIngredientsUpdatedAt();
    await new Promise((r) => setTimeout(r, 20));
    await adminB.upsertIngredient({ name: 'Test Meal', notes: null, bagSizeKg: 40, pricePerBag: 200, pricePerTon: 5000, values: { cp: 30, fat: null } });
    let created = (await adminB.listIngredients()).find((i) => i.name === 'Test Meal');
    assert.equal(created.is_active, true);
    assert.equal(created.values.cp, 30);
    const after1 = await adminB.getIngredientsUpdatedAt();
    assert.notEqual(after1, before);

    await adminB.upsertIngredient({ ...created, pricePerTon: 5500 });
    created = (await adminB.listIngredients()).find((i) => i.name === 'Test Meal');
    assert.equal(created.pricePerTon, 5500);
  });

  test('duplicate ingredient names give a readable error', async () => {
    await assert.rejects(adminB.upsertIngredient({ name: 'Urea', values: {} }), /name/);
  });

  test('reps cannot edit ingredients', async () => {
    await assert.rejects(repA.upsertIngredient({ name: 'Rep Meal', values: {} }));
  });

  test('inactive ingredients are hidden unless asked for', async () => {
    const salt = (await adminB.listIngredients()).find((i) => i.name === 'Salt');
    await adminB.setIngredientActive(salt.id, false);
    assert.equal((await repA.listIngredients()).some((i) => i.name === 'Salt'), false);
    assert.equal((await adminB.listIngredients({ includeInactive: true })).some((i) => i.name === 'Salt'), true);
    await adminB.setIngredientActive(salt.id, true);
  });

  test('settings round-trip', async () => {
    assert.deepEqual(await repA.getNpnSafetyLimits(), NPN_SAFETY_LIMITS);
    await adminB.upsertNpnSafetyLimit('cattle', 'maintenance', 40);
    assert.deepEqual(await repA.getNpnSafetyLimits(), { ...NPN_SAFETY_LIMITS, cattle: { maintenance: 40, production: 48 } });

    await adminB.upsertNutrientTarget({ species: 'sheep', supplementType: 'maintenance', cp: 20, me: null, p: null, cpNote: '', meNote: '', pNote: '' });
    const targets = await repA.getNutrientTargets();
    assert.equal(targets.length, 3);
    assert.equal(targets.find((t) => t.species === 'sheep').cp, 20);
    assert.equal(targets.find((t) => t.species === 'sheep').me, null);

    await adminB.upsertProductionTarget('sheep', 45, null);
    assert.deepEqual(await repA.getProductionTargets(), { ...PRODUCTION_TARGETS, sheep: { protein: 45, energy: null } });
  });

  test('reps cannot change settings', async () => {
    await assert.rejects(repA.upsertNpnSafetyLimit('cattle', 'maintenance', 999));
  });

  test('price overrides are per rep and upsert in place', async () => {
    const urea = (await repA.listIngredients()).find((i) => i.name === 'Urea');
    await repA.setPriceOverride(urea.id, 12000);
    await repA.setPriceOverride(urea.id, 12500);
    assert.deepEqual(await repA.getPriceOverrides(), { [urea.id]: 12500 });
    assert.deepEqual(await repB.getPriceOverrides(), {});
  });

  test('saveMix / listSavedMixes / setMixPublic / deleteSavedMix', async () => {
    const saved = await repA.saveMix({ name: 'A private', speciesId: 'cattle', supplementTypeId: 'maintenance', lickFocus: 'protein', lines: [{ ingredientId: 'x', inclusionPct: 100, costPerTon: 1 }], snapshot: snapshot('A private') });
    assert.equal(saved.name, 'A private');

    const mine = await repA.listSavedMixes();
    const m = mine.find((x) => x.id === saved.id);
    assert.equal(m.ownerName, 'Rep A');
    assert.equal(m.ownerEmail, 'a@test.local');
    assert.equal(m.lickFocus, 'protein');
    assert.equal(m.savedAt, '2026-03-01T08:00:00.000Z');
    assert.deepEqual(m.snapshot, snapshot('A private'));
    assert.equal(m.isPublic, false);

    assert.equal((await repB.listSavedMixes()).some((x) => x.id === saved.id), false);
    assert.equal((await adminB.listSavedMixes()).some((x) => x.id === saved.id), true);

    await repA.setMixPublic(saved.id, true);
    assert.equal((await repB.listSavedMixes()).some((x) => x.id === saved.id), true);

    await assert.rejects(adminB.deleteSavedMix(saved.id));
    await repA.deleteSavedMix(saved.id);
    assert.equal((await repA.listSavedMixes()).some((x) => x.id === saved.id), false);
  });

  test('saveMix without a lick focus stores null', async () => {
    const saved = await repA.saveMix({ name: 'No focus', speciesId: 'sheep', supplementTypeId: 'production', lines: [], snapshot: snapshot('No focus') });
    assert.equal((await repA.listSavedMixes()).find((x) => x.id === saved.id).lickFocus, null);
  });

  test('listSavedMixes is newest first', async () => {
    const first = await repB.saveMix({ name: 'older', speciesId: 'cattle', supplementTypeId: 'maintenance', lines: [], snapshot: snapshot('older') });
    await new Promise((r) => setTimeout(r, 20));
    const second = await repB.saveMix({ name: 'newer', speciesId: 'cattle', supplementTypeId: 'maintenance', lines: [], snapshot: snapshot('newer') });
    const ids = (await repB.listSavedMixes()).map((x) => x.id);
    assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id));
  });

  test('admins manage users; reps cannot', async () => {
    const created = await adminB.createUser({ email: 'c@test.local', password: 'password123', fullName: 'Rep C', role: 'rep' });
    assert.deepEqual({ email: created.email, full_name: created.full_name, role: created.role }, { email: 'c@test.local', full_name: 'Rep C', role: 'rep' });
    const users = await adminB.listUsers();
    assert.ok(users.some((u) => u.email === 'c@test.local'));
    assert.deepEqual(users.map((u) => u.email), [...users.map((u) => u.email)].sort());
    await assert.rejects(repA.createUser({ email: 'd@test.local', password: 'password123', fullName: '', role: 'admin' }));

    const c = await backendFor('c@test.local');
    await adminB.deleteUser(created.id);
    assert.equal(await c.getProfile(), null);
  });
});
