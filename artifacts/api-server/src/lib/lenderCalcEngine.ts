import type { VehicleTermMatrixEntry, VehicleConditionMatrixEntry } from "./bbObjectStore.js";

export type CapModelResolved = "allInOnly" | "split" | "backendOnly" | "unknown";
export type CapProfileKey = "000" | "001" | "010" | "011" | "100" | "101" | "110" | "111";

export interface CapProfile {
  hasAdvanceCap: boolean;
  hasAftermarketCap: boolean;
  hasAllInCap: boolean;
  allInOnly: boolean;
  key: CapProfileKey;
}

export interface CapProfileInput {
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  capModelResolved?: CapModelResolved;
}

export interface NoOnlineSellContext {
  pacCost: number;
  downPayment: number;
  netTrade: number;
  creditorFee: number;
  maxAdvance: number;
  maxAllInPreTax: number;
  profile: CapProfile;
}

export interface NoOnlineSellResolution {
  price: number;
  source: "maximized" | "pac";
  rejection?: "ltvAdvance" | "ltvAllIn";
  strategy: string;
}

export const NO_ONLINE_STRATEGY_BY_PROFILE: Record<CapProfileKey, string> = {
  "000": "pacFallback",
  "001": "maximizeFromAllIn",
  "010": "pacFallback",
  "011": "maximizeFromAllIn",
  "100": "maximizeFromAdvance",
  "101": "maximizeFromAdvanceAndAllIn",
  "110": "maximizeFromAdvance",
  "111": "maximizeFromAdvanceAndAllIn",
};

/**
 * Resolves the LTV cap profile for a lender tier into a 3-bit key and boolean flags.
 *
 * The key encodes which caps are active: bit 2 = advance, bit 1 = aftermarket, bit 0 = allIn.
 * Example: "101" means advance cap + allIn cap are active, aftermarket is not.
 *
 * Special rule: when capModelResolved is "allInOnly", the aftermarket cap is suppressed
 * even if a numeric value exists in the tier — this prevents double-constraining products
 * when the lender uses a single all-in bucket for everything.
 *
 * The `allInOnly` flag is true when neither advance nor aftermarket caps are active
 * and only the all-in cap governs the deal (common for Santander, iAF).
 *
 * @param input - Tier LTV percentages + capModelResolved classification
 * @returns CapProfile with boolean flags and a CapProfileKey ("000" through "111")
 */
export function resolveCapProfile(input: CapProfileInput): CapProfile {
  const hasAdvanceCap = input.maxAdvanceLTV > 0;
  const hasAllInCap = input.maxAllInLTV > 0;
  let hasAftermarketCap = input.maxAftermarketLTV > 0;

  // If formula classification says all-in only, suppress aftermarket split cap even if a numeric tier value exists.
  if (input.capModelResolved === "allInOnly") {
    hasAftermarketCap = false;
  }

  const key = `${hasAdvanceCap ? 1 : 0}${hasAftermarketCap ? 1 : 0}${hasAllInCap ? 1 : 0}` as CapProfileKey;

  return {
    hasAdvanceCap,
    hasAftermarketCap,
    hasAllInCap,
    allInOnly: !hasAdvanceCap && !hasAftermarketCap && hasAllInCap,
    key,
  };
}

/**
 * Determines the maximized selling price when a vehicle has no online listing price.
 *
 * Strategy is determined by the cap profile key (see NO_ONLINE_STRATEGY_BY_PROFILE):
 * - "pacFallback" (000, 010): no LTV caps → sell at PAC cost
 * - "maximizeFromAdvance" (100, 110): ceiling = maxAdvance + downPayment + netTrade
 * - "maximizeFromAllIn" (001, 011): ceiling = maxAllInPreTax - creditorFee + downPayment + netTrade
 * - "maximizeFromAdvanceAndAllIn" (101, 111): tighter of the two above
 *
 * If the computed ceiling is below PAC cost, the vehicle is flagged with a
 * rejection reason ("ltvAdvance" or "ltvAllIn") — the caller decides whether
 * to skip it or show required down payment.
 *
 * @param ctx - PAC cost, down payment, net trade, creditor fee, max ceilings, and cap profile
 * @returns { price, source ("maximized" | "pac"), rejection?, strategy }
 */
