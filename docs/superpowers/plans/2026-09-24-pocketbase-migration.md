# PocketBase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase with a self-hosted PocketBase server that runs as a single CapRover app, serves the static front-end, and keeps every current feature (logins, roles, ingredient DB, settings, saved mixes, password reset, offline use, demo mode).

**Architecture:** One Docker container runs the PocketBase binary. It serves the existing static app from `pb_public/` and its REST API under `/api/` on the same origin, so no CORS is needed. The schema and access rules live in a PocketBase JS migration (`pb_migrations/`). In the browser, `js/db.js` swaps its Supabase backend for a new `createPocketBaseBackend(pb)` (`js/pocketbaseBackend.js`) that implements the same method set the rest of the app already calls. Pure record↔app-shape conversion lives in `js/pocketbaseMappers.js` so it can be unit-tested in Node.

**Tech Stack:** PocketBase v0.35.0 server (SQLite), PocketBase JS SDK 0.26.2 (vendored ES module), plain browser ES modules (no build step), Node 24 `node:test` for tests (dev-only, zero npm dependencies), Docker + CapRover.

**Spec:** There is no separate spec document. This plan is based on the planning conversation of 2026-09-24, and the decisions from it are recorded under **Design decisions** below. Executors read that section before any task.

## Global Constraints

- PocketBase server version: **0.35.0**. The default `$Version` in `tools/get-pocketbase.ps1` and `ARG PB_VERSION` in `Dockerfile` must always be the same value.
- PocketBase JS SDK: **0.26.2**, vendored at `js/vendor/pocketbase.es.mjs`. The app must never load the SDK from a CDN at runtime, because it has to work offline.
- No build step. The app stays plain static HTML/CSS/ES modules. Node is only for tests and one-off scripts, and there are no npm dependencies. The root `package.json` exists only for `"type": "module"` and test scripts.
- The backend method names and return shapes used by `js/app.js`, `js/rep.js`, `js/admin.js`, `js/history.js` and `js/users.js` must not change. The one exception is that `updatePassword(newPassword)` is replaced by `confirmPasswordReset(token, newPassword)`.
- Demo mode (in-browser localStorage data, `admin@demo.local` / `admin123`) must keep working. After this migration it is enabled by opening the app with `?demo` in the URL.
- Superuser passwords, the Supabase service-role key and exported user data must never be committed. `migration-export/`, `tools/bin/` and `pb_data/` are gitignored.
- SQLite means exactly **one** CapRover instance, with persistent directory `/pb/pb_data`.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Design decisions

These decisions come from the conversation and from reading the code. They are settled; don't revisit them.

