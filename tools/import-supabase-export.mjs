// Imports migration-export/supabase-export.json into a FRESH PocketBase
// (migrations applied, NOT seeded). Every user gets a random temporary
// password, appended to migration-export/temp-passwords.csv (gitignored)
// as soon as it's created — so if the import dies partway through (network
// drop, a duplicate name clash on some later ingredient, ...) the passwords
// of the users already created are not lost. Hand the CSV out to reps, or
// have them use "Forgot password?" once SMTP is set up.
//
// If an import fails partway through, don't retry against the same
// PocketBase: start over from a fresh pb_data (the users already created
// would otherwise trip the "already has users" guard on retry). The
// passwords for anything already created are in temp-passwords.csv.
//
// Usage: node tools/import-supabase-export.mjs <url> <superuser-email> <superuser-password> [export-file]
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
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

const PASSWORDS_FILE = 'migration-export/temp-passwords.csv';
mkdirSync('migration-export', { recursive: true });

// Don't write the CSV (and truncate any existing one) until importIntoPocketBase
// has cleared its pre-flight guard — opened lazily on the first user actually
// created, so a run that's rejected outright (e.g. target already has data)
// never wipes out a temp-passwords.csv left over from a previous partial run.
let passwordsFileStarted = false;
const result = await importIntoPocketBase(pb, data, {
  generatePassword: () => randomBytes(9).toString('base64url'),
  onUserCreated: ({ email: userEmail, password: userPassword }) => {
    if (!passwordsFileStarted) {
      writeFileSync(PASSWORDS_FILE, 'email,password\n');
      passwordsFileStarted = true;
    }
    appendFileSync(PASSWORDS_FILE, `${userEmail},${userPassword}\n`);
  },
});

const { counts } = result;
const sourceMixes = data.mixes.length + data.skippedMixes;
console.log('Import summary (source rows read -> records created):');
console.log(`  Users:            ${data.users.length} -> ${counts.users}`);
console.log(`  Ingredients:      ${data.ingredients.length} -> ${counts.ingredients}`);
console.log(`  Price overrides:  ${data.priceOverrides.length} -> ${counts.priceOverrides}`);
console.log(`  Mixes:            ${sourceMixes} -> ${counts.mixes} imported, ${data.skippedMixes} skipped (never-saved draft), ${counts.mixesSkippedUnknownOwner} skipped (unknown owner)`);
console.log(`  Settings keys:    ${Object.keys(data.settings).length}`);
console.log(`Temporary passwords: ${PASSWORDS_FILE}`);
