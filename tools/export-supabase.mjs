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
