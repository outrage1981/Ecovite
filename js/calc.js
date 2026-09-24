// Pure calculation engine for the EcoVite lick cost comparison tool.
// No DOM, no network — everything here is unit-testable and framework-free.
//
// Fixes applied relative to the source spreadsheet (documented so the reasoning
// survives a future refactor):
//  1. NPN and ME are never stored values — they are always derived from
//     (Crude Protein x %Protein-ex-NPN) and (TDN x 0.1496). This makes the old
//     "Ammonium Chloride has %ex-NPN but no NPN value" bug structurally
//     impossible: there is nowhere to type a wrong or missing NPN.
//  2. Missing lab data (null) is tracked separately from an analysed zero.
//     A weighted average that includes an ingredient with no data for a
//     nutrient is flagged `hasGaps: true` instead of silently treating the
//     gap as 0.
//  3. The NPN safety check returns null (not a false "RISIKO") when there is
//     no ration to evaluate, instead of the spreadsheet's `COUNT(...)=0`
//     check, which never actually equalled zero because the safe-limit cell
//     always had a value.
//  4. The safety check runs against whichever intake the rep is actually
//     recommending (phosphorus-, protein-, or energy-driven), not always the
//     protein-driven one.

export const ME_PER_TDN = 0.1496; // ME (MJ/kg) = TDN (%) * 0.1496
export const NITROGEN_TO_PROTEIN = 6.25; // CP = N * 6.25
export const KG_PER_BAG = 20; // 50 kg bags -> ton / 20

/**
 * NPN (%) is always derived, never entered — this is what makes it
 * impossible to repeat the source spreadsheet's Ammonium Chloride bug
 * (a %-NPN-fraction entered with no corresponding NPN figure).
 *
 * `npnFractionPct` unset (no data) is treated as 0 — i.e. "no NPN fraction
 * recorded" defaults to "this is a conventional protein source, not an NPN
 * one", matching how the source sheet's formulas behaved for every ordinary
 * feedstuff (maize, oilcake, etc). Only an unanalysed crude protein (`null`)
 * produces a genuine "no data" result, since NPN cannot be derived at all
 * without a CP figure.
 */
export function deriveNpn(crudeProtein, npnFractionPct) {
  if (crudeProtein == null) return null;
  const fraction = npnFractionPct ?? 0;
  return (fraction / 100) * crudeProtein;
}

/** ME (MJ/kg) is always derived from TDN, never entered. */
export function deriveMe(tdn) {
  if (tdn == null) return null;
  return tdn * ME_PER_TDN;
}

/**
 * Effective nutrient value for an ingredient, resolving derived nutrients
 * (npn, me) through their source fields rather than a stored column.
 */
export function effectiveNutrientValue(ingredientValues, nutrientId) {
  if (nutrientId === 'npn') {
    return deriveNpn(ingredientValues.cp, ingredientValues.pct_ex_npn);
  }
  if (nutrientId === 'me') {
    return deriveMe(ingredientValues.tdn);
  }
  return ingredientValues[nutrientId] ?? null;
}

/**
 * Weighted average of a nutrient across mix lines (% "as is" inclusion).
 * lines: [{ ingredientId, inclusionPct, values: {nutrientId: number|null} }]
 * Mirrors the spreadsheet's SUMPRODUCT(inclusion%, nutrient%) / total%, but
 * treats a missing (null) value as "unknown" rather than 0, and reports
 * whether any included ingredient was missing data for this nutrient.
 */
export function weightedNutrientAverage(lines, nutrientId) {
  const totalInclusion = lines.reduce((sum, l) => sum + (l.inclusionPct || 0), 0);
  if (totalInclusion <= 0) return { value: null, hasGaps: false };

  let weightedSum = 0;
  let hasGaps = false;
  for (const line of lines) {
    const val = effectiveNutrientValue(line.values, nutrientId);
    if (val == null) {
      if (line.inclusionPct > 0) hasGaps = true;
      continue; // treat as "contributes nothing known", flagged via hasGaps
    }
    weightedSum += val * line.inclusionPct;
  }
  return { value: weightedSum / totalInclusion, hasGaps };
}

