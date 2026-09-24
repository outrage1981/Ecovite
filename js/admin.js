import { getBackend, getIngredients, clearIngredientCache, resetDemoData, PLAUSIBLE_RANGES } from './db.js';
import { IS_CONFIGURED } from './config.js';
import { deriveNpn, deriveMe } from './calc.js';
import { escapeHtml, fmt } from './app.js';

const NUTRIENT_GROUP_LABELS = {
  general: 'General',
  macro: 'Macro-minerals',
  trace: 'Trace minerals',
  vitamin: 'Vitamins',
  energy: 'Energy',
};

// ---------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------

export async function renderAdminIngredients(root) {
  root.innerHTML = `<div class="empty-state">Loading…</div>`;
  const backend = await getBackend();
  const [nutrients, cache] = await Promise.all([backend.listNutrients(), getIngredients({ forceRefresh: true })]);
  let query = '';
  let showInactive = false;

  async function reload() {
    return getIngredients({ forceRefresh: true });
  }

  function render(ingredientsCache) {
    const list = ingredientsCache.ingredients
      .filter((i) => showInactive || i.is_active)
      .filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));

    root.innerHTML = `
      <div class="toolbar">
        <input type="search" placeholder="Search ingredients…" id="search-input" value="${escapeHtml(query)}" />
        <div style="display:flex; gap:8px; align-items:center;">
          <label style="display:flex; align-items:center; gap:6px; font-size:0.85rem; color:var(--text-muted);">
            <input type="checkbox" id="show-inactive" ${showInactive ? 'checked' : ''} /> Show inactive
          </label>
          <button class="btn btn-primary" id="add-btn">+ Add ingredient</button>
        </div>
      </div>
      <div class="ing-list" id="ing-list">
        ${list.length === 0 ? '<div class="empty-state">No ingredients match.</div>' : ''}
      </div>
    `;

    const listEl = document.getElementById('ing-list');
    list.forEach((ing) => {
      const row = document.createElement('div');
      row.className = `ing-row ${ing.is_active ? '' : 'inactive'}`;
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(ing.name)}</strong>
          <div class="ing-meta">R${fmt(ing.pricePerTon ?? 0, 0)}/ton · Updated ${escapeHtml(new Date(ing.updated_at).toLocaleDateString())}${ing.is_active ? '' : ' · inactive'}</div>
        </div>
        <span class="faint">Edit →</span>
      `;
      row.addEventListener('click', () => openForm(ing, nutrients, async () => {
        const fresh = await reload();
        render(fresh);
      }));
      listEl.appendChild(row);
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      query = e.target.value;
      render(ingredientsCache);
    });
    document.getElementById('show-inactive').addEventListener('change', (e) => {
      showInactive = e.target.checked;
      render(ingredientsCache);
    });
    document.getElementById('add-btn').addEventListener('click', () => {
      openForm(null, nutrients, async () => {
        const fresh = await reload();
        render(fresh);
      });
    });
  }

  render(cache);
}

function openForm(ingredient, nutrients, onSaved) {
  const isNew = !ingredient;
  const values = { ...(ingredient?.values || {}) };
  const pricing = {
    bagSizeKg: ingredient?.bagSizeKg ?? null,
    pricePerBag: ingredient?.pricePerBag ?? null,
    pricePerTon: ingredient?.pricePerTon ?? 0,
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <h2>${isNew ? 'Add ingredient' : 'Edit ingredient'}</h2>
        <button class="icon-btn" data-role="close">✕</button>
      </div>

      <label class="field">
        <span>Ingredient name</span>
        <input type="text" id="ing-name" value="${escapeHtml(ingredient?.name || '')}" placeholder="e.g. Maize (8%)" />
      </label>

      <div id="warn-box"></div>

      <div class="section-label">Pricing</div>
      <div class="nutrient-grid" style="margin-bottom:18px;">
        <div class="nutrient-field">
          <label>Bag size <span class="unit">(kg)</span></label>
          <input type="number" step="any" min="0" id="price-bag-size" value="${pricing.bagSizeKg ?? ''}" placeholder="no data" />
        </div>
        <div class="nutrient-field">
          <label>Price per bag <span class="unit">(R/bag)</span></label>
          <input type="number" step="any" min="0" id="price-per-bag" value="${pricing.pricePerBag ?? ''}" placeholder="no data" />
        </div>
        <div class="nutrient-field">
          <label title="Auto-fills from bag size × price per bag. Editing it directly overrides that — if a bag size is set, price per bag recalculates to match, rounded to the nearest Rand.">Price per ton <span class="unit">(R/ton, default mix cost)</span></label>
          <input type="number" step="any" min="0" id="price-per-ton" value="${pricing.pricePerTon ?? 0}" />
        </div>
      </div>

      ${Object.entries(groupBy(nutrients, 'group'))
        .map(([group, list]) => renderNutrientSection(group, list, values))
        .join('')}

      <div style="display:flex; gap:10px; margin-top:18px;">
        <button class="btn btn-primary" data-role="save">Save to database</button>
        <button class="btn btn-secondary" data-role="cancel">Cancel</button>
        ${!isNew ? `<button class="btn ${ingredient.is_active ? 'btn-danger' : 'btn-secondary'}" data-role="toggle-active" style="margin-left:auto;">${ingredient.is_active ? 'Deactivate' : 'Reactivate'}</button>` : ''}
      </div>
      <p class="faint" data-role="status" style="margin-top:8px;"></p>
    </div>
  `;
  document.body.appendChild(backdrop);

  function close() { backdrop.remove(); }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-role="close"]').addEventListener('click', close);
  backdrop.querySelector('[data-role="cancel"]').addEventListener('click', close);

  // wire up numeric inputs -> values object, and live-update derived fields
  nutrients.filter((n) => !n.derived).forEach((n) => {
    const input = backdrop.querySelector(`[data-nutrient="${n.id}"]`);
    input.addEventListener('input', () => {
      values[n.id] = input.value === '' ? null : Number(input.value);
      updateDerivedDisplays();
    });
  });
  updateDerivedDisplays();

  // Pricing: bag size / price per bag recompute price per ton live, but
  // price per ton stays a normal editable field so it can be typed
  // directly instead (e.g. when bag pricing isn't known).
  const bagSizeInput = backdrop.querySelector('#price-bag-size');
  const pricePerBagInput = backdrop.querySelector('#price-per-bag');
  const pricePerTonInput = backdrop.querySelector('#price-per-ton');

  function recalcPricePerTon() {
    const bagSize = bagSizeInput.value === '' ? null : Number(bagSizeInput.value);
    const perBag = pricePerBagInput.value === '' ? null : Number(pricePerBagInput.value);
    pricing.bagSizeKg = bagSize;
    pricing.pricePerBag = perBag;
    if (bagSize != null && bagSize > 0 && perBag != null) {
      pricing.pricePerTon = (perBag / bagSize) * 1000;
      // Plain numeric string, not fmt()'s comma-grouped display text — a
      // type="number" input silently blanks itself on an invalid value
      // like "12,500.00".
      pricePerTonInput.value = String(Math.round(pricing.pricePerTon * 100) / 100);
    }
  }
  bagSizeInput.addEventListener('input', recalcPricePerTon);
  pricePerBagInput.addEventListener('input', recalcPricePerTon);
  // The reverse direction: typing a per-ton price directly (overriding the
  // bag-derived figure) back-calculates what that implies per bag, given
  // the bag size already entered — so the two stay consistent whichever
  // one was actually typed last, rounded to the nearest Rand.
  pricePerTonInput.addEventListener('input', () => {
    pricing.pricePerTon = pricePerTonInput.value === '' ? 0 : Number(pricePerTonInput.value);
    const bagSize = bagSizeInput.value === '' ? null : Number(bagSizeInput.value);
    if (bagSize != null && bagSize > 0) {
      pricing.pricePerBag = Math.round((pricing.pricePerTon * bagSize) / 1000);
      pricePerBagInput.value = String(pricing.pricePerBag);
    }
  });

  function updateDerivedDisplays() {
    const npn = deriveNpn(values.cp, values.pct_ex_npn);
    const me = deriveMe(values.tdn);
    const npnEl = backdrop.querySelector('[data-derived="npn"]');
    const meEl = backdrop.querySelector('[data-derived="me"]');
    if (npnEl) npnEl.value = npn == null ? '' : fmt(npn, 2);
    if (meEl) meEl.value = me == null ? '' : fmt(me, 3);
  }

  if (!isNew) {
    backdrop.querySelector('[data-role="toggle-active"]').addEventListener('click', async () => {
      const backend = await getBackend();
      await backend.setIngredientActive(ingredient.id, !ingredient.is_active);
      close();
      onSaved();
    });
  }

  backdrop.querySelector('[data-role="save"]').addEventListener('click', async () => {
    const statusEl = backdrop.querySelector('[data-role="status"]');
    const name = backdrop.querySelector('#ing-name').value.trim();
    if (!name) {
      statusEl.textContent = 'Ingredient name is required.';
      statusEl.style.color = 'var(--risk)';
      return;
    }

    const flags = checkPlausibility(values, nutrients);
    if (flags.length && !backdrop.dataset.confirmedWarnings) {
      const warnBox = backdrop.querySelector('#warn-box');
      warnBox.innerHTML = `<div class="form-warn">These values look unusual — check before saving:<br>${flags
        .map((f) => `&bull; ${escapeHtml(f)}`)
        .join('<br>')}<br><br>Click "Save to database" again to save anyway.</div>`;
      backdrop.dataset.confirmedWarnings = '1';
      return;
    }

    statusEl.textContent = 'Saving…';
    statusEl.style.color = '';
    try {
      const backend = await getBackend();
      await backend.upsertIngredient({
        id: ingredient?.id,
        name,
        notes: ingredient?.notes ?? null,
        bagSizeKg: pricing.bagSizeKg,
        pricePerBag: pricing.pricePerBag,
        pricePerTon: pricing.pricePerTon ?? 0,
        values,
      });
      close();
      onSaved();
    } catch (err) {
      statusEl.textContent = err.message || 'Could not save.';
      statusEl.style.color = 'var(--risk)';
    }
  });
}