export function resolveNoOnlineSellingPrice(ctx: NoOnlineSellContext): NoOnlineSellResolution {
  const strategy = NO_ONLINE_STRATEGY_BY_PROFILE[ctx.profile.key];

  const ceilings: { value: number; reason: "ltvAdvance" | "ltvAllIn" }[] = [];
  if (ctx.profile.hasAdvanceCap) {
    ceilings.push({
      value: Math.round(ctx.maxAdvance + ctx.downPayment + ctx.netTrade),
      reason: "ltvAdvance",
    });
  }
  if (ctx.profile.hasAllInCap) {
    ceilings.push({
      value: Math.round(ctx.maxAllInPreTax - ctx.creditorFee + ctx.downPayment + ctx.netTrade),
      reason: "ltvAllIn",
    });
  }

  if (ceilings.length === 0) {
    return { price: ctx.pacCost, source: "pac", strategy };
  }

  const effective = ceilings.reduce((min, c) => c.value < min.value ? c : min, ceilings[0]);

  if (effective.value < ctx.pacCost) {
    return {
      price: effective.value,
      source: "maximized",
      rejection: effective.reason,
      strategy,
    };
  }

  return {
    price: effective.value,
    source: "maximized",
    strategy,
  };
}

/** Accepts boolean or common string/number serializations from proxies and clients */
export function truthyOptionalFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "on";
  }
  return false;
}

/** +6/+12 mo only; coerces strings so JSON/proxies cannot break [0,6,12].includes */
export function normalizeTermStretchMonths(v: unknown): 0 | 6 | 12 {
  const n = typeof v === "string" ? parseInt(v.trim(), 10) : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n === 6 || n === 12) return n;
  return 0;
}

/** Hard cap on total finance term (months) when applying an exception stretch */
export const MAX_FINANCE_TERM_MONTHS = 84;

/** Largest stretch in {12,6,0} such that baseTerm + stretch <= maxTotal (default 84) */
export function largestStretchNotExceeding(baseTerm: number, maxTotal: number = MAX_FINANCE_TERM_MONTHS): 0 | 6 | 12 {
  if (baseTerm >= maxTotal) return 0;
  const order: (0 | 6 | 12)[] = [12, 6, 0];
  for (const s of order) {
    if (baseTerm + s <= maxTotal) return s;
  }
  return 0;
}

/**
 * Applies a term exception (stretch) to a matrix-derived base term.
 *
 * Business rules:
 * - Hard cap: no finance term can exceed MAX_FINANCE_TERM_MONTHS (84).
 * - If the matrix already qualifies at 84 months, no stretch is applied
 *   regardless of user request — returns cappedReason "matrix_already_84_no_stretch".
 * - A 78mo base with +12 requested is capped to +6 (reaching 84) — returns
 *   cappedReason "78_only_plus6_to_84".
 * - Any other over-cap scenario returns "capped_at_84_max".
 *
 * @param baseTerm - Term in months from the vehicle/year/km matrix lookup
 * @param requested - User-selected stretch: 0, 6, or 12 months
 * @returns effectiveStretch (actual months added), termMonths (final term),
 *   stretched (boolean), and optional cappedReason explaining any reduction
 */
export function resolveEffectiveTermStretch(
  baseTerm: number,
  requested: 0 | 6 | 12,
): {
  effectiveStretch: 0 | 6 | 12;
  termMonths: number;
  stretched: boolean;
  cappedReason?: "matrix_already_84_no_stretch" | "78_only_plus6_to_84" | "capped_at_84_max";
} {
  if (baseTerm >= MAX_FINANCE_TERM_MONTHS) {
    return {
      effectiveStretch: 0,
      termMonths:       baseTerm,
      stretched:        false,
      cappedReason:     baseTerm === MAX_FINANCE_TERM_MONTHS ? "matrix_already_84_no_stretch" : undefined,
    };
  }
  const maxStretch = largestStretchNotExceeding(baseTerm, MAX_FINANCE_TERM_MONTHS);
  const effectiveStretch = (Math.min(requested, maxStretch) as 0 | 6 | 12);
  const termMonths = baseTerm + effectiveStretch;

  let cappedReason: "matrix_already_84_no_stretch" | "78_only_plus6_to_84" | "capped_at_84_max" | undefined;
  if (requested > effectiveStretch) {
    if (baseTerm === 78 && requested === 12 && effectiveStretch === 6) {
      cappedReason = "78_only_plus6_to_84";
    } else {
      cappedReason = "capped_at_84_max";
    }
  }

  return {
    effectiveStretch,
    termMonths,
    stretched: effectiveStretch > 0,
    cappedReason,
  };
}

export function pmt(rate: number, nper: number, pv: number): number {
  if (nper <= 0) return 0;
  if (rate === 0) return pv / nper;
  const r = rate / 12;
  return (pv * r * Math.pow(1 + r, nper)) / (Math.pow(1 + r, nper) - 1);
}

