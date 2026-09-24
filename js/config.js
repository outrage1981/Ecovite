// Fill these in once you've created a Supabase project and run the SQL
// files in /sql (see README.md). Until then, SUPABASE_URL is left as the
// placeholder below and the app runs against an in-browser demo data store
// (seeded from js/seedData.js, persisted to localStorage) so you can try
// the whole thing — including the admin screens — without any setup.
export const SUPABASE_URL = 'https://yozpyipnnqmlrqkwhlnz.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_e30aZ2SejGq39K9ahFMXQg_4LPTes1c';

export const IS_CONFIGURED =
  SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL' && SUPABASE_URL.startsWith('http');