function renderNutrientSection(group, nutrientList, values) {
  return `
    <div class="section-label">${NUTRIENT_GROUP_LABELS[group] || group}</div>
    <div class="nutrient-grid">
      ${nutrientList
        .map((n) => {
          if (n.derived) {
            return `
              <div class="nutrient-field derived">
                <label>${escapeHtml(n.label)} <span class="unit">(${escapeHtml(n.unit)}, auto-calculated)</span></label>
                <input type="text" data-derived="${n.id}" disabled placeholder="no data" />
              </div>
            `;
          }
          const val = values[n.id];
          return `
            <div class="nutrient-field">
              <label title="${escapeHtml(n.helpText || '')}">${escapeHtml(n.label)} <span class="unit">(${escapeHtml(n.unit)})</span></label>
              <input type="number" step="any" data-nutrient="${n.id}" value="${val == null ? '' : val}" placeholder="no data" />
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function checkPlausibility(values, nutrients) {
  const flags = [];
  for (const n of nutrients) {
    if (n.derived) continue;
    const range = PLAUSIBLE_RANGES[n.id];
    const val = values[n.id];
    if (range && val != null && (val < range[0] || val > range[1])) {
      flags.push(`${n.label}: ${val} ${n.unit} is outside the usual ${range[0]}-${range[1]} range`);
    }
  }
  return flags;
}

function groupBy(list, key) {
  const out = {};
  for (const item of list) {
    if (item.derived && item.id !== 'npn' && item.id !== 'me') continue;
    (out[item[key]] = out[item[key]] || []).push(item);
  }
  return out;
}

// ---------------------------------------------------------------------
// Settings: Act 36 NPN safety limits + nutrient targets
// ---------------------------------------------------------------------

export async function renderAdminSettings(root) {
  root.innerHTML = `<div class="empty-state">Loading…</div>`;
  const backend = await getBackend();
  const [species, supplementTypes, npnLimits, targets, productionTargets] = await Promise.all([
    backend.listSpecies(),
    backend.listSupplementTypes(),
    backend.getNpnSafetyLimits(),
    backend.getNutrientTargets(),
    backend.getProductionTargets(),
  ]);

  const combos = [];
  for (const s of species) for (const t of supplementTypes) combos.push({ speciesId: s.id, speciesLabel: s.label, typeId: t.id, typeLabel: t.label });

  root.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <h2>Act 36 — maximum safe NPN supplementation</h2>
      <p class="muted">g N / head / day, by species and supplement type.</p>
      <table class="settings-table" id="npn-table">
        <thead><tr><th>Species</th><th>Supplement type</th><th>Max (g N/hd/day)</th></tr></thead>
        <tbody>
          ${combos
            .map(
              (c) => `
            <tr data-species="${c.speciesId}" data-type="${c.typeId}">
              <td>${escapeHtml(c.speciesLabel)}</td>
              <td>${escapeHtml(c.typeLabel)}</td>
              <td><input type="number" step="any" value="${npnLimits?.[c.speciesId]?.[c.typeId] ?? ''}" /></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <button class="btn btn-primary" id="save-npn" style="margin-top:14px;">Save limits</button>
      <p class="faint" id="npn-status"></p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h2>Lick contribution targets</h2>
      <p class="muted">What the lick itself should supply per head per day — not the animal's total daily requirement.</p>
      <div id="targets-list"></div>
    </div>

    ${!IS_CONFIGURED ? `
      <div class="card">
        <h2>Demo mode</h2>
        <p class="muted">
          You're in demo mode (?demo in the URL) — everything here lives in this
          browser's local storage, seeded once from the app's built-in data and never automatically
          refreshed. If you've updated the app's code and this browser is still showing old data
          (e.g. ingredients with no price), reset it below.
        </p>
        <button class="btn btn-danger" id="reset-demo-btn">Reset demo data</button>
        <p class="faint" id="reset-demo-status"></p>
      </div>
    ` : ''}
  `;

  document.getElementById('reset-demo-btn')?.addEventListener('click', () => {
    const statusEl = document.getElementById('reset-demo-status');
    resetDemoData();
    statusEl.textContent = 'Reset. Reloading…';
    statusEl.style.color = 'var(--safe)';
    setTimeout(() => location.reload(), 400);
  });

  document.getElementById('save-npn').addEventListener('click', async () => {
    const statusEl = document.getElementById('npn-status');
    statusEl.textContent = 'Saving…';
    try {
      const rows = document.querySelectorAll('#npn-table tbody tr');
      for (const row of rows) {
        const val = row.querySelector('input').value;
        if (val === '') continue;
        await backend.upsertNpnSafetyLimit(row.dataset.species, row.dataset.type, Number(val));
      }
      statusEl.textContent = 'Saved.';
      statusEl.style.color = 'var(--safe)';
    } catch (err) {
      statusEl.textContent = err.message || 'Could not save.';
      statusEl.style.color = 'var(--risk)';
    }
  });

  const targetsList = document.getElementById('targets-list');
  combos.forEach((c) => {
    const existing = targets.find((t) => t.species === c.speciesId && t.supplementType === c.typeId);
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.marginBottom = '12px';
    panel.innerHTML = `
      <h3>${escapeHtml(c.speciesLabel)} — ${escapeHtml(c.typeLabel)}</h3>
      <div class="field-row">
        <label class="field"><span>Protein target (g/hd/day)</span><input type="number" step="any" data-field="cp" value="${existing?.cp ?? ''}" /></label>
        <label class="field"><span>Energy target (MJ/hd/day)</span><input type="number" step="any" data-field="me" value="${existing?.me ?? ''}" /></label>
        <label class="field"><span>Phosphorus target (g/hd/day)</span><input type="number" step="any" data-field="p" value="${existing?.p ?? ''}" /></label>
      </div>
      <label class="field"><span>Protein reference note</span><input type="text" data-field="cpNote" value="${escapeHtml(existing?.cpNote || '')}" /></label>
      <label class="field"><span>Energy reference note</span><input type="text" data-field="meNote" value="${escapeHtml(existing?.meNote || '')}" /></label>
      <label class="field"><span>Phosphorus reference note</span><input type="text" data-field="pNote" value="${escapeHtml(existing?.pNote || '')}" /></label>
      <button class="btn btn-secondary btn-sm" data-role="save-target">Save</button>
      <span class="faint" data-role="target-status"></span>
      ${c.typeId === 'production' ? `
      <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border);">
        <h4 style="margin:0 0 6px;">Production</h4>
        <p class="muted" style="margin:0 0 8px;">Separate targets a Production Lick must satisfy at once — not used by the fields above.</p>
        <div class="field-row">
          <label class="field"><span>Protein (g/hd/day)</span><input type="number" step="any" data-role="prod-protein" value="${productionTargets?.[c.speciesId]?.protein ?? ''}" /></label>
          <label class="field"><span>Energy (MJ/hd/day)</span><input type="number" step="any" data-role="prod-energy" value="${productionTargets?.[c.speciesId]?.energy ?? ''}" /></label>
        </div>
        <button class="btn btn-secondary btn-sm" data-role="save-production">Save</button>
        <span class="faint" data-role="production-status"></span>
      </div>` : ''}
    `;
    panel.querySelector('[data-role="save-target"]').addEventListener('click', async () => {
      const statusEl = panel.querySelector('[data-role="target-status"]');
      const get = (f) => panel.querySelector(`[data-field="${f}"]`).value;
      statusEl.textContent = ' Saving…';
      try {
        await backend.upsertNutrientTarget({
          species: c.speciesId,
          supplementType: c.typeId,
          cp: get('cp') === '' ? null : Number(get('cp')),
          me: get('me') === '' ? null : Number(get('me')),
          p: get('p') === '' ? null : Number(get('p')),
          cpNote: get('cpNote'),
          meNote: get('meNote'),
          pNote: get('pNote'),
        });
        statusEl.textContent = ' Saved.';
        statusEl.style.color = 'var(--safe)';
      } catch (err) {
        statusEl.textContent = ' ' + (err.message || 'Could not save.');
        statusEl.style.color = 'var(--risk)';
      }
    });
    panel.querySelector('[data-role="save-production"]')?.addEventListener('click', async () => {
      const statusEl = panel.querySelector('[data-role="production-status"]');
      const protein = panel.querySelector('[data-role="prod-protein"]').value;
      const energy = panel.querySelector('[data-role="prod-energy"]').value;
      statusEl.textContent = ' Saving…';
      try {
        await backend.upsertProductionTarget(c.speciesId, protein === '' ? null : Number(protein), energy === '' ? null : Number(energy));
        statusEl.textContent = ' Saved.';
        statusEl.style.color = 'var(--safe)';
      } catch (err) {
        statusEl.textContent = ' ' + (err.message || 'Could not save.');
        statusEl.style.color = 'var(--risk)';
      }
    });
    targetsList.appendChild(panel);
  });
}
