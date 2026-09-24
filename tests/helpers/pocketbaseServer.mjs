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
