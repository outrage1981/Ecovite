-- Row-level security: reps can read the shared reference data but not
-- write to it; admins can read and write everything. Reps own their mixes;
-- admins can see and edit every rep's mixes too.

alter table profiles enable row level security;
alter table nutrients enable row level security;
alter table ingredients enable row level security;
alter table ingredient_nutrients enable row level security;
alter table species enable row level security;
alter table supplement_types enable row level security;
alter table npn_safety_limits enable row level security;
alter table nutrient_targets enable row level security;
alter table production_targets enable row level security;
alter table mixes enable row level security;
alter table mix_lines enable row level security;
alter table mix_snapshots enable row level security;
alter table ingredient_price_overrides enable row level security;

create function public.is_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- profiles
create policy "profiles: read own" on profiles for select using (id = auth.uid());
create policy "profiles: admin reads all" on profiles for select using (is_admin());
create policy "profiles: admin updates roles" on profiles for update using (is_admin());

-- reference tables: any authenticated user reads, only admins write
create policy "nutrients: read all" on nutrients for select using (auth.role() = 'authenticated');
create policy "nutrients: admin write" on nutrients for all using (is_admin()) with check (is_admin());

create policy "ingredients: read all" on ingredients for select using (auth.role() = 'authenticated');
create policy "ingredients: admin write" on ingredients for all using (is_admin()) with check (is_admin());

create policy "ingredient_nutrients: read all" on ingredient_nutrients for select using (auth.role() = 'authenticated');
create policy "ingredient_nutrients: admin write" on ingredient_nutrients for all using (is_admin()) with check (is_admin());

create policy "species: read all" on species for select using (auth.role() = 'authenticated');
create policy "species: admin write" on species for all using (is_admin()) with check (is_admin());

create policy "supplement_types: read all" on supplement_types for select using (auth.role() = 'authenticated');
create policy "supplement_types: admin write" on supplement_types for all using (is_admin()) with check (is_admin());

create policy "npn_safety_limits: read all" on npn_safety_limits for select using (auth.role() = 'authenticated');
create policy "npn_safety_limits: admin write" on npn_safety_limits for all using (is_admin()) with check (is_admin());

create policy "nutrient_targets: read all" on nutrient_targets for select using (auth.role() = 'authenticated');
create policy "nutrient_targets: admin write" on nutrient_targets for all using (is_admin()) with check (is_admin());

create policy "production_targets: read all" on production_targets for select using (auth.role() = 'authenticated');
create policy "production_targets: admin write" on production_targets for all using (is_admin()) with check (is_admin());

-- mixes: owner, admin, or (read-only) anyone when flagged is_public
create policy "mixes: owner reads" on mixes for select using (owner_id = auth.uid() or is_admin() or is_public);
create policy "mixes: owner writes" on mixes for insert with check (owner_id = auth.uid() or is_admin());
create policy "mixes: owner updates" on mixes for update using (owner_id = auth.uid() or is_admin());
-- Deliberately no admin bypass here (unlike the other mixes policies):
-- an admin can see and clone every rep's mixes, but deleting is limited to
-- whoever actually owns the mix, admin included.
create policy "mixes: owner deletes" on mixes for delete using (owner_id = auth.uid());

create policy "mix_lines: owner reads" on mix_lines for select using (
  exists (select 1 from mixes m where m.id = mix_id and (m.owner_id = auth.uid() or is_admin() or m.is_public))
);
create policy "mix_lines: owner writes" on mix_lines for all using (
  exists (select 1 from mixes m where m.id = mix_id and (m.owner_id = auth.uid() or is_admin()))
) with check (
  exists (select 1 from mixes m where m.id = mix_id and (m.owner_id = auth.uid() or is_admin()))
);

create policy "mix_snapshots: owner reads" on mix_snapshots for select using (
  exists (select 1 from mixes m where m.id = mix_id and (m.owner_id = auth.uid() or is_admin() or m.is_public))
);
create policy "mix_snapshots: owner writes" on mix_snapshots for insert with check (
  exists (select 1 from mixes m where m.id = mix_id and (m.owner_id = auth.uid() or is_admin()))
);
-- snapshots are immutable once written: no update policy, so even the owner cannot edit history.
-- Delete is allowed only so that deleting the parent `mixes` row (e.g. the
-- "override existing mix" flow, or straight deletion) can cascade — there
-- is no direct-delete UI path for a snapshot on its own.
create policy "mix_snapshots: owner deletes" on mix_snapshots for delete using (
  exists (select 1 from mixes m where m.id = mix_id and (m.owner_id = auth.uid() or is_admin()))
);

-- ingredient_price_overrides: strictly owner-only, no admin bypass — this
-- is a rep's own working price, not shared data an admin needs to manage.
create policy "ingredient_price_overrides: owner reads" on ingredient_price_overrides for select using (owner_id = auth.uid());
create policy "ingredient_price_overrides: owner writes" on ingredient_price_overrides for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