export function parseVehicleYear(vehicle: string): number | null {
  const match = vehicle.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}

export function lookupTerm(
  matrix: VehicleTermMatrixEntry[],
  year: number,
  km: number,
): number | null {
  const entry = matrix.find(e => e.year === year);
  if (!entry) return null;
  const match = entry.data.find(d => km >= d.kmFrom && km <= d.kmTo);
  return match ? match.term : null;
}

export type ConditionBucket = "extraClean" | "clean" | "average" | "rough";

export function lookupCondition(
  matrix: VehicleConditionMatrixEntry[],
  year: number,
  km: number,
): ConditionBucket | null {
  const entry = matrix.find(e => e.year === year);
  if (!entry) return null;
  const buckets: ConditionBucket[] = ["extraClean", "clean", "average", "rough"];
  for (const bucket of buckets) {
    const range = entry[bucket];
    if (km >= range.kmFrom && km <= range.kmTo) return bucket;
  }
  return null;
}

/**
 * Parses inventory string fields (e.g. "$12,500.00", "12500", null) into a
 * finite number. Returns 0 for missing/non-finite values so callers can
 * test with `<= 0` instead of branching on type/format.
 */
export function parseInventoryNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Allocated backend product state during deal construction */
export interface ProductState {
  admin: number;
  warranty: number;
  gap: number;
}

/**
 * Trims allocated backend products in reverse priority order (gap -> warranty -> admin)
 * until `excess` is absorbed, mutating `state` in place.
 *
 * Returns the unabsorbed remainder, which the caller converts into additional
 * required down payment (cash absorbs whatever the products couldn't).
 */
export function trimProductsInOrder(state: ProductState, excess: number): number {
  let remaining = Math.max(0, Math.ceil(excess));
  for (const key of ["gap", "warranty", "admin"] as const) {
    if (remaining <= 0) break;
    const cut = Math.min(state[key], remaining);
    state[key] -= cut;
    remaining -= cut;
  }
  return remaining;
}

/**
 * Computes the pre-tax present-value ceiling derived from the maximum monthly payment.
 * Returns `Infinity` when no payment cap applies.
 */
export function computePaymentCeilingPV(rateDecimal: number, termMonths: number, maxPmt: number): number {
  if (!Number.isFinite(maxPmt)) return Infinity;
  if (rateDecimal === 0) return maxPmt * termMonths;
  const monthlyRate = rateDecimal / 12;
  const factor = (Math.pow(1 + monthlyRate, termMonths) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, termMonths));
  return maxPmt * factor;
}

export interface ZeroDpCeilingInput {
  hasAdvanceCap: boolean;
  maxAdvance: number;
  hasAllInCap: boolean;
  maxAllInPreTax: number;
  paymentPV: number;
  downPayment: number;
  netTrade: number;
  creditorFee: number;
  taxRate: number;
}

export interface ZeroDpCeilingResult {
  ltvCeiling: number;
  ltvReason: "advance" | "allIn" | "none";
  paymentCeiling: number;
  zeroDpCeiling: number;
  bindingReason: "advance" | "allIn" | "payment" | "none";
}

/**
 * Computes the maximum selling price that requires zero additional down payment,
 * combining the active LTV ceilings with the payment-driven ceiling.
 *
 * - LTV ceiling = min of advance and all-in ceilings (whichever applies).
 * - Payment ceiling = pre-tax PV of `maxPmt`, less creditor fee and lender exposure
 *   adjustments (downPayment + netTrade).
 * - Zero-DP ceiling = tighter of the two; reason explains which bound binds.
 */
export function computeZeroDpCeiling(input: ZeroDpCeilingInput): ZeroDpCeilingResult {
  const ltvCandidates: { value: number; reason: "advance" | "allIn" }[] = [];
  if (input.hasAdvanceCap) {
    ltvCandidates.push({ value: input.maxAdvance + input.downPayment + input.netTrade, reason: "advance" });
  }
  if (input.hasAllInCap) {
    ltvCandidates.push({
      value: input.maxAllInPreTax - input.creditorFee + input.downPayment + input.netTrade,
      reason: "allIn",
    });
  }

  let ltvCeiling = Infinity;
  let ltvReason: "advance" | "allIn" | "none" = "none";
  if (ltvCandidates.length > 0) {
    const min = ltvCandidates.reduce((best, cur) => (cur.value < best.value ? cur : best), ltvCandidates[0]);
    ltvCeiling = Math.floor(min.value);
    ltvReason = min.reason;
  }

  const paymentCeiling = Number.isFinite(input.paymentPV)
    ? Math.floor((input.paymentPV / (1 + input.taxRate)) + input.downPayment + input.netTrade - input.creditorFee)
    : Infinity;

  const zeroDpCeiling = Math.min(ltvCeiling, paymentCeiling);

  let bindingReason: ZeroDpCeilingResult["bindingReason"] = "none";
  if (Number.isFinite(zeroDpCeiling)) {
    if (paymentCeiling <= ltvCeiling) bindingReason = "payment";
    else bindingReason = ltvReason;
  }

  return { ltvCeiling, ltvReason, paymentCeiling, zeroDpCeiling, bindingReason };
}

