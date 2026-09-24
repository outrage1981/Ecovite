import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP_REASON, startPocketBase, newClient } from './helpers/pocketbaseServer.mjs';
import { transformSupabaseExport, importIntoPocketBase } from '../tools/supabaseImport.mjs';
import { createPocketBaseBackend } from '../js/pocketbaseBackend.js';
import { FIXTURE } from './fixtures/supabaseExport.mjs';

describe('Supabase import', { skip: SKIP_REASON }, () => {
  let server, result;
  before(async () => {
    server = await startPocketBase({ port: 8094 });
    let n = 0;
    result = await importIntoPocketBase(server.superuser, transformSupabaseExport(FIXTURE), {
      generatePassword: () => `temp-password-${++n}`,
    });
  });
  after(() => server?.stop());

  test('reports counts and temporary passwords', () => {
    assert.deepEqual(result.counts, { users: 2, ingredients: 2, mixes: 2 });
    assert.deepEqual(result.tempPasswords.map((p) => p.email), ['ada@test.local', 'rep@test.local']);
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
  });

  test('refuses to import into a database that already has ingredients', async () => {
    await assert.rejects(
      importIntoPocketBase(server.superuser, transformSupabaseExport(FIXTURE), { generatePassword: () => 'x-password-1' }),
      /already has ingredients/
    );
  });
});