/** Weighted-average cost per ton (R), matching SUMPRODUCT(inclusion%, cost/ton)/total%. */
export function costPerTon(lines) {
  const totalInclusion = lines.reduce((sum, l) => sum + (l.inclusionPct || 0), 0);
  if (totalInclusion <= 0) return null;
  const weightedSum = lines.reduce(
    (sum, l) => sum + (l.costPerTon || 0) * (l.inclusionPct || 0),
    0
  );
  return weightedSum / totalInclusion;
}

export function costPerBag(costPerTonValue) {
  if (costPerTonValue == null) return null;
  return costPerTonValue / KG_PER_BAG;
}

/** Minimum lick intake (g/head/day) to hit a phosphorus or protein target expressed in g/head/day. */
export function minLickIntakeFromPercentNutrient(targetGPerHeadDay, nutrientPctInMix) {
  if (targetGPerHeadDay == null || !nutrientPctInMix || nutrientPctInMix <= 0) return null;
  return (100 * targetGPerHeadDay) / nutrientPctInMix;
}

/** Minimum lick intake (g/head/day) to hit an energy target expressed in MJ/head/day, given ME in MJ/kg. */
export function minLickIntakeFromEnergy(targetMjPerHeadDay, mePerKg) {
  if (targetMjPerHeadDay == null || !mePerKg || mePerKg <= 0) return null;
  return (1000 * targetMjPerHeadDay) / mePerKg;
}

/** Cost per head per day (R) given cost/ton (R) and intake (g/head/day). */
export function supplementCostPerHead(costPerTonValue, intakeGPerHeadDay) {
  if (costPerTonValue == null || intakeGPerHeadDay == null) return null;
  return (costPerTonValue / 1000) * (intakeGPerHeadDay / 1000);
}

/** NPN supplied (g N/head/day) at a given intake, from the mix's NPN %. */
export function npnSuppliedPerHead(intakeGPerHeadDay, npnPctInMix) {
  if (intakeGPerHeadDay == null || npnPctInMix == null) return null;
  return (intakeGPerHeadDay * npnPctInMix) / 100 / NITROGEN_TO_PROTEIN;
}

/**
 * Safety status against the Act 36 maximum. Returns null (render as "—",
 * never as a false RISIKO) when there is nothing to evaluate.
 */
export function npnStatus(npnSuppliedGPerHeadDay, maxSafeGPerHeadDay) {
  if (npnSuppliedGPerHeadDay == null || maxSafeGPerHeadDay == null) return null;
  return npnSuppliedGPerHeadDay > maxSafeGPerHeadDay ? 'RISK' : 'SAFE';
}

/**
 * A "Production Lick" must satisfy a protein AND an energy target at once.
 * Feeding enough to hit the protein target is checked first; if that
 * amount already supplies enough energy too, it's the answer. Otherwise the
 * intake is raised until the energy target is met as well — since energy
 * supplied rises linearly with intake (the mix's ME/kg is fixed), the
 * amount needed is exactly minLickIntakeFromEnergy(...), so taking the
 * larger of the two required intakes gives the same result a step-by-step
 * "increment by 0.1g/hd/day until satisfied" search would converge to,
 * without actually looping.
 */
export function productionScenario(cpPct, mePerKg, costTonValue, npnPct, productionTarget, maxSafeNpnGPerHeadDay) {
  const proteinIntake = minLickIntakeFromPercentNutrient(productionTarget?.protein, cpPct);
  const energyIntake = minLickIntakeFromEnergy(productionTarget?.energy, mePerKg);
  const intake =
    proteinIntake != null && energyIntake != null
      ? Math.max(proteinIntake, energyIntake)
      : proteinIntake ?? energyIntake ?? null;

  // Actual amounts delivered at the final (possibly energy-driven, larger
  // than the protein-only minimum) intake — not just the configured target.
  // Whichever requirement wasn't the binding one ends up over-supplied, and
  // that's the whole point of taking the larger intake, so this must be
  // shown rather than echoing the target back unchanged.
  const proteinSuppliedG = intake != null && cpPct != null ? (intake * cpPct) / 100 : null;
  const energySuppliedMj = intake != null && mePerKg != null ? (intake * mePerKg) / 1000 : null;

  return {
    label: 'Production',
    targetGPerHeadDay: productionTarget?.protein ?? null,
    targetMjPerHeadDay: productionTarget?.energy ?? null,
    proteinSuppliedG,
    energySuppliedMj,
    minLickIntakeG: intake,
    costPerHead: supplementCostPerHead(costTonValue, intake),
    npnSuppliedG: npnSuppliedPerHead(intake, npnPct),
    npnStatus: npnStatus(npnSuppliedPerHead(intake, npnPct), maxSafeNpnGPerHeadDay),
  };
}

