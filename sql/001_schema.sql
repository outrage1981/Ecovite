-- EcoVite Lick Cost Comparison — schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query),
-- then 002_rls_policies.sql, then 003_seed_data.sql, in that order.

create extension if not exists "pgcrypto";

-- One row per authenticated user, created automatically by the trigger below.
-- role drives what a user may write to (see 002_rls_policies.sql); every
-- admin can do everything a rep can, plus edit the ingredient database and
-- the settings tables.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'rep' check (role in ('rep', 'admin')),
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Fixed list of nutrient columns the app knows how to display and total.
-- 'npn' and 'me' are derived (see js/calc.js) and are never written to
-- ingredient_nutrients — they exist here only so the UI has a label/unit/
-- sort order for them.
create table nutrients (
  id text primary key,
  label text not null,
  unit text not null,
  nutrient_group text not null,
  is_derived boolean not null default false,
  sort_order int not null
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  notes text,
  -- Pricing: bag_size_kg / price_per_bag are a convenience for computing
  -- price_per_ton (price_per_bag / bag_size_kg * 1000). price_per_ton is
  -- the field the app actually uses as the default mix cost, and can be
  -- entered directly instead when bag pricing isn't known.
  bag_size_kg numeric,
  price_per_bag numeric,
  price_per_ton numeric not null default 0,
  created_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

-- One row per (ingredient, nutrient) that has a value. Absence of a row
-- means "not analysed" (no data) — this is distinct from a row with
-- value = 0, which means "analysed and confirmed zero".
create table ingredient_nutrients (
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  nutrient_id text not null references nutrients (id),
  value numeric not null,
  primary key (ingredient_id, nutrient_id)
);

-- A rep's own custom price for an ingredient, sized for their area — kept
-- separate from ingredients.price_per_ton (the admin-controlled default)
-- rather than overwriting it, since that default is shared by everyone.
-- One row per (rep, ingredient); toggling "Use default prices" off in the
-- builder is what makes this take effect instead of the shared default.
create table ingredient_price_overrides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  price_per_ton numeric not null,
  updated_at timestamptz not null default now(),
  unique (owner_id, ingredient_id)
);

create table species (
  id text primary key,
  label text not null
);

create table supplement_types (
  id text primary key,
  label text not null
);

-- Act 36 maximum safe non-protein-nitrogen supplementation, g N/head/day.
create table npn_safety_limits (
  species_id text not null references species (id),
  supplement_type_id text not null references supplement_types (id),
  max_g_n_per_head_day numeric not null,
  primary key (species_id, supplement_type_id)
);

-- Lick-contribution targets the mix is sized against, plus the reference
-- ranges shown for context (total daily requirement, not the lick target).
create table nutrient_targets (
  id uuid primary key default gen_random_uuid(),
  species_id text not null references species (id),
  supplement_type_id text not null references supplement_types (id),
  cp_target_g numeric,
  cp_reference_note text,
  me_target_mj numeric,
  me_reference_note text,
  p_target_g numeric,
  p_reference_note text,
  updated_at timestamptz not null default now(),
  unique (species_id, supplement_type_id)
);

-- Separate target pair for a "Production Lick" (Supplement Type), keyed by
-- species only — distinct from nutrient_targets, which drives the ordinary
-- phosphorus/protein/energy-driven scenarios and can vary by physiological
-- state. A production lick must satisfy both figures at once (see
-- js/calc.js's productionScenario).
create table production_targets (
  species_id text primary key references species (id),
  protein_target_g numeric,
  energy_target_mj numeric,
  updated_at timestamptz not null default now()
);

create table mixes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  name text not null default 'Untitled mix',
  species_id text not null references species (id),
  supplement_type_id text not null references supplement_types (id),
  status text not null default 'draft' check (status in ('draft', 'saved')),
  -- Which of the three nutrient-driven scenarios (or the Production Lick
  -- scenario) the rep had selected when they hit Save — drives how History
  -- groups saved mixes. Null on mixes saved before this column existed;
  -- the History UI buckets those as "Uncategorised" rather than guessing.
  lick_focus text check (lick_focus is null or lick_focus in ('energy', 'phosphorus', 'protein', 'production')),
  -- An admin-owned mix flagged visible to every rep, not just its owner —
  -- e.g. a handful of curated "starter" licks. Toggled from the History
  -- tab; see the "mixes: owner reads" RLS policy for the visibility rule.
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mix_lines (
  id uuid primary key default gen_random_uuid(),
  mix_id uuid not null references mixes (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id),
  inclusion_pct numeric not null check (inclusion_pct >= 0),
  cost_per_ton numeric not null default 0 check (cost_per_ton >= 0),
  sort_order int not null default 0
);

-- Immutable copy of a mix (ingredient values, inclusion, cost, computed
-- results) at the moment the rep hits "Save". Later edits to the ingredient
-- database or to the live mix must never change what a saved comparison
-- shows — a rep may already have this printed or shown to a farmer.
create table mix_snapshots (
  id uuid primary key default gen_random_uuid(),
  mix_id uuid not null references mixes (id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index on ingredient_nutrients (nutrient_id);
create index on mix_lines (mix_id);
create index on mix_snapshots (mix_id);
create index on mixes (owner_id);
create index on ingredient_price_overrides (owner_id);