export interface SellingPriceInput {
  pacCost: number;
  onlinePrice: number | null;
  zeroDpCeiling: number;
  bindingZeroDpReason: "advance" | "allIn" | "payment" | "none";
}

export interface SellingPriceResolution {
  sellingPrice: number;
  sellingPriceCappedByOnline: boolean;
  bindingSellingConstraint: "online" | "advance" | "allIn" | "payment" | "pacFloor" | "none";
  /** Minimum down payment required to reach PAC when zero-DP ceiling is below PAC */
  requiredDownPaymentForPac: number;
}

/**
 * Selects the front-first selling price:
 * - With an online price: cap selling price at the online price (never exceed).
 * - Without one: maximize selling price up to the zero-DP ceiling, then floor at PAC.
 *
 * If the zero-DP ceiling is below PAC, returns the minimum cash required to lift
 * lender exposure to PAC via `requiredDownPaymentForPac`. Selling price is always
 * floored at PAC; the caller decides how to surface the DP requirement.
 */
export function resolveSellingPrice(input: SellingPriceInput): SellingPriceResolution {
  const ceilingFinite = Number.isFinite(input.zeroDpCeiling) ? input.zeroDpCeiling : input.pacCost;
  const requiredDownPaymentForPac = ceilingFinite < input.pacCost ? Math.ceil(input.pacCost - ceilingFinite) : 0;

  let sellingPrice: number;
  let sellingPriceCappedByOnline = false;
  let bindingSellingConstraint: SellingPriceResolution["bindingSellingConstraint"];

  if (input.onlinePrice != null) {
    const cappedCeiling = Math.min(input.onlinePrice, ceilingFinite);
    sellingPrice = Math.max(input.pacCost, cappedCeiling);
    const onlineIsBinding = input.onlinePrice <= ceilingFinite;
    if (sellingPrice <= input.pacCost && cappedCeiling < input.pacCost) {
      bindingSellingConstraint = "pacFloor";
    } else if (onlineIsBinding) {
      bindingSellingConstraint = "online";
      sellingPriceCappedByOnline = true;
    } else {
      bindingSellingConstraint = input.bindingZeroDpReason;
    }
  } else {
    sellingPrice = Math.max(input.pacCost, ceilingFinite);
    if (ceilingFinite < input.pacCost) {
      bindingSellingConstraint = "pacFloor";
    } else {
      bindingSellingConstraint = input.bindingZeroDpReason;
    }
  }

  return { sellingPrice, sellingPriceCappedByOnline, bindingSellingConstraint, requiredDownPaymentForPac };
}

export interface BackendAllocationInput {
  allInRoom: number;
  aftermarketRoom: number;
  capAdmin: number | undefined;
  desiredAdmin: number;
  capWarranty: number | undefined;
  capGap: number | undefined;
  gapAllowed: boolean;
  adminInclusion: string;
  markup: number;
  minWarrantyCost: number;
  minGapCost: number;
  maxGapPrice: number;
}

/**
 * Allocates backend products incrementally in priority order:
 * dealer admin -> warranty -> GAP/AH.
 *
 * Honors the smaller of `allInRoom` and `aftermarketRoom` for warranty/GAP.
 * Admin allocation depends on `adminInclusion`:
 * - "excluded": admin only consumes all-in room (not aftermarket); does not
 *   reduce warranty/GAP budget when aftermarket is the binding cap.
 * - other: admin reduces shared room before warranty/GAP.
 *
 * Per-product minimum cost thresholds (after markup) gate inclusion. The result
 * is a `ProductState` ready to feed into the constraint settle loop.
 */
