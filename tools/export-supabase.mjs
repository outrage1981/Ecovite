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

// Every table needs a deterministic sort on a unique key, or paging by
// offset over PostgREST can skip or repeat rows between requests (rows can
// move relative to an unordered scan as other requests run). Most tables
// have a plain `id` primary key; a few don't (see sql/001_schema.sql,
// git show b3b465e:sql/001_schema.sql) and are keyed on the columns that
// actually make each row unique there.
const ORDER_BY = {
  ingredient_nutrients: 'ingredient_id,nutrient_id',
  npn_safety_limits: 'species_id,supplement_type_id',
  production_targets: 'species_id',
};

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
  const order = ORDER_BY[table] || 'id';
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&order=${order}&limit=${PAGE}&offset=${offset}`, { headers });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    // Loop until an explicitly empty page rather than stopping as soon as a
    // page comes back shorter than PAGE. PostgREST can be configured with
    // its own max page size, so a request for PAGE rows isn't guaranteed to
    // return that many even mid-table; an empty page is the only
    // unambiguous end-of-table signal.
    if (page.length === 0) return rows;
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
