import test from 'node:test';
import assert from 'node:assert/strict';
import { withOfflineMixQueue, newRecordId, mergePending } from '../js/offlineMixQueue.js';

const USER = { id: 'u1', email: 'rep@example.com', full_name: 'Rep One' };
const offlineErr = () => Object.assign(new Error('offline'), { status: 0 });

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// A fake server-side mixes store whose connectivity the test controls.
function fakeBackend() {
  const mixes = new Map();
  const fake = {
    online: true,
    mixes,
    calls: [],
    async saveMix(p) {
      fake.calls.push(['save', p.id]);
      if (!fake.online) throw offlineErr();
      if (mixes.has(p.id)) throw Object.assign(new Error('id: Value must be unique.'), { status: 400, data: { id: { code: 'validation_not_unique' } } });
      const mix = { id: p.id, name: p.name, ownerId: USER.id, snapshot: p.snapshot, savedAt: p.snapshot?.savedAt };
      mixes.set(p.id, mix);
      return mix;
    },
    async deleteSavedMix(id) {
      fake.calls.push(['delete', id]);
      if (!fake.online) throw offlineErr();
      if (!mixes.delete(id)) throw Object.assign(new Error('not found'), { status: 404 });
    },
    async listSavedMixes() {
      if (!fake.online) throw offlineErr();
      return [...mixes.values()].reverse();
    },
    async setMixPublic() {},
  };
  return fake;
}

const setup = () => {
  const server = fakeBackend();
  const changes = [];
  const backend = withOfflineMixQueue(server, { storage: memoryStorage(), getUser: () => USER, onChange: (n) => changes.push(n) });
  return { server, backend, changes };
};
const payload = (name) => ({ name, speciesId: 'cattle', supplementTypeId: 'maintenance', lickFocus: 'phosphorus', lines: [], snapshot: { savedAt: '2026-10-13T10:00:00.000Z' } });

test('newRecordId makes 15-char PocketBase-style ids', () => {
  const id = newRecordId();
  assert.match(id, /^[a-z0-9]{15}$/);
  assert.notEqual(id, newRecordId());
});

test('online save goes straight to the server with a device-picked id', async () => {
  const { server, backend } = setup();
  const mix = await backend.saveMix(payload('A'));
  assert.ok(!mix.pending);
  assert.ok(server.mixes.has(mix.id));
  assert.equal(backend.pendingMixCount(), 0);
});

test('offline save is queued, listed as pending, then uploaded once online', async () => {
  const { server, backend, changes } = setup();
  server.online = false;
  const mix = await backend.saveMix(payload('Field lick'));
  assert.equal(mix.pending, true);
  assert.equal(mix.ownerId, USER.id);
  assert.equal(backend.pendingMixCount(), 1);

  const offlineList = await backend.listSavedMixes();
  assert.deepEqual(offlineList.map((m) => [m.name, m.pending]), [['Field lick', true]]);

  server.online = true;
  const list = await backend.listSavedMixes();
  assert.equal(backend.pendingMixCount(), 0);
  assert.deepEqual(list.map((m) => [m.id, m.pending]), [[mix.id, undefined]]);
  assert.deepEqual(changes, [1, 0]);
});

test('a retry after a lost reply does not create a second copy', async () => {
  const { server, backend } = setup();
  server.online = false;
  const mix = await backend.saveMix(payload('A'));
  // The upload reached the server, but the device never heard back.
  server.mixes.set(mix.id, { id: mix.id, name: 'A' });
  server.online = true;
  assert.equal(await backend.flushPendingMixes(), 0);
  assert.equal(server.mixes.size, 1);
});

test('override offline: queued delete + create replay in order and hide the old mix', async () => {
  const { server, backend } = setup();
  const old = await backend.saveMix(payload('Same name'));
  server.online = false;
  await backend.deleteSavedMix(old.id);
  const replacement = await backend.saveMix(payload('Same name'));

  // Still offline when History loads.
  const offlineList = await backend.listSavedMixes();
  assert.deepEqual(offlineList.map((m) => m.id), [replacement.id]);

  server.online = true;
  await backend.flushPendingMixes();
  assert.deepEqual([...server.mixes.keys()], [replacement.id]);
});

test('deleting a mix that never uploaded just drops it from the queue', async () => {
  const { server, backend } = setup();
  server.online = false;
  const mix = await backend.saveMix(payload('Oops'));
  await backend.deleteSavedMix(mix.id);
  assert.equal(backend.pendingMixCount(), 0);
  server.online = true;
  await backend.flushPendingMixes();
  assert.deepEqual(server.calls.filter(([op]) => op === 'delete'), []);
});

test('real server errors still throw and are never queued', async () => {
  const { server, backend } = setup();
  server.saveMix = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); };
  await assert.rejects(backend.saveMix(payload('A')), /forbidden/);
  assert.equal(backend.pendingMixCount(), 0);
});

test('a queued op the server rejects is kept with its error, not lost or retried forever silently', async () => {
  const { server, backend } = setup();
  server.online = false;
  await backend.saveMix(payload('Bad'));
  server.online = true;
  server.saveMix = async () => { throw Object.assign(new Error('name: too long'), { status: 400, data: { name: {} } }); };
  await backend.flushPendingMixes();
  const [mix] = await backend.listSavedMixes();
  assert.equal(mix.pending, true);
  assert.equal(mix.uploadError, 'name: too long');
});

test('a save made while the queue is uploading is not lost', async () => {
  const { server, backend } = setup();
  server.online = false;
  await backend.saveMix(payload('First'));
  server.online = true;
  const realSave = server.saveMix;
  let midFlushSave;
  server.saveMix = async (p) => {
    server.saveMix = realSave;
    server.online = false;
    midFlushSave = backend.saveMix(payload('Second')); // queued while flush awaits
    await midFlushSave;
    server.online = true;
    return realSave(p);
  };
  await backend.flushPendingMixes();
  await midFlushSave;
  assert.equal(backend.pendingMixCount(), 1);
  await backend.flushPendingMixes();
  assert.deepEqual([...server.mixes.values()].map((m) => m.name).sort(), ['First', 'Second']);
});

test('setMixPublic refuses a mix that has not uploaded yet', async () => {
  const { server, backend } = setup();
  server.online = false;
  const mix = await backend.saveMix(payload('A'));
  await assert.rejects(backend.setMixPublic(mix.id, true), /hasn't been uploaded yet/);
});

test('mergePending puts pending mixes first, newest first', () => {
  const ops = [
    { op: 'create', id: 'a', payload: payload('older'), queuedAt: '1' },
    { op: 'create', id: 'b', payload: payload('newer'), queuedAt: '2' },
  ];
  const merged = mergePending([{ id: 's', name: 'server' }], ops, USER);
  assert.deepEqual(merged.map((m) => m.id), ['b', 'a', 's']);
});