/**
 * Full result set for one mix: nutrient specification, cost/ton, cost/bag,
 * and the intake-driven cost-per-head scenarios (each with its own NPN
 * safety check run against that scenario's own intake).
 *
 * lines: [{ ingredientId, ingredientName, inclusionPct, costPerTon, values }]
 * nutrientIds: ordered list of nutrient ids to compute the specification for
 * targets: { p: gPerHeadDay, cp: gPerHeadDay, me: mjPerHeadDay }
 * maxSafeNpnGPerHeadDay: Act 36 limit for the selected species/supplement type
 * productionTarget: { protein: gPerHeadDay, energy: mjPerHeadDay } | undefined
 */
export function computeMixResult(lines, nutrientIds, targets, maxSafeNpnGPerHeadDay, productionTarget) {
  const totalInclusion = lines.reduce((sum, l) => sum + (l.inclusionPct || 0), 0);

  const specification = {};
  for (const nutrientId of nutrientIds) {
    specification[nutrientId] = weightedNutrientAverage(lines, nutrientId);
  }

  const costTon = costPerTon(lines);
  const costBag = costPerBag(costTon);

  const pPct = specification.p?.value ?? null;
  const cpPct = specification.cp?.value ?? null;
  const mePerKg = specification.me?.value ?? null;
  const npnPct = specification.npn?.value ?? null;

  const scenarios = {};

  const pIntake = minLickIntakeFromPercentNutrient(targets?.p, pPct);
  scenarios.phosphorus = {
    label: 'Phosphorus',
    targetGPerHeadDay: targets?.p ?? null,
    minLickIntakeG: pIntake,
    costPerHead: supplementCostPerHead(costTon, pIntake),
    npnSuppliedG: npnSuppliedPerHead(pIntake, npnPct),
    npnStatus: npnStatus(npnSuppliedPerHead(pIntake, npnPct), maxSafeNpnGPerHeadDay),
  };

  const cpIntake = minLickIntakeFromPercentNutrient(targets?.cp, cpPct);
  scenarios.protein = {
    label: 'Protein',
    targetGPerHeadDay: targets?.cp ?? null,
    minLickIntakeG: cpIntake,
    costPerHead: supplementCostPerHead(costTon, cpIntake),
    npnSuppliedG: npnSuppliedPerHead(cpIntake, npnPct),
    npnStatus: npnStatus(npnSuppliedPerHead(cpIntake, npnPct), maxSafeNpnGPerHeadDay),
  };

  const meIntake = minLickIntakeFromEnergy(targets?.me, mePerKg);
  scenarios.energy = {
    label: 'Energy',
    targetMjPerHeadDay: targets?.me ?? null,
    minLickIntakeG: meIntake,
    costPerHead: supplementCostPerHead(costTon, meIntake),
    npnSuppliedG: npnSuppliedPerHead(meIntake, npnPct),
    npnStatus: npnStatus(npnSuppliedPerHead(meIntake, npnPct), maxSafeNpnGPerHeadDay),
  };

  scenarios.production = productionScenario(cpPct, mePerKg, costTon, npnPct, productionTarget, maxSafeNpnGPerHeadDay);

  return {
    totalInclusionPct: totalInclusion,
    costPerTon: costTon,
    costPerBag: costBag,
    specification,
    scenarios,
    maxSafeNpnGPerHeadDay: maxSafeNpnGPerHeadDay ?? null,
  };
}
