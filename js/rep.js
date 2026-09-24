import { getBackend, getIngredients, clearIngredientCache } from './db.js';
import { computeMixResult } from './calc.js';
import { escapeHtml, fmt } from './app.js';
import { renderScenarioCard, renderSpecTable, renderResultsStrip, comparisonRow, comparisonGroupRow, npnBadge } from './mixRender.js';
import { LICK_FOCUS_OPTIONS } from './seedData.js';
import { openReportFlow } from './report.js';

const MAX_MIXES = 4;

const FOCUS_META = {
  phosphorus: { sectionLabel: 'Phosphorus Supplementation', suppliedLabel: 'Phosphorus Supplemented', suppliedUnit: 'g/hd/day', targetKey: 'targetGPerHeadDay' },
  protein: { sectionLabel: 'Protein Supplementation', suppliedLabel: 'Protein Supplemented', suppliedUnit: 'g/hd/day', targetKey: 'targetGPerHeadDay' },
  energy: { sectionLabel: 'Energy Supplementation', suppliedLabel: 'Energy Supplemented', suppliedUnit: 'MJ/hd/day', targetKey: 'targetMjPerHeadDay' },
  production: { sectionLabel: 'Production Supplementation' }, // dual protein+energy target — built separately, see buildComparisonTable
};

function newMix(label) {
  return { name: label, lines: [], isDirty: true, savedSnapshot: null };
}

function newLine(ingredient, useDefaultPrices, priceOverrides) {
  return {
    ingredientId: ingredient?.id ?? '',
    inclusionKg: 0,
    costPerTon: resolvePrice(ingredient, useDefaultPrices, priceOverrides),
  };
}

// While "Use default prices" is off, a rep's own remembered price for this
// ingredient wins over the admin's shared default; ingredients they've
// never customised just fall back to that default as a starting point.
function resolvePrice(ingredient, useDefaultPrices, priceOverrides) {
  if (useDefaultPrices) return ingredient?.pricePerTon ?? 0;
  return priceOverrides?.[ingredient?.id] ?? ingredient?.pricePerTon ?? 0;
}

function mixIsInUse(mix) {
  return mix.lines.some((l) => (Number(l.inclusionKg) || 0) > 0);
}

// Keeps the builder's in-progress state (mixes, species/state pickers,
// toggles) alive across tab switches, keyed per signed-in user so it can't
// leak between accounts. Cleared explicitly on sign-out.
const stateCache = new Map();

export function resetRepViewState() {
  stateCache.clear();
}

