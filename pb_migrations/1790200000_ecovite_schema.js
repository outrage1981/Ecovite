/// <reference path="../pb_data/types.d.ts" />
// EcoVite schema + access rules. The rules replicate what
// sql/002_rls_policies.sql enforced on Supabase — see
// docs/superpowers/plans/2026-09-24-pocketbase-migration.md, "Design decisions".

migrate((app) => {
  const ADMIN = '@request.auth.role = "admin"';
  const SIGNED_IN = '@request.auth.id != ""';
  const OWNER_OR_ADMIN = `(owner = @request.auth.id || ${ADMIN})`;
  const autodate = (name, onUpdate) => ({ type: 'autodate', name, onCreate: true, onUpdate });

  // --- users: the built-in auth collection -------------------------------
  const users = app.findCollectionByNameOrId('users');
  if (!users.fields.getByName('name')) users.fields.add(new TextField({ name: 'name', max: 255 }));
  users.fields.add(new SelectField({ name: 'role', values: ['rep', 'admin'], maxSelect: 1, required: true }));
  users.listRule = `id = @request.auth.id || ${ADMIN}`;
  users.viewRule = `id = @request.auth.id || ${ADMIN}`;
  users.createRule = ADMIN;
  users.updateRule = ADMIN;
  users.deleteRule = `${ADMIN} && id != @request.auth.id`;
  // Lets admins create users as already-verified and set their passwords
  // without the old one: this replaces the Supabase admin-users function.
  users.manageRule = ADMIN;
  users.authToken.duration = 60 * 60 * 24 * 30; // 30 days: reps work offline in the field
  users.resetPasswordTemplate.subject = 'Reset your EcoVite lick app password';
  users.resetPasswordTemplate.body =
    '<p>Hello,</p>' +
    '<p>Click the link below to choose a new password for the EcoVite lick app.</p>' +
    '<p><a href="{APP_URL}/#reset-password={TOKEN}" target="_blank" rel="noopener">Set a new password</a></p>' +
    '<p>If you didn\'t ask for this, you can ignore this email.</p>';
  app.save(users);

  // --- ingredients ---------------------------------------------------------
  const ingredients = new Collection({
    type: 'base',
    name: 'ingredients',
    listRule: SIGNED_IN,
    viewRule: SIGNED_IN,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: ADMIN,
    fields: [
      { type: 'text', name: 'name', required: true, max: 200 },
      { type: 'bool', name: 'is_active' },
      { type: 'text', name: 'notes', max: 5000 },
      { type: 'number', name: 'bag_size_kg', min: 0 },
      { type: 'number', name: 'price_per_bag', min: 0 },
      { type: 'number', name: 'price_per_ton', min: 0 },
      // { nutrientId: number }. Absent key = not analysed, 0 = analysed zero.
      { type: 'json', name: 'values', maxSize: 20000 },
      autodate('created', false),
      autodate('updated', true),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_ingredients_name ON ingredients (name)'],
  });
  app.save(ingredients);

  // --- price_overrides: a rep's own price, never visible to anyone else --
  const priceOverrides = new Collection({
    type: 'base',
    name: 'price_overrides',
    listRule: 'owner = @request.auth.id',
    viewRule: 'owner = @request.auth.id',
    createRule: `${SIGNED_IN} && @request.body.owner = @request.auth.id`,
    updateRule: 'owner = @request.auth.id && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)',
    deleteRule: 'owner = @request.auth.id',
    fields: [
      { type: 'relation', name: 'owner', collectionId: users.id, cascadeDelete: true, maxSelect: 1, required: true },
      { type: 'relation', name: 'ingredient', collectionId: ingredients.id, cascadeDelete: true, maxSelect: 1, required: true },
      { type: 'number', name: 'price_per_ton', min: 0 },
      autodate('updated', true),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_price_overrides_owner_ingredient ON price_overrides (owner, ingredient)'],
  });
  app.save(priceOverrides);

  // --- settings: npn_safety_limits / nutrient_targets / production_targets
  const settings = new Collection({
    type: 'base',
    name: 'settings',
    listRule: SIGNED_IN,
    viewRule: SIGNED_IN,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: ADMIN,
    fields: [
      { type: 'text', name: 'key', required: true, max: 100 },
      { type: 'json', name: 'value', maxSize: 200000 },
      autodate('updated', true),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_settings_key ON settings (key)'],
  });
  app.save(settings);

  // --- mixes: saved licks with their frozen snapshot ----------------------
  const mixes = new Collection({
    type: 'base',
    name: 'mixes',
    listRule: `${SIGNED_IN} && (${OWNER_OR_ADMIN} || is_public = true)`,
    viewRule: `${SIGNED_IN} && (${OWNER_OR_ADMIN} || is_public = true)`,
    createRule: `${SIGNED_IN} && @request.body.owner = @request.auth.id`,
    // Snapshots are immutable once written; only is_public / name may change.
    updateRule: `${OWNER_OR_ADMIN} && @request.body.owner:isset = false && @request.body.lines:isset = false && @request.body.snapshot:isset = false`,
    // Deliberately no admin bypass, matching the Supabase policy.
    deleteRule: 'owner = @request.auth.id',
    fields: [
      { type: 'relation', name: 'owner', collectionId: users.id, cascadeDelete: true, maxSelect: 1, required: true },
      { type: 'text', name: 'name', max: 200 },
      { type: 'select', name: 'species', values: ['cattle', 'sheep'], maxSelect: 1, required: true },
      { type: 'select', name: 'supplement_type', values: ['maintenance', 'production'], maxSelect: 1, required: true },
      { type: 'select', name: 'lick_focus', values: ['energy', 'phosphorus', 'protein', 'production'], maxSelect: 1 },
      { type: 'bool', name: 'is_public' },
      { type: 'json', name: 'lines', maxSize: 100000 },
      { type: 'json', name: 'snapshot', maxSize: 2000000 },
      autodate('created', false),
      autodate('updated', true),
    ],
    indexes: ['CREATE INDEX idx_mixes_owner ON mixes (owner)'],
  });
  app.save(mixes);
}, (app) => {
  for (const name of ['mixes', 'settings', 'price_overrides', 'ingredients']) {
    app.delete(app.findCollectionByNameOrId(name));
  }
  const users = app.findCollectionByNameOrId('users');
  users.fields.removeByName('role');
  users.listRule = 'id = @request.auth.id';
  users.viewRule = 'id = @request.auth.id';
  users.createRule = '';
  users.updateRule = 'id = @request.auth.id';
  users.deleteRule = 'id = @request.auth.id';
  users.manageRule = null;
  app.save(users);
});
