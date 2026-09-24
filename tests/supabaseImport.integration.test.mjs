import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP_REASON, startPocketBase, newClient, createUser } from './helpers/pocketbaseServer.mjs';
import { transformSupabaseExport, importIntoPocketBase } from '../tools/supabaseImport.mjs';
import { createPocketBaseBackend } from '../js/pocketbaseBackend.js';
import { FIXTURE } from './fixtures/supabaseExport.mjs';

describe('Supabase import', { skip: SKIP_REASON }, () => {
  let server, result, userCreatedCalls;
  before(async () => {
    server = await startPocketBase({ port: 8094 });
    let n = 0;
    userCreatedCalls = [];
    result = await importIntoPocketBase(server.superuser, transformSupabaseExport(FIXTURE), {
      generatePassword: () => `temp-password-${++n}`,
      onUserCreated: (p) => userCreatedCalls.push(p),
    });
  });
  after(() => server?.stop());

  test('reports counts and temporary passwords', () => {
    // 'Orphan' (owner_id 'u-ghost') has no matching profile, so it's counted
    // as skipped for an unknown owner rather than imported.
    assert.deepEqual(result.counts, { users: 2, ingredients: 2, priceOverrides: 1, mixes: 2, mixesSkippedUnknownOwner: 1 });
    assert.deepEqual(result.tempPasswords.map((p) => p.email), ['ada@test.local', 'rep@test.local']);
  });

  test('onUserCreated fires once per user with the same email/password pairs as tempPasswords', () => {
    assert.deepEqual(userCreatedCalls, result.tempPasswords);
  });

  test('an imported rep signs in and sees their data with remapped ingredient ids', async () => {
    const pw = result.tempPasswords.find((p) => p.email === 'rep@test.local').password;
    const rep = createPocketBaseBackend(newClient(server.url));
    await rep.signIn('rep@test.local', pw);

    const urea = (await rep.listIngredients()).find((i) => i.name === 'Urea');
    assert.equal(urea.values.cp, 287);
    assert.deepEqual(await rep.getPriceOverrides(), { [urea.id]: 12000 });

    // Order is covered by the transform unit test; two creates can land in
    // the same millisecond here, so only check membership.
    const mixes = await rep.listSavedMixes();
    assert.deepEqual(mixes.map((m) => m.name).sort(), ['Newer', 'Older']);
    const older = mixes.find((m) => m.name === 'Older');
    assert.equal(older.snapshot.lines[0].ingredientId, urea.id);
    assert.equal(older.isPublic, true);

    assert.deepEqual(await rep.getNpnSafetyLimits(), { cattle: { maintenance: 35 }, sheep: { production: 9 } });
    assert.deepEqual(await rep.getNutrientTargets(), [
      { species: 'cattle', supplementType: 'maintenance', cp: 150, cpNote: 'note', me: null, meNote: null, p: 6, pNote: null },
    ]);
    assert.deepEqual(await rep.getProductionTargets(), { cattle: { protein: 350, energy: 7 } });
  });

  test('refuses to import into a database that already has ingredients', async () => {
    await assert.rejects(
      importIntoPocketBase(server.superuser, transformSupabaseExport(FIXTURE), { generatePassword: () => 'x-password-1' }),
      /already has ingredients/
    );
  });
});

describe('Supabase import users guard', { skip: SKIP_REASON }, () => {
  let server;
  before(async () => {
    server = await startPocketBase({ port: 8095 });
    await createUser(server.superuser, { email: 'existing@test.local' });
  });
  after(() => server?.stop());

  test('refuses to import into a database that already has users, even with no ingredients yet', async () => {
    await assert.rejects(
      importIntoPocketBase(server.superuser, transformSupabaseExport(FIXTURE), { generatePassword: () => 'x-password-1' }),
      /already has ingredients/
    );
  });
});
