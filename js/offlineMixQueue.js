// Offline save queue for mixes. Wraps the PocketBase backend (js/db.js)
// so a rep with no signal can still save, override and delete mixes: when
// one of those calls fails *only* because the server can't be reached
// (status 0), it's recorded in a per-user queue in localStorage instead,
// and replayed in order the next time the app can reach the server
// (reconnect, app start, or any listSavedMixes()). Real errors — a 403,
// a validation failure — still throw exactly as before.
//
// Retries are safe: each mix gets its PocketBase record id on the device
// before the first upload attempt, so if a create reached the server but
// the reply was lost, the retry is rejected as a duplicate id (treated as
// done) instead of creating a second copy. A delete that 404s is likewise
// already done. The id never changes, so History favourites keep working
// across the upload.
//
// Pending mixes are merged into listSavedMixes() with `pending: true`, so
// History shows them and rep.js's duplicate-name check sees them.

export const PENDING_CHANGED_EVENT = 'ecovite:pending-mixes-changed';

const isNetworkError = (err) => err?.status === 0;
const isDuplicateId = (err) => err?.status === 400 && err?.data?.id?.code === 'validation_not_unique';

// PocketBase record ids: 15 chars of [a-z0-9].
export function newRecordId(randomValues = (a) => globalThis.crypto.getRandomValues(a)) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomValues(new Uint8Array(15)), (b) => alphabet[b % alphabet.length]).join('');
}

export function pendingToMix(op, user) {
  const p = op.payload;
  return {
    id: op.id,
    name: p.name,
    ownerId: user.id,
    ownerName: user.full_name || null,
    ownerEmail: user.email ?? null,
    speciesId: p.speciesId,
    supplementTypeId: p.supplementTypeId,
    lickFocus: p.lickFocus || null,
    savedAt: p.snapshot?.savedAt ?? op.queuedAt,
    snapshot: p.snapshot,
    isPublic: false,
    pending: true,
    uploadError: op.error ?? null,
  };
}

// `serverMixes` is null when the server couldn't be reached.
export function mergePending(serverMixes, ops, user) {
  const deleted = new Set(ops.filter((o) => o.op === 'delete').map((o) => o.id));
  const fromServer = (serverMixes || []).filter((m) => !deleted.has(m.id));
  const onServer = new Set(fromServer.map((m) => m.id));
  const pending = ops
    .filter((o) => o.op === 'create' && !onServer.has(o.id))
    .map((o) => pendingToMix(o, user));
  // Newest first, matching the server's '-created' sort.
  return [...pending.reverse(), ...fromServer];
}

export function withOfflineMixQueue(backend, { storage, getUser, onChange = () => {}, now = () => new Date().toISOString() }) {
  const keyFor = (userId) => `ecovite.pendingMixOps.v1.${userId}`;

  function readOps(userId) {
    try {
      return JSON.parse(storage.getItem(keyFor(userId)) || '[]');
    } catch {
      return [];
    }
  }

  function writeOps(userId, ops) {
    try {
      if (ops.length) storage.setItem(keyFor(userId), JSON.stringify(ops));
      else storage.removeItem(keyFor(userId));
    } catch {
      throw new Error("Couldn't save on this device (its storage is full) — reconnect and try again.");
    }
    onChange(ops.length);
  }

  function requireUser() {
    const user = getUser();
    if (!user) throw new Error('Not signed in.');
    return user;
  }

  let flushing = null;

  // Replays the queue in order. Stops at the first network failure (still
  // offline — try again later); any other failure is recorded on that op
  // and skipped so one bad entry can't block the rest.
  async function flushPendingMixes() {
    if (flushing) return flushing;
    flushing = (async () => {
      const user = getUser();
      if (!user) return 0;
      // Always re-read before writing: a save made while this loop awaits
      // the network appends to the stored queue, and must not be lost.
      const same = (a, b) => a.op === b.op && a.id === b.id;
      for (const op of readOps(user.id)) {
        try {
          if (op.op === 'create') await backend.saveMix({ ...op.payload, id: op.id });
          else await backend.deleteSavedMix(op.id);
        } catch (err) {
          if (isNetworkError(err)) break;
          const alreadyDone = op.op === 'create' ? isDuplicateId(err) : err?.status === 404;
          if (!alreadyDone) {
            const error = err.message || 'Upload failed.';
            writeOps(user.id, readOps(user.id).map((o) => (same(o, op) ? { ...o, error } : o)));
            continue;
          }
        }
        writeOps(user.id, readOps(user.id).filter((o) => !same(o, op)));
      }
      return readOps(user.id).length;
    })();
    try {
      return await flushing;
    } finally {
      flushing = null;
    }
  }

  return {
    ...backend,

    flushPendingMixes,

    pendingMixCount() {
      const user = getUser();
      return user ? readOps(user.id).length : 0;
    },

    async saveMix(payload) {
      const user = requireUser();
      const id = newRecordId();
      try {
        return await backend.saveMix({ ...payload, id });
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        const op = { op: 'create', id, payload, queuedAt: now() };
        writeOps(user.id, [...readOps(user.id), op]);
        return pendingToMix(op, user);
      }
    },

    async deleteSavedMix(id) {
      const user = requireUser();
      const ops = readOps(user.id);
      if (ops.some((o) => o.op === 'create' && o.id === id)) {
        // Never reached the server: just drop it from the queue.
        writeOps(user.id, ops.filter((o) => o.id !== id));
        return;
      }
      try {
        await backend.deleteSavedMix(id);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        writeOps(user.id, [...ops, { op: 'delete', id, queuedAt: now() }]);
      }
    },

    async listSavedMixes() {
      const user = requireUser();
      await flushPendingMixes().catch(() => {});
      let serverMixes = null;
      try {
        serverMixes = await backend.listSavedMixes();
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
      const merged = mergePending(serverMixes, readOps(user.id), user);
      // Offline with nothing queued: keep the old behaviour (callers
      // already .catch() this into an empty list).
      if (serverMixes === null && merged.length === 0) {
        throw Object.assign(new Error("Can't reach the server — check your connection."), { status: 0 });
      }
      return merged;
    },

    async setMixPublic(id, isPublic) {
      const user = requireUser();
      if (readOps(user.id).some((o) => o.op === 'create' && o.id === id)) {
        throw new Error("This mix hasn't been uploaded yet — try again once you're back online.");
      }
      return backend.setMixPublic(id, isPublic);
    },
  };
}
