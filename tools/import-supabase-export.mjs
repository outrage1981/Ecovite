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
