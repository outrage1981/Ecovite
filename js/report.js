// Report generation for a lick comparison — an info-entry popup, a report
// viewer built from the same data as the on-screen comparison, and a
// client-side PDF export (jsPDF + autoTable, loaded lazily from a CDN so
// the app has no bundler/npm dependency for the common case where nobody
// generates a report).

import { escapeHtml, fmt } from './app.js';
import { NUTRIENTS } from './seedData.js';

const CLIENTS_KEY_PREFIX = 'ecovite.reportClients.';
const AREAS_KEY_PREFIX = 'ecovite.reportAreas.';
const MAX_RECENTS = 10;

// Shared column widths (as % of the shared table width, since every report
// table is stretched to the same container width via .spec-table's
// width:100%) so a mix's column lines up in the same horizontal span across
// the Composition, Comparison, and Nutrient tables, even though the
// Composition table splits that span into kg + % sub-columns and the other
// two don't have a Unit column at all — the Composition table's label
// column simply absorbs the width the other two spend on Label + Unit.
const LABEL_UNITS = 170;
const UNIT_UNITS = 60;
const MIX_UNITS = 140;

function totalUnits(mixCount) {
  return LABEL_UNITS + UNIT_UNITS + mixCount * MIX_UNITS;
}

function metaColgroup(mixCount) {
  const total = totalUnits(mixCount);
  const labelPct = ((LABEL_UNITS / total) * 100).toFixed(4);
  const unitPct = ((UNIT_UNITS / total) * 100).toFixed(4);
  const mixPct = ((MIX_UNITS / total) * 100).toFixed(4);
  return `<colgroup><col style="width:${labelPct}%" /><col style="width:${unitPct}%" />${`<col style="width:${mixPct}%" />`.repeat(mixCount)}</colgroup>`;
}

function compositionColgroup(mixCount) {
  const total = totalUnits(mixCount);
  const labelPct = (((LABEL_UNITS + UNIT_UNITS) / total) * 100).toFixed(4);
  const halfPct = ((MIX_UNITS / 2 / total) * 100).toFixed(4);
  return `<colgroup><col style="width:${labelPct}%" />${`<col style="width:${halfPct}%" /><col style="width:${halfPct}%" />`.repeat(mixCount)}</colgroup>`;
}

// autoTable's `html` mode doesn't read <colgroup> at all — each table it's
// given gets its own independent "auto" column-width pass sized to that
// table's own content, so the on-screen colgroup alignment above is
// invisible to it. These mirror the same LABEL/UNIT/MIX ratios as explicit
// per-column pixel widths (autoTable's columnStyles) so all three tables
// come out aligned in the PDF too.
function metaColumnStyles(mixCount, contentWidth) {
  const total = totalUnits(mixCount);
  const labelW = (LABEL_UNITS / total) * contentWidth;
  const unitW = (UNIT_UNITS / total) * contentWidth;
  const mixW = (MIX_UNITS / total) * contentWidth;
  const styles = { 0: { cellWidth: labelW }, 1: { cellWidth: unitW } };
  for (let i = 0; i < mixCount; i++) styles[2 + i] = { cellWidth: mixW };
  return styles;
}

function compositionColumnStyles(mixCount, contentWidth) {
  const total = totalUnits(mixCount);
  const labelW = ((LABEL_UNITS + UNIT_UNITS) / total) * contentWidth;
  const halfW = (MIX_UNITS / 2 / total) * contentWidth;
  const styles = { 0: { cellWidth: labelW } };
  for (let i = 0; i < mixCount * 2; i++) styles[1 + i] = { cellWidth: halfW };
  return styles;
}

// Nutrients shown on the report's nutrient comparison table, regardless of
// which scenario basis the comparison itself was built on.
const NUTRIENT_REPORT_IDS = ['dm', 'cp', 'npn', 'pct_ex_npn', 'me', 'ca', 'p', 'k', 'mg', 's'];
const NUTRIENT_REPORT_LABELS = {
  dm: 'DM', cp: 'Crude Protein', npn: 'NPN', pct_ex_npn: 'Ex NPN (%)', me: 'ME (MJ/kg)',
  ca: 'Ca', p: 'P', k: 'K', mg: 'Mg', s: 'S',
};

