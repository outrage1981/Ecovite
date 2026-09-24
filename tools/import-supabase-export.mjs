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
writeFileSync(PASSWORDS_FILE, 'email,password\n');

const result = await importIntoPocketBase(pb, data, {
  generatePassword: () => randomBytes(9).toString('base64url'),
  onUserCreated: ({ email: userEmail, password: userPassword }) => appendFileSync(PASSWORDS_FILE, `${userEmail},${userPassword}\n`),
});

console.log('Imported:', result.counts);
if (data.skippedMixes) console.log(`Skipped ${data.skippedMixes} never-saved draft mix(es).`);
console.log(`Temporary passwords: ${PASSWORDS_FILE}`);
