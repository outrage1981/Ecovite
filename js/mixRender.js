// Rendering helpers shared between the live mix builder (rep.js) and the
// saved-mix detail view (history.js), so a saved snapshot renders exactly
// the same way it did the moment it was saved.

import { escapeHtml, fmt } from './app.js';

export const NUTRIENT_GROUP_LABELS = {
  general: 'General',
  macro: 'Macro-minerals',
  trace: 'Trace minerals',
  vitamin: 'Vitamins',
  energy: 'Energy',
};

// For Phosphorus/Protein/Energy, the intake is derived to exactly meet that
// scenario's own single target, so what's supplied at that intake equals
// the target already on the scenario. Production is different: the intake
// is whichever of its two requirements needs more lick, so the OTHER one
// ends up over-supplied — calc.js's productionScenario() computes the real
// proteinSuppliedG/energySuppliedMj at that final intake for exactly this
// reason, and that's what must be shown here, not the static target.
function suppliedFieldsHtml(scenario) {
  if (scenario.label === 'Production') {
    return `
      <span>Protein supplied <b>${scenario.proteinSuppliedG != null ? fmt(scenario.proteinSuppliedG, 1) + ' g/hd/day' : '—'}</b></span>
      <span>Energy supplied <b>${scenario.energySuppliedMj != null ? fmt(scenario.energySuppliedMj, 1) + ' MJ/hd/day' : '—'}</b></span>
    `;
  }
  if (scenario.label === 'Energy') {
    return `<span>Energy supplied <b>${scenario.targetMjPerHeadDay != null ? fmt(scenario.targetMjPerHeadDay, 1) + ' MJ/hd/day' : '—'}</b></span>`;
  }
  // Phosphorus and Protein both size against a g/hd/day target.
  return `<span>${scenario.label} supplied <b>${scenario.targetGPerHeadDay != null ? fmt(scenario.targetGPerHeadDay, 1) + ' g/hd/day' : '—'}</b></span>`;
}

export function renderScenarioCard(scenario, isFocused) {
  const badge =
    scenario.npnStatus === 'RISK'
      ? '<span class="badge badge-risk">Risk</span>'
      : scenario.npnStatus === 'SAFE'
      ? '<span class="badge badge-safe">Safe</span>'
      : '<span class="badge badge-neutral">—</span>';
  return `
    <div class="scenario-card${isFocused ? ' scenario-card-focus' : ''}">
      <div class="scenario-head">
        <strong>${scenario.label}-driven</strong>
        ${badge}
      </div>
      <div class="scenario-metrics">
        <span>Min. lick intake <b>${scenario.minLickIntakeG != null ? fmt(scenario.minLickIntakeG, 1) + ' g/hd/day' : '—'}</b></span>
        <span>Cost <b>${scenario.costPerHead != null ? 'R' + fmt(scenario.costPerHead, 2) + '/hd/day' : '—'}</b></span>
        ${suppliedFieldsHtml(scenario)}
      </div>
      <div class="scenario-metrics scenario-metrics-secondary">
        <span>NPN supplied <b>${scenario.npnSuppliedG != null ? fmt(scenario.npnSuppliedG, 2) + ' g N/hd/day' : '—'}</b></span>
      </div>
    </div>
  `;
}

// With only one active ingredient, the mix's weighted average IS that
// ingredient's raw analysed values (100% inclusion), so this table would
// hand a rep the exact spec of a single ingredient just by loading it
// alone — restricted (for reps only) until there are 2+ ingredients to
// actually blend, at which point it's a genuine mix result again.
export function renderSpecTable(specification, nutrients, { restricted = false } = {}) {
  if (restricted) {
    return `<p class="muted" style="padding:8px 4px;">Add at least 2 ingredients to view the full nutrient specification.</p>`;
  }
  let lastGroup = null;
  const rows = nutrients
    .map((n) => {
      const entry = specification[n.id];
      const groupHeader =
        n.group !== lastGroup
          ? `<tr class="group-row"><td colspan="3">${NUTRIENT_GROUP_LABELS[n.group] || n.group}</td></tr>`
          : '';
      lastGroup = n.group;
      const valueCell =
        entry?.value == null
          ? '<td class="num">—</td>'
          : `<td class="num">${fmt(entry.value, entry.value < 10 ? 3 : 2)}</td>`;
      const gapNote = entry?.hasGaps ? '<span class="faint"> (no data)</span>' : '';
      return `${groupHeader}<tr class="${entry?.hasGaps ? 'gap' : ''}"><td>${escapeHtml(n.label)}${n.derived ? ' <span class="faint">(calc.)</span>' : ''}${gapNote}</td>${valueCell}<td class="faint">${escapeHtml(n.unit)}</td></tr>`;
    })
    .join('');
  return `<table class="spec-table"><tbody>${rows}</tbody></table>`;
}

export function renderResultsStrip(result) {
  return `
    <div class="stat"><div class="num">${result.costPerTon != null ? 'R' + fmt(result.costPerTon, 0) : '—'}</div><div class="lbl">Per ton</div></div>
    <div class="stat"><div class="num">${result.costPerBag != null ? 'R' + fmt(result.costPerBag, 2) : '—'}</div><div class="lbl">Per 50kg bag</div></div>
  `;
}

export function npnBadge(status) {
  if (status === 'RISK') return '<span class="badge badge-risk">Risk</span>';
  if (status === 'SAFE') return '<span class="badge badge-safe">Safe</span>';
  return '<span class="badge badge-neutral">—</span>';
}

// Shared building blocks for the multi-lick comparison tables (rep.js's
// single-focus one and history.js's "compare saved licks" master table),
// so both use the same row markup and column layout.
export function comparisonRow(items, label, unit, valueFn) {
  return `<tr><td>${escapeHtml(label)}</td><td class="faint">${escapeHtml(unit)}</td>${items
    .map((item) => `<td class="num">${valueFn(item)}</td>`)
    .join('')}</tr>`;
}

export function comparisonGroupRow(label, colCount) {
  return `<tr class="group-row"><td colspan="${colCount}">${escapeHtml(label)}</td></tr>`;
}
