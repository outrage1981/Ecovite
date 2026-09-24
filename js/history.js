import { getBackend } from './db.js';
import { escapeHtml, fmt } from './app.js';
import { renderScenarioCard, renderSpecTable, renderResultsStrip, comparisonRow, comparisonGroupRow, npnBadge } from './mixRender.js';
import { openReportFlow } from './report.js';
import { LICK_FOCUS_OPTIONS } from './seedData.js';

const NPN_LICK_LABELS = { phosphorus: 'Phosphorus Lick', protein: 'Protein Lick', energy: 'Energy Lick', production: 'Production Lick' };

const MIN_COMPARE = 2;
const MAX_COMPARE = 6;

// Favourites are a personal, per-viewer preference (not a property of the
// mix itself — an admin favouriting a rep's lick shouldn't pin it for that
// rep too), so they live in localStorage keyed by the viewer, the same way
// the report flow's recent client/area names do.
const FAVORITES_KEY_PREFIX = 'ecovite.favoriteMixes.';

function loadFavoriteIds(profile) {
  try {
    const list = JSON.parse(localStorage.getItem(FAVORITES_KEY_PREFIX + profile.id));
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

function saveFavoriteIds(profile, idSet) {
  localStorage.setItem(FAVORITES_KEY_PREFIX + profile.id, JSON.stringify([...idSet]));
}

// Filter selections are just a view convenience (not saved anywhere), but
// kept at module scope so they survive the full re-render this file does
// after every action (favouriting, deleting, ...) rather than resetting
// back to "All" each time.
let filterSpeciesId = 'all';
let filterLickFocus = 'all';

function lickFocusLabel(id) {
  return LICK_FOCUS_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

export async function renderHistoryView(root, profile) {
  root.innerHTML = `<div class="empty-state">Loading…</div>`;
  const backend = await getBackend();
  const [nutrients, species, supplementTypes, mixes] = await Promise.all([
    backend.listNutrients(),
    backend.listSpecies(),
    backend.listSupplementTypes(),
    backend.listSavedMixes().catch(() => []),
  ]);

  const speciesLabel = (id) => species.find((s) => s.id === id)?.label ?? id;
  const typeLabel = (id) => supplementTypes.find((t) => t.id === id)?.label ?? id;
  const isAdmin = profile.role === 'admin';
  const showOwner = isAdmin;

  if (mixes.length === 0) {
    root.innerHTML = `
      <div class="card empty-state">
        No saved mixes yet. Build a comparison on the Compare Licks tab and hit "Save this mix" to see it here.
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="card">
      <div class="toolbar" style="margin-bottom:4px;">
        <h2 style="margin:0;">${isAdmin ? 'All saved mixes' : 'Your saved mixes'}</h2>
        <button class="btn btn-primary" id="compare-saved-btn">Compare Saved Licks</button>
      </div>
      ${isAdmin ? '<p class="muted">As an admin you can see every rep’s saved mixes here; reps only ever see their own, plus any you’ve marked Public.</p>' : ''}
      ${!isAdmin ? '<p class="muted">Your own saved mixes and shared default mixes.</p>' : ''}
      <div class="section-label" style="margin:8px 0 6px;">Filter by</div>
      <div class="filter-row" style="margin-bottom:14px;">
        <label class="field">
          <span>Species</span>
          <select id="filter-species">
            <option value="all">All species</option>
            ${species.map((s) => `<option value="${s.id}" ${filterSpeciesId === s.id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Lick type</span>
          <select id="filter-focus">
            <option value="all">All lick types</option>
            ${LICK_FOCUS_OPTIONS.map((o) => `<option value="${o.id}" ${filterLickFocus === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div id="history-list"></div>
    </div>
  `;

  document.getElementById('compare-saved-btn').addEventListener('click', () => {
    openCompareSelector(mixes, species, supplementTypes, profile);
  });
  document.getElementById('filter-species').addEventListener('change', (e) => {
    filterSpeciesId = e.target.value;
    renderHistoryView(root, profile);
  });
  document.getElementById('filter-focus').addEventListener('change', (e) => {
    filterLickFocus = e.target.value;
    renderHistoryView(root, profile);
  });

  const favoriteIds = loadFavoriteIds(profile);
  const filteredMixes = mixes.filter(
    (m) => (filterSpeciesId === 'all' || m.speciesId === filterSpeciesId) && (filterLickFocus === 'all' || m.lickFocus === filterLickFocus)
  );

  const listEl = document.getElementById('history-list');
  if (filteredMixes.length === 0) {
    listEl.innerHTML = `<div class="card empty-state">No saved mixes match this filter.</div>`;
    return;
  }

  // Species > lick type, each bucket sorted with favourites pinned first
  // and everything else newest-first — a mix that's unfavourited drops
  // straight back into its plain chronological spot in the same bucket.
  const focusBuckets = [...LICK_FOCUS_OPTIONS.map((o) => o.id), 'uncategorised'];
  const sortBucket = (list) =>
    [...list].sort((a, b) => {
      const aFav = favoriteIds.has(a.id);
      const bFav = favoriteIds.has(b.id);
      if (aFav !== bFav) return aFav ? -1 : 1;
      return new Date(b.savedAt) - new Date(a.savedAt);
    });

  species.forEach((sp) => {
    const speciesMixes = filteredMixes.filter((m) => m.speciesId === sp.id);
    if (speciesMixes.length === 0) return;

    const speciesHeading = document.createElement('h3');
    speciesHeading.textContent = sp.label;
    speciesHeading.style.marginTop = '18px';
    speciesHeading.style.fontSize = '1.15rem';
    listEl.appendChild(speciesHeading);

    focusBuckets.forEach((focusId) => {
      const bucketMixes = speciesMixes.filter((m) => (m.lickFocus ?? 'uncategorised') === focusId);
      if (bucketMixes.length === 0) return;

      const focusHeading = document.createElement('div');
      focusHeading.className = 'section-label';
      focusHeading.textContent = focusId === 'uncategorised' ? 'Uncategorised' : lickFocusLabel(focusId);
      listEl.appendChild(focusHeading);

      const bucketEl = document.createElement('div');
      bucketEl.className = 'ing-list';
      sortBucket(bucketMixes).forEach((m) => {
        bucketEl.appendChild(buildMixRow(m, { root, profile, nutrients, speciesLabel, typeLabel, showOwner, isAdmin, favoriteIds }));
      });
      listEl.appendChild(bucketEl);
    });
  });
}

function buildMixRow(m, { root, profile, nutrients, speciesLabel, typeLabel, showOwner, isAdmin, favoriteIds }) {
  const snap = m.snapshot;
  const costLine = snap?.result
    ? `R${fmt(snap.result.costPerTon, 0)}/ton · R${fmt(snap.result.costPerBag, 2)}/bag`
    : 'No detail saved';
  const isFav = favoriteIds.has(m.id);
  const canDelete = m.ownerId === profile.id;
  const canTogglePublic = isAdmin && canDelete;
  const row = document.createElement('div');
  row.className = 'ing-row';
  row.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <button class="favorite-star${isFav ? ' is-favorite' : ''}" data-role="favorite-toggle" title="${isFav ? 'Remove from favourites' : 'Add to favourites'}">${isFav ? '★' : '☆'}</button>
      <div>
        <strong>${escapeHtml(m.name)}</strong>${m.isPublic ? ' <span class="badge badge-safe">Shared</span>' : ''}
        <div class="ing-meta">
          ${escapeHtml(speciesLabel(m.speciesId))} · ${escapeHtml(typeLabel(m.supplementTypeId))} · ${costLine}
          <br>${escapeHtml(new Date(m.savedAt).toLocaleString())}${showOwner ? ` · ${escapeHtml(m.ownerEmail || m.ownerName || 'Unknown')}` : ''}
        </div>
      </div>
    </div>
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
      ${canTogglePublic ? `<button class="btn ${m.isPublic ? 'btn-safe' : 'btn-secondary'} btn-sm" data-role="toggle-public" style="border-radius:999px;" title="${m.isPublic ? 'Visible to all reps — click to make private again' : 'Only visible to admins — click to share with all reps'}">${m.isPublic ? 'Public ✓' : 'Make Public'}</button>` : ''}
      ${canDelete ? `<button class="btn btn-danger btn-sm" data-role="delete-mix" style="border-radius:999px;" title="Delete this mix">Delete</button>` : ''}
      <span class="faint">View mix →</span>
    </div>
  `;
  row.querySelector('[data-role="favorite-toggle"]').addEventListener('click', (e) => {
    e.stopPropagation();
    if (favoriteIds.has(m.id)) favoriteIds.delete(m.id);
    else favoriteIds.add(m.id);
    saveFavoriteIds(profile, favoriteIds);
    renderHistoryView(root, profile);
  });
  row.querySelector('[data-role="toggle-public"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const backend = await getBackend();
      await backend.setMixPublic(m.id, !m.isPublic);
      renderHistoryView(root, profile);
    } catch (err) {
      alert(err.message || 'Could not update this mix.');
    }
  });
  row.querySelector('[data-role="delete-mix"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${m.name}"?`)) return;
    try {
      const backend = await getBackend();
      await backend.deleteSavedMix(m.id);
      favoriteIds.delete(m.id);
      saveFavoriteIds(profile, favoriteIds);
      renderHistoryView(root, profile);
    } catch (err) {
      alert(err.message || 'Could not delete this mix.');
    }
  });
  row.addEventListener('click', () => openDetail(m, nutrients, speciesLabel, typeLabel, showOwner, profile));
  return row;
}

function openDetail(mix, nutrients, speciesLabel, typeLabel, showOwner, profile) {
  const snap = mix.snapshot;
  if (!snap) return;

  // Same restriction as the live builder: a single-ingredient mix's
  // weighted average is just that ingredient's raw spec, so don't let a
  // rep pull it out of a saved mix either.
  const activeIngredientCount = (snap.lines || []).filter((l) => (Number(l.inclusionPct) || 0) > 0).length;
  const restrictSpec = profile.role !== 'admin' && activeIngredientCount < 2;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:820px;">
      <div class="modal-head">
        <div>
          <h2>${escapeHtml(mix.name)}</h2>
          <p class="faint" style="margin:0;">
            ${escapeHtml(speciesLabel(mix.speciesId))} · ${escapeHtml(typeLabel(mix.supplementTypeId))}
            · ${escapeHtml(new Date(mix.savedAt).toLocaleString())}${showOwner ? ` · ${escapeHtml(mix.ownerEmail || mix.ownerName || 'Unknown')}` : ''}
          </p>
        </div>
        <button class="icon-btn" data-role="close">✕</button>
      </div>

      <div class="section-label">Ingredients</div>
      ${renderIngredientTable(snap.lines)}

      <div class="section-label">Cost</div>
      <div class="results-strip">${renderResultsStrip(snap.result)}</div>

      <div class="section-label">Cost per head, by nutrient sold on</div>
      ${['phosphorus', 'protein', 'energy', 'production']
        .filter((key) => snap.result.scenarios[key] && (key !== 'production' || mix.supplementTypeId === 'production'))
        .map((key) => renderScenarioCard(snap.result.scenarios[key]))
        .join('')}

      <div class="section-label">Full nutrient specification (% as-is)</div>
      ${renderSpecTable(snap.result.specification, nutrients, { restricted: restrictSpec })}
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-role="close"]').addEventListener('click', () => backdrop.remove());
}

function renderIngredientTable(lines) {
  const totalKg = (lines || []).reduce((s, l) => s + (Number(l.inclusionPct) || 0), 0);
  const rows = (lines || [])
    .map((l) => {
      const kg = Number(l.inclusionPct) || 0;
      const pct = totalKg > 0 ? (kg / totalKg) * 100 : 0;
      return `
      <tr>
        <td>${escapeHtml(l.ingredientName)}</td>
        <td class="num">${fmt(kg, 2)}</td>
        <td class="num">${fmt(pct, 1)}%</td>
        <td class="num">R${fmt(l.costPerTon, 0)}</td>
      </tr>`;
    })
    .join('');
  return `
    <table class="spec-table history-ingredient-table" style="margin-bottom:18px;">
      <thead><tr><th>Ingredient</th><th>Incl. (kg)</th><th>%</th><th>R / ton</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------
// Compare Saved Licks: pick 2-6 licks (filtered to one species +
// physiological state, so the comparison never mixes e.g. a cattle
// maintenance lick with a sheep production one), then a master table
// covering all three nutrients plus a worst-case NPN row.
// ---------------------------------------------------------------------

function openCompareSelector(mixes, species, supplementTypes, profile) {
  let selSpecies = species[0]?.id;
  let selState = supplementTypes[0]?.id;
  const selectedIds = new Set();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:600px;">
      <div class="modal-head">
        <h2>Compare Saved Licks</h2>
        <button class="icon-btn" data-role="close">✕</button>
      </div>
      <div class="field-row">
        <label class="field">
          <span>Species</span>
          <select id="cmp-species">${species.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}</select>
        </label>
        <label class="field">
          <span>Physiological State</span>
          <select id="cmp-state">${supplementTypes.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}</select>
        </label>
      </div>
      <p class="muted">
        Pick ${MIN_COMPARE} to ${MAX_COMPARE} saved licks to compare — only licks saved under the
        species and state above are listed
      </p>
      <div id="cmp-lick-list" class="ing-list" style="max-height:320px; overflow-y:auto;"></div>
      <p class="form-error" id="cmp-select-error" hidden></p>
      <button class="btn btn-primary" id="cmp-run-btn" style="margin-top:14px;">Compare</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  function close() { backdrop.remove(); }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-role="close"]').addEventListener('click', close);

  function renderLickList() {
    selectedIds.clear();
    document.getElementById('cmp-select-error').hidden = true;
    const listEl = document.getElementById('cmp-lick-list');
    const matching = mixes.filter((m) => m.speciesId === selSpecies && m.supplementTypeId === selState && m.snapshot);
    if (matching.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No saved licks match this species and state.</div>';
      return;
    }
    listEl.innerHTML = matching
      .map(
        (m) => `
        <label class="ing-row" style="cursor:pointer;">
          <span style="display:flex; align-items:center; gap:10px;">
            <input type="checkbox" data-id="${m.id}" />
            <span>
              <strong>${escapeHtml(m.name)}</strong>
              <div class="ing-meta">${escapeHtml(new Date(m.savedAt).toLocaleString())}</div>
            </span>
          </span>
        </label>`
      )
      .join('');
    listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        if (e.target.checked) selectedIds.add(e.target.dataset.id);
        else selectedIds.delete(e.target.dataset.id);
      });
    });
  }
  renderLickList();

  document.getElementById('cmp-species').addEventListener('change', (e) => {
    selSpecies = e.target.value;
    renderLickList();
  });
  document.getElementById('cmp-state').addEventListener('change', (e) => {
    selState = e.target.value;
    renderLickList();
  });

  document.getElementById('cmp-run-btn').addEventListener('click', () => {
    const errorEl = document.getElementById('cmp-select-error');
    if (selectedIds.size < MIN_COMPARE || selectedIds.size > MAX_COMPARE) {
      errorEl.textContent = `Select between ${MIN_COMPARE} and ${MAX_COMPARE} licks to compare.`;
      errorEl.hidden = false;
      return;
    }
    const selected = mixes.filter((m) => selectedIds.has(m.id));
    const speciesLbl = species.find((s) => s.id === selSpecies)?.label ?? selSpecies;
    const stateLbl = supplementTypes.find((t) => t.id === selState)?.label ?? selState;
    close();
    openMasterComparison(selected, speciesLbl, stateLbl, selState, profile);
  });
}

// One row per lick type, each checked against the same Act 36 limit for the
// species/state being compared (e.g. Cattle-Production: 48 g N/hd/day) —
// replaces the old single "worst case across three nutrients" row so a
// Production-lick NPN check is no longer left out, and so a risk under one
// lick type is never hidden behind a safer figure from another.
function npnScenarioRow(snaps, key) {
  return `<tr><td>${escapeHtml(NPN_LICK_LABELS[key])}</td><td class="faint">g N/hd/day</td>${snaps
    .map((s) => {
      const scenario = s.result.scenarios[key];
      const supplied = scenario?.npnSuppliedG != null ? fmt(scenario.npnSuppliedG, 2) : '—';
      return `<td class="num">${supplied} ${npnBadge(scenario?.npnStatus)}</td>`;
    })
    .join('')}</tr>`;
}

function openMasterComparison(mixes, speciesLbl, stateLbl, stateId, profile) {
  const snaps = mixes.map((m) => m.snapshot);
  const colCount = 2 + snaps.length;

  const nutrientBlock = (key, sectionLabel, suppliedLabel, suppliedUnit, targetKey) => [
    comparisonGroupRow(sectionLabel, colCount),
    comparisonRow(snaps, 'Minimum Lick Intake', 'g/hd/day', (s) => fmt(s.result.scenarios[key].minLickIntakeG, 1)),
    comparisonRow(snaps, 'Supplement Cost', 'R/hd/day', (s) => (s.result.scenarios[key].costPerHead != null ? 'R' + fmt(s.result.scenarios[key].costPerHead, 2) : '—')),
    comparisonRow(snaps, suppliedLabel, suppliedUnit, (s) => fmt(s.result.scenarios[key][targetKey], 1)),
  ];

  // Only meaningful for licks saved under the "Production" physiological
  // state — same rule as the live builder's Production-driven card.
  const productionBlock = stateId === 'production' ? [
    comparisonGroupRow('Production Supplementation', colCount),
    comparisonRow(snaps, 'Minimum Lick Intake', 'g/hd/day', (s) => fmt(s.result.scenarios.production?.minLickIntakeG, 1)),
    comparisonRow(snaps, 'Supplement Cost', 'R/hd/day', (s) => (s.result.scenarios.production?.costPerHead != null ? 'R' + fmt(s.result.scenarios.production.costPerHead, 2) : '—')),
    comparisonRow(snaps, 'Protein Supplied', 'g/hd/day', (s) => fmt(s.result.scenarios.production?.proteinSuppliedG, 1)),
    comparisonRow(snaps, 'Energy Supplied', 'MJ/hd/day', (s) => fmt(s.result.scenarios.production?.energySuppliedMj, 1)),
  ] : [];

  const rows = [
    comparisonRow(snaps, 'Cost', 'R/ton', (s) => (s.result.costPerTon != null ? 'R' + fmt(s.result.costPerTon, 0) : '—')),
    comparisonRow(snaps, 'Cost', 'R/50kg bag', (s) => (s.result.costPerBag != null ? 'R' + fmt(s.result.costPerBag, 2) : '—')),
    ...nutrientBlock('phosphorus', 'Phosphorus Supplementation', 'Phosphorus Supplemented', 'g/hd/day', 'targetGPerHeadDay'),
    ...nutrientBlock('energy', 'Energy Supplementation', 'Energy Supplemented', 'MJ/hd/day', 'targetMjPerHeadDay'),
    ...nutrientBlock('protein', 'Protein Supplementation', 'Protein Supplemented', 'g/hd/day', 'targetGPerHeadDay'),
    ...productionBlock,
    comparisonGroupRow('NPN Safety — by lick type', colCount),
    npnScenarioRow(snaps, 'phosphorus'),
    npnScenarioRow(snaps, 'protein'),
    npnScenarioRow(snaps, 'energy'),
    ...(stateId === 'production' ? [npnScenarioRow(snaps, 'production')] : []),
  ].join('');

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:960px;">
      <div class="modal-head">
        <div>
          <h2>Lick Comparison</h2>
          <p class="faint" style="margin:0;">${escapeHtml(speciesLbl)} · ${escapeHtml(stateLbl)}</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary btn-sm" data-role="generate-report-btn">Generate Report</button>
          <button class="icon-btn" data-role="close">✕</button>
        </div>
      </div>
      <p class="faint">Built from each lick's saved snapshot. NPN safety is checked separately for each
        lick type against the Act 36 limit for this species and state, so a risk under one basis is
        never hidden by a safer one.</p>
      <div style="overflow-x:auto;">
        <table class="spec-table compare-table" id="master-comparison-table">
          <thead>
            <tr>
              <th>Metric</th><th>Unit</th>
              ${snaps.map((s) => `<th>${escapeHtml(s.mixName)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-role="close"]').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('[data-role="generate-report-btn"]').addEventListener('click', () => {
    openReportFlow({
      snaps,
      comparisonTableEl: backdrop.querySelector('#master-comparison-table'),
      profile,
    });
  });
}
