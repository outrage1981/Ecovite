// Creates app users in bulk from a plain list of names, each with a random
// password that meets the password rule (js/passwordPolicy.js), and writes
// the sign-in details to a CSV to hand out.
//
// Usage:
//   node tools/create-users.mjs <url> <superuser-email> <superuser-password> <names-file> [domain] [role]
//
// <names-file> has one "Name Surname" per line ("Johan De Klerk" -> name
// "Johan", surname "De Klerk"). Each email is <first name>@<domain>, lower-
// cased (default domain: ecovite.local, default role: rep). Anyone whose
// email already exists is skipped, so it's safe to re-run. Results go to
// new-users/<timestamp>.csv (gitignored) — delete it once handed out.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import PocketBase from '../js/vendor/pocketbase.es.mjs';
import { generatePassword } from '../js/passwordPolicy.js';
import { splitFullName } from './supabaseImport.mjs';

export function planUsers(lines, { domain = 'ecovite.local', role = 'rep' } = {}) {
  const people = lines
    .map((l) => l.replace(/^[\s*•-]+/, '').trim()) // tolerate pasted bullet lists
    .filter(Boolean)
    .map((full) => {
      const { name, surname } = splitFullName(full);
      const local = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
      return { name, surname, email: `${local}@${domain}`, role };
    });
  const seen = new Map();
  for (const p of people) {
    if (seen.has(p.email)) {
      throw new Error(`${seen.get(p.email)} and ${p.name} ${p.surname} would both get ${p.email} — give one a different first name in the list.`);
    }
    seen.set(p.email, `${p.name} ${p.surname}`);
  }
  return people;
}

export async function createUsers(pb, people) {
  const results = [];
  for (const p of people) {
    const existing = await pb.collection('users')
      .getFirstListItem(pb.filter('email = {:email}', { email: p.email }))
      .catch((err) => { if (err.status === 404) return null; throw err; });
    if (existing) {
      results.push({ ...p, password: '', status: 'skipped (email already exists)' });
      continue;
    }
    const password = generatePassword();
    await pb.collection('users').create({
      name: p.name, surname: p.surname, email: p.email, password, passwordConfirm: password,
      role: p.role, verified: true, emailVisibility: true,
    });
    results.push({ ...p, password, status: 'created' });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, suEmail, suPassword, namesFile, domain, role] = process.argv.slice(2);
  if (!namesFile) {
    console.error('Usage: node tools/create-users.mjs <url> <superuser-email> <superuser-password> <names-file> [domain] [role]');
    process.exit(1);
  }
  const people = planUsers(readFileSync(namesFile, 'utf8').split(/\r?\n/), { domain, role });
  const pb = new PocketBase(url);
  await pb.collection('_superusers').authWithPassword(suEmail, suPassword);
  const results = await createUsers(pb, people);

  // Owner-only: the file holds passwords. (On Windows these modes are
  // largely ignored; the folder is gitignored either way.)
  mkdirSync('new-users', { recursive: true, mode: 0o700 });
  chmodSync('new-users', 0o700); // tighten it if it already existed
  const out = `new-users/${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  const csv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  writeFileSync(out, ['name,surname,email,password,role,status',
    ...results.map((r) => [r.name, r.surname, r.email, r.password, r.role, r.status].map(csv).join(','))].join('\n') + '\n',
  { mode: 0o600, flag: 'wx' }); // wx: never overwrite an existing results file
  for (const r of results) console.log(`${r.status.padEnd(8)} ${r.email}`);
  console.log(`\nSign-in details written to ${out} (gitignored — delete it once handed out).`);
}