export function allocateBackend(input: BackendAllocationInput): ProductState {
  let room = Number.isFinite(input.allInRoom) ? input.allInRoom : Infinity;
  if (Number.isFinite(input.aftermarketRoom)) room = Math.min(room, input.aftermarketRoom);
  if (!Number.isFinite(room) || room < 0) room = 0;

  const state: ProductState = { admin: 0, warranty: 0, gap: 0 };
  const adminFromCap = input.capAdmin != null ? Math.min(input.desiredAdmin, input.capAdmin) : input.desiredAdmin;

  let warGapRoom: number;
  if (input.adminInclusion === "excluded") {
    const adminRoom = Number.isFinite(input.allInRoom) ? Math.max(0, Math.floor(input.allInRoom)) : adminFromCap;
    state.admin = Math.min(adminFromCap, adminRoom);
    warGapRoom = Number.isFinite(input.allInRoom)
      ? Math.max(0, Math.min(room, input.allInRoom - state.admin))
      : room;
  } else {
    state.admin = Math.min(adminFromCap, Math.floor(room));
    warGapRoom = Math.max(0, room - state.admin);
  }

  const minWarrantyPrice = Math.round(input.minWarrantyCost * input.markup);
  if (warGapRoom >= minWarrantyPrice) {
    let warranty = input.capWarranty != null ? Math.min(warGapRoom, input.capWarranty) : warGapRoom;
    warranty = Math.max(warranty, minWarrantyPrice);
    if (warranty <= warGapRoom) state.warranty = warranty;
  }
  warGapRoom -= state.warranty;

  if (input.gapAllowed) {
    const minGapPrice = Math.round(input.minGapCost * input.markup);
    if (warGapRoom >= minGapPrice) {
      const gapCeiling = Math.min(input.maxGapPrice, input.capGap ?? input.maxGapPrice);
      let gap = Math.min(warGapRoom, gapCeiling);
      gap = Math.max(gap, minGapPrice);
      if (gap <= warGapRoom) state.gap = gap;
    }
  }

  return state;
}

export interface SettleConstraintsInput {
  state: ProductState;
  sellingPrice: number;
  pacCost: number;
  downPayment: number;
  netTrade: number;
  creditorFee: number;
  taxRate: number;
  rateDecimal: number;
  termMonths: number;
  maxPmt: number;
  paymentPV: number;
  maxAllInPreTax: number;
  initialReqDP: number;
  maxIterations?: number;
}

export interface SettleConstraintsResult {
  state: ProductState;
  reqDP: number;
  feasible: boolean;
}

/**
 * Iteratively trims allocated products and adds required down payment until
 * both the all-in LTV and the payment cap are satisfied.
 *
 * Order: GAP -> warranty -> admin (reverse of allocation priority). Whatever
 * the products can't absorb is converted into extra required down payment.
 *
 * Mutates `input.state` and returns the updated `reqDP`. `feasible` is false
 * only when the deal degenerates into a non-positive subtotal (impossible to
 * settle with any DP).
 */
export function settleConstraints(input: SettleConstraintsInput): SettleConstraintsResult {
  const { state } = input;
  let reqDP = input.initialReqDP;
  const maxPasses = input.maxIterations ?? 40;

  for (let pass = 0; pass < maxPasses; pass++) {
    const exposure = input.sellingPrice - (input.downPayment + reqDP) - input.netTrade;
    const allInSubtotal = exposure + state.admin + state.warranty + state.gap + input.creditorFee;
    if (allInSubtotal <= 0) {
      return { state, reqDP, feasible: false };
    }
    const totalFinanced = allInSubtotal * (1 + input.taxRate);
    const monthlyPayment = pmt(input.rateDecimal, input.termMonths, totalFinanced);

    let changed = false;
    if (Number.isFinite(input.maxAllInPreTax) && allInSubtotal > input.maxAllInPreTax) {
      const leftover = trimProductsInOrder(state, allInSubtotal - input.maxAllInPreTax);
      if (leftover > 0) reqDP += leftover;
      changed = true;
    }

    if (Number.isFinite(input.maxPmt) && monthlyPayment > input.maxPmt) {
      const allowedSubtotal = input.paymentPV / (1 + input.taxRate);
      const adjustedExposure = input.sellingPrice - (input.downPayment + reqDP) - input.netTrade;
      const currentSubtotal = adjustedExposure + state.admin + state.warranty + state.gap + input.creditorFee;
      const leftover = trimProductsInOrder(state, currentSubtotal - allowedSubtotal);
      if (leftover > 0) reqDP += leftover;
      changed = true;
    }

    if (!changed) break;
  }

  return { state, reqDP, feasible: true };
}
