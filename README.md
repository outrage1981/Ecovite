# EcoVite Lick Cost Comparison

A responsive web app for building and comparing cattle/sheep lick mixes by
cost per head — the same maths as `EcoVite Cost Comparison - 23032026 - AD.xlsx`,
rebuilt so the ingredient database lives in one place you control, reps get
a clean phone-friendly picker instead of a spreadsheet, and a handful of
spreadsheet bugs can't happen anymore (see "What changed" below).

It's a static site — no build step, no Node required. Everything runs as
plain HTML/CSS/JS in the browser, talking to a [Supabase](https://supabase.com)
project (free tier is plenty for 5-8 reps) for the ingredient database,
login, and saved-mix history.

## Try it with zero setup

**Don't just double-click `index.html`.** This app uses ES modules, which
browsers refuse to load over the `file://` protocol — you'll get a
"Loading…" screen that never finishes, with no error shown. It has to be
served over `http://`, even locally. Two ways to do that, no Node needed:

```powershell
powershell -File tools/static-server.ps1 -Port 8080
```

or, since you have Python installed:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`. With `js/config.js` left untouched, the
app runs in **demo mode**: an in-browser copy of the ingredient database,
seeded from the workbook, persisted to `localStorage`.

- Admin: `admin@demo.local` / `admin123`
- Rep: `rep@demo.local` / `rep123`

Nothing you do in demo mode reaches a server — it's there so you (and your
colleague) can click through the whole thing, including editing ingredients,
before setting up Supabase.

**Seeing stale or missing data** (e.g. ingredients with no price) after
pulling a code update? Demo mode seeds itself once per browser and never
re-seeds on its own — it has no idea the underlying data changed. Click
**"Reset demo data"** on the login screen (or, once signed in as admin,
on the Settings tab) to wipe it and start fresh from the current code.

## Setting up the real backend (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, go to **SQL Editor** and run, in this order:
   - `sql/001_schema.sql`
   - `sql/002_rls_policies.sql`
   - `sql/003_seed_data.sql`
3. In **Project Settings → API**, copy the **Project URL** and **anon public
   key** into `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
4. Create your reps as users: **Authentication → Users → Add user** (set an
   email + password for each). A `profiles` row is created automatically
   with `role = 'rep'`.
5. Promote yourself (and anyone else who should manage the ingredient
   database) to admin — in the SQL Editor:
   ```sql
   update profiles set role = 'admin' where id =
     (select id from auth.users where email = 'you@example.com');
   ```
6. Reload the app — it's no longer in demo mode. Sign in with the account
   you just promoted and you'll see the **Ingredients** and **Settings**
   tabs.

From here, everything an admin does in the app (adding an ingredient,
editing Act 36 limits, editing lick targets) writes straight to Supabase.
Reps only ever get read access to that data — see `sql/002_rls_policies.sql`.

## Deploying for your reps

Any static hosting works — there's nothing to build. The easiest options,
all free at this scale:

- **Netlify / Cloudflare Pages**: drag the whole project folder onto their
  dashboard, done.
- **Vercel**: `vercel --prod` from this folder (or connect the folder via
  their dashboard).

Once it's live, each rep opens the URL on their phone, signs in, and taps
**Add to Home Screen** (Safari: Share → Add to Home Screen; Chrome:
⋮ menu → Add to Home Screen). It then opens full-screen with an icon like
any other app, and keeps working with no signal — the full ingredient list
is cached on the device the first time it loads, and only re-downloaded
when you've actually changed something (see the "data as of" line at the
bottom of the Compare Licks screen).

## Ingredient pricing

Each ingredient has three pricing fields in the admin editor:

- **Bag size (kg)** and **Price per bag (R/bag)** — fill these in and the
  **Price per ton (R/ton)** field auto-calculates (`price per bag ÷ bag
  size × 1000`) as you type.
- **Price per ton** can also be typed directly — useful when you don't have
  bag pricing for something. It stays a normal editable field, so the
  auto-calculated value is just a starting point you can overwrite.

This price per ton is the ingredient's *default* cost — it never overrides
what a rep types on the Compare Licks screen, and a rep's override never
writes back to the database; it only affects their own mix.