function loadRecents(key) {
  try {
    const list = JSON.parse(localStorage.getItem(key));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveRecent(key, value) {
  if (!value) return;
  const list = loadRecents(key).filter((v) => v.toLowerCase() !== value.toLowerCase());
  list.unshift(value);
  localStorage.setItem(key, JSON.stringify(list.slice(0, MAX_RECENTS)));
}

// snaps: array of saved-mix snapshots (each with mixName/lines/result) —
// callers pass this directly (rep.js's mixes use .savedSnapshot, history.js's
// use .snapshot, so extracting it is the caller's job, not this module's).
// comparisonTableEl: the already-rendered comparison <table> to embed
// verbatim in the report, whatever its shape (single-focus or full master
// comparison) — this module doesn't need to understand its structure.
export function openReportFlow({ snaps, comparisonTableEl, profile }) {
  openInfoModal({ snaps, comparisonTableEl, profile });
}

function openInfoModal({ snaps, comparisonTableEl, profile }) {
  const clientsKey = CLIENTS_KEY_PREFIX + profile.id;
  const areasKey = AREAS_KEY_PREFIX + profile.id;
  const clients = loadRecents(clientsKey);
  const areas = loadRecents(areasKey);
  const today = new Date().toISOString().slice(0, 10);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:440px;">
      <div class="modal-head"><h2>Report details</h2></div>
      <label class="field"><span>Compiled by</span><input type="text" data-role="compiled-by" value="${escapeHtml(profile.email || '')}" /></label>
      <label class="field">
        <span>Client</span>
        <input type="text" list="report-client-list" data-role="client" placeholder="Client name" />
        <datalist id="report-client-list">${clients.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </label>
      <label class="field">
        <span>Area</span>
        <input type="text" list="report-area-list" data-role="area" placeholder="Area" />
        <datalist id="report-area-list">${areas.map((a) => `<option value="${escapeHtml(a)}"></option>`).join('')}</datalist>
      </label>
      <label class="field"><span>Date</span><input type="date" data-role="date" value="${today}" /></label>
      <div style="display:flex; gap:10px; margin-top:16px;">
        <button class="btn btn-secondary" data-role="back">Back</button>
        <button class="btn btn-primary" data-role="next">Next</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelector('[data-role="back"]').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('[data-role="next"]').addEventListener('click', () => {
    const get = (f) => backdrop.querySelector(`[data-role="${f}"]`).value.trim();
    const info = { compiledBy: get('compiled-by'), client: get('client'), area: get('area'), date: get('date') };
    saveRecent(clientsKey, info.client);
    saveRecent(areasKey, info.area);
    backdrop.remove();
    openReportViewer({ snaps, comparisonTableEl, info });
  });
}

function lickCompositionRows(snap) {
  const totalKg = (snap.lines || []).reduce((sum, l) => sum + (Number(l.inclusionPct) || 0), 0);
  return (snap.lines || []).map((l) => {
    const kg = Number(l.inclusionPct) || 0;
    return { name: l.ingredientName, kg, pct: totalKg > 0 ? (kg / totalKg) * 100 : 0 };
  });
}

function buildCompositionTable(snaps) {
  const names = new Set();
  const perLick = snaps.map((s) => {
    const rows = lickCompositionRows(s);
    rows.forEach((r) => names.add(r.name));
    return new Map(rows.map((r) => [r.name, r]));
  });
  const sortedNames = Array.from(names).sort((a, b) => a.localeCompare(b));

  const bodyRows = sortedNames
    .map((name) => {
      const cells = perLick
        .map((map) => {
          const r = map.get(name);
          return `<td class="num">${r ? fmt(r.kg, 2) : '—'}</td><td class="num">${r ? fmt(r.pct, 1) + '%' : '—'}</td>`;
        })
        .join('');
      return `<tr><td class="report-ingredient-col">${escapeHtml(name)}</td>${cells}</tr>`;
    })
    .join('');

  // Each lick's % column always sums to 100 by construction (see
  // lickCompositionRows) — shown anyway so the total row reads the same way
  // an accounting table would, with the kg total right next to it.
  const totalCells = snaps
    .map((s) => {
      const totalKg = (s.lines || []).reduce((sum, l) => sum + (Number(l.inclusionPct) || 0), 0);
      return `<td class="num"><strong>${fmt(totalKg, 2)}</strong></td><td class="num"><strong>${totalKg > 0 ? '100.0%' : '—'}</strong></td>`;
    })
    .join('');
  const totalRow = `<tr class="report-composition-total"><td class="report-ingredient-col"><strong>Total</strong></td>${totalCells}</tr>`;

  return `
    <table id="report-composition-table" class="spec-table compare-table report-fixed-table">
      ${compositionColgroup(snaps.length)}
      <thead>
        <tr><th rowspan="2" class="report-ingredient-col">Ingredient</th>${snaps.map((s) => `<th colspan="2">${escapeHtml(s.mixName)}</th>`).join('')}</tr>
        <tr>${snaps.map(() => '<th>kg</th><th>%</th>').join('')}</tr>
      </thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table>
  `;
}

function buildNutrientTable(snaps) {
  // Mirrors the Comparison table's Metric/Unit + one-column-per-lick layout
  // (same column count and CSS class) so the two tables line up visually.
  const rows = NUTRIENT_REPORT_IDS.map((id) => {
    const unit = NUTRIENTS.find((n) => n.id === id)?.unit ?? '';
    const cells = snaps
      .map((s) => {
        const entry = s.result.specification[id];
        return `<td class="num">${entry?.value != null ? fmt(entry.value, entry.value < 10 ? 3 : 2) : '—'}</td>`;
      })
      .join('');
    return `<tr><td>${NUTRIENT_REPORT_LABELS[id]}</td><td class="faint">${escapeHtml(unit)}</td>${cells}</tr>`;
  }).join('');

  return `
    <table id="report-nutrient-table" class="spec-table compare-table report-fixed-table">
      ${metaColgroup(snaps.length)}
      <thead><tr><th>Nutrient</th><th>Unit</th>${snaps.map((s) => `<th>${escapeHtml(s.mixName)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildInfoTable(info) {
  return `
    <table id="report-info-table" class="spec-table">
      <tbody>
        <tr><td><strong>Compiled by</strong></td><td>${escapeHtml(info.compiledBy || '—')}</td></tr>
        <tr><td><strong>Client</strong></td><td>${escapeHtml(info.client || '—')}</td></tr>
        <tr><td><strong>Area</strong></td><td>${escapeHtml(info.area || '—')}</td></tr>
        <tr><td><strong>Date</strong></td><td>${escapeHtml(info.date || '—')}</td></tr>
      </tbody>
    </table>
  `;
}

function openReportViewer({ snaps, comparisonTableEl, info }) {

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:1100px; max-height:88vh; overflow-y:auto;">
      <div class="modal-head">
        <h2>Lick Comparison Report</h2>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary btn-sm" data-role="download-pdf">Download as PDF</button>
          <button class="icon-btn" data-role="close">✕</button>
        </div>
      </div>
      <div id="report-content">
        <div class="section-label">General Information</div>
        ${buildInfoTable(info)}
        <div class="section-label" style="margin-top:18px;">Lick Composition</div>
        <div style="overflow-x:auto;">${buildCompositionTable(snaps)}</div>
        <div class="section-label" style="margin-top:18px;">Comparison</div>
        <div style="overflow-x:auto;" id="report-comparison-wrap"></div>
        <div class="section-label" style="margin-top:18px;">Nutrient Comparison</div>
        <div style="overflow-x:auto;">${buildNutrientTable(snaps)}</div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const clonedComparison = comparisonTableEl.cloneNode(true);
  clonedComparison.id = 'report-comparison-table';
  clonedComparison.classList.add('report-fixed-table');
  clonedComparison.insertAdjacentHTML('afterbegin', metaColgroup(snaps.length));
  backdrop.querySelector('#report-comparison-wrap').appendChild(clonedComparison);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-role="close"]').addEventListener('click', () => backdrop.remove());

  backdrop.querySelector('[data-role="download-pdf"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      await downloadReportAsPdf(backdrop.querySelector('#report-content'), info, snaps.length);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Could not generate the PDF: ' + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download as PDF';
    }
  });
}

async function downloadReportAsPdf(contentEl, info, mixCount) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('https://esm.sh/jspdf@2'),
    import('https://esm.sh/jspdf-autotable@3'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 40;
  const contentWidth = doc.internal.pageSize.getWidth() - margin * 2;

  doc.setFontSize(16);
  doc.text('Lick Comparison Report', margin, margin);

  const BODY_FONT_SIZE = 8;
  // Matches css/style.css's --safe/--safe-bg and --risk/--risk-bg (light
  // background, saturated text) rather than a solid fill, to look like the
  // same soft pill used on screen.
  const BADGE_COLORS = {
    risk: { fill: [247, 226, 220], textColor: [181, 70, 47] },
    safe: { fill: [228, 239, 226], textColor: [74, 122, 85] },
  };

  let y = margin + 20;
  const baseOptions = {
    startY: y,
    margin: { left: margin, right: margin },
    styles: { fontSize: BODY_FONT_SIZE },
    headStyles: { fillColor: [95, 122, 90] },
    didParseCell: (data) => {
      const cellEl = data.cell.raw;
      if (!(cellEl instanceof HTMLElement)) return;

      // Section headings (e.g. "Protein Supplementation") come through as
      // .group-row cells but autoTable's html import doesn't carry over
      // enough of their CSS to actually stand out on the page — force it.
      const rowEl = cellEl.closest('tr');
      if (rowEl?.classList.contains('group-row')) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [46, 42, 34];
        data.cell.styles.fillColor = [228, 235, 224]; // matches css/style.css's --accent-soft
      }

      // Risk/Safe badges: strip the badge's own label out of the cell's
      // plain text now (before it's drawn) and stash the colors so
      // didDrawCell below can paint a rounded pill instead, once the rest
      // of the cell's text is already in place.
      const badgeEl = cellEl.querySelector('.badge-risk, .badge-safe');
      if (badgeEl) {
        const kind = badgeEl.classList.contains('badge-risk') ? 'risk' : 'safe';
        const badgeText = badgeEl.textContent.trim();
        const leadingText = cellEl.textContent.replace(/\s+/g, ' ').trim().replace(new RegExp(badgeText + '$'), '').trim();
        data.cell.text = leadingText ? [leadingText] : [];
        data.cell._badge = { text: badgeText, hasLeadingText: !!leadingText, ...BADGE_COLORS[kind] };
      }

      // Composition table's Total row — bold text, double rule drawn above
      // it in didDrawCell (a plain CSS border doesn't carry through to the
      // PDF the way it does on screen).
      if (rowEl?.classList.contains('report-composition-total')) {
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawCell: (data) => {
      const badge = data.cell._badge;
      if (badge) {
        doc.setFontSize(7);
        doc.setFont(undefined, 'bold');
        const padX = 5;
        const pillH = 11;
        const pillW = doc.getTextWidth(badge.text) + padX * 2;
        const pillX = data.cell.x + (data.cell.width - pillW) / 2;
        const pillY = badge.hasLeadingText
          ? data.cell.y + data.cell.height - pillH - 3
          : data.cell.y + (data.cell.height - pillH) / 2;
        doc.setFillColor(...badge.fill);
        doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2, pillH / 2, 'F');
        doc.setTextColor(...badge.textColor);
        doc.text(badge.text, data.cell.x + data.cell.width / 2, pillY + pillH / 2 + 2.5, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.setFontSize(BODY_FONT_SIZE);
        doc.setTextColor(46, 42, 34);
      }

      const rowEl = data.cell.raw?.closest?.('tr');
      if (rowEl?.classList.contains('report-composition-total')) {
        doc.setDrawColor(46, 42, 34);
        doc.setLineWidth(0.6);
        doc.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y);
        doc.line(data.cell.x, data.cell.y + 1.6, data.cell.x + data.cell.width, data.cell.y + 1.6);
      }
    },
  };

  // Info table has no lick columns to line up — auto-sized like normal.
  const infoTable = contentEl.querySelector('#report-info-table');
  if (infoTable) {
    autoTable(doc, { ...baseOptions, html: infoTable, startY: y });
    y = doc.lastAutoTable.finalY + 24;
  }

  // These three share the same column-width ratios as the on-screen
  // colgroups (see metaColumnStyles/compositionColumnStyles above) so a
  // mix's column lands in the same place in the PDF as it does on screen.
  const compositionTable = contentEl.querySelector('#report-composition-table');
  if (compositionTable) {
    autoTable(doc, { ...baseOptions, html: compositionTable, startY: y, columnStyles: compositionColumnStyles(mixCount, contentWidth) });
    y = doc.lastAutoTable.finalY + 24;
  }

  const comparisonTable = contentEl.querySelector('#report-comparison-table');
  if (comparisonTable) {
    autoTable(doc, { ...baseOptions, html: comparisonTable, startY: y, columnStyles: metaColumnStyles(mixCount, contentWidth) });
    y = doc.lastAutoTable.finalY + 24;
  }

  const nutrientTable = contentEl.querySelector('#report-nutrient-table');
  if (nutrientTable) {
    autoTable(doc, { ...baseOptions, html: nutrientTable, startY: y, columnStyles: metaColumnStyles(mixCount, contentWidth) });
    y = doc.lastAutoTable.finalY + 24;
  }

  const filenameBits = ['lick-comparison', info.client, info.date].filter(Boolean);
  doc.save(filenameBits.join('-').replace(/\s+/g, '_') + '.pdf');
}