export async function renderRepView(root, profile) {
  root.innerHTML = `<div class="empty-state">Loading ingredient data…</div>`;

  const backend = await getBackend();
  const [nutrients, species, supplementTypes, npnLimits, targets, productionTargets, cache, priceOverrides] = await Promise.all([
    backend.listNutrients(),
    backend.listSpecies(),
    backend.listSupplementTypes(),
    backend.getNpnSafetyLimits(),
    backend.getNutrientTargets(),
    backend.getProductionTargets(),
    getIngredients(),
    backend.getPriceOverrides().catch(() => ({})),
  ]);
  let savedMixes = await backend.listSavedMixes().catch(() => []);

  const ingredients = cache.ingredients.filter((i) => i.is_active);
  const specNutrients = nutrients; // full list, including derived npn/me, for the spec table

  const isNewState = !stateCache.has(profile.id);
  const state = stateCache.get(profile.id) ?? {
    speciesId: species[0]?.id ?? 'cattle',
    supplementTypeId: supplementTypes[0]?.id ?? 'maintenance',
    lickFocus: LICK_FOCUS_OPTIONS[0]?.id ?? 'energy',
    // Off by default: a rep's own remembered prices are more useful to
    // them day-to-day than the shared admin defaults.
    useDefaultPrices: false,
    showPercent: false,
    mixes: [newMix('Mix A'), newMix('Mix B')],
  };
  if (isNewState) {
    // seed one blank ingredient row each so the UI isn't empty
    state.mixes.forEach((m) => m.lines.push(newLine(ingredients[0], state.useDefaultPrices, priceOverrides)));
    stateCache.set(profile.id, state);
  }

  let lastComparedMixes = null; // survives across refreshResults(), cleared on full render()
  let mixRefreshers = []; // one refreshResults() per mix card, rebuilt each render()

  function currentTarget() {
    const t = targets.find((t) => t.species === state.speciesId && t.supplementType === state.supplementTypeId);
    return t
      ? { p: t.p, cp: t.cp, me: t.me, pNote: t.pNote, cpNote: t.cpNote, meNote: t.meNote }
      : { p: null, cp: null, me: null };
  }

  function currentMaxNpn() {
    return npnLimits?.[state.speciesId]?.[state.supplementTypeId] ?? null;
  }

  function currentProductionTarget() {
    return productionTargets?.[state.speciesId] ?? null;
  }

  function ingredientById(id) {
    return ingredients.find((i) => i.id === id);
  }

  // calc.js's weighted-average functions only ever use inclusionPct as a
  // relative weight (they divide by the sum across lines) — so passing kg
  // straight through works with no conversion, and the mix always resolves
  // to 100% of itself regardless of what the kg amounts add up to.
  function linesForCalc(mix) {
    return mix.lines
      .filter((l) => l.ingredientId)
      .map((l) => ({
        ingredientId: l.ingredientId,
        inclusionPct: Number(l.inclusionKg) || 0,
        costPerTon: Number(l.costPerTon) || 0,
        values: ingredientById(l.ingredientId)?.values || {},
      }));
  }

  function ingredientOptions(selectedId) {
    const options = ingredients
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((i) => `<option value="${i.id}" ${i.id === selectedId ? 'selected' : ''}>${escapeHtml(i.name)}</option>`)
      .join('');
    // Without this, a <select> with no matching value just silently shows
    // its first real option — which would make a genuinely blank row look
    // like it already has an ingredient chosen.
    return selectedId ? options : `<option value="" selected disabled>Select ingredient…</option>${options}`;
  }

  function goToHistoryTab() {
    document.querySelector('.tab-btn[data-tab="history"]')?.click();
  }

  function render() {
    const target = currentTarget();
    const maxNpn = currentMaxNpn();
    const dataDate = cache.fetchedAt ? new Date(cache.fetchedAt).toLocaleString() : 'unknown';
    lastComparedMixes = null; // a structural rebuild invalidates whatever was last compared

    function targetInfoHtml() {
      if (state.lickFocus === 'production') {
        const pt = currentProductionTarget();
        return `Production Lick contribution targets — Protein ${pt?.protein ?? '—'} g/hd/day, Energy ${pt?.energy ?? '—'} MJ/hd/day. Max safe NPN (Act 36): ${maxNpn ?? '—'} g N/hd/day.`;
      }
      return `Lick contribution targets — Protein ${target.cp ?? '—'} g/hd/day, Energy ${target.me ?? '—'} MJ/hd/day, Phosphorus ${target.p ?? '—'} g/hd/day. Max safe NPN (Act 36): ${maxNpn ?? '—'} g N/hd/day.`;
    }

    root.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <div class="field-row">
          <label class="field">
            <span>Species</span>
            <select id="species-select">
              ${species.map((s) => `<option value="${s.id}" ${s.id === state.speciesId ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Physiological State</span>
            <select id="type-select">
              ${supplementTypes.map((t) => `<option value="${t.id}" ${t.id === state.supplementTypeId ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Supplement Type</span>
            <select id="lick-focus-select">
              ${LICK_FOCUS_OPTIONS.filter((o) => !o.requiresState || o.requiresState === state.supplementTypeId)
                .map((o) => `<option value="${o.id}" ${o.id === state.lickFocus ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="display:flex; gap:24px; flex-wrap:wrap; margin-bottom:4px;">
          <label class="toggle-row">
            <span class="switch">
              <input type="checkbox" id="use-default-prices" ${state.useDefaultPrices ? 'checked' : ''} />
              <span class="slider"></span>
            </span>
            <span class="toggle-label">Use default prices</span>
          </label>
          <label class="toggle-row">
            <span class="switch">
              <input type="checkbox" id="show-percent" ${state.showPercent ? 'checked' : ''} />
              <span class="slider"></span>
            </span>
            <span class="toggle-label">Show formulation in %</span>
          </label>
        </div>
        <p class="faint" id="target-info">${targetInfoHtml()}</p>
      </div>

      <div class="mix-columns" id="mix-columns"></div>

      <div class="toolbar" style="margin-top:16px;">
        ${state.mixes.length < MAX_MIXES ? '<button class="btn btn-secondary" id="add-lick-btn">+ Add another lick</button>' : '<span></span>'}
        <button class="btn btn-primary" id="compare-btn">Compare Licks</button>
      </div>
      <p class="form-error" id="compare-error" hidden></p>
      <div id="comparison-section"></div>

      <div class="data-footer">
        <span>Ingredient data as of ${escapeHtml(dataDate)} · ${ingredients.length} active ingredients</span>
        <button class="btn btn-ghost btn-sm" id="refresh-btn">Refresh data</button>
      </div>

      <div id="saved-history-section"></div>
    `;

    document.getElementById('species-select').addEventListener('change', (e) => {
      state.speciesId = e.target.value;
      render();
    });
    document.getElementById('type-select').addEventListener('change', (e) => {
      state.supplementTypeId = e.target.value;
      // "Production Lick" only makes sense while the Physiological State is
      // Production — fall back to the default focus if it's no longer valid.
      const stillValid = LICK_FOCUS_OPTIONS.find((o) => o.id === state.lickFocus && (!o.requiresState || o.requiresState === state.supplementTypeId));
      if (!stillValid) state.lickFocus = LICK_FOCUS_OPTIONS[0].id;
      render();
    });
    document.getElementById('lick-focus-select').addEventListener('change', (e) => {
      state.lickFocus = e.target.value;
      document.getElementById('target-info').innerHTML = targetInfoHtml();
      // Refresh each mix card's scenario highlighting in place (not a full
      // render) so an already-built comparison table below isn't wiped out.
      mixRefreshers.forEach((refresh) => refresh());
      renderComparisonSection();
    });
    document.getElementById('use-default-prices').addEventListener('change', (e) => {
      state.useDefaultPrices = e.target.checked;
      // Swap every already-populated row over immediately — not just rows
      // added from here on — so flipping the toggle visibly shows admin
      // defaults vs. the rep's own remembered prices right away.
      state.mixes.forEach((mix) => {
        mix.lines.forEach((line) => {
          if (!line.ingredientId) return;
          line.costPerTon = resolvePrice(ingredientById(line.ingredientId), state.useDefaultPrices, priceOverrides);
        });
      });
      render();
    });
    document.getElementById('show-percent').addEventListener('change', (e) => {
      state.showPercent = e.target.checked;
      render();
    });
    document.getElementById('refresh-btn').addEventListener('click', async () => {
      const btn = document.getElementById('refresh-btn');
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      clearIngredientCache();
      await renderRepView(root, profile);
    });
    document.getElementById('add-lick-btn')?.addEventListener('click', () => {
      if (state.mixes.length >= MAX_MIXES) return;
      const label = String.fromCharCode('A'.charCodeAt(0) + state.mixes.length);
      const mix = newMix(`Mix ${label}`);
      mix.lines.push(newLine(ingredients[0], state.useDefaultPrices, priceOverrides));
      state.mixes.push(mix);
      render();
    });
    document.getElementById('compare-btn').addEventListener('click', () => {
      const errorEl = document.getElementById('compare-error');
      const inUseMixes = state.mixes.filter(mixIsInUse);

      if (inUseMixes.length < 2) {
        lastComparedMixes = null;
        errorEl.textContent = 'Build and save at least 2 licks before comparing.';
        errorEl.hidden = false;
        renderComparisonSection();
        return;
      }
      const unsaved = inUseMixes.filter((m) => m.isDirty || !m.savedSnapshot);
      if (unsaved.length) {
        lastComparedMixes = null;
        errorEl.textContent = `Save "${unsaved.map((m) => m.name).join('", "')}" before comparing — the comparison only uses saved licks.`;
        errorEl.hidden = false;
        renderComparisonSection();
        return;
      }

      errorEl.hidden = true;
      lastComparedMixes = inUseMixes;
      renderComparisonSection();
    });

    const columnsEl = document.getElementById('mix-columns');
    mixRefreshers = [];
    state.mixes.forEach((mix, mixIdx) => {
      const { wrap, refreshResults } = renderMixCard(mix, mixIdx, target, maxNpn);
      columnsEl.appendChild(wrap);
      mixRefreshers.push(refreshResults);
    });

    refreshSavedHistorySection();
    renderComparisonSection();
  }

  function renderComparisonSection() {
    const container = document.getElementById('comparison-section');
    if (!container) return;
    container.innerHTML = lastComparedMixes ? buildComparisonTable(lastComparedMixes, state.lickFocus) : '';
    container.querySelector('[data-role="generate-report-btn"]')?.addEventListener('click', () => {
      openReportFlow({
        snaps: lastComparedMixes.map((m) => m.savedSnapshot),
        comparisonTableEl: container.querySelector('#comparison-table'),
        profile,
      });
    });
  }

  function buildComparisonTable(mixes, lickFocus) {
    const meta = FOCUS_META[lickFocus];
    const focusOption = LICK_FOCUS_OPTIONS.find((o) => o.id === lickFocus);
    const snaps = mixes.map((m) => m.savedSnapshot);
    const colCount = snaps.length;

    const npnRow = `<tr><td>NPN status</td><td class="faint"></td>${snaps
      .map((s) => `<td>${npnBadge(s.result.scenarios[lickFocus]?.npnStatus)}</td>`)
      .join('')}</tr>`;

    const suppliedRows = lickFocus === 'production'
      ? [
          comparisonRow(snaps, 'Protein Supplied', 'g/hd/day', (s) => fmt(s.result.scenarios.production?.proteinSuppliedG, 1)),
          comparisonRow(snaps, 'Energy Supplied', 'MJ/hd/day', (s) => fmt(s.result.scenarios.production?.energySuppliedMj, 1)),
        ]
      : [comparisonRow(snaps, meta.suppliedLabel, meta.suppliedUnit, (s) => fmt(s.result.scenarios[lickFocus]?.[meta.targetKey], 1))];

    const rows = [
      comparisonRow(snaps, 'Cost', 'R/ton', (s) => (s.result.costPerTon != null ? 'R' + fmt(s.result.costPerTon, 0) : '—')),
      comparisonRow(snaps, 'Cost', 'R/50kg bag', (s) => (s.result.costPerBag != null ? 'R' + fmt(s.result.costPerBag, 2) : '—')),
      comparisonGroupRow(meta.sectionLabel, 2 + colCount),
      comparisonRow(snaps, 'Minimum Lick Intake', 'g/hd/day', (s) => fmt(s.result.scenarios[lickFocus]?.minLickIntakeG, 1)),
      comparisonRow(snaps, 'Supplement Cost', 'R/hd/day', (s) => (s.result.scenarios[lickFocus]?.costPerHead != null ? 'R' + fmt(s.result.scenarios[lickFocus].costPerHead, 2) : '—')),
      ...suppliedRows,
      npnRow,
    ].join('');

    return `
      <div class="card" style="margin-top:8px;">
        <h2>Comparison — ${escapeHtml(focusOption?.label ?? lickFocus)}</h2>
        <div style="overflow-x:auto;">
          <table class="spec-table compare-table" id="comparison-table">
            <thead>
              <tr>
                <th>Metric</th><th>Unit</th>
                ${snaps.map((s) => `<th>${escapeHtml(s.mixName)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="toolbar" style="margin-top:12px; justify-content:flex-end;">
          <button class="btn btn-primary" data-role="generate-report-btn">Generate Report</button>
        </div>
      </div>
    `;
  }

  // Only the "recently saved" strip refreshes after a save — not a full
  // render() — so the save confirmation message on the mix card itself
  // isn't wiped out the instant it appears.
  function refreshSavedHistorySection() {
    const container = document.getElementById('saved-history-section');
    if (!container) return;
    const own = savedMixes.filter((m) => m.ownerId === profile.id);
    container.innerHTML = own.length ? renderRecentMixes(own) : '';
    container.querySelector('[data-role="view-history"]')?.addEventListener('click', goToHistoryTab);
  }

  function renderRecentMixes(mixes) {
    const rows = mixes
      .slice(0, 5)
      .map((m) => {
        const snap = m.snapshot;
        const costLine = snap?.result
          ? `R${fmt(snap.result.costPerTon, 0)}/ton · R${fmt(snap.result.costPerBag, 2)}/bag`
          : '';
        return `<div class="ing-row" style="cursor:default;">
          <div>
            <strong>${escapeHtml(m.name)}</strong>
            <div class="ing-meta">${escapeHtml(new Date(m.savedAt).toLocaleString())} · ${costLine}</div>
          </div>
        </div>`;
      })
      .join('');
    return `<div class="card" style="margin-top:20px;">
      <div class="toolbar" style="margin-bottom:10px;">
        <h3 style="margin:0;">Recently saved mixes</h3>
        <button class="btn btn-ghost btn-sm" data-role="view-history">View all in History →</button>
      </div>
      <div class="ing-list">${rows}</div>
    </div>`;
  }

  // Typing in the inclusion%/cost fields must NOT go through the top-level
  // render() — that rebuilds the whole page from innerHTML, which destroys
  // and recreates the very input the rep is typing into, kicking focus out
  // after every keystroke. Instead, only the computed-results portion of a
  // mix card is refreshed on each keystroke; the ingredient rows (and
  // whichever one is currently focused) are left untouched. Structural
  // changes (add/remove a row, change species/type, pick a different
  // ingredient) still go through the full render() — those are discrete
  // clicks/selections, not continuous typing, so losing focus there is a
  // non-issue.
  function renderMixCard(mix, mixIdx, target, maxNpn) {
    const wrap = document.createElement('div');
    wrap.className = 'card mix-card';

    wrap.innerHTML = `
      <div class="mix-card-header">
        <input class="mix-name" value="${escapeHtml(mix.name)}" data-role="mix-name" />
        <span class="badge" data-role="saved-badge"></span>
        ${state.mixes.length > 1 ? '<button class="icon-btn" data-role="remove-mix" title="Remove this lick">✕</button>' : ''}
      </div>

      <div>
        <div class="ingredient-row-header${state.showPercent ? ' with-pct' : ''}">
          <span>Ingredient</span><span>Incl. (kg)</span>${state.showPercent ? '<span>%</span>' : ''}<span>R / ton</span><span></span>
        </div>
        <div data-role="ingredient-rows"></div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" data-role="add-line">+ Add ingredient</button>
          <button class="btn btn-secondary btn-sm" style="font-size:0.78rem;" data-role="clone-mix">Clone saved mix</button>
        </div>
        <div class="inclusion-total" data-role="inclusion-total">
          <span>Total mix weight</span>
          <span class="value" data-role="inclusion-value"></span>
        </div>
      </div>

      <div class="results-strip" data-role="results-strip"></div>

      <div data-role="scenarios"></div>

      <details class="spec-details">
        <summary>Full nutrient specification (% as-is)</summary>
        <div data-role="spec-table-container"></div>
      </details>

      <button class="btn btn-primary btn-block" data-role="save-mix">Save this mix</button>
      <p class="faint" data-role="save-status" style="text-align:center;"></p>
    `;

    const rowsEl = wrap.querySelector('[data-role="ingredient-rows"]');
    mix.lines.forEach((line, lineIdx) => {
      rowsEl.appendChild(renderIngredientRow(mix, line, lineIdx, refreshResults));
    });

    function refreshResults() {
      const lines = linesForCalc(mix);
      const result = computeMixResult(lines, specNutrients.map((n) => n.id), target, maxNpn, currentProductionTarget());
      const totalKg = mix.lines.reduce((s, l) => s + (Number(l.inclusionKg) || 0), 0);

      const totalEl = wrap.querySelector('[data-role="inclusion-total"]');
      totalEl.classList.toggle('ok', totalKg > 0);
      totalEl.classList.toggle('off', totalKg <= 0);
      wrap.querySelector('[data-role="inclusion-value"]').textContent = `${fmt(totalKg, 2)} kg`;

      if (state.showPercent) {
        rowsEl.querySelectorAll('[data-role="pct-cell"]').forEach((el, idx) => {
          const kg = Number(mix.lines[idx]?.inclusionKg) || 0;
          el.textContent = totalKg > 0 ? `${fmt((kg / totalKg) * 100, 1)}%` : '—';
        });
      }

      wrap.querySelector('[data-role="results-strip"]').innerHTML = renderResultsStrip(result);
      const scenarioKeys = state.supplementTypeId === 'production'
        ? ['phosphorus', 'protein', 'energy', 'production']
        : ['phosphorus', 'protein', 'energy'];
      wrap.querySelector('[data-role="scenarios"]').innerHTML = scenarioKeys
        .map((key) => renderScenarioCard(result.scenarios[key], key === state.lickFocus))
        .join('');
      const activeIngredientCount = mix.lines.filter((l) => l.ingredientId && (Number(l.inclusionKg) || 0) > 0).length;
      const restrictSpec = profile.role !== 'admin' && activeIngredientCount < 2;
      wrap.querySelector('[data-role="spec-table-container"]').innerHTML = renderSpecTable(result.specification, specNutrients, { restricted: restrictSpec });
      wrap.querySelector('[data-role="save-mix"]').disabled = lines.length === 0;

      // Note: .badge sets display:inline-flex, which at equal CSS
      // specificity beats the native [hidden] { display:none } UA rule —
      // so visibility here is toggled via inline style, not .hidden.
      const badgeEl = wrap.querySelector('[data-role="saved-badge"]');
      if (!mixIsInUse(mix)) {
        badgeEl.style.display = 'none';
      } else if (mix.isDirty) {
        badgeEl.style.display = '';
        badgeEl.className = 'badge badge-neutral';
        badgeEl.textContent = 'Unsaved';
      } else {
        badgeEl.style.display = '';
        badgeEl.className = 'badge badge-safe';
        badgeEl.textContent = 'Saved';
      }

      return { lines, result, totalKg };
    }
    refreshResults();

    wrap.querySelector('[data-role="mix-name"]').addEventListener('input', (e) => {
      mix.name = e.target.value;
      mix.isDirty = true;
      refreshResults();
    });

    wrap.querySelector('[data-role="remove-mix"]')?.addEventListener('click', () => {
      const idx = state.mixes.indexOf(mix);
      if (idx !== -1) state.mixes.splice(idx, 1);
      render();
    });

    wrap.querySelector('[data-role="add-line"]').addEventListener('click', () => {
      // Blank, not pre-filled — the rep picks the ingredient themselves
      // rather than starting on whichever one happens to sort first.
      mix.lines.push(newLine(null, state.useDefaultPrices, priceOverrides));
      mix.isDirty = true;
      render();
    });

    wrap.querySelector('[data-role="clone-mix"]').addEventListener('click', () => {
      openCloneMixModal(mix);
    });

    const statusEl = wrap.querySelector('[data-role="save-status"]');

    async function doSave(lines, result) {
      statusEl.textContent = 'Saving…';
      statusEl.style.color = '';
      const snapshot = {
        mixName: mix.name,
        speciesId: state.speciesId,
        supplementTypeId: state.supplementTypeId,
        lickFocus: state.lickFocus,
        target,
        maxSafeNpnGPerHeadDay: maxNpn,
        lines: lines.map((l) => ({
          ingredientId: l.ingredientId,
          ingredientName: ingredientById(l.ingredientId)?.name ?? 'Unknown',
          inclusionPct: l.inclusionPct,
          costPerTon: l.costPerTon,
          values: l.values,
        })),
        result,
        savedAt: new Date().toISOString(),
      };
      try {
        await backend.saveMix({
          name: mix.name.trim(),
          speciesId: state.speciesId,
          supplementTypeId: state.supplementTypeId,
          lickFocus: state.lickFocus,
          lines: lines.map((l) => ({ ingredientId: l.ingredientId, inclusionPct: l.inclusionPct, costPerTon: l.costPerTon })),
          snapshot,
        });
      } catch (err) {
        // The save itself failed — this is the only case that should show
        // as an error, since nothing was actually persisted.
        statusEl.textContent = err.message || 'Could not save.';
        statusEl.style.color = 'var(--risk)';
        return;
      }

      // The save succeeded — commit to that regardless of what happens
      // next. A problem refreshing the on-screen history list afterward is
      // a display glitch, not a reason to tell the rep their mix didn't
      // save (it did).
      statusEl.textContent = 'Saved — this comparison is now frozen and won’t change if ingredient data is edited later.';
      statusEl.style.color = 'var(--safe)';
      mix.isDirty = false;
      mix.savedSnapshot = snapshot;
      try {
        refreshResults();
        savedMixes = await backend.listSavedMixes().catch(() => savedMixes);
        refreshSavedHistorySection();
      } catch (err) {
        console.error('Post-save UI refresh failed (mix was still saved):', err);
      }
    }

    function showDuplicateNameModal(duplicate, lines, result) {
      const backdrop = document.createElement('div');
      // Small notice-style dialog — unlike the big detail/comparison
      // modals (which stay top-aligned so a tall one isn't pushed off
      // screen), this one is short enough to just centre vertically, which
      // also keeps it from landing out of view on mobile when it appears
      // right as the on-screen keyboard is closing.
      backdrop.className = 'modal-backdrop modal-backdrop-center';
      backdrop.innerHTML = `
        <div class="modal-card" style="max-width:440px;">
          <div class="modal-head"><h2>Name already used</h2></div>
          <p>You already have a saved mix named "<strong>${escapeHtml(mix.name.trim())}</strong>". What would you like to do?</p>
          <div style="display:flex; gap:10px; margin-top:16px;">
            <button class="btn btn-danger" data-role="override">Override existing mix</button>
            <button class="btn btn-secondary" data-role="rename">Rename</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-role="rename"]').addEventListener('click', () => {
        backdrop.remove();
        const nameInput = wrap.querySelector('[data-role="mix-name"]');
        nameInput.focus();
        nameInput.select();
      });
      backdrop.querySelector('[data-role="override"]').addEventListener('click', async () => {
        backdrop.remove();
        try {
          await backend.deleteSavedMix(duplicate.id);
          savedMixes = savedMixes.filter((m) => m.id !== duplicate.id);
        } catch (err) {
          statusEl.textContent = err.message || 'Could not override the existing mix.';
          statusEl.style.color = 'var(--risk)';
          return;
        }
        doSave(lines, result);
      });
    }

    wrap.querySelector('[data-role="save-mix"]')?.addEventListener('click', async () => {
      const { lines, result, totalKg } = refreshResults();
      if (totalKg <= 0) {
        statusEl.textContent = 'Add at least one ingredient with a kg amount before saving.';
        statusEl.style.color = 'var(--risk)';
        return;
      }
      const trimmedName = mix.name.trim();
      const duplicate = savedMixes.find(
        (m) => m.ownerId === profile.id && m.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (duplicate) {
        showDuplicateNameModal(duplicate, lines, result);
        return;
      }
      await doSave(lines, result);
    });

    return { wrap, refreshResults };
  }

  function renderIngredientRow(mix, line, lineIdx, refreshResults) {
    const row = document.createElement('div');
    row.className = 'ingredient-row' + (state.showPercent ? ' with-pct' : '');
    row.innerHTML = `
      <select data-role="ingredient">${ingredientOptions(line.ingredientId)}</select>
      <input type="number" min="0" step="0.01" value="${Number(line.inclusionKg || 0).toFixed(2)}" data-role="inclusion" />
      ${state.showPercent ? '<span class="faint num" data-role="pct-cell" style="text-align:center;">—</span>' : ''}
      <input type="number" min="0" step="1" value="${line.costPerTon}" data-role="cost" />
      <button class="icon-btn" data-role="remove" title="Remove">✕</button>
    `;
    row.querySelector('[data-role="ingredient"]').addEventListener('change', (e) => {
      line.ingredientId = e.target.value;
      const selected = ingredientById(e.target.value);
      line.costPerTon = resolvePrice(selected, state.useDefaultPrices, priceOverrides);
      mix.isDirty = true;
      render();
    });
    // type="number" inputs don't support .select() in most browsers — swap
    // to type="text" just long enough to select-all on focus, then back.
    row.querySelector('[data-role="inclusion"]').addEventListener('focus', (e) => {
      const el = e.target;
      el.type = 'text';
      el.select();
    });
    row.querySelector('[data-role="inclusion"]').addEventListener('blur', (e) => {
      e.target.type = 'number';
    });
    row.querySelector('[data-role="inclusion"]').addEventListener('input', (e) => {
      line.inclusionKg = e.target.value;
      mix.isDirty = true;
      refreshResults();
    });
    // Same select-all-on-focus behaviour as the kg field above.
    row.querySelector('[data-role="cost"]').addEventListener('focus', (e) => {
      const el = e.target;
      el.type = 'text';
      el.select();
    });
    row.querySelector('[data-role="cost"]').addEventListener('input', (e) => {
      line.costPerTon = e.target.value;
      mix.isDirty = true;
      refreshResults();
    });
    // Persist on blur (not every keystroke) — only while "Use default
    // prices" is off, so this is only ever remembering a deliberate
    // personal override, never a one-off edit made while viewing defaults.
    row.querySelector('[data-role="cost"]').addEventListener('blur', async (e) => {
      e.target.type = 'number';
      if (state.useDefaultPrices || !line.ingredientId) return;
      const price = Number(e.target.value) || 0;
      priceOverrides[line.ingredientId] = price;
      try {
        await backend.setPriceOverride(line.ingredientId, price);
      } catch (err) {
        console.error('Could not save custom price (will retry next edit):', err);
      }
    });
    row.querySelector('[data-role="remove"]').addEventListener('click', () => {
      mix.lines.splice(lineIdx, 1);
      mix.isDirty = true;
      render();
    });
    return row;
  }

  function openCloneMixModal(targetMix) {
    // Admins can clone any rep's saved mix (matching what they can already
    // see in History) — reps still only ever see their own.
    const isAdmin = profile.role === 'admin';
    const own = savedMixes.filter((m) => m.snapshot && (isAdmin || m.ownerId === profile.id));

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card" style="max-width:520px;">
        <div class="modal-head">
          <h2>Clone a saved mix</h2>
          <button class="icon-btn" data-role="close">✕</button>
        </div>
        ${own.length === 0
          ? `<p class="muted">${isAdmin ? 'No mixes have been saved yet' : 'You haven’t saved any mixes yet'} — nothing to clone from.</p>`
          : `<p class="muted">Pick a saved mix to copy its ingredients, inclusion %, and prices</p>
             <div class="ing-list" id="clone-list"></div>`
        }
      </div>
    `;
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('[data-role="close"]').addEventListener('click', close);

    const listEl = document.getElementById('clone-list');
    own.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'ing-row';
      const costLine = m.snapshot?.result
        ? `R${fmt(m.snapshot.result.costPerTon, 0)}/ton · R${fmt(m.snapshot.result.costPerBag, 2)}/bag`
        : '';
      const ownerLine = isAdmin ? ` · ${escapeHtml(m.ownerEmail || m.ownerName || 'Unknown')}` : '';
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(m.name)}</strong>
          <div class="ing-meta">${escapeHtml(new Date(m.savedAt).toLocaleString())} · ${costLine}${ownerLine}</div>
        </div>
        <span class="faint">Clone →</span>
      `;
      row.addEventListener('click', () => {
        applyClone(targetMix, m);
        close();
      });
      listEl?.appendChild(row);
    });
  }

  // Ingredients that no longer exist (or were deactivated) since the source
  // mix was saved are silently skipped rather than left broken — if that
  // empties the mix entirely, it falls back to one blank row like a brand
  // new panel would.
  function applyClone(targetMix, savedRecord) {
    const snapshot = savedRecord.snapshot;
    const clonedLines = (snapshot.lines || [])
      .filter((l) => ingredientById(l.ingredientId))
      .map((l) => ({
        ingredientId: l.ingredientId,
        inclusionKg: l.inclusionPct, // snapshots store the entered kg amount under this historical key name
        costPerTon: l.costPerTon,
      }));
    targetMix.name = `${savedRecord.name}-copy`;
    targetMix.lines = clonedLines.length ? clonedLines : [newLine(ingredients[0], state.useDefaultPrices, priceOverrides)];
    targetMix.isDirty = true;
    targetMix.savedSnapshot = null;
    render();
  }

  render();
}