1. **Same-origin hosting.** PocketBase serves the app (`--publicDir`) and the API. `js/config.js` uses `location.origin` as the server URL. There's no CORS, one domain and one HTTPS certificate.
2. **Collections (5, down from Supabase's 13 tables):**
   - `users`: the built-in auth collection, plus `name` (text) and `role` (select `rep`|`admin`, required). This replaces Supabase `auth.users` + `profiles`.
   - `ingredients`: nutrient values are stored as one JSON field, `values`, instead of the `ingredient_nutrients` table. A key that is absent or null means "no data" and `0` means an analysed zero, so the missing-data vs zero distinction is kept.
   - `price_overrides`: each rep's own custom price per ingredient.
   - `settings`: key/value JSON rows `npn_safety_limits`, `nutrient_targets` and `production_targets`, in exactly the shapes the demo store already uses. Target numbers must be nullable (blank = "not set yet"), and PocketBase number fields can't hold null (they store 0), which would silently turn a blank target into a real target of 0. So they live in JSON.
   - `mixes`: `lines` and `snapshot` are JSON fields on the mix row instead of the `mix_lines` and `mix_snapshots` tables. The app always writes them together and only ever reads the snapshot.
3. **Nutrients, species and supplement types are not stored in the database.** The admin UI never edits them, so the PocketBase backend returns the `NUTRIENTS`, `SPECIES` and `SUPPLEMENT_TYPES` constants from `js/seedData.js`, as demo mode already does.
4. **Access rules replicate `sql/002_rls_policies.sql` exactly:**
   - Reps read reference data; admins write it.
   - A mix is visible to its owner, to admins, and to everyone if `is_public`.
   - Only the owner can delete a mix, admins included.
   - Snapshots are immutable.
   - Price overrides are owner-only, admins included.
   - Only admins can create or delete users (not their own account) or change roles.
   - The `users` collection's `manageRule` lets admins create users with `verified: true` and set passwords, which replaces the `admin-users` Supabase Edge Function.
5. **Password reset:** the email links to `{APP_URL}/#reset-password={TOKEN}`. `js/app.js` detects that hash and calls `confirmPasswordReset`. SMTP and the Application URL are set in the PocketBase dashboard at deploy time.
6. **Offline:** the SDK is vendored and added to the service-worker shell. The service worker must **not** intercept `/api/` or `/_/` (same origin now). User auth tokens last 30 days. `getProfile()` refreshes the token when online and keeps the cached session when offline.
7. **Nullable price numbers:** `bag_size_kg` and `price_per_bag` are PocketBase number fields, so an empty value is stored as `0`. The mapper turns `0` back into `null`, because a bag size or bag price of 0 is meaningless.
8. **Existing Supabase data** (users, ingredients, settings, saved mixes) is moved by an export script (Supabase REST + service-role key) and an import script (PocketBase superuser). Supabase password hashes can't be moved. Imported users get random temporary passwords, written to a gitignored CSV, and they can then use "Forgot password".

## File structure

| Path | Status | Responsibility |
|---|---|---|
| `package.json` | Create | `"type": "module"` + `test` / `test:unit` scripts. No dependencies. |
| `.gitignore` | Modify | Ignore `tools/bin/`, `pb_data/`, `migration-export/` |
| `tools/get-pocketbase.ps1` | Create | Download the pinned PocketBase Windows binary to `tools/bin/` |
| `tools/dev-pocketbase.ps1` | Create | Run PocketBase locally, serving the project folder |
| `js/vendor/pocketbase.es.mjs` | Create (vendored) | PocketBase JS SDK |
| `js/pocketbaseMappers.js` | Create | Pure conversions between PocketBase records and app shapes + error text |
| `js/pocketbaseBackend.js` | Create | `createPocketBaseBackend(pb)`: the full backend method set |
| `pb_migrations/1790200000_ecovite_schema.js` | Create | Collections, fields, indexes, access rules, auth settings, reset email |
| `tools/seed-pocketbase.mjs` | Create | Seed settings + 28 ingredients from `js/seedData.js` (idempotent) |
| `tools/export-supabase.mjs` | Create | Dump all Supabase tables to `migration-export/supabase-export.json` |
| `tools/supabaseImport.mjs` | Create | Pure transform + import into PocketBase with id remapping |
| `tools/import-supabase-export.mjs` | Create | CLI wrapper around `tools/supabaseImport.mjs` |
| `tests/helpers/pocketbaseServer.mjs` | Create | Start/stop a throwaway PocketBase for integration tests |
| `tests/pocketbaseMappers.test.mjs` | Create | Unit tests |
| `tests/accessRules.integration.test.mjs` | Create | Access-rule tests against a real PocketBase |
| `tests/seed.integration.test.mjs` | Create | Seed script tests |
| `tests/pocketbaseBackend.integration.test.mjs` | Create | Backend behaviour tests |
| `tests/fixtures/supabaseExport.mjs` | Create | Small Supabase export fixture shared by the import tests |
| `tests/supabaseImport.test.mjs` | Create | Transform unit tests |
| `tests/supabaseImport.integration.test.mjs` | Create | Import end-to-end test |
| `js/config.js` | Rewrite | `POCKETBASE_URL`, `IS_CONFIGURED` (false when `?demo`) |
| `js/db.js` | Modify | Remove Supabase backend, build PocketBase backend |
| `js/app.js` | Modify | `#reset-password=` flow |
| `js/admin.js` | Modify | Demo-mode notice text |
| `sw.js` | Modify | New shell files, skip `/api/` + `/_/`, bump cache |
| `Dockerfile`, `captain-definition`, `.dockerignore` | Create | CapRover deployment |
| `README.md` | Modify | Replace Supabase setup with PocketBase/CapRover docs |
| `.claude/launch.json` | Modify | Add a PocketBase launch config |
| `sql/`, `supabase/` | Delete (last task) | Supabase-only files |

---

### Task 1: Tooling baseline (git, test runner, PocketBase binary, vendored SDK)

**Files:**
- Create: `package.json`, `tools/get-pocketbase.ps1`, `js/vendor/pocketbase.es.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm test` runs `node --test` over `tests/**/*.test.mjs`. `tools/bin/pocketbase.exe` exists. `js/vendor/pocketbase.es.mjs` has a default export `PocketBase`.

- [ ] **Step 1: Initialise git and commit the untouched project** (the folder is not a repo yet)

```bash
cd "C:/Progams/ecovite-lick-comparison-master"
git init
git add -A
git commit -m "chore: snapshot project before PocketBase migration

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git checkout -b pocketbase-migration
```

- [ ] **Step 2: Add ignore rules** by appending to `.gitignore`:

```gitignore
# PocketBase migration
tools/bin/
pb_data/
migration-export/
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "ecovite-lick-comparison",
  "private": true,
  "type": "module",
  "description": "Dev-only: the app itself needs no Node. This file exists for tests and one-off scripts.",
  "scripts": {
    "test": "node --test --test-concurrency=1 \"tests/**/*.test.mjs\"",
    "test:unit": "node --test \"tests/pocketbaseMappers.test.mjs\" \"tests/supabaseImport.test.mjs\""
  }
}
```

- [ ] **Step 4: Create `tools/get-pocketbase.ps1`**

```powershell
# Downloads the PocketBase binary this project is pinned to into tools/bin/.
# Keep $Version identical to ARG PB_VERSION in the Dockerfile.
param([string]$Version = '0.35.0')
$ErrorActionPreference = 'Stop'

$binDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force $binDir | Out-Null
$zip = Join-Path $binDir 'pocketbase.zip'
$url = "https://github.com/pocketbase/pocketbase/releases/download/v$Version/pocketbase_${Version}_windows_amd64.zip"

Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $binDir -Force
Remove-Item $zip
& (Join-Path $binDir 'pocketbase.exe') --version
```

- [ ] **Step 5: Run it**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/get-pocketbase.ps1`
Expected: last line prints `pocketbase version 0.35.0`.

- [ ] **Step 6: Vendor the SDK**

Run:
```powershell
New-Item -ItemType Directory -Force js/vendor | Out-Null
Invoke-WebRequest -Uri https://cdn.jsdelivr.net/npm/pocketbase@0.26.2/dist/pocketbase.es.mjs -OutFile js/vendor/pocketbase.es.mjs
```

- [ ] **Step 7: Check the SDK imports in Node**

Run: `node -e "import('./js/vendor/pocketbase.es.mjs').then(m => console.log(typeof m.default))"`
Expected: `function`

- [ ] **Step 8: Check the test runner works with zero tests**

Run: `npm test`
Expected: exits 0 (`tests 0`). If Node complains that no files match, that's fine at this stage. The first test file arrives in Task 2.

- [ ] **Step 9: Commit**

```bash
git add .gitignore package.json tools/get-pocketbase.ps1 js/vendor/pocketbase.es.mjs
git commit -m "chore: add test runner, PocketBase download script, vendored SDK

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Record mappers (pure, unit-tested)

**Files:**
- Create: `js/pocketbaseMappers.js`
- Test: `tests/pocketbaseMappers.test.mjs`

**Interfaces:**
- Consumes: `NUTRIENTS` from `js/seedData.js` (array of `{ id, label, unit, group, derived }`; ids include derived `npn` and `me`).
- Produces (all named exports of `js/pocketbaseMappers.js`):
  - `recordToIngredient(record) → { id, name, is_active, notes, bagSizeKg, pricePerBag, pricePerTon, updated_at, values }`
  - `ingredientToRecord(ingredient) → { name, notes, bag_size_kg, price_per_bag, price_per_ton, values }`
  - `recordToProfile(record) → { id, email, full_name, role }`
  - `recordToMix(record) → { id, name, ownerId, ownerName, ownerEmail, speciesId, supplementTypeId, lickFocus, savedAt, snapshot, isPublic }`
  - `mergeNutrientTarget(list, target) → newList` (never mutates `list`)
  - `setNpnLimit(map, speciesId, supplementTypeId, value) → newMap` (never mutates `map`)
  - `describePbError(err) → string`

- [ ] **Step 1: Write the failing tests** in `tests/pocketbaseMappers.test.mjs`

```js
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
  assert.equal(describePbError({ status: 0, response: {} }), 'Can’t reach the server — check your connection.');
});

test('describePbError falls back to the server or plain message', () => {
  assert.equal(describePbError({ status: 403, response: { message: 'Only superusers can perform this action.', data: {} } }), 'Only superusers can perform this action.');
  assert.equal(describePbError(new Error('boom')), 'boom');
  assert.equal(describePbError(undefined), 'Something went wrong.');
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node --test tests/pocketbaseMappers.test.mjs`
Expected: FAIL with `Cannot find module ... pocketbaseMappers.js`.

- [ ] **Step 3: Implement `js/pocketbaseMappers.js`**

```js
// Pure conversions between PocketBase records and the shapes the rest of
// the app already uses (the same shapes the demo backend in db.js returns).
// No SDK, no DOM, no network, so everything here is unit-tested in Node.

import { NUTRIENTS } from './seedData.js';

// Always calculated in js/calc.js, never stored (see calc.js header).
const DERIVED_NUTRIENTS = ['npn', 'me'];

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
    updated_at: record.updated,
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
    // reset to the import time for mixes brought over from Supabase.
    savedAt: record.snapshot?.savedAt ?? record.created,
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
  if (err?.status === 0) return 'Can’t reach the server — check your connection.';
  return err?.response?.message || err?.message || 'Something went wrong.';
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node --test tests/pocketbaseMappers.test.mjs`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add js/pocketbaseMappers.js tests/pocketbaseMappers.test.mjs
git commit -m "feat: add PocketBase record mappers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Schema migration + access rules

**Files:**
- Create: `pb_migrations/1790200000_ecovite_schema.js`
- Create: `tests/helpers/pocketbaseServer.mjs`
- Test: `tests/accessRules.integration.test.mjs`

**Interfaces:**
- Consumes: `tools/bin/pocketbase.exe` (Task 1), `js/vendor/pocketbase.es.mjs`.
- Produces:
  - Collections, with field names exactly as follows:
    - `users` (+`name`, `role`)
    - `ingredients` (`name`, `is_active`, `notes`, `bag_size_kg`, `price_per_bag`, `price_per_ton`, `values`, `created`, `updated`)
    - `price_overrides` (`owner`, `ingredient`, `price_per_ton`, `updated`)
    - `settings` (`key`, `value`, `updated`)
    - `mixes` (`owner`, `name`, `species`, `supplement_type`, `lick_focus`, `is_public`, `lines`, `snapshot`, `created`, `updated`)
  - Test helpers (from `tests/helpers/pocketbaseServer.mjs`):
    - `hasPocketBase: boolean`
    - `SKIP_REASON: string | false`
    - `startPocketBase({ port }) → Promise<{ url, superuser: PocketBase, stop(): Promise<void> }>`
    - `createUser(superuserClient, { email, password = 'password123', role = 'rep', name = '' }) → Promise<record>`
    - `clientFor(url, email, password = 'password123') → Promise<PocketBase>` (signed in)
    - `newClient(url) → PocketBase` (anonymous, autoCancellation off)

- [ ] **Step 1: Write the test helper** `tests/helpers/pocketbaseServer.mjs`

```js
// Starts a throwaway PocketBase (fresh temp data dir, this repo's
// migrations) for integration tests, and tears it down afterwards.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import PocketBase from '../../js/vendor/pocketbase.es.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'pb_migrations');
export const PB_BIN = process.env.POCKETBASE_BIN
  || path.join(ROOT, 'tools', 'bin', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
export const hasPocketBase = existsSync(PB_BIN);
export const SKIP_REASON = hasPocketBase ? false : 'PocketBase binary not found — run tools/get-pocketbase.ps1';

const SUPERUSER = { email: 'superuser@test.local', password: 'superuser-pass-123' };

export function newClient(url) {
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  return pb;
}

export async function startPocketBase({ port }) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ecovite-pb-'));
  const common = [`--dir=${dataDir}`, `--migrationsDir=${MIGRATIONS}`];
  execFileSync(PB_BIN, ['superuser', 'upsert', SUPERUSER.email, SUPERUSER.password, ...common], { stdio: 'ignore' });

  const url = `http://127.0.0.1:${port}`;
  const proc = spawn(PB_BIN, ['serve', `--http=127.0.0.1:${port}`, '--automigrate=false', ...common], { stdio: 'ignore' });
  const exited = new Promise((resolve) => proc.once('exit', resolve));

  let healthy = false;
  for (let i = 0; i < 100 && !healthy; i++) {
    try { healthy = (await fetch(`${url}/api/health`)).ok; } catch { /* not up yet */ }
    if (!healthy) await new Promise((r) => setTimeout(r, 100));
  }
  if (!healthy) throw new Error(`PocketBase did not start on ${url}`);

  const superuser = newClient(url);
  await superuser.collection('_superusers').authWithPassword(SUPERUSER.email, SUPERUSER.password);

  return {
    url,
    superuser,
    async stop() {
      proc.kill();
      await exited;
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

export function createUser(superuser, { email, password = 'password123', role = 'rep', name = '' }) {
  return superuser.collection('users').create({
    email, password, passwordConfirm: password, name, role, verified: true, emailVisibility: true,
  });
}

export async function clientFor(url, email, password = 'password123') {
  const pb = newClient(url);
  await pb.collection('users').authWithPassword(email, password);
  return pb;
}
```

- [ ] **Step 2: Write the failing access-rule tests** in `tests/accessRules.integration.test.mjs`

```js
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
```

- [ ] **Step 3: Run the tests to check they fail**

Run: `node --test tests/accessRules.integration.test.mjs`
Expected: FAIL in `before`, because creating a user with `role` fails and the collection `ingredients` doesn't exist.

- [ ] **Step 4: Write the migration** `pb_migrations/1790200000_ecovite_schema.js`

```js
/// <reference path="../pb_data/types.d.ts" />
// EcoVite schema + access rules. The rules replicate what
// sql/002_rls_policies.sql enforced on Supabase — see
// docs/superpowers/plans/2026-09-24-pocketbase-migration.md, "Design decisions".

migrate((app) => {
  const ADMIN = '@request.auth.role = "admin"';
  const SIGNED_IN = '@request.auth.id != ""';
  const OWNER_OR_ADMIN = `(owner = @request.auth.id || ${ADMIN})`;
  const autodate = (name, onUpdate) => ({ type: 'autodate', name, onCreate: true, onUpdate });

  // --- users: the built-in auth collection -------------------------------
  const users = app.findCollectionByNameOrId('users');
  if (!users.fields.getByName('name')) users.fields.add(new TextField({ name: 'name', max: 255 }));
  users.fields.add(new SelectField({ name: 'role', values: ['rep', 'admin'], maxSelect: 1, required: true }));
  users.listRule = `id = @request.auth.id || ${ADMIN}`;
  users.viewRule = `id = @request.auth.id || ${ADMIN}`;
  users.createRule = ADMIN;
  users.updateRule = ADMIN;
  users.deleteRule = `${ADMIN} && id != @request.auth.id`;
  // Lets admins create users as already-verified and set their passwords
  // without the old one: this replaces the Supabase admin-users function.
  users.manageRule = ADMIN;
  users.authToken.duration = 60 * 60 * 24 * 30; // 30 days: reps work offline in the field
  users.resetPasswordTemplate.subject = 'Reset your EcoVite lick app password';
  users.resetPasswordTemplate.body =
    '<p>Hello,</p>' +
    '<p>Click the link below to choose a new password for the EcoVite lick app.</p>' +
    '<p><a href="{APP_URL}/#reset-password={TOKEN}" target="_blank" rel="noopener">Set a new password</a></p>' +
    '<p>If you didn\'t ask for this, you can ignore this email.</p>';
  app.save(users);

  // --- ingredients ---------------------------------------------------------
  const ingredients = new Collection({
    type: 'base',
    name: 'ingredients',
    listRule: SIGNED_IN,
    viewRule: SIGNED_IN,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: ADMIN,
    fields: [
      { type: 'text', name: 'name', required: true, max: 200 },
      { type: 'bool', name: 'is_active' },
      { type: 'text', name: 'notes', max: 5000 },
      { type: 'number', name: 'bag_size_kg', min: 0 },
      { type: 'number', name: 'price_per_bag', min: 0 },
      { type: 'number', name: 'price_per_ton', min: 0 },
      // { nutrientId: number }. Absent key = not analysed, 0 = analysed zero.
      { type: 'json', name: 'values', maxSize: 20000 },
      autodate('created', false),
      autodate('updated', true),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_ingredients_name ON ingredients (name)'],
  });
  app.save(ingredients);

  // --- price_overrides: a rep's own price, never visible to anyone else --
  const priceOverrides = new Collection({
    type: 'base',
    name: 'price_overrides',
    listRule: 'owner = @request.auth.id',
    viewRule: 'owner = @request.auth.id',
    createRule: `${SIGNED_IN} && @request.body.owner = @request.auth.id`,
    updateRule: 'owner = @request.auth.id && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)',
    deleteRule: 'owner = @request.auth.id',
    fields: [
      { type: 'relation', name: 'owner', collectionId: users.id, cascadeDelete: true, maxSelect: 1, required: true },
      { type: 'relation', name: 'ingredient', collectionId: ingredients.id, cascadeDelete: true, maxSelect: 1, required: true },
      { type: 'number', name: 'price_per_ton', min: 0 },
      autodate('updated', true),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_price_overrides_owner_ingredient ON price_overrides (owner, ingredient)'],
  });
  app.save(priceOverrides);

  // --- settings: npn_safety_limits / nutrient_targets / production_targets
  const settings = new Collection({
    type: 'base',
    name: 'settings',
    listRule: SIGNED_IN,
    viewRule: SIGNED_IN,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: ADMIN,
    fields: [
      { type: 'text', name: 'key', required: true, max: 100 },
      { type: 'json', name: 'value', maxSize: 200000 },
      autodate('updated', true),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_settings_key ON settings (key)'],
  });
  app.save(settings);

  // --- mixes: saved licks with their frozen snapshot ----------------------
  const mixes = new Collection({
    type: 'base',
    name: 'mixes',
    listRule: `${SIGNED_IN} && (${OWNER_OR_ADMIN} || is_public = true)`,
    viewRule: `${SIGNED_IN} && (${OWNER_OR_ADMIN} || is_public = true)`,
    createRule: `${SIGNED_IN} && @request.body.owner = @request.auth.id`,
    // Snapshots are immutable once written; only is_public / name may change.
    updateRule: `${OWNER_OR_ADMIN} && @request.body.owner:isset = false && @request.body.lines:isset = false && @request.body.snapshot:isset = false`,
    // Deliberately no admin bypass, matching the Supabase policy.
    deleteRule: 'owner = @request.auth.id',
    fields: [
      { type: 'relation', name: 'owner', collectionId: users.id, cascadeDelete: true, maxSelect: 1, required: true },
      { type: 'text', name: 'name', max: 200 },
      { type: 'select', name: 'species', values: ['cattle', 'sheep'], maxSelect: 1, required: true },
      { type: 'select', name: 'supplement_type', values: ['maintenance', 'production'], maxSelect: 1, required: true },
      { type: 'select', name: 'lick_focus', values: ['energy', 'phosphorus', 'protein', 'production'], maxSelect: 1 },
      { type: 'bool', name: 'is_public' },
      { type: 'json', name: 'lines', maxSize: 100000 },
      { type: 'json', name: 'snapshot', maxSize: 2000000 },
      autodate('created', false),
      autodate('updated', true),
    ],
    indexes: ['CREATE INDEX idx_mixes_owner ON mixes (owner)'],
  });
  app.save(mixes);
}, (app) => {
  for (const name of ['mixes', 'settings', 'price_overrides', 'ingredients']) {
    app.delete(app.findCollectionByNameOrId(name));
  }
  const users = app.findCollectionByNameOrId('users');
  users.fields.removeByName('role');
  users.listRule = 'id = @request.auth.id';
  users.viewRule = 'id = @request.auth.id';
  users.createRule = '';
  users.updateRule = 'id = @request.auth.id';
  users.deleteRule = 'id = @request.auth.id';
  users.manageRule = null;
  app.save(users);
});
```

- [ ] **Step 5: Run the tests to check they pass**

Run: `node --test tests/accessRules.integration.test.mjs`
Expected: PASS, 13 tests. If the migration fails to load, start `tools/bin/pocketbase.exe serve --dir=%TEMP%\pbcheck --migrationsDir=pb_migrations` by hand and read the startup error. JSVM errors name the exact line.

- [ ] **Step 6: Commit**

```bash
git add pb_migrations tests/helpers/pocketbaseServer.mjs tests/accessRules.integration.test.mjs
git commit -m "feat: PocketBase schema and access rules mirroring the Supabase RLS policies

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Seed script

**Files:**
- Create: `tools/seed-pocketbase.mjs`
- Test: `tests/seed.integration.test.mjs`

**Interfaces:**
- Consumes: `ingredientToRecord` (Task 2); `INGREDIENTS`, `NPN_SAFETY_LIMITS`, `NUTRIENT_TARGETS`, `PRODUCTION_TARGETS` from `js/seedData.js`; test helpers (Task 3).
- Produces: `export async function seed(pb) → Promise<{ ingredientsCreated: number, settingsCreated: number }>`. The function is idempotent: it only fills in what's missing. CLI: `node tools/seed-pocketbase.mjs <url> <superuser-email> <superuser-password>`.

- [ ] **Step 1: Write the failing test** `tests/seed.integration.test.mjs`

```js
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
```

- [ ] **Step 2: Run the test to check it fails**

Run: `node --test tests/seed.integration.test.mjs`
Expected: FAIL with `Cannot find module ... seed-pocketbase.mjs`.

- [ ] **Step 3: Implement `tools/seed-pocketbase.mjs`**

```js
// Seeds a PocketBase database with the workbook's starting data
// (js/seedData.js): the three settings rows and the 28 ingredients.
// Safe to re-run: it only creates what's missing, and never touches
// ingredients at all once any exist.
//
// Usage: node tools/seed-pocketbase.mjs <url> <superuser-email> <superuser-password>
import { pathToFileURL } from 'node:url';
import PocketBase from '../js/vendor/pocketbase.es.mjs';
import { INGREDIENTS, NPN_SAFETY_LIMITS, NUTRIENT_TARGETS, PRODUCTION_TARGETS } from '../js/seedData.js';
import { ingredientToRecord } from '../js/pocketbaseMappers.js';

export async function seed(pb) {
  let settingsCreated = 0;
  const settings = {
    npn_safety_limits: NPN_SAFETY_LIMITS,
    nutrient_targets: NUTRIENT_TARGETS,
    production_targets: PRODUCTION_TARGETS,
  };
  for (const [key, value] of Object.entries(settings)) {
    const existing = await pb.collection('settings')
      .getFirstListItem(pb.filter('key = {:key}', { key }))
      .catch((err) => { if (err.status === 404) return null; throw err; });
    if (!existing) {
      await pb.collection('settings').create({ key, value });
      settingsCreated++;
    }
  }

  let ingredientsCreated = 0;
  const { totalItems } = await pb.collection('ingredients').getList(1, 1);
  if (totalItems === 0) {
    for (const ingredient of INGREDIENTS) {
      await pb.collection('ingredients').create({ ...ingredientToRecord(ingredient), is_active: true });
      ingredientsCreated++;
    }
  }
  return { ingredientsCreated, settingsCreated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, email, password] = process.argv.slice(2);
  if (!url || !email || !password) {
    console.error('Usage: node tools/seed-pocketbase.mjs <url> <superuser-email> <superuser-password>');
    process.exit(1);
  }
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  await pb.collection('_superusers').authWithPassword(email, password);
  console.log(await seed(pb));
}
```

- [ ] **Step 4: Run the test to check it passes**

Run: `node --test tests/seed.integration.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/seed-pocketbase.mjs tests/seed.integration.test.mjs
git commit -m "feat: add idempotent PocketBase seed script

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: PocketBase backend

**Files:**
- Create: `js/pocketbaseBackend.js`
- Test: `tests/pocketbaseBackend.integration.test.mjs`

**Interfaces:**
- Consumes: mappers (Task 2), `seed(pb)` (Task 4), test helpers (Task 3), `NUTRIENTS`, `SPECIES`, `SUPPLEMENT_TYPES` from `js/seedData.js`.
- Produces: `export function createPocketBaseBackend(pb)`. It returns an object with `mode: 'pocketbase'` and these async methods (identical names/returns to `demoBackend` in `js/db.js`, except `confirmPasswordReset`):
  - Auth and users:
    - `signIn(email, password) → profile`
    - `signOut()`
    - `requestPasswordReset(email)`
    - `confirmPasswordReset(token, newPassword)`
    - `getProfile() → profile | null`
    - `listUsers() → profile[]`
    - `createUser({ email, password, fullName, role }) → profile`
    - `deleteUser(id)`
  - Reference data:
    - `listNutrients()`
    - `listSpecies()`
    - `listSupplementTypes()`
  - Ingredients:
    - `getIngredientsUpdatedAt() → string`
    - `listIngredients({ includeInactive })`
    - `getPriceOverrides() → { [ingredientId]: number }`
    - `setPriceOverride(ingredientId, pricePerTon)`
    - `upsertIngredient(ingredient) → true`
    - `setIngredientActive(id, isActive)`
  - Settings:
    - `getNpnSafetyLimits()`
    - `upsertNpnSafetyLimit(speciesId, supplementTypeId, value)`
    - `getNutrientTargets()`
    - `upsertNutrientTarget(target)`
    - `getProductionTargets()`
    - `upsertProductionTarget(speciesId, protein, energy)`
  - Mixes:
    - `saveMix({ name, speciesId, supplementTypeId, lickFocus, lines, snapshot }) → mix`
    - `listSavedMixes() → mix[]`
    - `deleteSavedMix(id)`
    - `setMixPublic(id, isPublic)`
  - Error handling: every method rejects with a plain `Error` whose `.message` is human-readable (`describePbError`) and whose `.status` is the HTTP status.

- [ ] **Step 1: Write the failing tests** `tests/pocketbaseBackend.integration.test.mjs`

```js
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
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node --test tests/pocketbaseBackend.integration.test.mjs`
Expected: FAIL with `Cannot find module ... pocketbaseBackend.js`.

- [ ] **Step 3: Implement `js/pocketbaseBackend.js`**

```js
// PocketBase implementation of the backend interface js/db.js hands to the
// rest of the app. Method names and return shapes match db.js's demoBackend
// exactly (except confirmPasswordReset, which replaces Supabase's
// updatePassword). Access control is enforced server-side by the rules in
// pb_migrations/, not by anything here.

import { NUTRIENTS, SPECIES, SUPPLEMENT_TYPES } from './seedData.js';
import {
  recordToIngredient, ingredientToRecord, recordToProfile, recordToMix,
  mergeNutrientTarget, setNpnLimit, describePbError,
} from './pocketbaseMappers.js';

const notFoundToNull = (err) => {
  if (err?.status === 404) return null;
  throw err;
};

export function createPocketBaseBackend(pb) {
  const users = () => pb.collection('users');

  async function getSetting(key, fallback) {
    const row = await pb.collection('settings').getFirstListItem(pb.filter('key = {:key}', { key })).catch(notFoundToNull);
    return row?.value ?? fallback;
  }

  async function putSetting(key, value) {
    const row = await pb.collection('settings').getFirstListItem(pb.filter('key = {:key}', { key })).catch(notFoundToNull);
    if (row) await pb.collection('settings').update(row.id, { value });
    else await pb.collection('settings').create({ key, value });
  }

  const methods = {
    async signIn(email, password) {
      try {
        const { record } = await users().authWithPassword(email, password);
        return recordToProfile(record);
      } catch (err) {
        if (err?.status === 400) throw Object.assign(new Error('Incorrect email or password.'), { status: 400 });
        throw err;
      }
    },

    async signOut() {
      pb.authStore.clear();
    },

    async requestPasswordReset(email) {
      await users().requestPasswordReset(email);
    },

    // The token arrives in the reset email's link (#reset-password=TOKEN,
    // see the template in pb_migrations/). This doesn't sign the user in;
    // they sign in with the new password afterwards.
    async confirmPasswordReset(token, newPassword) {
      await users().confirmPasswordReset(token, newPassword, newPassword);
    },

    // Works offline: the session lives in localStorage. When online, the
    // token is refreshed (extending it another 30 days and picking up role
    // changes); a 401/403/404 means the account was removed or the token
    // revoked, so the stale session is dropped.
    async getProfile() {
      if (!pb.authStore.record) return null;
      if (!pb.authStore.isValid) {
        pb.authStore.clear();
        return null;
      }
      try {
        await users().authRefresh();
      } catch (err) {
        if ([401, 403, 404].includes(err?.status)) {
          pb.authStore.clear();
          return null;
        }
        // status 0 = offline: keep using the cached session.
      }
      return recordToProfile(pb.authStore.record);
    },

    async listUsers() {
      return (await users().getFullList({ sort: 'email' })).map(recordToProfile);
    },

    async createUser({ email, password, fullName, role }) {
      const record = await users().create({
        email, password, passwordConfirm: password, name: fullName || '', role,
        verified: true, emailVisibility: true,
      });
      return recordToProfile(record);
    },

    async deleteUser(id) {
      await users().delete(id);
    },

    async listNutrients() {
      return NUTRIENTS;
    },

    async listSpecies() {
      return SPECIES;
    },

    async listSupplementTypes() {
      return SUPPLEMENT_TYPES;
    },

    async getIngredientsUpdatedAt() {
      const page = await pb.collection('ingredients').getList(1, 1, { sort: '-updated', fields: 'updated' });
      return page.items[0]?.updated ?? '';
    },

    async listIngredients({ includeInactive = false } = {}) {
      const records = await pb.collection('ingredients').getFullList({
        filter: includeInactive ? '' : 'is_active = true',
        sort: 'name',
      });
      return records.map(recordToIngredient);
    },

    // The list rule already limits this to the caller's own rows.
    async getPriceOverrides() {
      const result = {};
      for (const row of await pb.collection('price_overrides').getFullList()) {
        result[row.ingredient] = row.price_per_ton;
      }
      return result;
    },

    async setPriceOverride(ingredientId, pricePerTon) {
      const existing = await pb.collection('price_overrides')
        .getFirstListItem(pb.filter('ingredient = {:ingredientId}', { ingredientId }))
        .catch(notFoundToNull);
      if (existing) {
        await pb.collection('price_overrides').update(existing.id, { price_per_ton: pricePerTon });
      } else {
        await pb.collection('price_overrides').create({
          owner: pb.authStore.record?.id, ingredient: ingredientId, price_per_ton: pricePerTon,
        });
      }
    },

    async upsertIngredient(ingredient) {
      const body = ingredientToRecord(ingredient);
      if (ingredient.id) await pb.collection('ingredients').update(ingredient.id, body);
      else await pb.collection('ingredients').create({ ...body, is_active: true });
      return true;
    },

    async setIngredientActive(id, isActive) {
      await pb.collection('ingredients').update(id, { is_active: isActive });
    },

    async getNpnSafetyLimits() {
      return getSetting('npn_safety_limits', {});
    },

    async upsertNpnSafetyLimit(speciesId, supplementTypeId, maxGNPerHeadDay) {
      const current = await getSetting('npn_safety_limits', {});
      await putSetting('npn_safety_limits', setNpnLimit(current, speciesId, supplementTypeId, maxGNPerHeadDay));
    },

    async getNutrientTargets() {
      return getSetting('nutrient_targets', []);
    },

    async upsertNutrientTarget(target) {
      const current = await getSetting('nutrient_targets', []);
      await putSetting('nutrient_targets', mergeNutrientTarget(current, target));
    },

    async getProductionTargets() {
      return getSetting('production_targets', {});
    },

    async upsertProductionTarget(speciesId, protein, energy) {
      const current = await getSetting('production_targets', {});
      await putSetting('production_targets', { ...current, [speciesId]: { protein, energy } });
    },

    async saveMix({ name, speciesId, supplementTypeId, lickFocus, lines, snapshot }) {
      const record = await pb.collection('mixes').create({
        owner: pb.authStore.record?.id,
        name,
        species: speciesId,
        supplement_type: supplementTypeId,
        lick_focus: lickFocus ?? '',
        lines,
        snapshot,
      });
      return recordToMix(record);
    },

    async listSavedMixes() {
      const records = await pb.collection('mixes').getFullList({ sort: '-created', expand: 'owner' });
      return records.map(recordToMix);
    },

    async deleteSavedMix(id) {
      await pb.collection('mixes').delete(id);
    },

    async setMixPublic(id, isPublic) {
      await pb.collection('mixes').update(id, { is_public: isPublic });
    },
  };

  // Every method rejects with a plain Error carrying a readable message,
  // since the UI shows err.message directly.
  const backend = { mode: 'pocketbase' };
  for (const [name, fn] of Object.entries(methods)) {
    backend[name] = async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        throw Object.assign(new Error(describePbError(err)), { status: err?.status });
      }
    };
  }
  return backend;
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node --test tests/pocketbaseBackend.integration.test.mjs`
Expected: PASS, 16 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add js/pocketbaseBackend.js tests/pocketbaseBackend.integration.test.mjs
git commit -m "feat: add PocketBase backend implementing the app's data interface

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire the app to PocketBase

**Files:**
- Rewrite: `js/config.js`
- Modify: `js/db.js:1-18` (header + imports), `js/db.js:344-682` (replace Supabase backend + `getBackend`)
- Modify: `js/app.js:13-30` (`boot`), `js/app.js:32-47` (`renderLogin` signature), `js/app.js` `renderResetPassword`
- Modify: `js/admin.js:350-352` (demo notice text)
- Modify: `sw.js`
- Create: `tools/dev-pocketbase.ps1`
- Modify: `.claude/launch.json`

**Interfaces:**
- Consumes: `createPocketBaseBackend(pb)` (Task 5); SDK default export.
- Produces: `js/config.js` exports `POCKETBASE_URL: string` and `IS_CONFIGURED: boolean`. The backend returned by `getBackend()` has `confirmPasswordReset(token, newPassword)` instead of `updatePassword`.

- [ ] **Step 1: Rewrite `js/config.js`**

```js
// The app is served by PocketBase itself (see Dockerfile), so the API lives
// on the same origin the page was loaded from; nothing to fill in.
//
// Add ?demo to the URL (e.g. http://localhost:8080/?demo) to run against
// the in-browser demo data store instead (seeded from js/seedData.js,
// persisted to localStorage), with no server at all.
export const IS_CONFIGURED = !new URLSearchParams(location.search).has('demo');
export const POCKETBASE_URL = IS_CONFIGURED ? location.origin : '';
```

- [ ] **Step 2: Update the top of `js/db.js`.** Replace lines 1–14 (the header comment through the `calc.js` import) with:

```js
// Data access layer. Everything above this file (rep.js, admin.js, app.js)
// calls the same `db` interface regardless of whether it's talking to the
// real PocketBase server (the normal case, see js/config.js) or running in
// demo mode (?demo in the URL).
//
// In demo mode, `db` is backed by an in-browser store seeded from
// js/seedData.js and persisted to localStorage, so the app, including the
// admin ingredient editor, can be tried with zero setup. Otherwise the same
// calls go to PocketBase (js/pocketbaseBackend.js), with the ingredient set
// cached on the device (see below) so mix-building keeps working offline.

import PocketBase from './vendor/pocketbase.es.mjs';
import { IS_CONFIGURED, POCKETBASE_URL } from './config.js';
import { createPocketBaseBackend } from './pocketbaseBackend.js';
import { NUTRIENTS, SPECIES, SUPPLEMENT_TYPES, NPN_SAFETY_LIMITS, NUTRIENT_TARGETS, PRODUCTION_TARGETS, INGREDIENTS, PLAUSIBLE_RANGES, SEED_MIXES } from './seedData.js';
import { computeMixResult } from './calc.js';
```

- [ ] **Step 3: Replace the Supabase backend in `js/db.js`.** Delete everything from the `// Supabase backend` section banner (line 344) through the end of `getBackend()` (line 682), and put this in its place:

```js
// ---------------------------------------------------------------------
// PocketBase backend (js/pocketbaseBackend.js)
// ---------------------------------------------------------------------

function buildPocketBaseBackend() {
  const pb = new PocketBase(POCKETBASE_URL);
  // The SDK cancels a pending request when another one to the same
  // endpoint starts; the app fires several reads in parallel (Promise.all
  // in rep.js/admin.js), so that behaviour has to be off.
  pb.autoCancellation(false);
  return createPocketBaseBackend(pb);
}

let backendPromise = null;
export function getBackend() {
  if (!backendPromise) {
    backendPromise = Promise.resolve(IS_CONFIGURED ? buildPocketBaseBackend() : demoBackend);
  }
  return backendPromise;
}
```

Also in `resetDemoData()`'s comment, change "once a real Supabase project is configured" to "outside demo mode".

- [ ] **Step 4: Check nothing still references Supabase in the JS**

Run: `grep -rn -i "supabase\|updatePassword" js/ --include=*.js | grep -v vendor`
Expected: only matches inside `js/app.js`, `js/admin.js` and `js/seedData.js` (the next steps fix app.js and admin.js; seedData.js's comment is fixed in Task 9).

- [ ] **Step 5: Update the password-reset flow in `js/app.js`.** In `boot()`, replace the recovery-token block:

```js
  // Clicking the link in a "reset your password" email brings the rep back
  // here with a one-time recovery token attached to the URL (creating the
  // Supabase client above already consumed it into a temporary session) —
  // show the "set a new password" screen instead of the normal app.
  if (location.hash.includes('type=recovery')) {
    renderResetPassword();
    return;
  }
```

with:

```js
  // The "reset your password" email links back here with a one-time token
  // in the URL hash (see the email template in pb_migrations/). Show the
  // "set a new password" screen instead of the normal app.
  const resetMatch = location.hash.match(/reset-password=([^&]+)/);
  if (resetMatch) {
    renderResetPassword(decodeURIComponent(resetMatch[1]));
    return;
  }
```

Change `function renderLogin() {` to:

```js
function renderLogin({ notice } = {}) {
```

and directly after `appEl.appendChild(tpl.content.cloneNode(true));` inside it, add:

```js
  if (notice) {
    const hint = document.getElementById('demo-hint');
    hint.hidden = false;
    hint.textContent = notice;
  }
```

In the demo-hint text, change `'Running in demo mode (no Supabase project configured yet — see README.md).<br>'` to `'Running in demo mode — nothing here reaches the server.<br>'`.

Change `function renderResetPassword() {` to `function renderResetPassword(token) {`, and replace this part of its `try` block:

```js
      const backend = await getBackend();
      await backend.updatePassword(password);
      // Drop the recovery token from the URL so refreshing the page
      // doesn't re-trigger this screen once the password is already set.
      history.replaceState(null, '', location.pathname);
      profile = await backend.getProfile();
      if (profile) renderShell();
      else renderLogin();
```

with:

```js
      const backend = await getBackend();
      await backend.confirmPasswordReset(token, password);
      // Drop the token from the URL so refreshing the page doesn't
      // re-trigger this screen once the password is already set.
      history.replaceState(null, '', location.pathname + location.search);
      renderLogin({ notice: 'Password updated — sign in with your new password.' });
```

- [ ] **Step 6: Update the demo notice in `js/admin.js`.** Replace:

```
          No Supabase project is configured yet (see README.md) — everything here lives in this
```

with:

```
          You're in demo mode (?demo in the URL) — everything here lives in this
```

- [ ] **Step 7: Update `sw.js`.**
  - Change `const CACHE_NAME = 'ecovite-shell-v72';` to `const CACHE_NAME = 'ecovite-shell-v73';`.
  - Change the header comment's "Never intercepts calls to Supabase or the CDN" to "Never intercepts PocketBase API/dashboard calls or the CDN".
  - Add these three entries to `SHELL_FILES` after `'./js/db.js',`:

```js
  './js/pocketbaseBackend.js',
  './js/pocketbaseMappers.js',
  './js/vendor/pocketbase.es.mjs',
```

  - Replace:

```js
  if (url.origin !== self.location.origin) return; // let Supabase/CDN requests pass straight through
```

with:

```js
  if (url.origin !== self.location.origin) return; // let CDN requests pass straight through
  // PocketBase is on the same origin: its API and dashboard must always hit the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_/')) return;
```

- [ ] **Step 8: Create `tools/dev-pocketbase.ps1`**

```powershell
# Runs PocketBase locally, serving this project folder as the app, so
# code edits show up on reload. Data lives outside the project folder so
# it can never be served as a public file.
#   First run:  tools/get-pocketbase.ps1, then this script, then open
#   http://127.0.0.1:8090/_/ to create your superuser.
param([int]$Port = 8090)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $PSScriptRoot 'bin\pocketbase.exe'
$data = Join-Path $env:LOCALAPPDATA 'ecovite-pocketbase\pb_data'
if (-not (Test-Path $bin)) { throw "PocketBase not found at $bin - run tools/get-pocketbase.ps1 first." }

& $bin serve "--http=127.0.0.1:$Port" "--dir=$data" "--publicDir=$root" "--migrationsDir=$(Join-Path $root 'pb_migrations')"
```

- [ ] **Step 9: Add a launch config** by appending this object to the `configurations` array in `.claude/launch.json`:

```json
    {
      "name": "ecovite-pocketbase",
      "runtimeExecutable": "powershell",
      "runtimeArgs": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/dev-pocketbase.ps1", "-Port", "8090"],
      "port": 8090
    }
```

- [ ] **Step 10: Manual end-to-end check (local)**
  1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File tools/dev-pocketbase.ps1` (leave it running).
  2. Create a superuser: `tools/bin/pocketbase.exe superuser upsert you@example.com <a-long-password> --dir "$env:LOCALAPPDATA\ecovite-pocketbase\pb_data"`.
  3. Seed: `node tools/seed-pocketbase.mjs http://127.0.0.1:8090 you@example.com <password>`. Expected: `{ ingredientsCreated: 28, settingsCreated: 3 }`.
  4. In `http://127.0.0.1:8090/_/`, go to **Collections → users → New record** and create `admin@local.test` with a password ≥ 8 characters, role `admin`, Verified on and Email visibility on.
  5. Open `http://127.0.0.1:8090/` and sign in as that admin. Then check each of these:
     - The **Compare Licks** ingredient list shows 28 ingredients with prices.
     - You can build and save a mix, and it appears in **History**.
     - On **Ingredients**, you can edit a price and save it.
     - On **Settings**, you can change an NPN limit, save it, and it's still there after a reload.
     - On **Users**, you can add a rep, sign out, sign in as the rep, and confirm the rep sees only their own mixes plus public ones.
  6. Offline check: in DevTools → Network, tick **Offline**, then reload. The app still loads, stays signed in, and can still build a mix from the cached ingredients.
  7. Demo check: run `powershell -File tools/static-server.ps1 -Port 8080` and open `http://localhost:8080/?demo`. The demo-mode hint shows and `admin@demo.local` / `admin123` works.

- [ ] **Step 11: Run the automated suite again**

Run: `npm test`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add js/config.js js/db.js js/app.js js/admin.js sw.js tools/dev-pocketbase.ps1 .claude/launch.json
git commit -m "feat: switch the app from Supabase to PocketBase

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Move existing Supabase data (export + import)

**Files:**
- Create: `tools/export-supabase.mjs`, `tools/supabaseImport.mjs`, `tools/import-supabase-export.mjs`
- Test: `tests/fixtures/supabaseExport.mjs`, `tests/supabaseImport.test.mjs`, `tests/supabaseImport.integration.test.mjs`

**Interfaces:**
- Consumes: test helpers (Task 3), `createPocketBaseBackend` (Task 5).
- Produces (from `tools/supabaseImport.mjs`):
  - `transformSupabaseExport(exp)`. Takes `{ profiles, ingredients, ingredient_nutrients, ingredient_price_overrides, npn_safety_limits, nutrient_targets, production_targets, mixes, mix_lines, mix_snapshots }` (arrays of raw Supabase rows). Returns `{ users, ingredients, priceOverrides, settings, mixes, skippedMixes }`.
  - `remapIngredientIds(mix, ingredientIdMap: Map) → mix`
  - `importIntoPocketBase(pb, data, { generatePassword }) → { tempPasswords: {email,password}[], counts: { users, ingredients, mixes } }`

- [ ] **Step 1: Write the failing transform tests** `tests/supabaseImport.test.mjs`

First create the shared fixture `tests/fixtures/supabaseExport.mjs`. It lives in its own file because importing a `*.test.mjs` file from another test would register its tests twice.

```js
// A tiny Supabase export in the exact shape tools/export-supabase.mjs writes.
// PostgREST returns numeric columns as strings, hence the quoted numbers.
export const FIXTURE = {
  profiles: [
    { id: 'u-admin', full_name: 'Ada', email: 'ada@test.local', role: 'admin' },
    { id: 'u-rep', full_name: null, email: 'rep@test.local', role: 'rep' },
  ],
  ingredients: [
    { id: 'i-urea', name: 'Urea', is_active: true, notes: null, bag_size_kg: '50', price_per_bag: '550', price_per_ton: '11000' },
    { id: 'i-water', name: 'Water', is_active: false, notes: 'free', bag_size_kg: null, price_per_bag: null, price_per_ton: '0' },
  ],
  ingredient_nutrients: [
    { ingredient_id: 'i-urea', nutrient_id: 'cp', value: '287' },
    { ingredient_id: 'i-urea', nutrient_id: 'tdn', value: '0' },
  ],
  ingredient_price_overrides: [{ owner_id: 'u-rep', ingredient_id: 'i-urea', price_per_ton: '12000' }],
  npn_safety_limits: [
    { species_id: 'cattle', supplement_type_id: 'maintenance', max_g_n_per_head_day: '35' },
    { species_id: 'sheep', supplement_type_id: 'production', max_g_n_per_head_day: '9' },
  ],
  nutrient_targets: [
    { species_id: 'cattle', supplement_type_id: 'maintenance', cp_target_g: '150', cp_reference_note: 'note', me_target_mj: null, me_reference_note: null, p_target_g: '6', p_reference_note: null },
  ],
  production_targets: [{ species_id: 'cattle', protein_target_g: '350', energy_target_mj: '7' }],
  mixes: [
    { id: 'm-new', owner_id: 'u-rep', name: 'Newer', species_id: 'cattle', supplement_type_id: 'maintenance', lick_focus: null, is_public: false, created_at: '2026-02-01T00:00:00Z' },
    { id: 'm-old', owner_id: 'u-rep', name: 'Older', species_id: 'cattle', supplement_type_id: 'maintenance', lick_focus: 'protein', is_public: true, created_at: '2026-01-01T00:00:00Z' },
    { id: 'm-draft', owner_id: 'u-rep', name: 'Draft', species_id: 'cattle', supplement_type_id: 'maintenance', lick_focus: null, is_public: false, created_at: '2026-01-15T00:00:00Z' },
  ],
  mix_lines: [
    { mix_id: 'm-old', ingredient_id: 'i-urea', inclusion_pct: '100', cost_per_ton: '11000', sort_order: 0 },
  ],
  mix_snapshots: [
    { mix_id: 'm-old', created_at: '2026-01-01T00:00:00Z', snapshot: { savedAt: '2026-01-01T00:00:00Z', lines: [{ ingredientId: 'i-urea' }] } },
    { mix_id: 'm-new', created_at: '2026-02-01T00:00:00Z', snapshot: { savedAt: 'first', lines: [] } },
    { mix_id: 'm-new', created_at: '2026-02-02T00:00:00Z', snapshot: { savedAt: 'second', lines: [] } },
  ],
};
```

Then the tests, `tests/supabaseImport.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node --test tests/supabaseImport.test.mjs`
Expected: FAIL with `Cannot find module ... supabaseImport.mjs`.

- [ ] **Step 3: Implement `tools/supabaseImport.mjs`**

```js
// Turns a raw Supabase export (tools/export-supabase.mjs) into PocketBase
// records and writes them, remapping old UUIDs to new PocketBase ids.

const num = (v) => (v == null ? null : Number(v));
const DERIVED_NUTRIENTS = ['npn', 'me'];

export function transformSupabaseExport(exp) {
  const users = exp.profiles.map((p) => ({
    oldId: p.id, email: p.email, name: p.full_name ?? '', role: p.role === 'admin' ? 'admin' : 'rep',
  }));

  const ingredients = exp.ingredients.map((row) => {
    const values = {};
    for (const n of exp.ingredient_nutrients) {
      if (n.ingredient_id === row.id && !DERIVED_NUTRIENTS.includes(n.nutrient_id)) values[n.nutrient_id] = num(n.value);
    }
    return {
      oldId: row.id,
      record: {
        name: row.name, is_active: row.is_active, notes: row.notes ?? '',
        bag_size_kg: num(row.bag_size_kg), price_per_bag: num(row.price_per_bag),
        price_per_ton: num(row.price_per_ton) ?? 0, values,
      },
    };
  });

  const priceOverrides = exp.ingredient_price_overrides.map((o) => ({
    oldOwnerId: o.owner_id, oldIngredientId: o.ingredient_id, price_per_ton: num(o.price_per_ton),
  }));

  const npnSafetyLimits = {};
  for (const r of exp.npn_safety_limits) {
    npnSafetyLimits[r.species_id] = npnSafetyLimits[r.species_id] || {};
    npnSafetyLimits[r.species_id][r.supplement_type_id] = num(r.max_g_n_per_head_day);
  }
  const nutrientTargets = exp.nutrient_targets.map((t) => ({
    species: t.species_id, supplementType: t.supplement_type_id,
    cp: num(t.cp_target_g), cpNote: t.cp_reference_note,
    me: num(t.me_target_mj), meNote: t.me_reference_note,
    p: num(t.p_target_g), pNote: t.p_reference_note,
  }));
  const productionTargets = {};
  for (const r of exp.production_targets) {
    productionTargets[r.species_id] = { protein: num(r.protein_target_g), energy: num(r.energy_target_mj) };
  }

  const latestSnapshot = new Map();
  for (const s of exp.mix_snapshots) {
    const current = latestSnapshot.get(s.mix_id);
    if (!current || s.created_at > current.created_at) latestSnapshot.set(s.mix_id, s);
  }
  const mixes = [];
  let skippedMixes = 0;
  // Oldest first, so PocketBase's `created` order (History sorts on it)
  // matches the original save order.
  for (const m of [...exp.mixes].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const snap = latestSnapshot.get(m.id);
    if (!snap) { skippedMixes++; continue; } // never-saved drafts: nothing to show
    const lines = exp.mix_lines
      .filter((l) => l.mix_id === m.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({ ingredientId: l.ingredient_id, inclusionPct: num(l.inclusion_pct), costPerTon: num(l.cost_per_ton) }));
    mixes.push({
      oldOwnerId: m.owner_id, name: m.name, species: m.species_id, supplement_type: m.supplement_type_id,
      lick_focus: m.lick_focus ?? '', is_public: !!m.is_public, lines, snapshot: snap.snapshot,
    });
  }

  return {
    users, ingredients, priceOverrides,
    settings: { npn_safety_limits: npnSafetyLimits, nutrient_targets: nutrientTargets, production_targets: productionTargets },
    mixes, skippedMixes,
  };
}

export function remapIngredientIds(mix, ingredientIdMap) {
  const remap = (id) => ingredientIdMap.get(id) ?? id;
  return {
    ...mix,
    lines: mix.lines.map((l) => ({ ...l, ingredientId: remap(l.ingredientId) })),
    snapshot: {
      ...mix.snapshot,
      lines: (mix.snapshot?.lines ?? []).map((l) => ({ ...l, ingredientId: remap(l.ingredientId) })),
    },
  };
}

export async function importIntoPocketBase(pb, data, { generatePassword }) {
  const existing = await pb.collection('ingredients').getList(1, 1);
  if (existing.totalItems > 0) {
    throw new Error('Target database already has ingredients. Import into a fresh PocketBase (do not run the seed script first).');
  }

  const userIds = new Map();
  const tempPasswords = [];
  for (const u of data.users) {
    const password = generatePassword();
    const rec = await pb.collection('users').create({
      email: u.email, password, passwordConfirm: password, name: u.name, role: u.role,
      verified: true, emailVisibility: true,
    });
    userIds.set(u.oldId, rec.id);
    tempPasswords.push({ email: u.email, password });
  }

  const ingredientIds = new Map();
  for (const i of data.ingredients) {
    const rec = await pb.collection('ingredients').create(i.record);
    ingredientIds.set(i.oldId, rec.id);
  }

  for (const o of data.priceOverrides) {
    const owner = userIds.get(o.oldOwnerId);
    const ingredient = ingredientIds.get(o.oldIngredientId);
    if (owner && ingredient) await pb.collection('price_overrides').create({ owner, ingredient, price_per_ton: o.price_per_ton });
  }

  for (const [key, value] of Object.entries(data.settings)) {
    const found = await pb.collection('settings').getFirstListItem(pb.filter('key = {:key}', { key })).catch(() => null);
    if (found) await pb.collection('settings').update(found.id, { value });
    else await pb.collection('settings').create({ key, value });
  }

  let mixCount = 0;
  for (const m of data.mixes) {
    const owner = userIds.get(m.oldOwnerId);
    if (!owner) continue;
    const { oldOwnerId, ...mix } = remapIngredientIds(m, ingredientIds);
    await pb.collection('mixes').create({ ...mix, owner });
    mixCount++;
  }

  return { tempPasswords, counts: { users: userIds.size, ingredients: ingredientIds.size, mixes: mixCount } };
}
```

- [ ] **Step 4: Run the unit tests to check they pass**

Run: `node --test tests/supabaseImport.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing end-to-end import test** `tests/supabaseImport.integration.test.mjs`

```js
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
```

- [ ] **Step 6: Run it**

Run: `node --test tests/supabaseImport.integration.test.mjs`
Expected: PASS, 3 tests. `importIntoPocketBase` already exists from Step 3; this test checks it against a real server. If it fails, fix `tools/supabaseImport.mjs`, not the test.

- [ ] **Step 7: Create the export CLI** `tools/export-supabase.mjs`

```js
// Dumps every table the app used on Supabase to
// migration-export/supabase-export.json (gitignored; it contains user emails).
//
// Needs the service-role ("secret") key so it can read every rep's rows
// past row-level security. Find it in Supabase → Project Settings → API.
// Never commit it; pass it via environment variables:
//
//   $env:SUPABASE_URL = 'https://xxxx.supabase.co'
//   $env:SUPABASE_SERVICE_ROLE_KEY = '<secret key>'
//   node tools/export-supabase.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const TABLES = [
  'profiles', 'ingredients', 'ingredient_nutrients', 'ingredient_price_overrides',
  'npn_safety_limits', 'nutrient_targets', 'production_targets',
  'mixes', 'mix_lines', 'mix_snapshots',
];
const PAGE = 1000;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (see the comment at the top of this file).');
  process.exit(1);
}
// New-style secret keys (sb_secret_...) go in the apikey header only;
// legacy JWT service_role keys also need the Authorization header.
const headers = key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };

async function fetchAll(table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${offset}`, { headers });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const out = {};
for (const table of TABLES) {
  out[table] = await fetchAll(table);
  console.log(`${table}: ${out[table].length} rows`);
}
mkdirSync('migration-export', { recursive: true });
writeFileSync('migration-export/supabase-export.json', JSON.stringify(out, null, 2));
console.log('Wrote migration-export/supabase-export.json');
```

- [ ] **Step 8: Create the import CLI** `tools/import-supabase-export.mjs`

```js
// Imports migration-export/supabase-export.json into a FRESH PocketBase
// (migrations applied, NOT seeded). Every user gets a random temporary
// password, written to migration-export/temp-passwords.csv (gitignored);
// hand those out, or have reps use "Forgot password?" once SMTP is set up.
//
// Usage: node tools/import-supabase-export.mjs <url> <superuser-email> <superuser-password> [export-file]
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import PocketBase from '../js/vendor/pocketbase.es.mjs';
import { transformSupabaseExport, importIntoPocketBase } from './supabaseImport.mjs';

const [url, email, password, file = 'migration-export/supabase-export.json'] = process.argv.slice(2);
if (!url || !email || !password) {
  console.error('Usage: node tools/import-supabase-export.mjs <url> <superuser-email> <superuser-password> [export-file]');
  process.exit(1);
}

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(email, password);

const data = transformSupabaseExport(JSON.parse(readFileSync(file, 'utf8')));
const result = await importIntoPocketBase(pb, data, { generatePassword: () => randomBytes(9).toString('base64url') });

writeFileSync(
  'migration-export/temp-passwords.csv',
  'email,password\n' + result.tempPasswords.map((p) => `${p.email},${p.password}`).join('\n') + '\n'
);
console.log('Imported:', result.counts);
if (data.skippedMixes) console.log(`Skipped ${data.skippedMixes} never-saved draft mix(es).`);
console.log('Temporary passwords: migration-export/temp-passwords.csv');
```

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add tools/export-supabase.mjs tools/supabaseImport.mjs tools/import-supabase-export.mjs tests/fixtures/supabaseExport.mjs tests/supabaseImport.test.mjs tests/supabaseImport.integration.test.mjs
git commit -m "feat: add Supabase export and PocketBase import scripts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: CapRover packaging and deployment

**Files:**
- Create: `Dockerfile`, `captain-definition`, `.dockerignore`

**Interfaces:**
- Consumes: everything above.
- Produces: a container listening on port 8090 that serves the app at `/`, the API at `/api/` and the dashboard at `/_/`, with data in `/pb/pb_data`.

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM alpine:3.20

# Keep identical to the default $Version in tools/get-pocketbase.ps1.
ARG PB_VERSION=0.35.0
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip -d /pb \
 && rm /tmp/pb.zip

COPY pb_migrations /pb/pb_migrations
COPY index.html manifest.webmanifest sw.js /pb/pb_public/
COPY css /pb/pb_public/css
COPY js /pb/pb_public/js
COPY icons /pb/pb_public/icons

EXPOSE 8090

# --automigrate=false: schema changes come only from committed migrations,
# never from dashboard edits writing files into the (throwaway) container.
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--publicDir=/pb/pb_public", "--migrationsDir=/pb/pb_migrations", "--automigrate=false"]
```

- [ ] **Step 2: Create `captain-definition`**

```json
{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile"
}
```

- [ ] **Step 3: Create `.dockerignore`**

```gitignore
.git
.claude
.claudeignore.txt
docs
tests
tools
sql
supabase
migration-export
pb_data
node_modules
package.json
README.md
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile captain-definition .dockerignore
git commit -m "feat: add CapRover deployment (PocketBase serving the app)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Deploy to CapRover.** Docker isn't installed on this machine, so the image is built and verified on CapRover itself.
  1. In the CapRover dashboard: **Apps → Create New App** named `ecovite`, with **Has Persistent Data** ticked.
  2. On the app's **App Configs** tab, set:
     - **Container HTTP Port** to `8090`.
     - Under **Persistent Directories**, path in app `/pb/pb_data`, label `ecovite-pb-data`.
     - **Instance Count** to `1`.
     - Then click **Save & Update**.
  3. On the **HTTP Settings** tab, connect the domain and click **Enable HTTPS**.
  4. Deploy from this folder: `npx caprover deploy` (choose the `ecovite` app), or upload a `.tar` of the folder on the **Deployment** tab.
  5. On the **Deployment** tab's app logs, copy the one-time superuser installer link (`.../_/#/pbinstal/...`), open it, swapping in the real HTTPS domain, and create the superuser.
  6. In `https://<domain>/_/` → **Settings → Application**, set **Application URL** to `https://<domain>` and **Application name** to `EcoVite`.
  7. In **Settings → Mail settings**, enter the SMTP server details, then click **Send test email** to your own address. This is required for "Forgot password?".
  8. In **Settings → Backups**, turn on scheduled backups. Backups are stored in `pb_data/backups` on the same volume, so also configure S3 storage there, or download a backup regularly.

- [ ] **Step 6: Verify the deployment**
  - `https://<domain>/api/health` returns `{"message":"API is healthy.",...}`.
  - `https://<domain>/` shows the login screen with no demo hint.
  - Using the same checks as Task 6 Step 10.5, against the live domain, with data from Step 7 (import) or seeded via `node tools/seed-pocketbase.mjs https://<domain> <su-email> <su-password>`. Seed only if you're not importing Supabase data.
  - Password reset: on the login screen, click "Forgot password?" and enter a real user's email. The email arrives, its link opens the "Set new password" screen, the new password works, and the login screen then shows "Password updated…".
  - On a phone: **Add to Home Screen**, open it, turn on flight mode, reopen it. It stays signed in and can build a mix.

- [ ] **Step 7: Move the live data** (only if the Supabase project has real users/mixes)
  1. `$env:SUPABASE_URL='https://yozpyipnnqmlrqkwhlnz.supabase.co'; $env:SUPABASE_SERVICE_ROLE_KEY='<secret key>'; node tools/export-supabase.mjs`
  2. `node tools/import-supabase-export.mjs https://<domain> <su-email> <su-password>` against the **freshly deployed, unseeded** server.
  3. Open `migration-export/temp-passwords.csv` and send each rep their temporary password, or ask them to use "Forgot password?".
  4. Spot-check one rep's History against Supabase, then keep the Supabase project paused, not deleted, for a few weeks as a fallback.

---

### Task 9: Remove Supabase leftovers and update the docs

**Files:**
- Delete: `sql/001_schema.sql`, `sql/002_rls_policies.sql`, `sql/003_seed_data.sql`, `supabase/functions/admin-users/index.ts`
- Modify: `js/seedData.js:1-7` (header comment), `README.md`

**Interfaces:**
- Consumes: the working deployment from Task 8.
- Produces: no Supabase references outside `tools/export-supabase.mjs`, `tools/supabaseImport.mjs`, `tools/import-supabase-export.mjs` and the plan doc.

- [ ] **Step 1: Delete the Supabase-only files**

```bash
git rm -r sql supabase
```

- [ ] **Step 2: Fix the `js/seedData.js` header.** Replace lines 3–7:

```js
// rows 11-38). This is the single source of truth for both:
//   - the local demo/offline data layer (js/db.js when no Supabase config
//     is present), and
//   - sql/003_seed_data.sql, which mirrors it for a real Supabase project.
// If you correct a value in one, correct it in the other.
```

with:

```js
// rows 11-38). This is the single source of truth for both:
//   - the demo data layer (js/db.js in ?demo mode), and
//   - tools/seed-pocketbase.mjs, which loads it into a fresh PocketBase.
```

- [ ] **Step 3: Rewrite the README's setup sections.** In `README.md`:
  - Replace the intro paragraph's "talking to a [Supabase](https://supabase.com) project (free tier is plenty for 5-8 reps)" with "talking to a self-hosted [PocketBase](https://pocketbase.io) server (one small container on CapRover)".
  - Replace the whole of **"## Try it with zero setup"**, **"## Setting up the real backend (Supabase)"** and **"## Deploying for your reps"** with the following:

````markdown
## Try it with zero setup (demo mode)

**Don't just double-click `index.html`.** This app uses ES modules, which
browsers refuse to load over `file://`. Serve it over `http://`:

```powershell
powershell -File tools/static-server.ps1 -Port 8080
```

Then open `http://localhost:8080/?demo`. The `?demo` switches the app to an
in-browser copy of the ingredient database, seeded from the workbook and
persisted to `localStorage`. Nothing reaches a server.

- Admin: `admin@demo.local` / `admin123`
- Rep: `rep@demo.local` / `rep123`

Seeing stale data after pulling a code update? Click **"Reset demo data"**
on the login screen (or on the Settings tab as admin).

## Running it locally with the real backend

```powershell
powershell -File tools/get-pocketbase.ps1      # once: downloads PocketBase to tools/bin/
powershell -File tools/dev-pocketbase.ps1      # serves the app + API on http://127.0.0.1:8090
```

First time only:

1. `tools/bin/pocketbase.exe superuser upsert you@example.com <password> --dir "$env:LOCALAPPDATA\ecovite-pocketbase\pb_data"`
2. `node tools/seed-pocketbase.mjs http://127.0.0.1:8090 you@example.com <password>`
3. In `http://127.0.0.1:8090/_/`, go to **users → New record** and create yourself
   with role `admin` (tick Verified and Email visibility).

Tests: `npm test` (Node 24+, no `npm install` needed). The integration tests
need the PocketBase binary from step 0 and skip themselves without it.

## Deploying on CapRover

PocketBase serves both the app and its API from one container (see
`Dockerfile`). In CapRover:

1. Create an app with **Has Persistent Data**; set Container HTTP Port
   `8090`, persistent directory `/pb/pb_data`, instance count **1**
   (SQLite: never scale it out).
2. Enable HTTPS on its domain (required for offline use and install-to-home-screen).
3. `npx caprover deploy` from this folder.
4. Open the installer link printed in the app logs to create the superuser.
5. In `https://<domain>/_/`, go to **Settings**:
   - Set the Application URL to `https://<domain>`.
   - Configure SMTP (needed for "Forgot password?").
   - Turn on scheduled backups.
6. Seed (`node tools/seed-pocketbase.mjs https://<domain> …`) **or** import
   old Supabase data (below), then create your admin user as in the local
   steps.

Reps open the URL on their phone, sign in, and tap **Add to Home Screen**.
The app then works with no signal: the app shell and the full ingredient
list are cached on the device, and the list is only re-downloaded when an
admin has changed something.

Admins manage people on the **Users** tab (add a rep, remove a rep).
Removing a user also removes everything they saved.

## Moving data over from Supabase

```powershell
$env:SUPABASE_URL = 'https://xxxx.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<secret key from Project Settings → API>'
node tools/export-supabase.mjs
node tools/import-supabase-export.mjs https://<domain> <superuser-email> <superuser-password>
```

Import into a fresh, **unseeded** server. Supabase passwords can't be
carried over: every user gets a temporary password, listed in
`migration-export/temp-passwords.csv` (gitignored; delete it once handed out).
````

  - In **"## Saving a mix, and the History tab"**, replace "enforced by the same row-level security as the ingredient database (`sql/002_rls_policies.sql`)" with "enforced server-side by the PocketBase access rules (`pb_migrations/`)".
  - In **"## What changed from the spreadsheet"**, replace "(`mix_snapshots` table)" with "(the mix's `snapshot` field)".
  - Replace the **"## Project layout"** block with:

```
index.html                  App shell + login screen
css/style.css               Design system (theme, cards, forms)
js/app.js                   Auth + tab routing
js/rep.js                   Mix builder (Compare Licks tab)
js/history.js               Saved-mix history + detail view
js/mixRender.js             Result rendering shared by rep.js and history.js
js/report.js                Comparison report + PDF export
js/admin.js                 Ingredient editor + Settings tab
js/users.js                 Users tab (admins)
js/calc.js                  Calculation engine (pure functions, no DOM)
js/db.js                    Data access layer (PocketBase or ?demo store)
js/pocketbaseBackend.js     PocketBase implementation of that layer
js/pocketbaseMappers.js     Record <-> app-shape conversions
js/vendor/pocketbase.es.mjs PocketBase JS SDK (vendored for offline use)
js/seedData.js              Ingredient matrix transcribed from the workbook
js/config.js                Demo-mode switch
pb_migrations/              Database schema + access rules
Dockerfile, captain-definition  CapRover deployment
manifest.webmanifest, sw.js PWA install + offline app shell
tools/                      Dev server, PocketBase download/run, seed, Supabase export/import
tests/                      node:test unit + integration tests
```

  - In **"## Known limitations (v1)"**, delete the bullet that begins "Only two mixes are shown side by side by default". It's out of date, because up to 4 panels are supported.

- [ ] **Step 4: Check nothing stale is left**

Run: `grep -rn -i "supabase" --include=*.js --include=*.html --include=*.md . | grep -v "^./docs/" | grep -v "^./tools/"`
Expected: matches only in `README.md`'s "Moving data over from Supabase" section.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Supabase schema/function, document PocketBase + CapRover

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