The **"Use default prices"** toggle at the top of Compare Licks controls
what happens when a rep picks an ingredient: on, the R/ton field fills in
from the database; off, it starts at R0 (the original behavior, for reps
who'd rather always type their own number). Flipping the toggle only
affects ingredients picked from that point on — it won't silently overwrite
a cost a rep has already typed in.

The 28 ingredients currently ship with **generic placeholder pricing**
(bag sizes 10-50kg, made-up prices) purely so you have something to test
against — replace them with real figures via the admin Ingredients screen
whenever you're ready.

## Comparing licks side by side

Three selectors sit above the mix builder:

- **Species** and **Physiological State** (Maintenance/Production) — as
  before, these drive the lick-contribution targets and the Act 36 NPN
  limit.
- **Supplement Type** — Energy / Phosphate / Protein Lick. This doesn't
  change any calculation; it picks which of a mix's three scenario cards
  (already computed either way) the comparison report below is built from.

Reps start with 2 lick panels (Mix A/B) as before, but **"+ Add another
lick"** appends a 3rd and 4th (Mix C/D) — the button disappears once you're
at 4. Each panel carries a **Saved / Unsaved** badge next to its name, so
it's obvious at a glance which licks are stale. A ✕ in the top-right corner
of a panel removes it (can't remove the last one); this only drops the
working panel, it never deletes anything already saved to History.

**Clone saved mix**, next to "+ Add ingredient" on each panel, opens a
picker of your own saved licks — pick one and its ingredients, inclusion %,
and prices (exactly as saved, not recalculated) replace whatever was in
that panel, with `-copy` appended to the name. Saves rebuilding something
you've already built before. Ingredients that no longer exist are skipped
silently rather than left broken.

**Compare Licks** builds a summary table — cost/ton, cost/bag, then the
Minimum Lick Intake / Supplement Cost / [Nutrient] Supplemented rows for
whichever Supplement Type is selected, and an NPN Safe/Risk badge — with
one column per lick and a dedicated Unit column, mirroring the layout of
the original workbook's supplementation tables. It only ever reads from
each lick's **last saved snapshot**, never live in-progress values, so:

- Comparing is blocked with a clear message if fewer than 2 licks have any
  inclusion, or if any lick with inclusion hasn't been saved (or was edited
  since its last save) — you can't accidentally compare stale or
  in-progress numbers.
- Switching the Supplement Type dropdown after comparing re-renders the
  table instantly from the same saved snapshots — no need to hit Compare
  again, since all three scenarios were already computed at save time.

This comparison table lives inline on Compare Licks for now. A dedicated
report page (shareable/printable, same Supplement Type-driven layout) is a
planned follow-up, not built yet.

## Saving a mix, and the History tab

Hitting "Save this mix" runs two checks first:

- **Total inclusion isn't 100%** — a "Save anyway? / Continue editing" prompt,
  since a rep might genuinely want to save a partial mix mid-comparison.
- **The name is already used** (by that same user) — a prompt to either
  **override** the existing saved mix (deletes it and saves the new one in
  its place) or **rename** (closes the prompt and selects the mix name field
  so you can just type over it). Two different users can each have a mix
  called the same thing — the check only ever looks at your own.

Every saved mix is a full, frozen snapshot — ingredients, inclusion %, cost,
the complete nutrient specification, and all three scenario cards — so
editing an ingredient afterward can never change what a saved comparison
shows.

The **History** tab lists every mix you've saved; clicking one opens the
full detail exactly as described above. Reps only ever see their own —
admins see every rep's, labelled with who saved it — enforced by the same
row-level security as the ingredient database (`sql/002_rls_policies.sql`),
not just by what the UI happens to show. The "Recently saved mixes" strip
at the bottom of Compare Licks is a shortcut to your own last 5; History has
the rest.

### Compare Saved Licks

The **"Compare Saved Licks"** button on History opens a picker: choose a
Species and Physiological State, then check 2-6 saved licks from the
(filtered) list under that combination — filtered so the comparison can
never mix, say, a cattle-maintenance lick with a sheep-production one, since
they're built against different targets and NPN limits.

The resulting master table is more complete than the single-focus one on
Compare Licks — it always shows all three nutrient blocks (Phosphorus,
Energy, Protein), each with Minimum Lick Intake / Supplement Cost /
[Nutrient] Supplemented, plus one NPN row at the bottom. Because a lick's
NPN figure depends on which of the three intakes you evaluate it at, that
NPN row reports the **worst case across all three** — whichever basis
produces the higher NPN figure, with a Risk badge if any of the three would
be Risk. This matters in practice: a lick can look perfectly safe evaluated
at its (small) protein-driven intake while being genuinely risky if a rep
recommends it as a phosphorus lick, because hitting a trace-level phosphorus
target can require eating far more of it. Worst-case reporting means that
risk shows up here regardless of which nutrient the lick ends up being sold
on.

## How the numbers work

The calculation engine is `js/calc.js` — plain, dependency-free functions,
each one short enough to read top to bottom. In short:

- Every mix's nutrient specification is the inclusion-weighted average of
  its ingredients, the same as the spreadsheet's `SUMPRODUCT`.
- For phosphorus, protein, and energy, the app back-calculates the minimum
  lick intake (g/head/day) needed to hit that nutrient's target, then costs
  that intake — so every mix gets three different cost-per-head figures
  depending on which nutrient you're selling on, exactly like the original.
- NPN safety (Act 36) is checked against **each** of those three intake
  levels independently, so the risk badge reflects whichever amount you're
  actually recommending — not always the protein-driven one.

## What changed from the spreadsheet

A few issues in the original workbook get fixed structurally, not just
patched:

- **Ammonium Chloride's missing NPN.** The sheet had this ingredient's
  %-ex-NPN filled in but the NPN cell itself blank, so it silently
  contributed zero NPN to any ration containing it — the one check meant to
  catch a urea-poisoning risk. NPN and ME are no longer stored values at
  all; they're always calculated from crude protein / %-NPN and TDN
  respectively (`js/calc.js`, `deriveNpn` / `deriveMe`), so there's nowhere
  left to enter one field and forget the other.
- **False "RISK" on an empty ration.** The sheet's safety check used
  `COUNT(...)=0` to detect "nothing entered yet", which never actually
  equalled zero because the limit cell always had a value — so every unused
  ration column showed RISIKO. The app returns "no data" (—) instead of a
  status when there's nothing to evaluate.
- **Missing lab data vs. an analysed zero.** The spreadsheet couldn't tell
  "this ingredient has no copper" from "we've never tested it for copper" —
  both just read 0. The app stores no data as genuinely empty and shows
  "no data" in the mix specification when a nutrient total is built from an
  ingredient with a gap, instead of silently understating it.
- **The printed report dropping ingredients past the 13th slot.** Not
  applicable here — the app has no separate "report" data path to fall out
  of sync with the input.
- **A saved comparison changing after the fact.** Editing an ingredient in
  the admin screen no longer touches a mix you've already saved — hitting
  "Save this mix" freezes a full copy of the ingredient values, inclusion,
  cost, and computed results at that moment (`mix_snapshots` table), so a
  comparison you've shown a farmer stays exactly as shown.
- **Sanity-check on save.** Typing an implausible value (e.g. crude fibre
  of 250%) prompts a confirmation instead of silently saving — cheap
  insurance against the kind of typo that's easy to miss in a spreadsheet
  full of numbers.

## Editable settings

The Act 36 NPN limits and the lick-contribution targets (Settings tab) are
editable, not hard-coded — the source workbook only ever defined the
maintenance-cattle targets, so production and sheep targets start blank
until you fill them in with real figures.

## Project layout

```
index.html            App shell + login screen
css/style.css          Design system (theme, cards, forms)
js/app.js               Auth + tab routing
js/rep.js                Mix builder (Compare Licks tab)
js/history.js              Saved-mix history + detail view
js/mixRender.js             Result rendering shared by rep.js and history.js
js/admin.js               Ingredient editor + Settings tab
js/calc.js                 Calculation engine (pure functions, no DOM)
js/db.js                    Data access layer (Supabase or local demo store)
js/seedData.js               Ingredient matrix transcribed from the workbook
js/config.js                  Your Supabase URL / anon key
sql/001_schema.sql             Tables
sql/002_rls_policies.sql        Row-level security
sql/003_seed_data.sql            Same data as seedData.js, for Supabase
manifest.webmanifest, sw.js       PWA install + offline app shell
tools/static-server.ps1            Local dev server (no Node needed)
```

## Known limitations (v1)

- The PWA icon is an SVG (`icons/icon.svg`). Android/Chrome handle this
  fine; iOS's home-screen icon support for SVG is inconsistent across
  versions. Swap in real PNG icons (192×192, 512×512) if that matters —
  just update `manifest.webmanifest` and the `apple-touch-icon` link in
  `index.html`.
- Only two mixes are shown side by side by default (matching what you
  described), not the six columns the original sheet supported. Reps can
  still build one mix, save it, clear it, and build the next if they want
  to compare more than two.
