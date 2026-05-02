# Inventory Platform — Complete source (part 4 of 10)

Generated: 2026-05-02T06:08:07 UTC

Machine-generated split of `downloads/inventory-platform-complete-source.md`. Each file in the bundle starts with a `### \`path\`` heading followed by a fenced code block — this split only cuts **between** those blocks so fences stay intact.

- **Single-file bundle:** run `pnpm --filter @workspace/scripts export:complete-md`
- **Parts:** `inventory-platform-complete-source-part-NN-of-10.md` (this is part 4)
- **Replication:** Part 1 begins with the original preamble (quickstart + included roots + TOC). Other parts continue body content only.

---

### `artifacts/api-server/src/lib/lenderCalcEngine.ts` (1021 lines)

```typescript
/**
 * Lender Calculator Engine
 *
 * Pure calculation and profile-resolution logic for the lender deal calculator.
 * No Express, no I/O, no side-effects — all math lives here.
 *
 * Exports:
 *   CapProfile / CapProfileInput / CapProfileKey — LTV cap structure types
 *   NoOnlineSellContext / NoOnlineSellResolution — no-online-price strategy types
 *   resolveCapProfile(input)       — maps maxAdvanceLTV/maxAftermarketLTV/maxAllInLTV
 *                                    into a typed 3-bit CapProfile key
 *   resolveNoOnlineSellingPrice(ctx)— maximizes selling price when no online listing
 *   NO_ONLINE_STRATEGY_BY_PROFILE  — lookup table of strategies by profile key
 *   parseWorksheetRules(raw)       — normalizes CreditApp worksheet rules → WorksheetRule[]
 *
 * Consumers: routes/lender/lender-calculate.ts (calculator), scripts/lender-engine.golden.test.ts
 *
 * Sections:
 *   1. Type definitions (CapProfile, NoOnlineSell*, WorksheetRule types re-exported)
 *   2. resolveCapProfile — 3-bit key assignment
 *   3. resolveNoOnlineSellingPrice — price maximization strategies
 *   4. NO_ONLINE_STRATEGY_BY_PROFILE lookup table
 *   5. parseWorksheetRules — CreditApp worksheet normalization
 *
 * WARNING: Do NOT put calculation logic in route files. Everything goes here.
 * WARNING: This file is NOT eligible for automated code repair (see AGENTS.md Tier A allow-list).
 */

import type {
  VehicleTermMatrixEntry,
  VehicleConditionMatrixEntry,
  WorksheetRule,
  RuleEffect,
} from "./bbObjectStore.js";

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
  /**
   * Minimum down payment required to reach the chosen selling price.
   *
   * When an online price exists, the target is the online price (priority);
   * otherwise the target is PAC. Equals zero when the zero-DP ceiling already
   * reaches the target.
   */
  requiredDownPayment: number;
}

/**
 * Selects the front-first selling price:
 * - With an online price: target the online price (floored at PAC). If the
 *   zero-DP ceiling cannot reach the online price, report the DP needed to
 *   reach it.
 * - Without an online price: maximize selling price up to the zero-DP ceiling
 *   and floor at PAC. If the ceiling is below PAC, report the DP needed to
 *   reach PAC.
 *
 * The DP target priority is: online price first, then PAC. The caller passes
 * `requiredDownPayment` into `settleConstraints` as `initialReqDP`.
 */
export function resolveSellingPrice(input: SellingPriceInput): SellingPriceResolution {
  const ceilingFinite = Number.isFinite(input.zeroDpCeiling) ? input.zeroDpCeiling : input.pacCost;

  let sellingPrice: number;
  let sellingPriceCappedByOnline = false;
  let bindingSellingConstraint: SellingPriceResolution["bindingSellingConstraint"];
  let requiredDownPayment: number;

  if (input.onlinePrice != null) {
    const target = Math.max(input.pacCost, input.onlinePrice);
    sellingPrice = target;
    requiredDownPayment = ceilingFinite < target ? Math.ceil(target - ceilingFinite) : 0;

    if (input.onlinePrice <= ceilingFinite) {
      bindingSellingConstraint = "online";
      sellingPriceCappedByOnline = true;
    } else {
      bindingSellingConstraint = input.bindingZeroDpReason;
    }
  } else {
    sellingPrice = Math.max(input.pacCost, ceilingFinite);
    requiredDownPayment = ceilingFinite < input.pacCost ? Math.ceil(input.pacCost - ceilingFinite) : 0;

    if (ceilingFinite < input.pacCost) {
      bindingSellingConstraint = "pacFloor";
    } else {
      bindingSellingConstraint = input.bindingZeroDpReason;
    }
  }

  return { sellingPrice, sellingPriceCappedByOnline, bindingSellingConstraint, requiredDownPayment };
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

// ---------------------------------------------------------------------------
// Worksheet rule parser
// ---------------------------------------------------------------------------

/**
 * Strips outer whitespace and a leading/trailing parenthesis pair when present.
 * CreditApp rule queries are often parenthesized to disambiguate precedence.
 */
function trimParens(s: string): string {
  let out = s.trim();
  while (out.startsWith("(") && out.endsWith(")")) {
    let depth = 0;
    let outerWraps = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")") depth--;
      if (depth === 0 && i < out.length - 1) { outerWraps = false; break; }
    }
    if (outerWraps) out = out.slice(1, -1).trim();
    else break;
  }
  return out;
}

/**
 * Splits a CreditApp rule query into AND-clauses, ignoring `&&` inside
 * parentheses, brackets, or strings.
 */
function splitAnd(query: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let buf = "";
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (c === '"') inStr = !inStr;
    if (!inStr) {
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      if (depth === 0 && c === "&" && query[i + 1] === "&") {
        out.push(buf.trim());
        buf = "";
        i++;
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Splits a rule query into OR-clauses, ignoring `||` inside nested groups or
 * strings. Preserves operator-context for parsers that match composite
 * expressions like vehicle-type bans across multiple alternatives.
 */
function splitOr(query: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let buf = "";
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (c === '"') inStr = !inStr;
    if (!inStr) {
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      if (depth === 0 && c === "|" && query[i + 1] === "|") {
        out.push(buf.trim());
        buf = "";
        i++;
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Strips `(${expr} ?? fallback)` wrappers down to the bare ${expr} placeholder. */
function stripCoalesce(s: string): string {
  // Match (${expr} ?? "###") or (${expr} ?? 0) wrapping the LHS of a comparison
  return s.replace(/\(\s*(\$\{[^}]+\})\s*\?\?\s*[^)]+\)/g, "$1");
}

/**
 * Best-effort parser for a CreditApp `WorksheetRule.query` string.
 * Recognizes a small set of eligibility-relevant patterns and emits typed
 * `RuleEffect`s. Anything else returns `{ kind: "ignored" }` with a reason.
 *
 * Operational rules (firstPaymentDate, deliveryDate, frequency, term-multiple,
 * AH routing, fee-vs-calculatedValue caps, lien-holder requirement) are
 * intentionally ignored — they don't affect inventory eligibility and the
 * calculator already enforces fee caps via the program's max*Calculation
 * fields.
 *
 * The output shape is consumed by `applyEligibilityRules` and the calculator
 * route. Tier-conditional rules carry a `tierName` so the calculator can apply
 * them only when running under the matching tier.
 */
export function parseWorksheetRule(rule: WorksheetRule): RuleEffect {
  const q = rule.query;
  const meta = { ruleId: rule.id, ruleName: rule.name };

  // -- Skip operational rules outright (cheap pre-filter) --
  if (
    /firstPaymentDate|deliveryDate|date_part|date_until/.test(q) ||
    /\bworksheet\.frequency\b/.test(q) ||
    /\bworksheet\.interestRate\b/.test(q) ||
    /\bworksheet\.tradeIn\b/.test(q) ||
    /otherTaxableDescription|otherNonTaxableDescription/.test(q) ||
    /\bworksheet\.installationDeliveryFee\b/.test(q) ||
    /\bworksheet\.lifeInsurance\b/.test(q) ||
    /\bworksheet\.ahInsuranceFee\b/.test(q) ||
    /\bworksheet\.creditorFee\b/.test(q) ||
    /\bworksheet\.gpsFee\b/.test(q) ||
    /\bworksheet\.LicenseFee\b|\bworksheet\.licenseFee\b/.test(q) ||
    /\bworksheet\.pstNotApplicableOnGapInsurance\b/.test(q) ||
    /\bworksheet\.otherNonTaxable\b|\bworksheet\.otherTaxable\b/.test(q)
  ) {
    return { ...meta, kind: "ignored", reason: "operational" };
  }

  // -- term-multiple-of-6 / non-eligibility term rules --
  if (/\bworksheet\.term\b\s+notin\b/.test(q)) {
    return { ...meta, kind: "ignored", reason: "term_format_check" };
  }

  // -- max*Calculation fee caps (already handled by program.max*Fee fields) --
  if (/\bcalculatedValues\.\w+/.test(q)) {
    return { ...meta, kind: "ignored", reason: "fee_cap_already_handled" };
  }

  const ands = splitAnd(q).map(trimParens).map(stripCoalesce);

  // -- Odometer max: ${worksheet.vehicle.odometer.amount} > N --
  for (const clause of ands) {
    const m = clause.match(/\$\{worksheet\.vehicle\.odometer\.amount\}\s*>\s*(\d+)\s*$/);
    if (m) return { ...meta, kind: "odometerMax", max: parseInt(m[1], 10) };
  }

  // -- Odometer min (e.g. Santander odometer == 0 → min of 1) --
  if (/\$\{worksheet\.vehicle\.odometer\.amount\}.*==\s*0/.test(q)) {
    return { ...meta, kind: "odometerMin", min: 1 };
  }

  // -- Vehicle min year: ${worksheet.vehicle.year} < N (often quoted) --
  for (const clause of ands) {
    const m = clause.match(/\$\{worksheet\.vehicle\.year\}\s*<\s*"?(\d{4})"?\s*$/);
    if (m) return { ...meta, kind: "vehicleMinYear", minYear: parseInt(m[1], 10) };
  }

  // -- Carfax claim absolute cap: ${worksheet.vehicle.carfaxClaims.amount} > N
  // Pure absolute cap (no BBV ratio in any AND-clause).
  if (
    /\$\{worksheet\.vehicle\.carfaxClaims\.amount\}\s*>\s*\d+\s*$/.test(q) &&
    !/wholesaleValueBasedOnProgram/.test(q)
  ) {
    const m = q.match(/\$\{worksheet\.vehicle\.carfaxClaims\.amount\}\s*>\s*(\d+)/);
    if (m) return { ...meta, kind: "carfaxClaimMax", max: parseInt(m[1], 10) };
  }

  // -- Carfax claim ratio: ${...carfaxClaims.amount} > (${...wholesaleValue...} * RATIO) [&& bbv > FLOOR]
  if (/wholesaleValueBasedOnProgram/.test(q) && /carfaxClaims\.amount/.test(q)) {
    // 100% rule: claims > BBV (no ratio constant)
    if (/\$\{worksheet\.vehicle\.carfaxClaims\.amount\}\s*>\s*\$\{worksheet\.vehicle\.wholesaleValueBasedOnProgram\.amount\}\s*$/.test(q)) {
      return { ...meta, kind: "carfaxClaimRatioMax", ratio: 1.0 };
    }
    const ratioMatch = q.match(/\$\{worksheet\.vehicle\.wholesaleValueBasedOnProgram\.amount\}\s*\*\s*(0?\.\d+|\d+\.\d+)/);
    if (ratioMatch) {
      const ratio = parseFloat(ratioMatch[1]);
      let bbvFloor: number | undefined;
      let bbvCeiling: number | undefined;
      const floorMatch = q.match(/\$\{worksheet\.vehicle\.wholesaleValueBasedOnProgram\.amount\}\s*>\s*(\d+)/);
      if (floorMatch) bbvFloor = parseInt(floorMatch[1], 10);
      const ceilMatch = q.match(/\$\{worksheet\.vehicle\.wholesaleValueBasedOnProgram\.amount\}\s*<\s*(\d+)/);
      if (ceilMatch) bbvCeiling = parseInt(ceilMatch[1], 10);
      return { ...meta, kind: "carfaxClaimRatioMax", ratio, bbvFloor, bbvCeiling };
    }
  }

  // -- Total finance max: ${worksheet.totalFinancedAmount.amount} > N [&& program.tierName == "X"]
  if (/\$\{worksheet\.totalFinancedAmount\.amount\}\s*>\s*\d+/.test(q)) {
    const m = q.match(/\$\{worksheet\.totalFinancedAmount\.amount\}\s*>\s*(\d+)/);
    if (m) {
      const max = parseInt(m[1], 10);
      const tierMatch = q.match(/\$\{program\.tierName\}\s*==\s*"([^"]+)"/);
      // Also catch lookup-table form (Rifco): >  {"Tier 1": 55000,...} lookup ${program.tierName}
      // Skip those — handled case-by-case in apply step
      if (q.includes("lookup")) {
        return { ...meta, kind: "ignored", reason: "tier_lookup_table_unsupported" };
      }
      return { ...meta, kind: "totalFinanceMax", max, tierName: tierMatch ? tierMatch[1] : undefined };
    }
  }

  // -- Total finance min --
  if (/\$\{worksheet\.totalFinancedAmount\.amount\}\s*<\s*\d+/.test(q)) {
    const m = q.match(/\$\{worksheet\.totalFinancedAmount\.amount\}\s*<\s*(\d+)/);
    if (m) return { ...meta, kind: "totalFinanceMin", min: parseInt(m[1], 10) };
  }

  // -- Term hard max: ${worksheet.term} > N (only when N is the sole RHS, not lookup tables/program.maxTerm)
  const termMatch = q.match(/^\s*\$\{worksheet\.term\}\s*>\s*(\d+)\s*$/);
  if (termMatch) {
    return { ...meta, kind: "termMax", max: parseInt(termMatch[1], 10) };
  }

  // -- Vehicle type ban (multiple shapes; AND-within-disjunct preserved):
  //    Eden Park: `${trim} match /a/ || ${model} match /b/ || (${make} match /Ford/ && ${model} match /Transit/)`
  //    Rifco DRW: `(...year && make && model && trim in [...]) || ${trim} match /DRW/`
  //    Rifco cargo (no `match`): `${model} in ["EXPRESS", ...]`
  //
  // We split top-level OR-clauses, then for each clause extract every
  // `match /.../` regex body. Single-field matches become a 1-element disjunct;
  // composite AND clauses keep all their patterns so the eligibility check
  // requires all of them to fire.
  if (
    (/vehicle\.(model|trim|make)/.test(q)) &&
    (/\bmatch\s+\//.test(q) || /\bin\s+\[/.test(q))
  ) {
    // Model-in-list (Rifco cargo vans) — handled separately when no match regexes are present.
    const modelInList: string[] = [];
    const inMatch = q.match(/\$\{worksheet\.vehicle\.model\}\s+in\s+\[([^\]]+)\]/);
    if (inMatch) {
      const items = inMatch[1].match(/"([^"]+)"/g);
      if (items) for (const it of items) modelInList.push(it.replace(/"/g, ""));
    }
    const orClauses = splitOr(q).map(trimParens);
    const disjuncts: string[][] = [];
    for (const clause of orClauses) {
      const patterns: string[] = [];
      const matchRe = /match\s+\/([^/]+)\//g;
      let m: RegExpExecArray | null;
      while ((m = matchRe.exec(clause)) !== null) {
        patterns.push(m[1]);
      }
      if (patterns.length > 0) disjuncts.push(patterns);
    }
    if (modelInList.length > 0 && disjuncts.length === 0) {
      return { ...meta, kind: "vehicleModelInList", models: modelInList };
    }
    if (disjuncts.length > 0) {
      return {
        ...meta,
        kind: "vehicleTypeBan",
        disjuncts,
        description: rule.description ?? rule.name,
      };
    }
  }

  return { ...meta, kind: "ignored", reason: "unrecognized" };
}

/**
 * Convenience wrapper: parses an array of raw rules into effects.
 * Used at sync time (lenderWorker) and at calc time as a fallback.
 */
export function parseWorksheetRules(rules: WorksheetRule[]): RuleEffect[] {
  return rules.map(parseWorksheetRule);
}

export interface EligibilityVehicle {
  vehicle: string;
  km:      number;
  vehicleYear: number;
  bbWholesale: number;
  carfaxClaimAmount?: number;
  totalFinancedEstimate?: number;
}

export interface EligibilityResult {
  ok: boolean;
  rejections: { ruleId: string; ruleName: string; reason: string }[];
}

/**
 * Applies parsed rule effects against a vehicle. Returns `ok: false` and the
 * rejection reasons when any hard-eligibility predicate fails. Rules tied to a
 * specific tier name only fire when `tierName` matches.
 *
 * The carfaxClaim* checks short-circuit when no claim amount is supplied
 * (we don't pessimistically reject vehicles with unknown carfax history).
 */
export function applyEligibilityRules(
  effects: RuleEffect[],
  vehicle: EligibilityVehicle,
  ctx: { tierName: string },
): EligibilityResult {
  const rejections: { ruleId: string; ruleName: string; reason: string }[] = [];
  const make  = vehicle.vehicle;
  const lower = make.toLowerCase();

  for (const eff of effects) {
    switch (eff.kind) {
      case "odometerMax":
        if (vehicle.km > eff.max) {
          rejections.push({ ruleId: eff.ruleId, ruleName: eff.ruleName, reason: `km ${vehicle.km} > ${eff.max}` });
        }
        break;
      case "odometerMin":
        if (vehicle.km < eff.min) {
          rejections.push({ ruleId: eff.ruleId, ruleName: eff.ruleName, reason: `km ${vehicle.km} < ${eff.min}` });
        }
        break;
      case "vehicleMinYear":
        if (vehicle.vehicleYear < eff.minYear) {
          rejections.push({ ruleId: eff.ruleId, ruleName: eff.ruleName, reason: `year ${vehicle.vehicleYear} < ${eff.minYear}` });
        }
        break;
      case "vehicleTypeBan": {
        // Reject when any disjunct's patterns ALL match the vehicle string.
        for (const conjunction of eff.disjuncts) {
          let allMatch = true;
          for (const pat of conjunction) {
            try {
              const re = new RegExp(pat, "i");
              if (!re.test(lower)) { allMatch = false; break; }
            } catch {
              allMatch = false; break;
            }
          }
          if (allMatch) {
            rejections.push({ ruleId: eff.ruleId, ruleName: eff.ruleName, reason: eff.description });
            break;
          }
        }
        break;
      }
      case "vehicleModelInList": {
        const upper = make.toUpperCase();
        if (eff.models.some((m) => upper.includes(m.toUpperCase()))) {
          rejections.push({ ruleId: eff.ruleId, ruleName: eff.ruleName, reason: `model in banned list` });
        }
        break;
      }
      case "carfaxClaimMax":
        if (vehicle.carfaxClaimAmount != null && vehicle.carfaxClaimAmount > eff.max) {
          rejections.push({ ruleId: eff.ruleId, ruleName: eff.ruleName, reason: `carfax claim ${vehicle.carfaxClaimAmount} > ${eff.max}` });
        }
        break;
      case "carfaxClaimRatioMax":
        if (vehicle.carfaxClaimAmount != null && vehicle.bbWholesale > 0) {
          const floorOk   = eff.bbvFloor   == null || vehicle.bbWholesale > eff.bbvFloor;
          const ceilingOk = eff.bbvCeiling == null || vehicle.bbWholesale < eff.bbvCeiling;
          if (floorOk && ceilingOk && vehicle.carfaxClaimAmount > vehicle.bbWholesale * eff.ratio) {
            rejections.push({
              ruleId: eff.ruleId,
              ruleName: eff.ruleName,
              reason: `carfax ${vehicle.carfaxClaimAmount} > ${(eff.ratio * 100).toFixed(0)}% of BBV ${vehicle.bbWholesale}`,
            });
          }
        }
        break;
      case "totalFinanceMax":
        if (eff.tierName != null && eff.tierName !== ctx.tierName) break;
        if (vehicle.totalFinancedEstimate != null && vehicle.totalFinancedEstimate > eff.max) {
          rejections.push({
            ruleId: eff.ruleId,
            ruleName: eff.ruleName,
            reason: `est. financed ${Math.round(vehicle.totalFinancedEstimate)} > ${eff.max}`,
          });
        }
        break;
      // totalFinanceMin / termMax / ignored: not actionable at eligibility-filter stage
      default:
        break;
    }
  }

  return { ok: rejections.length === 0, rejections };
}

/**
 * Returns the tightest absolute term cap, in months, from `termMax` rule
 * effects — or `null` when no term cap applies. Used to clamp matrix-derived
 * terms before allocation.
 */
export function deriveTermCap(effects: RuleEffect[]): number | null {
  let cap: number | null = null;
  for (const eff of effects) {
    if (eff.kind === "termMax") {
      cap = cap == null ? eff.max : Math.min(cap, eff.max);
    }
  }
  return cap;
}

/**
 * Returns the tightest total-finance cap applicable to the given tier (or
 * `null`). Effects without a tierName apply to all tiers.
 */
export function deriveTotalFinanceCap(effects: RuleEffect[], tierName: string): number | null {
  let cap: number | null = null;
  for (const eff of effects) {
    if (eff.kind !== "totalFinanceMax") continue;
    if (eff.tierName != null && eff.tierName !== tierName) continue;
    cap = cap == null ? eff.max : Math.min(cap, eff.max);
  }
  return cap;
}

```

### `artifacts/api-server/src/lib/lenderWorker.ts` (607 lines)

```typescript
/**
 * Lender Worker
 *
 * Syncs lender program matrices from the CreditApp GraphQL API. Runs daily
 * at a random time during business hours (Mountain Time). Programs are
 * normalized into a uniform LenderProgram[] structure and stored in GCS.
 *
 * Exports:
 *   getLenderSyncStatus()        — last sync timestamp + error state
 *   getCachedLenderPrograms()    — in-memory program array (never null after first load)
 *   loadLenderProgramsFromCache()— loads from GCS into memory on startup
 *   runLenderSync()              — full sync from CreditApp GraphQL
 *   scheduleLenderSync()         — starts the daily randomized schedule
 *
 * Consumers: routes/lender/ (reads cached programs), index.ts (scheduling)
 *
 * Required env: LENDER_CREDITAPP_EMAIL, LENDER_CREDITAPP_PASSWORD
 * Optional env: LENDER_CREDITAPP_TOTP_SECRET
 *
 * Sections:
 *   1. Constants + creditor name maps
 *   2. In-memory cache + sync state
 *   3. GraphQL queries
 *   4. Normalization helpers (matrix parsing, tier mapping)
 *   5. Public API (get/load/run/schedule)
 */

import { logger } from "./logger.js";
import {
  loadLenderProgramsFromStore,
  saveLenderProgramsToStore,
  type LenderProgram,
  type LenderProgramGuide,
  type LenderProgramTier,
  type LenderProgramsBlob,
  type VehicleTermMatrixEntry,
  type VehicleConditionMatrixEntry,
  type WorksheetRule,
} from "./bbObjectStore.js";
import { parseWorksheetRules } from "./lenderCalcEngine.js";
import { getLenderAuthCookies, callGraphQL, LENDER_ENABLED } from "./lenderAuth.js";
import { scheduleRandomDaily, toMountainDateStr } from "./randomScheduler.js";
import { withRetry } from "./selfHeal/withRetry.js";
import { PlatformError } from "./platformError.js";
import { recordFailure, recordIncident, updateLenderSessionState } from "./incidentService.js";
import { withCircuitBreaker } from "./selfHeal/circuitBreaker.js";

const CREDITOR_NAME_TO_CODE: Record<string, { code: string; name: string }> = {
  SANTANDER:  { code: "SAN", name: "Santander" },
  EDEN_PARK:  { code: "EPI", name: "Eden Park" },
  ACC:        { code: "ACC", name: "ACC" },
  IAF:        { code: "iAF", name: "iA Auto Finance" },
  QUANTIFI:   { code: "QLI", name: "Quantifi" },
  RIFCO:      { code: "RFC", name: "Rifco" },
};

const IN_HOUSE_PROGRAM_MAP: Record<string, { code: string; name: string }> = {
  "Cavalcade":              { code: "CAV", name: "Cavalcade" },
  "Cavalcade Tier Program": { code: "CAV", name: "Cavalcade" },
  "Powersports":            { code: "THF", name: "The House Finance Corp" },
  "Auto Program":           { code: "THF", name: "The House Finance Corp" },
};

interface LenderStatus {
  running:   boolean;
  startedAt: string | null;
  lastRun:   string | null;
  lastCount: number;
  error?:    string;
}

const status: LenderStatus = { running: false, startedAt: null, lastRun: null, lastCount: 0 };

export function getLenderSyncStatus(): LenderStatus {
  return { ...status };
}

let cachedPrograms: LenderProgramsBlob | null = null;

export function getCachedLenderPrograms(): LenderProgramsBlob | null {
  return cachedPrograms;
}

export async function loadLenderProgramsFromCache(): Promise<LenderProgramsBlob | null> {
  if (cachedPrograms) return cachedPrograms;
  try {
    const blob = await loadLenderProgramsFromStore();
    if (blob) {
      cachedPrograms = blob;
      logger.info({ count: blob.programs.length, updatedAt: blob.updatedAt }, "Lender programs loaded from object storage");
    }
    return blob;
  } catch (err: any) {
    logger.warn({ err: err.message }, "Could not load lender programs from object storage");
    return null;
  }
}

const CREDITORS_PROGRAMS_QUERY = `{
  creditors {
    id
    name
    status
    worksheetRules {
      id
      name
      query
      fieldName
      description
      type
    }
    programs {
      id
      type
      title
      tiers {
        id
        name
        maxPayment { amount currency }
        interestRate { from to }
        maxAdvanceLTV
        maxAftermarketLTV
        maxAllInLTV
        creditorFee { amount currency }
        dealerReserve { amount currency }
      }
      vehicleTermMatrix {
        year
        data {
          term
          milage { from to }
        }
      }
      vehicleConditionMatrix {
        year
        extraClean { milage { from to } }
        clean { milage { from to } }
        average { milage { from to } }
        rough { milage { from to } }
      }
      backendLtvCalculation
      allInLtvCalculation
      maxExtendedWarrantyFeeCalculation
      maxGapInsuranceFeeCalculation
      maxAhInsuranceFeeCalculation
      maxDealerAdminFeeCalculation
      backendRemainingCalculation
      allInRemainingCalculation
    }
  }
}`;

function mapCreditorToLenderPrograms(creditor: any): LenderProgram[] {
  const creditorName: string = creditor.name ?? "";
  const creditorId: string = creditor.id;

  // Worksheet rules are creditor-level — copy them onto every LenderProgram
  // we emit for this creditor (including each split when IN_HOUSE expands into
  // multiple programs). Parsing happens once here so the calculator path is
  // free of regex work.
  const worksheetRules: WorksheetRule[] = Array.isArray(creditor.worksheetRules)
    ? creditor.worksheetRules.map((r: any) => ({
        id:          String(r.id),
        name:        String(r.name ?? ""),
        query:       String(r.query ?? ""),
        fieldName:   r.fieldName ?? null,
        description: r.description ?? null,
        type:        String(r.type ?? "WARNING"),
      }))
    : [];
  const ruleEffects = parseWorksheetRules(worksheetRules);

  if (worksheetRules.length > 0) {
    const summary: Record<string, number> = {};
    for (const eff of ruleEffects) summary[eff.kind] = (summary[eff.kind] ?? 0) + 1;
    logger.info({ creditorName, ruleCount: worksheetRules.length, byKind: summary }, "Lender sync: parsed worksheet rules");
  }

  if (creditorName === "IN_HOUSE") {
    const grouped = new Map<string, { code: string; name: string; guides: LenderProgramGuide[] }>();

    for (const prog of creditor.programs ?? []) {
      const match = IN_HOUSE_PROGRAM_MAP[prog.title];
      if (!match) continue;
      if (!grouped.has(match.code)) {
        grouped.set(match.code, { code: match.code, name: match.name, guides: [] });
      }
      grouped.get(match.code)!.guides.push(mapProgramGuide(prog));
    }

    return [...grouped.values()].map(g => ({
      lenderCode: g.code,
      lenderName: g.name,
      creditorId,
      programs: g.guides,
      worksheetRules,
      ruleEffects,
    }));
  }

  const mapping = CREDITOR_NAME_TO_CODE[creditorName];
  if (!mapping) {
    logger.info({ creditorName, creditorId }, "Lender sync: unknown creditor — skipping");
    void recordIncident({
      subsystem: "lender",
      reason: "SCHEMA_DRIFT",
      recoverability: "needsCodeRepair",
      message: `Unknown creditor encountered: ${creditorName}`,
      payload: { creditorId, creditorName },
    });
    return [];
  }

  const guides: LenderProgramGuide[] = (creditor.programs ?? []).map(mapProgramGuide);
  if (mapping.code === "SAN") {
    for (const g of guides) {
      // Santander uses all-in constraint in practice; do not force synthetic split aftermarket caps.
      g.capModelResolved = "allInOnly";
    }
  }

  return [{
    lenderCode: mapping.code,
    lenderName: mapping.name,
    creditorId,
    programs: guides,
    worksheetRules,
    ruleEffects,
  }];
}

function mapMilageRange(m: any): { kmFrom: number; kmTo: number } {
  return { kmFrom: m?.milage?.from ?? 0, kmTo: m?.milage?.to ?? 0 };
}

function mapProgramGuide(prog: any): LenderProgramGuide {
  const tiers: LenderProgramTier[] = (prog.tiers ?? []).map((t: any) => ({
    tierName:          t.name ?? "Unknown",
    minRate:           t.interestRate?.from ?? 0,
    maxRate:           t.interestRate?.to ?? 0,
    maxPayment:        t.maxPayment?.amount ?? 0,
    maxAdvanceLTV:     t.maxAdvanceLTV ?? 0,
    maxAftermarketLTV: t.maxAftermarketLTV ?? 0,
    maxAllInLTV:       t.maxAllInLTV ?? 0,
    creditorFee:       t.creditorFee?.amount ?? 0,
    dealerReserve:     t.dealerReserve?.amount ?? 0,
  }));

  const vehicleTermMatrix: VehicleTermMatrixEntry[] = (prog.vehicleTermMatrix ?? []).map((entry: any) => ({
    year: entry.year,
    data: (entry.data ?? []).map((d: any) => ({
      term:   d.term,
      kmFrom: d.milage?.from ?? 0,
      kmTo:   d.milage?.to ?? 0,
    })),
  }));

  const vehicleConditionMatrix: VehicleConditionMatrixEntry[] = (prog.vehicleConditionMatrix ?? []).map((entry: any) => ({
    year:       entry.year,
    extraClean: mapMilageRange(entry.extraClean),
    clean:      mapMilageRange(entry.clean),
    average:    mapMilageRange(entry.average),
    rough:      mapMilageRange(entry.rough),
  }));

  const maxTerm = vehicleTermMatrix.length > 0
    ? Math.max(...vehicleTermMatrix.flatMap(e => e.data.map(d => d.term)))
    : undefined;

  function parseCalcNumber(val: unknown): number | undefined {
    if (val == null) return undefined;
    const s = String(val).trim();
    if (s === "") return undefined;
    const n = Number(s);
    return isFinite(n) ? n : undefined;
  }

  function parseCalcString(val: unknown): string | undefined {
    if (typeof val !== "string") return undefined;
    const s = val.trim();
    return s.length > 0 ? s : undefined;
  }

  function inferAftermarketBase(backendRemaining?: string): "bbWholesale" | "salePrice" | "unknown" {
    if (!backendRemaining) return "unknown";
    const hasWholesale = backendRemaining.includes("wholesaleValueBasedOnProgram");
    const hasSalePrice = backendRemaining.includes("salePrice");
    if (hasWholesale && !hasSalePrice) return "bbWholesale";
    if (hasSalePrice && !hasWholesale) return "salePrice";
    return "unknown";
  }

  function inferAdminFeeInclusion(
    backendLtv?: string, allInLtv?: string
  ): "backend" | "allIn" | "excluded" | "unknown" {
    const inBackend = backendLtv?.includes("dealerAdminFee") ?? false;
    const inAllIn   = allInLtv?.includes("dealerAdminFee") ?? false;
    if (inBackend) return "backend";
    if (inAllIn)   return "allIn";
    if (backendLtv || allInLtv) return "excluded";
    return "unknown";
  }

  function inferCapModelResolved(
    backendRemaining?: string,
    allInRemaining?: string,
    backendLtv?: string,
    allInLtv?: string,
  ): "allInOnly" | "split" | "backendOnly" | "unknown" {
    const backendExpr = `${backendRemaining ?? ""} ${backendLtv ?? ""}`.toLowerCase();
    const allInExpr = `${allInRemaining ?? ""} ${allInLtv ?? ""}`.toLowerCase();
    const productRegex = /(extendedwarrantyfee|gapinsurancefee|ahinsurancefee|dealeradminfee)/i;

    const hasBackendRemaining = !!backendRemaining;
    const hasAllInRemaining = !!allInRemaining;
    const backendMentionsProducts = productRegex.test(backendExpr);
    const allInMentionsProducts = productRegex.test(allInExpr);

    if (!hasBackendRemaining && hasAllInRemaining) return "allInOnly";
    if (hasBackendRemaining && !hasAllInRemaining) return "backendOnly";
    if (hasBackendRemaining && hasAllInRemaining) {
      if (!backendMentionsProducts && allInMentionsProducts) return "allInOnly";
      return "split";
    }
    return "unknown";
  }

  const backendLtvCalculation = parseCalcString(prog.backendLtvCalculation);
  const allInLtvCalculation = parseCalcString(prog.allInLtvCalculation);
  const backendRemainingCalculation = parseCalcString(prog.backendRemainingCalculation);
  const allInRemainingCalculation = parseCalcString(prog.allInRemainingCalculation);
  const aftermarketBase = inferAftermarketBase(backendRemainingCalculation);
  const adminFeeInclusion = inferAdminFeeInclusion(backendLtvCalculation, allInLtvCalculation);
  const capModelResolved = inferCapModelResolved(
    backendRemainingCalculation,
    allInRemainingCalculation,
    backendLtvCalculation,
    allInLtvCalculation,
  );

  const parsedMaxWarranty = parseCalcNumber(prog.maxExtendedWarrantyFeeCalculation);
  const parsedMaxGap      = parseCalcNumber(prog.maxGapInsuranceFeeCalculation);
  const parsedMaxAh       = parseCalcNumber(prog.maxAhInsuranceFeeCalculation);
  const parsedMaxAdmin    = parseCalcNumber(prog.maxDealerAdminFeeCalculation);

  // autoWorksheetPreferences.gapInsuranceTarget is not available in the
  // creditors-level GraphQL query (field doesn't exist in the schema).
  // Keep the AH_INSURANCE routing logic below for future use if a
  // per-program query becomes available.
  const gapTarget: string | null = null;

  let resolvedMaxWarranty = parsedMaxWarranty != null && parsedMaxWarranty > 0
    ? parsedMaxWarranty
    : undefined;

  // GAP cap source tracked for debug visibility.
  let gapCapSource = "none";
  let resolvedMaxGap: number | undefined;
  if (gapTarget === "AH_INSURANCE") {
    if (parsedMaxAh != null && parsedMaxAh > 0) {
      resolvedMaxGap = parsedMaxAh;
      gapCapSource = "maxAhInsuranceFeeCalculation";
    } else if (parsedMaxGap != null && parsedMaxGap > 0) {
      resolvedMaxGap = parsedMaxGap;
      gapCapSource = "maxGapInsuranceFeeCalculation";
    } else if (resolvedMaxWarranty != null) {
      // CreditApp sometimes stores AH-routed GAP cap in the warranty calc field.
      resolvedMaxGap = resolvedMaxWarranty;
      resolvedMaxWarranty = undefined;
      gapCapSource = "warrantyFallbackForAhTarget";
    } else {
      resolvedMaxGap = undefined;
      gapCapSource = "none";
    }
  } else {
    resolvedMaxGap = parsedMaxGap != null && parsedMaxGap > 0 ? parsedMaxGap : undefined;
    gapCapSource = resolvedMaxGap != null ? "maxGapInsuranceFeeCalculation" : "none";
  }

  const feeCalculationsRaw = {
    maxExtendedWarrantyFeeCalculation: typeof prog.maxExtendedWarrantyFeeCalculation === "string"
      ? prog.maxExtendedWarrantyFeeCalculation
      : undefined,
    maxGapInsuranceFeeCalculation: typeof prog.maxGapInsuranceFeeCalculation === "string"
      ? prog.maxGapInsuranceFeeCalculation
      : undefined,
    maxDealerAdminFeeCalculation: typeof prog.maxDealerAdminFeeCalculation === "string"
      ? prog.maxDealerAdminFeeCalculation
      : undefined,
    maxAhInsuranceFeeCalculation: typeof prog.maxAhInsuranceFeeCalculation === "string"
      ? prog.maxAhInsuranceFeeCalculation
      : undefined,
    resolvedGapCapSource: gapCapSource,
  };

  logger.info({
    program: prog.title,
    rawWarrantyCalc: prog.maxExtendedWarrantyFeeCalculation ?? null,
    rawGapCalc:      prog.maxGapInsuranceFeeCalculation ?? null,
    rawAhCalc:       prog.maxAhInsuranceFeeCalculation ?? null,
    rawAdminCalc:    prog.maxDealerAdminFeeCalculation ?? null,
    gapInsuranceTarget: gapTarget,
    parsedMaxWarranty,
    parsedMaxGapFromField: parsedMaxGap,
    resolvedMaxGap,
    resolvedMaxWarranty,
    gapCapSource,
    parsedMaxAh,
    parsedMaxAdmin,
    adminFeeInclusion,
    aftermarketBase,
    capModelResolved,
  }, "Lender sync: program fee caps");

  return {
    programId:              prog.id,
    programTitle:           prog.title ?? "Unknown",
    programType:            prog.type ?? "FINANCE",
    tiers,
    vehicleTermMatrix,
    vehicleConditionMatrix,
    maxTerm,
    maxWarrantyPrice: resolvedMaxWarranty,
    maxGapPrice:      resolvedMaxGap,
    maxAdminFee:      parsedMaxAdmin != null && parsedMaxAdmin > 0 ? parsedMaxAdmin : undefined,
    gapInsuranceTarget: gapTarget,
    feeCalculationsRaw,
    capModelResolved,
    backendLtvCalculation,
    allInLtvCalculation,
    backendRemainingCalculation,
    allInRemainingCalculation,
    aftermarketBase,
    allInOnlyRules: !!allInRemainingCalculation && !backendRemainingCalculation,
    adminFeeInclusion,
  };
}

async function syncLenderPrograms(): Promise<void> {
  const { appSession, csrfToken } = await getLenderAuthCookies();
  logger.info("Lender sync: auth ready — fetching creditor programs");

  const data = await callGraphQL(appSession, csrfToken, "", CREDITORS_PROGRAMS_QUERY);
  const creditors = data?.creditors ?? [];

  if (creditors.length === 0) {
    throw new Error("Lender sync: creditors query returned empty");
  }

  logger.info({ creditorCount: creditors.length }, "Lender sync: fetched creditors from CreditApp");

  const programs: LenderProgram[] = [];
  for (const cred of creditors) {
    if (cred.status !== "ACTIVE") continue;
    const mapped = mapCreditorToLenderPrograms(cred);
    programs.push(...mapped);
  }

  if (programs.length === 0) {
    throw new Error("Lender sync: no active lender programs found");
  }

  const totalTiers = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.tiers.length, 0), 0);
  const totalTermMatrices = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.vehicleTermMatrix.length, 0), 0);
  const totalCondMatrices = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.vehicleConditionMatrix.length, 0), 0);

  const blob: LenderProgramsBlob = {
    programs,
    updatedAt: new Date().toISOString(),
  };

  await saveLenderProgramsToStore(blob);
  cachedPrograms = blob;

  logger.info(
    { lenderCount: programs.length, totalTiers, totalTermMatrices, totalCondMatrices },
    "Lender sync: programs saved to object storage",
  );
}

/**
 * Executes a full lender program sync from CreditApp.
 *
 * Flow:
 * 1. Authenticates to CreditApp via lenderAuth.ts (session cookies)
 * 2. Queries the creditors GraphQL endpoint for all active programs
 * 3. Maps each creditor to normalized LenderProgram[] (tiers, LTV caps, fee rules,
 *    vehicle term matrices, condition matrices)
 * 4. Saves the result blob to GCS via bbObjectStore and updates in-memory cache
 *
 * Trigger conditions:
 * - Manual: POST /api/refresh-lender (owner only)
 * - Scheduled: once daily at a random time during business hours (MT)
 *
 * Guards: skips if LENDER_ENABLED is false or if already running.
 * On success, records last-run date to DB for schedule dedup.
 */
export async function runLenderSync(): Promise<void> {
  if (!LENDER_ENABLED) {
    logger.info("Lender sync: LENDER_CREDITAPP_EMAIL or LENDER_CREDITAPP_PASSWORD not set — skipping");
    return;
  }
  if (status.running) {
    logger.warn("Lender sync: already running — skipping");
    return;
  }

  status.running   = true;
  status.startedAt = new Date().toISOString();
  status.error     = undefined;

  try {
    await withCircuitBreaker("lender-sync", async () =>
      withRetry(
        { retries: 2, baseDelayMs: 3_000, jitterMs: 500 },
        async () => syncLenderPrograms(),
      ), { threshold: 3, cooldownMs: 60_000 });
    status.lastRun   = new Date().toISOString();
    status.lastCount = cachedPrograms?.programs.length ?? 0;
    await recordRunDateToDb();
    await updateLenderSessionState({
      lastOutcome: "success",
      consecutiveFailures: 0,
    });
  } catch (err: any) {
    status.error = err.message;
    logger.error({ err: err.message }, "Lender sync: run failed");
    await recordFailure(new PlatformError({
      subsystem: "lender",
      reason: err.message?.includes("GraphQL") ? "NETWORK_TIMEOUT" : "UNKNOWN",
      recoverability: "transient",
      message: err.message,
      payload: { where: "runLenderSync" },
    }));
    await updateLenderSessionState({
      lastOutcome: "failed",
      lastErrorReason: err.message?.includes("GraphQL") ? "NETWORK_TIMEOUT" : "UNKNOWN",
      lastErrorMessage: err.message,
      consecutiveFailures: 1,
    });
    throw err;
  } finally {
    status.running   = false;
    status.startedAt = null;
  }
}

async function getLastRunDateFromDb(): Promise<string> {
  try {
    // Lazy: DB only needed for session/schedule bookkeeping
    const { db, lenderSessionTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select({ lastRunAt: lenderSessionTable.lastRunAt })
      .from(lenderSessionTable)
      .where(eq(lenderSessionTable.id, "singleton"));
    if (rows.length > 0 && rows[0].lastRunAt) {
      return toMountainDateStr(rows[0].lastRunAt);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Lender sync: could not read last run date from DB");
  }
  return "";
}

async function recordRunDateToDb(): Promise<void> {
  try {
    // Lazy: DB only needed for session/schedule bookkeeping
    const { db, lenderSessionTable } = await import("@workspace/db");
    await db
      .insert(lenderSessionTable)
      .values({ id: "singleton", cookies: "[]", lastRunAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: lenderSessionTable.id,
        set: { lastRunAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err: String(err) }, "Lender sync: could not record run date to DB");
  }
}

/**
 * Initializes the lender sync lifecycle:
 * 1. Preloads cached programs from GCS (so calculator works before first sync)
 * 2. Registers a randomized daily schedule via randomScheduler
 *
 * Called once from index.ts at server startup.
 */
export function scheduleLenderSync(): void {
  loadLenderProgramsFromCache().catch(err =>
    logger.warn({ err: String(err) }, "Lender sync: could not preload programs from object storage"),
  );

  scheduleRandomDaily({
    name: "Lender sync",
    hasRunToday: async () => {
      const today = toMountainDateStr();
      const lastRan = await getLastRunDateFromDb();
      return lastRan === today;
    },
    execute: (reason: string) => {
      runLenderSync().catch(err => logger.error({ err }, "Lender sync: scheduled run error"));
    },
  });

  logger.info("Lender sync scheduled — randomized daily within business hours (Mountain Time)");
}

```

### `artifacts/api-server/src/lib/runtimeFingerprint.ts` (34 lines)

```typescript
import { execSync } from "node:child_process";
import { env } from "./env.js";

const CALCULATOR_VERSION = "calculator-cap-profile-v2";

function readGitSha(): string {
  const sha = env.GIT_SHA || env.REPL_GIT_COMMIT || env.VERCEL_GIT_COMMIT_SHA;
  if (sha && sha !== "unknown") {
    return sha;
  }

  // Replit / local dev often omit env SHAs; resolve from .git so responses prove which code is running
  try {
    const sha = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2500,
      cwd: process.cwd(),
    }).trim();
    if (sha.length >= 7) return sha;
  } catch {
    /* git not available */
  }

  return "unknown";
}

export function getRuntimeFingerprint() {
  return {
    calculatorVersion: CALCULATOR_VERSION,
    gitSha: readGitSha(),
  };
}

```

### `artifacts/api-server/src/routes/lender/index.ts` (19 lines)

```typescript
/**
 * Lender router barrel — mounts lender sub-routers.
 * All lender routes require owner access; enforcement is applied
 * per-route inside each sub-router via requireOwner middleware.
 *   lender-read.ts      — GET /lender-programs, GET /lender-status
 *   lender-calculate.ts — POST /lender-calculate
 *   lender-admin.ts     — POST /refresh-lender, GET /lender-debug
 */
import { Router } from "express";
import readRouter from "./lender-read.js";
import calculateRouter from "./lender-calculate.js";
import adminRouter from "./lender-admin.js";

const router = Router();
router.use(readRouter);
router.use(calculateRouter);
router.use(adminRouter);
export default router;

```

### `artifacts/api-server/src/routes/lender/lender-admin.ts` (29 lines)

```typescript
import { Router } from "express";
import { requireOwner } from "../../lib/auth.js";
import { logger } from "../../lib/logger.js";
import {
  getLenderSyncStatus,
  runLenderSync,
} from "../../lib/lenderWorker.js";

const router = Router();

router.post("/refresh-lender", requireOwner, async (_req, res) => {
  const s = getLenderSyncStatus();
  if (s.running) {
    res.json({ ok: false, message: "Already running", running: true });
    return;
  }
  const { LENDER_ENABLED } = await import("../../lib/lenderAuth.js");
  if (!LENDER_ENABLED) {
    res.json({ ok: false, message: "Lender credentials not configured", running: false });
    return;
  }
  runLenderSync().catch((err) =>
    logger.error({ err }, "Manual lender sync error"),
  );
  res.json({ ok: true, message: "Lender sync started", running: true });
});

export default router;

```

### `artifacts/api-server/src/routes/lender/lender-calculate.ts` (463 lines)

```typescript
import { Router } from "express";
import { requireOwnerOrViewer } from "../../lib/auth.js";
import { logger } from "../../lib/logger.js";
import { validateBody } from "../../lib/validate.js";
import { LenderCalculateBody } from "@workspace/api-zod";
import { getCacheState, type InventoryItem } from "../../lib/inventoryCache.js";
import { getCachedLenderPrograms } from "../../lib/lenderWorker.js";
import {
  resolveCapProfile,
  NO_ONLINE_STRATEGY_BY_PROFILE,
  normalizeTermStretchMonths,
  resolveEffectiveTermStretch,
  pmt,
  parseVehicleYear,
  lookupTerm,
  lookupCondition,
  parseInventoryNumber,
  computePaymentCeilingPV,
  computeZeroDpCeiling,
  resolveSellingPrice,
  allocateBackend,
  settleConstraints,
  parseWorksheetRules,
  applyEligibilityRules,
  deriveTermCap,
  deriveTotalFinanceCap,
  type ConditionBucket,
} from "../../lib/lenderCalcEngine.js";
import type { RuleEffect } from "../../lib/bbObjectStore.js";
import { getRuntimeFingerprint } from "../../lib/runtimeFingerprint.js";

const router = Router();

interface CalcParams {
  lenderCode:    string;
  programId:     string;
  tierName:      string;
  approvedRate:  number;
  maxPaymentOverride?: number;
  downPayment?:  number;
  tradeValue?:   number;
  tradeLien?:    number;
  taxRate?:      number;
  adminFee?:     number;
  termStretchMonths?:      number;
}

const conditionToBBField: Record<ConditionBucket, keyof NonNullable<InventoryItem["bbValues"]>> = {
  extraClean: "xclean",
  clean:      "clean",
  average:    "avg",
  rough:      "rough",
};

router.post("/lender-calculate", requireOwnerOrViewer, validateBody(LenderCalculateBody), async (req, res) => {
  const params = req.body as CalcParams;

  if (!params.lenderCode || !params.tierName || !params.programId) {
    res.status(400).json({ error: "lenderCode, programId, and tierName are required" });
    return;
  }
  if (params.approvedRate == null) {
    res.status(400).json({ error: "approvedRate is required" });
    return;
  }

  const rate = Number(params.approvedRate);
  if (!isFinite(rate) || rate < 0 || rate > 100) {
    res.status(400).json({ error: "approvedRate must be between 0 and 100" });
    return;
  }

  const programs = getCachedLenderPrograms();
  if (!programs || programs.programs.length === 0) {
    res.status(404).json({ error: "No lender programs cached — run a sync first" });
    return;
  }

  const lender = programs.programs.find(p => p.lenderCode === params.lenderCode);
  if (!lender) {
    res.status(404).json({ error: `Lender ${params.lenderCode} not found in cached programs` });
    return;
  }

  const guide = lender.programs.find(g => g.programId === params.programId);
  if (!guide) {
    res.status(404).json({ error: `Program not found for ${params.lenderCode}` });
    return;
  }

  const tier = guide.tiers.find(t => t.tierName === params.tierName);
  if (!tier) {
    res.status(404).json({ error: `Tier "${params.tierName}" not found in program "${guide.programTitle}"` });
    return;
  }

  const { data: inventory } = getCacheState();
  const rateDecimal    = rate / 100;
  const tierMaxPmt     = tier.maxPayment > 0 ? tier.maxPayment : Infinity;
  const maxPmt         = params.maxPaymentOverride ? Math.min(Number(params.maxPaymentOverride), tierMaxPmt) : tierMaxPmt;
  const downPayment    = params.downPayment ?? 0;
  const tradeValue     = params.tradeValue ?? 0;
  const tradeLien      = params.tradeLien ?? 0;
  const taxRate        = (params.taxRate ?? 5) / 100;
  const netTrade       = tradeValue - tradeLien;
  const requestedAdmin = params.adminFee ?? 0;
  const creditorFee    = tier.creditorFee ?? 0;
  const dealerReserve  = tier.dealerReserve ?? 0;

  const MARKUP            = 2.5;
  const MIN_WARRANTY_COST = 600;
  const MIN_GAP_COST      = 550;
  const MAX_GAP_MARKUP    = 1500;
  const MAX_GAP_PRICE     = Math.round(MAX_GAP_MARKUP / (1 - 1 / MARKUP));

  const capProfile = resolveCapProfile({
    maxAdvanceLTV: tier.maxAdvanceLTV,
    maxAftermarketLTV: tier.maxAftermarketLTV,
    maxAllInLTV: tier.maxAllInLTV,
    capModelResolved: guide.capModelResolved ?? "unknown",
  });
  const hasAdvanceCap = capProfile.hasAdvanceCap;
  const hasAftermarketCap = capProfile.hasAftermarketCap;
  const hasAllInCap = capProfile.hasAllInCap;
  const allInOnly = capProfile.allInOnly;

  const maxAdvanceLTV     = hasAdvanceCap    ? tier.maxAdvanceLTV / 100    : Infinity;
  const maxAftermarketLTV = hasAftermarketCap ? tier.maxAftermarketLTV / 100 : Infinity;
  const maxAllInLTV       = hasAllInCap       ? tier.maxAllInLTV / 100       : Infinity;
  const allInTaxMultiplier = 1 + taxRate;

  const adminInclusion = guide.adminFeeInclusion ?? "unknown";

  // CreditApp fee calculation fields: positive numbers are real caps, 0 means "no cap set".
  // When aftermarketBase is "salePrice", the fee cap fields return deal-context defaults
  // (not real program caps). The aftermarket LTV% budget is the true constraint and is
  // computed dynamically per vehicle below. Discard unreliable static caps in that case.
  const aftermarketBudgetIsDynamic =
    (guide.aftermarketBase === "salePrice") && hasAftermarketCap;

  let capWarranty = (guide.maxWarrantyPrice != null && guide.maxWarrantyPrice > 0 && !aftermarketBudgetIsDynamic)
    ? guide.maxWarrantyPrice : undefined;
  let capGap = (guide.maxGapPrice != null && guide.maxGapPrice > 0 && !aftermarketBudgetIsDynamic)
    ? guide.maxGapPrice : undefined;
  // AH routing fallback: when GAP target is AH and gap field resolves to 0/not-set,
  // treat warranty cap as GAP cap to avoid known mis-mapping.
  if (
    guide.gapInsuranceTarget === "AH_INSURANCE" &&
    capGap == null &&
    capWarranty != null &&
    (guide.maxGapPrice == null || guide.maxGapPrice <= 0)
  ) {
    capGap = capWarranty;
    capWarranty = undefined;
  }
  const capAdmin    = (guide.maxAdminFee != null && guide.maxAdminFee > 0)            ? guide.maxAdminFee      : undefined;
  const desiredAdmin = requestedAdmin > 0
    ? Math.round(requestedAdmin)
    : (capAdmin ?? 0);
  const gapAllowed  = capGap == null || capGap > 0;

  const termStretch = normalizeTermStretchMonths(params.termStretchMonths);

  // Resolve creditor-level worksheet rules → typed effects. Effects from sync
  // are preferred (already parsed); fall back to parsing raw rules when the
  // cache predates this feature so we don't gate eligibility on a re-sync.
  let ruleEffects: RuleEffect[] = lender.ruleEffects ?? [];
  if (ruleEffects.length === 0 && lender.worksheetRules && lender.worksheetRules.length > 0) {
    ruleEffects = parseWorksheetRules(lender.worksheetRules);
  }
  const ruleTermCap = deriveTermCap(ruleEffects);
  const ruleTotalFinanceCap = deriveTotalFinanceCap(ruleEffects, params.tierName);

  interface Result {
    vin: string;
    vehicle: string;
    location: string;
    term: number;
    matrixTerm: number;
    termStretchApplied: 0 | 6 | 12;
    termStretched: boolean;
    termStretchCappedReason?: string;
    conditionUsed: string;
    bbWholesale: number;
    pacCost: number;
    pacCostSource: "price";
    onlinePrice: number | null;
    sellingPrice: number;
    sellingPriceCappedByOnline: boolean;
    bindingSellingConstraint: "online" | "advance" | "allIn" | "payment" | "pacFloor" | "none";
    requiredDownPayment?: number;
    adminFeeUsed: number;
    warrantyPrice: number;
    warrantyCost: number;
    gapPrice: number;
    gapCost: number;
    totalFinanced: number;
    monthlyPayment: number;
    frontEndGross: number;
    nonCancelableGross: number;
    cancelableBackendGross: number;
    totalGross: number;
    allocationOrderApplied: ["admin", "warranty", "gap"];
    hasPhotos: boolean;
    website: string;
  }

  const results: Result[] = [];
  const debugCounts = {
    total: 0,
    noYear: 0,
    noKm: 0,
    noTerm: 0,
    noCondition: 0,
    noBB: 0,
    noBBVal: 0,
    noPacPrice: 0,
    excludedByRule: 0,
    passed: 0,
  };
  const ruleRejectionsSummary: Record<string, number> = {};

  inventory: for (const item of inventory) {
    debugCounts.total++;
    const vehicleYear = parseVehicleYear(item.vehicle);
    if (!vehicleYear) { debugCounts.noYear++; continue inventory; }

    const km = parseInt(item.km?.replace(/[^0-9]/g, "") || "0", 10);
    if (!km || km <= 0) { debugCounts.noKm++; continue inventory; }

    const baseTerm = lookupTerm(guide.vehicleTermMatrix, vehicleYear, km);
    if (!baseTerm) { debugCounts.noTerm++; continue inventory; }
    const termResolved = resolveEffectiveTermStretch(baseTerm, termStretch);
    let termMonths = termResolved.termMonths;
    const termStretched = termResolved.stretched;
    const termStretchApplied = termResolved.effectiveStretch;
    const termStretchCappedReason = termResolved.cappedReason;
    if (ruleTermCap != null && termMonths > ruleTermCap) termMonths = ruleTermCap;

    const condition = lookupCondition(guide.vehicleConditionMatrix, vehicleYear, km);
    if (!condition) { debugCounts.noCondition++; continue inventory; }

    if (!item.bbValues) { debugCounts.noBB++; continue inventory; }
    const bbField = conditionToBBField[condition];
    const bbWholesale = item.bbValues[bbField];
    if (!bbWholesale || bbWholesale <= 0) { debugCounts.noBBVal++; continue inventory; }

    const rawOnline = parseInventoryNumber(item.onlinePrice);
    const onlinePrice = rawOnline > 0 ? Math.round(rawOnline) : null;
    const pacCost = parseInventoryNumber(item.price);
    if (pacCost <= 0) { debugCounts.noPacPrice++; continue inventory; }

    // Apply lender worksheetRules eligibility (km cap, vehicle ban, carfax cap, year cap).
    // carfaxClaimAmount comes from inventory bb metadata when available.
    const carfaxClaimAmount = parseInventoryNumber((item as any).carfaxClaimsAmount ?? (item as any).carfaxClaimAmount);
    if (ruleEffects.length > 0) {
      const elig = applyEligibilityRules(ruleEffects, {
        vehicle: item.vehicle,
        km,
        vehicleYear,
        bbWholesale,
        carfaxClaimAmount: carfaxClaimAmount > 0 ? carfaxClaimAmount : undefined,
      }, { tierName: params.tierName });
      if (!elig.ok) {
        debugCounts.excludedByRule++;
        for (const r of elig.rejections) {
          ruleRejectionsSummary[r.ruleName] = (ruleRejectionsSummary[r.ruleName] ?? 0) + 1;
        }
        continue inventory;
      }
    }

    const maxAdvance = hasAdvanceCap ? bbWholesale * maxAdvanceLTV : Infinity;
    const maxAllInWithTax = hasAllInCap ? bbWholesale * maxAllInLTV : Infinity;
    let maxAllInPreTax = isFinite(maxAllInWithTax) ? (maxAllInWithTax / allInTaxMultiplier) : Infinity;
    // Total-finance rule cap (e.g. ACC $50k, Santander tier-conditional caps)
    // tightens the all-in subtotal bound regardless of whether an LTV all-in
    // cap is otherwise active. The cap is post-tax (matches CreditApp's
    // totalFinancedAmount.amount), so we divide back into the same pre-tax
    // space and force `hasAllInCap` true so downstream ceilings honor it.
    let effectiveHasAllInCap = hasAllInCap;
    if (ruleTotalFinanceCap != null) {
      const capPreTax = ruleTotalFinanceCap / allInTaxMultiplier;
      maxAllInPreTax = Math.min(maxAllInPreTax, capPreTax);
      effectiveHasAllInCap = true;
    }

    const paymentPV = computePaymentCeilingPV(rateDecimal, termMonths, maxPmt);
    const ceilingResult = computeZeroDpCeiling({
      hasAdvanceCap,
      maxAdvance,
      hasAllInCap: effectiveHasAllInCap,
      maxAllInPreTax,
      paymentPV,
      downPayment,
      netTrade,
      creditorFee,
      taxRate,
    });

    const sellingResolution = resolveSellingPrice({
      pacCost,
      onlinePrice,
      zeroDpCeiling: ceilingResult.zeroDpCeiling,
      bindingZeroDpReason: ceilingResult.bindingReason,
    });
    const sellingPrice = sellingResolution.sellingPrice;
    const bindingSellingConstraint = sellingResolution.bindingSellingConstraint;
    const sellingPriceCappedByOnline = sellingResolution.sellingPriceCappedByOnline;

    const reqDpToTarget = sellingResolution.requiredDownPayment;
    const effectiveExposure = sellingPrice - (downPayment + reqDpToTarget) - netTrade;
    const allInRoom0 = isFinite(maxAllInPreTax) ? (maxAllInPreTax - effectiveExposure - creditorFee) : Infinity;
    const aftermarketBase = guide.aftermarketBase === "salePrice" ? sellingPrice : bbWholesale;
    const aftermarketRoom0 = hasAftermarketCap ? aftermarketBase * maxAftermarketLTV : Infinity;

    const state = allocateBackend({
      allInRoom: allInRoom0,
      aftermarketRoom: aftermarketRoom0,
      capAdmin,
      desiredAdmin,
      capWarranty,
      capGap,
      gapAllowed,
      adminInclusion,
      markup: MARKUP,
      minWarrantyCost: MIN_WARRANTY_COST,
      minGapCost: MIN_GAP_COST,
      maxGapPrice: MAX_GAP_PRICE,
    });

    const settlement = settleConstraints({
      state,
      sellingPrice,
      pacCost,
      downPayment,
      netTrade,
      creditorFee,
      taxRate,
      rateDecimal,
      termMonths,
      maxPmt,
      paymentPV,
      maxAllInPreTax,
      initialReqDP: reqDpToTarget,
    });

    if (!settlement.feasible) continue inventory;
    const reqDP = settlement.reqDP;

    const finalExposure = sellingPrice - (downPayment + reqDP) - netTrade;
    const allInSubtotal = finalExposure + state.admin + state.warranty + state.gap + creditorFee;
    const taxes = allInSubtotal * taxRate;
    const totalFinanced = allInSubtotal + taxes;
    const monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);

    debugCounts.passed++;

    const warrantyCost = state.warranty > 0 ? Math.round(state.warranty / MARKUP) : 0;
    const gapCost = state.gap > 0 ? Math.round(state.gap / MARKUP) : 0;
    const frontEndGross = Math.round(sellingPrice - pacCost);
    const warrantyProfit = Math.round(state.warranty - warrantyCost);
    const gapProfit = Math.round(state.gap - gapCost);
    const cancelableBackendGross = warrantyProfit + gapProfit;
    const nonCancelableGross = Math.round(frontEndGross + state.admin + dealerReserve);
    const totalGross = nonCancelableGross + cancelableBackendGross;

    results.push({
      vin: item.vin,
      vehicle: item.vehicle,
      location: item.location,
      term: termMonths,
      matrixTerm: baseTerm,
      termStretchApplied,
      termStretched,
      termStretchCappedReason,
      conditionUsed: condition,
      bbWholesale,
      pacCost: Math.round(pacCost),
      pacCostSource: "price",
      onlinePrice,
      sellingPrice: Math.round(sellingPrice),
      sellingPriceCappedByOnline,
      bindingSellingConstraint,
      requiredDownPayment: reqDP > 0 ? Math.round(reqDP) : undefined,
      adminFeeUsed: Math.round(state.admin),
      warrantyPrice: Math.round(state.warranty),
      warrantyCost,
      gapPrice: Math.round(state.gap),
      gapCost,
      totalFinanced: Math.round(totalFinanced),
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
      frontEndGross,
      nonCancelableGross,
      cancelableBackendGross,
      totalGross,
      allocationOrderApplied: ["admin", "warranty", "gap"],
      hasPhotos: item.hasPhotos,
      website: item.website,
    });
  }

  results.sort((a, b) => b.totalGross - a.totalGross);

  const runtime = getRuntimeFingerprint();

  logger.info({
    debugCounts,
    ruleRejectionsSummary,
    ruleEffectsCount: ruleEffects.length,
    ruleTermCap,
    ruleTotalFinanceCap,
    lender: params.lenderCode,
    program: guide.programTitle,
    tier: params.tierName,
    termStretchMonths: termStretch,
    allInOnly,
    hasAdvanceCap,
    hasAftermarketCap,
    aftermarketBudgetIsDynamic,
    adminInclusion,
    capAdmin,
    capWarranty,
    capGap,
    capModelResolved: guide.capModelResolved ?? "unknown",
    capProfileKey: capProfile.key,
    noOnlineStrategy: NO_ONLINE_STRATEGY_BY_PROFILE[capProfile.key],
    ...runtime,
  }, "Lender calculate debug");

  res.set("Cache-Control", "no-store");
  res.json({
    lender:     params.lenderCode,
    program:    guide.programTitle,
    tier:       params.tierName,
    termStretchMonths: termStretch,
    ...runtime,
    tierConfig: tier,
    programLimits: {
      maxWarrantyPrice: capWarranty ?? null,
      maxGapPrice:      capGap ?? null,
      maxAdminFee:      capAdmin ?? null,
      maxGapMarkup:     MAX_GAP_MARKUP,
      gapAllowed,
      allInOnly,
      hasAdvanceCap,
      hasAftermarketCap,
      aftermarketBudgetIsDynamic,
      aftermarketBase:    guide.aftermarketBase ?? "unknown",
      adminFeeInclusion:  adminInclusion,
      capModelResolved:   guide.capModelResolved ?? "unknown",
      capProfileKey:      capProfile.key,
      noOnlineStrategy:   NO_ONLINE_STRATEGY_BY_PROFILE[capProfile.key],
    },
    pacCostSource: "price",
    debugCounts,
    resultCount: results.length,
    results,
  });
});

export default router;

```

### `artifacts/api-server/src/routes/lender/lender-read.ts` (105 lines)

```typescript
import { Router } from "express";
import { requireOwner, requireOwnerOrViewer } from "../../lib/auth.js";
import {
  getLenderSyncStatus,
  getCachedLenderPrograms,
} from "../../lib/lenderWorker.js";
import {
  resolveCapProfile,
  NO_ONLINE_STRATEGY_BY_PROFILE,
} from "../../lib/lenderCalcEngine.js";
import { getRuntimeFingerprint } from "../../lib/runtimeFingerprint.js";

const router = Router();

router.get("/lender-programs", requireOwnerOrViewer, async (req, res) => {
  const programs = getCachedLenderPrograms();
  if (!programs) {
    res.set("Cache-Control", "no-store");
    res.set("X-Data-Staleness", "-1");
    res.json({ programs: [], updatedAt: null, role: req._role });
    return;
  }
  // Compute staleness from the blob's own updatedAt timestamp so the header
  // reflects real program age, not the age of the last API call.
  const stalenessMs = programs.updatedAt
    ? Date.now() - new Date(programs.updatedAt).getTime()
    : -1;
  res.set("Cache-Control", "no-store");
  res.set("X-Data-Staleness", String(stalenessMs));
  res.json({ ...programs, role: req._role });
});

router.get("/lender-status", requireOwnerOrViewer, async (req, res) => {
  const s = getLenderSyncStatus();
  const programs = getCachedLenderPrograms();
  res.set("Cache-Control", "no-store");
  res.json({
    running:      s.running,
    startedAt:    s.startedAt,
    lastRun:      s.lastRun,
    lenderCount:  s.lastCount,
    error:        s.error ?? null,
    programsAge:  programs?.updatedAt ?? null,
    role:         req._role,
  });
});

// Diagnostic endpoint — dumps cached program metadata for debugging
router.get("/lender-debug", requireOwner, async (_req, res) => {
  const runtime = getRuntimeFingerprint();
  const programs = getCachedLenderPrograms();
  if (!programs) {
    res.json({ error: "No cached programs", programs: [], ...runtime });
    return;
  }
  const summary = programs.programs.map(lender => ({
    lenderCode: lender.lenderCode,
    lenderName: lender.lenderName,
    programs: lender.programs.map(g => ({
      programId: g.programId,
      programTitle: g.programTitle,
      tiersCount: g.tiers.length,
      tiers: g.tiers.map(t => ({
        capProfileKey: resolveCapProfile({
          maxAdvanceLTV: t.maxAdvanceLTV,
          maxAftermarketLTV: t.maxAftermarketLTV,
          maxAllInLTV: t.maxAllInLTV,
          capModelResolved: g.capModelResolved ?? "unknown",
        }).key,
        noOnlineStrategy: NO_ONLINE_STRATEGY_BY_PROFILE[resolveCapProfile({
          maxAdvanceLTV: t.maxAdvanceLTV,
          maxAftermarketLTV: t.maxAftermarketLTV,
          maxAllInLTV: t.maxAllInLTV,
          capModelResolved: g.capModelResolved ?? "unknown",
        }).key],
        tierName: t.tierName,
        maxAdvanceLTV: t.maxAdvanceLTV,
        maxAftermarketLTV: t.maxAftermarketLTV,
        maxAllInLTV: t.maxAllInLTV,
        creditorFee: t.creditorFee,
        dealerReserve: t.dealerReserve,
      })),
      maxWarrantyPrice: g.maxWarrantyPrice ?? null,
      maxGapPrice: g.maxGapPrice ?? null,
      maxAdminFee: g.maxAdminFee ?? null,
      gapInsuranceTarget: g.gapInsuranceTarget ?? null,
      feeCalculationsRaw: g.feeCalculationsRaw ?? null,
      aftermarketBase: g.aftermarketBase ?? "unknown",
      allInOnlyRules: g.allInOnlyRules ?? false,
      capModelResolved: g.capModelResolved ?? "unknown",
      adminFeeInclusion: g.adminFeeInclusion ?? "unknown",
      backendLtvCalculation: g.backendLtvCalculation ?? null,
      allInLtvCalculation: g.allInLtvCalculation ?? null,
      backendRemainingCalculation: g.backendRemainingCalculation ?? null,
      allInRemainingCalculation: g.allInRemainingCalculation ?? null,
      configuredOk: g.tiers.length > 0 && (
        g.tiers.some(t => t.maxAdvanceLTV > 0 || t.maxAftermarketLTV > 0 || t.maxAllInLTV > 0)
      ),
    })),
  }));
  res.json({ updatedAt: programs.updatedAt, lenders: summary, ...runtime });
});

export default router;

```

---

<a id="integrations"></a>
## 11. API server — integrations (Black Book, Carfax, object storage)

*5 file(s).*

### `artifacts/api-server/src/lib/bbObjectStore.ts` (350 lines)

```typescript
/**
 * bbObjectStore.ts
 *
 * Thin wrapper around Replit's GCS-backed object storage for two JSON blobs
 * that must be shared between the dev and production environments:
 *
 *   bb-session.json  — CreditApp session cookies (written by dev, read by both)
 *   bb-values.json   — VIN → bbAvgWholesale map (written by dev, read by both)
 *
 * Object storage is per-workspace (not per-environment), so the same bucket
 * is accessible from both dev and production deployments.
 */

import { Storage } from "@google-cloud/storage";
import { logger } from "./logger.js";
import { env } from "./env.js";

const SIDECAR = "http://127.0.0.1:1106";

const gcs = new Storage({
  credentials: {
    audience:            "replit",
    subject_token_type:  "access_token",
    token_url:           `${SIDECAR}/token`,
    type:                "external_account",
    credential_source: {
      url:    `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

function bucket() {
  if (!env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return gcs.bucket(env.DEFAULT_OBJECT_STORAGE_BUCKET_ID);
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    const [contents] = await bucket().file(name).download();
    return JSON.parse(contents.toString("utf8")) as T;
  } catch (err: any) {
    if (err.code === 404 || err.message?.includes("No such object")) return null;
    logger.warn({ err: err.message, name }, "bbObjectStore: read failed");
    return null;
  }
}

async function writeJson(name: string, data: unknown): Promise<void> {
  try {
    await bucket().file(name).save(JSON.stringify(data), { contentType: "application/json" });
  } catch (err: any) {
    logger.error({ err: err.message, name }, "bbObjectStore: write failed");
    throw err;
  }
}

async function writeJsonBestEffort(name: string, data: unknown): Promise<void> {
  try {
    await bucket().file(name).save(JSON.stringify(data), { contentType: "application/json" });
  } catch (err: any) {
    logger.warn({ err: err.message, name }, "bbObjectStore: write failed");
  }
}

// ---------------------------------------------------------------------------
// Session cookies (CreditApp auth — written by dev browser login)
// ---------------------------------------------------------------------------

export interface BbSessionBlob {
  cookies:   any[];
  updatedAt: string;
}

export async function loadSessionFromStore(): Promise<BbSessionBlob | null> {
  return readJson<BbSessionBlob>("bb-session.json");
}

export async function saveSessionToStore(cookies: any[]): Promise<void> {
  await writeJsonBestEffort("bb-session.json", {
    cookies,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// BB values map (VIN → bbAvgWholesale string — written by dev worker)
// ---------------------------------------------------------------------------

export interface BbValueEntry {
  avg:     string;
  xclean:  number;
  clean:   number;
  average: number;
  rough:   number;
}

export interface BbValuesBlob {
  values:    Record<string, string | BbValueEntry>;
  updatedAt: string;
}

export function parseBbEntry(raw: string | BbValueEntry): BbValueEntry | null {
  if (typeof raw === "object" && raw !== null && "avg" in raw) return raw as BbValueEntry;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    if (!isNaN(n) && cleaned.length > 0) return { avg: raw, xclean: 0, clean: 0, average: n, rough: 0 };
  }
  return null;
}

export async function loadBbValuesFromStore(): Promise<BbValuesBlob | null> {
  return readJson<BbValuesBlob>("bb-values.json");
}

export async function saveBbValuesToStore(values: Record<string, BbValueEntry>): Promise<void> {
  const existing = await loadBbValuesFromStore();
  const merged = existing?.values ? { ...existing.values } : {};
  for (const [vin, entry] of Object.entries(values)) {
    merged[vin.toUpperCase()] = entry;
  }
  await writeJson("bb-values.json", {
    values: merged,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Carfax worker run tracking — last run date (Mountain TZ) to prevent
// duplicate same-day runs across server restarts.
// ---------------------------------------------------------------------------

export interface CarfaxRunsBlob {
  lastRunDate: string;
  updatedAt:   string;
}

export async function loadCarfaxRunsFromStore(): Promise<CarfaxRunsBlob | null> {
  return readJson<CarfaxRunsBlob>("carfax-runs.json");
}

export async function saveCarfaxRunsToStore(lastRunDate: string): Promise<void> {
  await writeJsonBestEffort("carfax-runs.json", {
    lastRunDate,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Lender session cookies (CreditApp lender account — separate from BB)
// ---------------------------------------------------------------------------

export async function loadLenderSessionFromStore(): Promise<BbSessionBlob | null> {
  return readJson<BbSessionBlob>("lender-session.json");
}

export async function saveLenderSessionToStore(cookies: any[]): Promise<void> {
  await writeJsonBestEffort("lender-session.json", {
    cookies,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Lender programs cache (program matrices from CreditApp GraphQL)
// ---------------------------------------------------------------------------

export interface LenderProgramTier {
  tierName:         string;
  minRate:          number;
  maxRate:          number;
  maxPayment:       number;
  maxAdvanceLTV:    number;
  maxAftermarketLTV: number;
  maxAllInLTV:      number;
  creditorFee:      number;
  dealerReserve:    number;
}

export interface VehicleTermMatrixEntry {
  year: number;
  data: { term: number; kmFrom: number; kmTo: number }[];
}

export interface VehicleConditionMatrixEntry {
  year: number;
  extraClean: { kmFrom: number; kmTo: number };
  clean:      { kmFrom: number; kmTo: number };
  average:    { kmFrom: number; kmTo: number };
  rough:      { kmFrom: number; kmTo: number };
}

export interface LenderProgramGuide {
  programId:              string;
  programTitle:           string;
  programType:            string;
  tiers:                  LenderProgramTier[];
  vehicleTermMatrix:      VehicleTermMatrixEntry[];
  vehicleConditionMatrix: VehicleConditionMatrixEntry[];
  maxTerm?:               number;
  maxWarrantyPrice?:      number;
  maxGapPrice?:           number;
  maxAdminFee?:           number;
  /** CreditApp routing: when AH_INSURANCE, GAP sells in AH field; cap may be maxAhInsuranceFeeCalculation */
  gapInsuranceTarget?:    string | null;
  feeCalculationsRaw?: {
    maxExtendedWarrantyFeeCalculation?: string;
    maxGapInsuranceFeeCalculation?:     string;
    maxDealerAdminFeeCalculation?:       string;
    maxAhInsuranceFeeCalculation?:      string;
    resolvedGapCapSource?:             string;
  };
  capModelResolved?: "allInOnly" | "split" | "backendOnly" | "unknown";
  backendLtvCalculation?: string;
  allInLtvCalculation?: string;
  backendRemainingCalculation?: string;
  allInRemainingCalculation?: string;
  aftermarketBase?: "bbWholesale" | "salePrice" | "unknown";
  allInOnlyRules?: boolean;
  adminFeeInclusion?: "backend" | "allIn" | "excluded" | "unknown";
}

/**
 * Raw worksheet rule synced from CreditApp's GraphQL `Creditor.worksheetRules`
 * field. Rules are creditor-level (apply across all programs of that lender)
 * and contain a CreditApp template-language `query` string that, when true,
 * would surface a warning/error in the CreditApp UI when booking the deal.
 *
 * Most rules are operational (payment-date windows, term-multiple-of-6,
 * frequency restrictions) and don't affect inventory eligibility. Eligibility-
 * affecting rules (km caps, vehicle-type bans, carfax claim caps, total-finance
 * caps, vehicle age caps) are extracted into `RuleEffect[]` by the parser.
 */
export interface WorksheetRule {
  id:          string;
  name:        string;
  query:       string;
  fieldName:   string | null;
  description: string | null;
  type:        "ERROR" | "WARNING" | string;
}

/**
 * Parsed rule shapes consumed by the calculator's eligibility filter.
 *
 * `ignored` is emitted (with a reason) for rules the parser intentionally does
 * not act on — operational, tier-conditional with unsupported tier context, or
 * unrecognized syntax. The raw rules are also persisted alongside parsed
 * effects so future debugging is non-destructive.
 */
export type RuleEffect =
  | { kind: "odometerMax";      max: number;       ruleId: string; ruleName: string }
  | { kind: "odometerMin";      min: number;       ruleId: string; ruleName: string }
  | { kind: "vehicleMinYear";   minYear: number;   ruleId: string; ruleName: string }
  /**
   * Vehicle type ban predicate: rejects when ANY `disjuncts` entry matches.
   * Each disjunct is an array of regex patterns that ALL must match the
   * vehicle string (preserves AND semantics inside an OR-clause, e.g.
   * "make match /Ford/ AND model match /Transit/").
   */
  | { kind: "vehicleTypeBan";   disjuncts: string[][]; description: string; ruleId: string; ruleName: string }
  | { kind: "vehicleModelInList"; models: string[]; ruleId: string; ruleName: string }
  | { kind: "carfaxClaimMax";   max: number;       ruleId: string; ruleName: string }
  | { kind: "carfaxClaimRatioMax"; ratio: number; bbvFloor?: number; bbvCeiling?: number; ruleId: string; ruleName: string }
  | { kind: "totalFinanceMax";  max: number; tierName?: string; ruleId: string; ruleName: string }
  | { kind: "totalFinanceMin";  min: number;       ruleId: string; ruleName: string }
  | { kind: "termMax";          max: number;       ruleId: string; ruleName: string }
  | { kind: "ignored";          reason: string;    ruleId: string; ruleName: string };

export interface LenderProgram {
  lenderCode:   string;
  lenderName:   string;
  creditorId:   string;
  programs:     LenderProgramGuide[];
  /** Raw rules from CreditApp (creditor-level, applies to all programs) */
  worksheetRules?: WorksheetRule[];
  /** Effects parsed from `worksheetRules`; calculator consumes these directly */
  ruleEffects?: RuleEffect[];
}

export interface LenderProgramsBlob {
  programs:   LenderProgram[];
  updatedAt:  string;
}

export async function loadLenderProgramsFromStore(): Promise<LenderProgramsBlob | null> {
  return readJson<LenderProgramsBlob>("lender-programs.json");
}

export async function saveLenderProgramsToStore(data: LenderProgramsBlob): Promise<void> {
  await writeJson("lender-programs.json", data);
}

// ---------------------------------------------------------------------------
// Self-heal flags durability mirror (DB is primary, GCS is backup path)
// ---------------------------------------------------------------------------

export interface SelfHealFlagBlob {
  subsystem: string;
  flagState: "canary" | "promoted" | "rolled_back";
  prUrl: string | null;
  incidentLogId: number | null;
  rollbackReason: string | null;
  updatedAt: string;
}

export async function saveSelfHealFlagToStore(patchId: string, data: SelfHealFlagBlob): Promise<void> {
  await writeJsonBestEffort(`self-heal-flags/${patchId}.json`, data);
}

export async function loadSelfHealFlagFromStore(patchId: string): Promise<SelfHealFlagBlob | null> {
  return readJson<SelfHealFlagBlob>(`self-heal-flags/${patchId}.json`);
}

export async function loadSelfHealAutomergeToggle(): Promise<{ enabled: boolean } | null> {
  return readJson<{ enabled: boolean }>("self-heal/automerge-toggle.json");
}

export async function saveSelfHealAutomergeToggle(enabled: boolean): Promise<void> {
  await writeJsonBestEffort("self-heal/automerge-toggle.json", {
    enabled,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Bucket reachability probe — used by /healthz/deep to verify GCS is live.
// Unlike readJson, this actually throws on transport/auth failure rather than
// returning null, giving the health check a real signal.
// ---------------------------------------------------------------------------

export async function probeBucket(): Promise<{ ok: boolean; error: string | null }> {
  const timeoutMs = 5_000;
  try {
    const b = bucket();
    await Promise.race([
      b.getMetadata(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`GCS probe timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return { ok: true, error: null };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

```

### `artifacts/api-server/src/lib/blackBookWorker.ts` (1695 lines)

```typescript
/**
 * Black Book Worker
 *
 * Runs daily at a random time during business hours (Mountain Time).
 * Manual trigger via POST /api/refresh-blackbook (owner only).
 *
 * Flow:
 *  1. Login to admin.creditapp.ca via Auth0 (Puppeteer + stealth)
 *  2. Extract appSession + CA_CSRF_TOKEN cookies → close browser
 *  3. Health-check POST /api/cbb/find before processing any VINs
 *  4. For each VIN in inventory: POST /api/cbb/find with VIN + KM
 *  5. Validate response fields are present
 *  6. Match best trim via vehicle string scoring (conservative fallback)
 *  7. Apply adjusted_whole_avg values to inventory cache
 *  8. On any failure: self-heal with exponential backoff — no notifications
 *
 * REQUIRED SECRETS: CREDITAPP_EMAIL, CREDITAPP_PASSWORD
 * OPTIONAL SECRETS: CREDITAPP_TOTP_SECRET, BB_CBB_ENDPOINT
 */

import { logger }                         from "./logger.js";
import { env, isProduction }              from "./env.js";
import * as fs                            from "fs";
import * as path                          from "path";
import * as crypto                        from "crypto";
import { getCacheState, applyBlackBookValues } from "./inventoryCache.js";
import {
  loadSessionFromStore,
  saveSessionToStore,
  saveBbValuesToStore,
} from "./bbObjectStore.js";
import { scheduleRandomDaily, toMountainDateStr } from "./randomScheduler.js";
import { PlatformError } from "./platformError.js";
import { recordFailure, recordIncident, updateBbSessionState } from "./incidentService.js";
import { withRetry } from "./selfHeal/withRetry.js";
import { withCircuitBreaker } from "./selfHeal/circuitBreaker.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREDITAPP_EMAIL       = env.CREDITAPP_EMAIL;
const CREDITAPP_PASSWORD    = env.CREDITAPP_PASSWORD;
const CREDITAPP_TOTP_SECRET = env.CREDITAPP_TOTP_SECRET;
const BB_ENABLED            = !!(CREDITAPP_EMAIL && CREDITAPP_PASSWORD);
const BB_ALLOW_PROD_BROWSER_LOGIN = env.BB_ALLOW_PROD_BROWSER_LOGIN;
const BB_SELF_HEAL_INTERVAL_MS = env.BB_SELF_HEAL_INTERVAL_MIN * 60_000;
const BB_SELF_HEAL_STALE_MS = env.BB_SELF_HEAL_STALE_HOURS * 60 * 60 * 1000;

const CBB_ENDPOINT    = env.BB_CBB_ENDPOINT || "https://admin.creditapp.ca/api/cbb/find";
const CREDITAPP_HOME  = "https://admin.creditapp.ca";
const LOGIN_URL       = "https://admin.creditapp.ca/api/auth/login";
const SESSION_FILE    = path.join(process.cwd(), ".creditapp-session.json");

// VIN used for the health check before batch (Toyota Corolla — confirmed working)
const HEALTH_CHECK_VIN = "2T1BU4EE6DC038563";
const HEALTH_CHECK_KM  = 145000;

const AUTH0_EMAIL_SELECTORS = ["#username", 'input[name="username"]', 'input[type="email"]'];
const AUTH0_PASS_SELECTORS  = ["#password", 'input[name="password"]', 'input[type="password"]'];

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

interface BbStatus {
  running:   boolean;
  startedAt: string | null;
  lastRun:   string | null;
  lastCount: number;
  pendingTargetVinCount: number;
  lastOutcome: "success" | "partial" | "failed" | null;
  lastError: string | null;
  lastBatch: {
    total: number;
    succeeded: number;
    skipped: number;
    failed: number;
    updated: number;
  } | null;
}

interface BbConfigStatus {
  enabled: boolean;
  missingEnv: string[];
  isProduction: boolean;
  allowProdBrowserLogin: boolean;
}

type BbAuthCookies = { appSession: string; csrfToken: string };

const status: BbStatus = {
  running: false,
  startedAt: null,
  lastRun: null,
  lastCount: 0,
  pendingTargetVinCount: 0,
  lastOutcome: null,
  lastError: null,
  lastBatch: null,
};

const pendingTargetVins = new Set<string>();

function enqueueTargetVins(vins: string[]): void {
  for (const vin of vins) {
    const key = vin.trim().toUpperCase();
    if (key) pendingTargetVins.add(key);
  }
  status.pendingTargetVinCount = pendingTargetVins.size;
}

function takePendingTargetVins(): string[] {
  const vins = [...pendingTargetVins];
  pendingTargetVins.clear();
  status.pendingTargetVinCount = 0;
  return vins;
}

async function drainPendingTargetVins(reason: string): Promise<void> {
  if (status.running || pendingTargetVins.size === 0) return;
  const queued = takePendingTargetVins();
  logger.info({ reason, queuedCount: queued.length }, "BB worker: draining queued targeted VIN lookups");
  await runBlackBookForVins(queued);
}

export function getBlackBookStatus(): BbStatus {
  return { ...status };
}

export function getBlackBookConfigStatus(): BbConfigStatus {
  const missingEnv: string[] = [];
  if (!CREDITAPP_EMAIL) missingEnv.push("CREDITAPP_EMAIL");
  if (!CREDITAPP_PASSWORD) missingEnv.push("CREDITAPP_PASSWORD");
  if (!env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) missingEnv.push("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  return {
    enabled: BB_ENABLED,
    missingEnv,
    isProduction,
    allowProdBrowserLogin: BB_ALLOW_PROD_BROWSER_LOGIN,
  };
}

export async function getBlackBookLastRunAtIso(): Promise<string | null> {
  try {
    // Lazy: DB only needed for status/ops introspection
    const { db, bbSessionTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select({ lastRunAt: bbSessionTable.lastRunAt })
      .from(bbSessionTable)
      .where(eq(bbSessionTable.id, "singleton"));
    const lastRunAt = rows[0]?.lastRunAt ?? null;
    return lastRunAt ? lastRunAt.toISOString() : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not read persistent last run timestamp");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseKm(kmStr: string): number {
  const n = parseInt(kmStr.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// TOTP generation (mirrors lenderAuth.ts)
// ---------------------------------------------------------------------------

function base32Decode(encoded: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = encoded.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret: string, period = 30, digits = 6): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % (10 ** digits);
  return code.toString().padStart(digits, "0");
}

// ---------------------------------------------------------------------------
// Session persistence — file + database (shared between dev and prod)
// ---------------------------------------------------------------------------

function loadCookiesFromFile(): any[] {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw     = fs.readFileSync(SESSION_FILE, "utf8");
      const cookies = JSON.parse(raw);
      logger.info({ count: cookies.length }, "BB worker: loaded session cookies from file");
      return cookies;
    }
  } catch (_) {}
  return [];
}

function saveCookiesToFile(cookies: any[]): void {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2), "utf8");
  } catch (_) {}
}

async function loadCookiesFromDb(): Promise<any[]> {
  try {
    // Lazy: DB only needed for session/schedule bookkeeping
    const { db, bbSessionTable } = await import("@workspace/db");
    const { eq }                 = await import("drizzle-orm");
    const rows = await db.select().from(bbSessionTable).where(eq(bbSessionTable.id, "singleton"));
    if (rows.length === 0) {
      logger.warn("BB worker: bb_session row not found in database (no data seeded yet)");
      return [];
    }
    if (!rows[0].cookies) {
      logger.warn("BB worker: bb_session cookies field is null/empty");
      return [];
    }
    const cookies = JSON.parse(rows[0].cookies);
    logger.info({ count: cookies.length }, "BB worker: loaded session cookies from database");
    return cookies;
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not load session from database");
  }
  return [];
}

async function saveCookiesToDb(cookies: any[]): Promise<void> {
  try {
    // Lazy: DB only needed for session/schedule bookkeeping
    const { db, bbSessionTable } = await import("@workspace/db");
    await db
      .insert(bbSessionTable)
      .values({ id: "singleton", cookies: JSON.stringify(cookies), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: bbSessionTable.id,
        set:    { cookies: JSON.stringify(cookies), updatedAt: new Date() },
      });
    logger.info({ count: cookies.length }, "BB worker: session cookies saved to database");
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not save session to database");
  }
}

function extractAuthCookies(cookies: any[]): { appSession: string; csrfToken: string } | null {
  const appSession = cookies.find((c: any) => c.name === "appSession");
  const csrfToken  = cookies.find((c: any) => c.name === "CA_CSRF_TOKEN");
  if (!appSession || !csrfToken) return null;
  return { appSession: appSession.value, csrfToken: csrfToken.value };
}

/**
 * Get valid auth cookies — tries object storage first (shared between dev + prod),
 * then DB, then file, then (dev only) full browser login.
 *
 * Object storage (GCS-backed) is the primary shared store.
 * In production, browser login is skipped entirely — dev's nightly run keeps
 * cookies fresh in the shared object storage bucket.
 */
async function getAuthCookies(): Promise<{ appSession: string; csrfToken: string }> {
  // 1. Object storage (shared between dev + prod — primary source)
  try {
    const blob = await loadSessionFromStore();
    if (blob?.cookies?.length) {
      const auth = extractAuthCookies(blob.cookies);
      if (auth) {
        const ok = await healthCheck(auth.appSession, auth.csrfToken);
        if (ok) {
          logger.info("BB worker: object-storage session valid — skipping browser login");
          return auth;
        }
        logger.info({ isProduction }, "BB worker: object-storage session expired");
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "BB worker: could not load session from object storage");
  }

  // 2. Database cookies (fallback — only visible to the env that wrote them)
  const dbCookies = await loadCookiesFromDb();
  if (dbCookies.length > 0) {
    const auth = extractAuthCookies(dbCookies);
    if (auth) {
      const ok = await healthCheck(auth.appSession, auth.csrfToken);
      if (ok) {
        logger.info("BB worker: database session valid — promoting to object storage");
        await saveSessionToStore(dbCookies);
        return auth;
      }
      logger.info("BB worker: database session expired");
    }
  }

  // 3. File cookies (dev convenience)
  const fileCookies = loadCookiesFromFile();
  if (fileCookies.length > 0) {
    const auth = extractAuthCookies(fileCookies);
    if (auth) {
      const ok = await healthCheck(auth.appSession, auth.csrfToken);
      if (ok) {
        logger.info("BB worker: file session valid — promoting to object storage + database");
        await saveSessionToStore(fileCookies);
        await saveCookiesToDb(fileCookies);
        return auth;
      }
      logger.info("BB worker: file session expired");
    }
  }

  // 4. Production default: no browser login unless explicitly enabled
  if (isProduction && !BB_ALLOW_PROD_BROWSER_LOGIN) {
    throw new Error(
      "BB worker: session cookies expired in production — dev's nightly 2am run will refresh them. " +
      "Values remain from the last successful run.",
    );
  }

  // 5. Dev (and optional production fallback): full browser login to refresh cookies
  logger.info(
    { isProduction, allowProdBrowserLogin: BB_ALLOW_PROD_BROWSER_LOGIN },
    "BB worker: launching browser for fresh login",
  );
  let browser: any = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await addAntiDetection(page);

    const loggedIn = await loginWithAuth0(page);
    if (!loggedIn) throw new Error("Login to CreditApp failed");

    // After Auth0 login the browser may be on the auth domain — navigate to
    // the app domain so appSession + CA_CSRF_TOKEN cookies are set.
    let currentUrl = page.url() as string;
    logger.info({ currentUrl }, "BB worker: URL after login flow");

    if (currentUrl.includes("auth.admin.creditapp.ca") || !currentUrl.includes("admin.creditapp.ca")) {
      logger.info("BB worker: navigating to admin.creditapp.ca to collect app cookies");
      await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(3000);
      currentUrl = page.url() as string;
      logger.info({ currentUrl }, "BB worker: URL after navigating to app domain");
    }

    const cookies = await page.cookies(CREDITAPP_HOME);
    const cookieNames = cookies.map((c: any) => c.name);
    logger.info({ currentUrl, cookieCount: cookies.length, cookieNames }, "BB worker: cookies after login");

    let auth = extractAuthCookies(cookies);
    if (!auth) {
      // Fallback: try the auth subdomain (some Auth0 configs set cookies there)
      const authDomainCookies = await page.cookies("https://auth.admin.creditapp.ca");
      const authCookieNames = authDomainCookies.map((c: any) => c.name);
      logger.warn({ cookieNames, authCookieNames, currentUrl }, "BB worker: appSession/CA_CSRF_TOKEN not on app domain — trying auth domain");
      auth = extractAuthCookies(authDomainCookies);
    }
    if (!auth) {
      // Last resort: use CDP to get all cookies including httpOnly
      try {
        const client = await page.createCDPSession();
        const { cookies: allCookies } = await client.send("Network.getAllCookies");
        const allNames = allCookies.map((c: any) => c.name);
        logger.info({ allCookieCount: allCookies.length, allNames }, "BB worker: all cookies via CDP");
        auth = extractAuthCookies(allCookies);
        if (auth) {
          // Use the full CDP cookie set for persistence
          cookies.length = 0;
          cookies.push(...allCookies);
        }
      } catch (cdpErr) {
        logger.warn({ err: String(cdpErr) }, "BB worker: CDP cookie fallback failed");
      }
    }
    if (!auth) throw new Error("Required auth cookies not found after login");

    // Persist to object storage (shared), DB, and local file
    await saveSessionToStore(cookies);
    await saveCookiesToDb(cookies);
    saveCookiesToFile(cookies);

    return auth;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}

function isLikelyAuthExpiryError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("HTTP 401") || msg.includes("HTTP 403") || msg.includes("session cookies expired");
}

async function callCbbWithAutoReauth(authRef: { current: BbAuthCookies }, vin: string, km: number): Promise<any[]> {
  try {
    return await callCbbEndpoint(authRef.current.appSession, authRef.current.csrfToken, vin, km);
  } catch (err) {
    if (!isLikelyAuthExpiryError(err)) throw err;
    logger.warn({ vin, km, err: String(err) }, "BB worker: auth likely expired mid-run — refreshing session and retrying");
    authRef.current = await getAuthCookies();
    return callCbbEndpoint(authRef.current.appSession, authRef.current.csrfToken, vin, km);
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function launchBrowser(): Promise<any> {
  // Lazy: heavy deps loaded only when browser automation runs
  let puppeteer: any;
  try {
    puppeteer = (await import("puppeteer-extra")).default;
    const Stealth = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(Stealth());
    logger.info("BB worker: using puppeteer-extra + stealth");
  } catch (_) {
    puppeteer = (await import("puppeteer")).default;
    logger.warn("BB worker: stealth not available — using plain puppeteer");
  }

  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process");
    const found = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) { executablePath = found; logger.info({ executablePath }, "BB worker: using system Chromium"); }
  } catch (_) {}

  return puppeteer.launch({
    headless: "new" as any,
    executablePath,
    timeout: 90_000,
    protocolTimeout: 90_000,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-gpu", "--no-zygote", "--disable-blink-features=AutomationControlled",
      "--no-first-run", "--no-default-browser-check", "--disable-infobars",
      "--window-size=1280,900",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function addAntiDetection(page: any): Promise<void> {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8" });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
}

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

async function findSelector(page: any, selectors: string[], timeout = 8000): Promise<any> {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout });
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

async function humanType(page: any, element: any, text: string): Promise<void> {
  await element.click();
  await sleep(rand(80, 200));
  for (const ch of text) {
    await element.type(ch, { delay: 0 });
    await sleep(rand(60, 150));
  }
  await sleep(rand(200, 400));
}

// ---------------------------------------------------------------------------
// Page helpers (mirrored from lenderAuth.ts)
// ---------------------------------------------------------------------------

async function clickLinkByText(page: any, phrases: string[]): Promise<string | null> {
  return page.evaluate((phrases: string[]) => {
    const els = Array.from(document.querySelectorAll("a, button, [role='button'], span[tabindex]"));
    for (const el of els) {
      const t = ((el as HTMLElement).textContent ?? "").toLowerCase().trim();
      if (phrases.some((p) => t.includes(p))) {
        (el as HTMLElement).click();
        return t;
      }
    }
    return null;
  }, phrases);
}

async function getPageText(page: any): Promise<string> {
  return page.evaluate(() => (document.body?.textContent ?? "").toLowerCase());
}

// ---------------------------------------------------------------------------
// 2FA / MFA handling (mirrored from lenderAuth.ts)
// ---------------------------------------------------------------------------

let enrolledTotpSecret: string | null = null;

async function navigateToOtpPage(page: any, startUrl: string): Promise<void> {
  const OTP_METHODS = [
    "one-time password", "otp", "authenticator", "google authenticator",
    "authentication app", "authenticator app", "one time password",
  ];
  const SWITCH_LINKS = [
    "try another method", "try another way", "use another method",
    "other methods", "choose another method",
  ];

  let url = startUrl;

  if (url.includes("mfa-otp-challenge")) {
    logger.info("BB worker: already on OTP challenge page");
    return;
  }

  if (url.includes("mfa-sms-enrollment") || url.includes("mfa-sms-challenge")) {
    logger.info("BB worker: on SMS page — clicking 'try another method'");
    const switched = await clickLinkByText(page, SWITCH_LINKS);
    if (switched) {
      logger.info({ clicked: switched }, "BB worker: clicked switch link");
      await sleep(3000);
      url = page.url() as string;
    }
  }

  if (url.includes("mfa-enroll-options") || url.includes("mfa-login-options")) {
    logger.info("BB worker: on method selection page — selecting OTP/authenticator");
    const pageText = await getPageText(page);
    logger.info({ pageTextSnippet: pageText.substring(0, 400) }, "BB worker: method options page content");

    const otpClicked = await clickLinkByText(page, OTP_METHODS);
    if (otpClicked) {
      logger.info({ clicked: otpClicked }, "BB worker: selected OTP method");
      await sleep(3000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}
    } else {
      const allLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("a, button, [role='button'], li, div[class*='option']"))
          .map((el: Element) => ({
            tag: el.tagName, text: (el as HTMLElement).innerText?.trim().substring(0, 80),
            href: (el as HTMLAnchorElement).href || "",
          }))
          .filter((l: any) => l.text && l.text.length > 0);
      });
      logger.info({ links: allLinks.slice(0, 15) }, "BB worker: clickable elements on options page");
    }
    url = page.url() as string;
    logger.info({ url }, "BB worker: page after selecting OTP method");
  }

  if (url.includes("mfa-otp-enrollment")) {
    logger.info("BB worker: on OTP enrollment page — extracting secret from QR/page");

    let extractedSecret: string | null = null;

    extractedSecret = await page.evaluate(() => {
      const imgs = document.querySelectorAll("img");
      for (const img of imgs) {
        const src = (img as HTMLImageElement).src || "";
        if (src.includes("otpauth") || src.includes("secret=")) {
          const decoded = decodeURIComponent(src);
          const m = decoded.match(/secret=([A-Z2-7]+)/i);
          if (m) return m[1].toUpperCase();
        }
      }
      return null;
    });

    if (extractedSecret) {
      logger.info({ secretLen: extractedSecret.length, method: "qr-img-src" }, "BB worker: extracted TOTP secret");
      enrolledTotpSecret = extractedSecret;
    } else {
      logger.info("BB worker: QR src extraction failed — trying 'trouble scanning?' link");
      const cantScan = await clickLinkByText(page, [
        "can't scan", "trouble scanning", "enter key manually",
        "manual entry", "enter code manually", "having trouble",
        "can not scan", "setup key", "enter this code",
      ]);
      if (cantScan) {
        logger.info({ clicked: cantScan }, "BB worker: clicked 'trouble scanning' link");
        await sleep(2000);
      }

      extractedSecret = await page.evaluate(() => {
        const allText = document.body?.innerText || "";
        const base32Match = allText.match(/[A-Z2-7]{16,}/);
        if (base32Match) return base32Match[0];

        const codeElements = document.querySelectorAll("code, pre, .secret, [data-secret], kbd, samp, tt");
        for (const el of codeElements) {
          const txt = (el as HTMLElement).innerText?.trim();
          if (txt && /^[A-Z2-7]{16,}$/.test(txt)) return txt;
        }
        return null;
      });

      if (extractedSecret) {
        logger.info({ secretLen: extractedSecret.length, method: "trouble-scanning" }, "BB worker: extracted TOTP secret");
        enrolledTotpSecret = extractedSecret;
      } else {
        const pageHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || "");
        logger.warn({ pageHtmlSnippet: pageHtml.substring(0, 800) }, "BB worker: could not extract TOTP secret");
      }
    }
  }
}

async function handle2FA(page: any): Promise<void> {
  await sleep(2000);

  const currentUrl = page.url() as string;
  if (currentUrl.includes("/u/login/password")) {
    logger.info("BB worker: still on password page — not a 2FA prompt, skipping");
    return;
  }

  const pageText = await getPageText(page);
  if (pageText.includes("enter your password") || pageText.includes("wrong password")) {
    logger.info("BB worker: password page detected — skipping 2FA handler");
    return;
  }

  const has2FA = pageText.includes("verify your identity") || pageText.includes("one-time password") ||
                 pageText.includes("authenticator") || pageText.includes("enter the code") ||
                 pageText.includes("verification") || pageText.includes("security code") ||
                 pageText.includes("multi-factor") || pageText.includes("2fa") ||
                 pageText.includes("secure your account") ||
                 currentUrl.includes("mfa-otp-challenge") || currentUrl.includes("mfa-sms-challenge") ||
                 currentUrl.includes("mfa-sms-enrollment") || currentUrl.includes("mfa-otp-enrollment");

  if (!has2FA) {
    // No MFA wall — try the old dismiss approach as a fallback for soft prompts
    const dismissed = await clickLinkByText(page, ["remind me later", "skip", "not now", "maybe later", "do it later"]);
    if (dismissed) logger.info({ dismissed }, "BB worker: 2FA prompt dismissed");
    else logger.info("BB worker: no 2FA prompt detected — skipping");
    return;
  }

  logger.info({ url: currentUrl, pageTextSnippet: pageText.substring(0, 300) }, "BB worker: 2FA prompt detected");

  await navigateToOtpPage(page, currentUrl);

  const activeSecret = enrolledTotpSecret || CREDITAPP_TOTP_SECRET;
  if (activeSecret) {
    const secretSource = enrolledTotpSecret ? "enrollment-extracted" : "env-var";
    const totpCode = generateTOTP(activeSecret);
    logger.info({ codeLength: totpCode.length, secretSource }, "BB worker: TOTP code generated");

    const allInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map((el: HTMLInputElement) => ({
        name: el.name, type: el.type, id: el.id, placeholder: el.placeholder,
        inputMode: el.inputMode, readOnly: el.readOnly, disabled: el.disabled,
        valueLen: el.value.length, visible: el.offsetParent !== null,
        classes: el.className.substring(0, 60),
      }));
    });
    logger.info({ allInputs }, "BB worker: all inputs on page before OTP entry");

    let otpInput = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      for (const el of inputs) {
        if (el.name === "code" && !el.readOnly && !el.disabled && el.offsetParent !== null) return true;
      }
      return false;
    }) ? await page.$('input[name="code"]') : null;

    if (!otpInput) {
      otpInput = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        for (const el of inputs) {
          if (el.inputMode === "numeric" && !el.readOnly && !el.disabled && el.offsetParent !== null && el.value.length === 0) return true;
        }
        return false;
      }) ? await page.$('input[inputmode="numeric"]') : null;
    }

    if (!otpInput) {
      otpInput = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const textInputs = inputs.filter(el =>
          (el.type === "text" || el.type === "tel" || el.type === "number") &&
          !el.readOnly && !el.disabled && el.offsetParent !== null && el.value.length === 0
        );
        return textInputs.length > 0;
      }) ? await page.evaluateHandle(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        return inputs.find(el =>
          (el.type === "text" || el.type === "tel" || el.type === "number") &&
          !el.readOnly && !el.disabled && el.offsetParent !== null && el.value.length === 0
        );
      }) : null;
    }

    if (!otpInput) {
      otpInput = await findSelector(page, [
        'input[name="code"]',
        'input[inputmode="numeric"]',
      ], 10_000);
    }

    if (otpInput) {
      const inputAttrs = await otpInput.evaluate((el: HTMLInputElement) => ({
        name: el.name, type: el.type, id: el.id, valueLen: el.value.length,
        placeholder: el.placeholder, inputMode: el.inputMode,
      }));
      logger.info({ inputAttrs }, "BB worker: selected OTP input element");

      await otpInput.click({ clickCount: 3 }).catch(() => otpInput.focus());
      await sleep(300);
      await page.keyboard.press("Backspace");
      await sleep(200);

      for (const ch of totpCode) {
        await page.keyboard.press(ch);
        await sleep(rand(40, 80));
      }
      await sleep(500);

      const typedLen = await otpInput.evaluate((el: HTMLInputElement) => el.value.length);
      logger.info({ typedLen, expected: 6 }, "BB worker: TOTP code typed");

      if (typedLen !== 6) {
        logger.warn("BB worker: keyboard.press result unexpected — using nativeSet + dispatchEvent");
        await otpInput.evaluate((el: HTMLInputElement, code: string) => {
          const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          nativeSet.call(el, code);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, totpCode);
        await sleep(500);
        const retryLen = await otpInput.evaluate((el: HTMLInputElement) => el.value.length);
        logger.info({ retryLen }, "BB worker: TOTP code set (nativeSet fallback)");
      }

      const submitted = await otpInput.evaluate((el: HTMLInputElement) => {
        const form = el.closest("form");
        if (form) {
          const btn = form.querySelector('button[type="submit"], button[name="action"]') as HTMLButtonElement | null;
          if (btn) { btn.click(); return "form-button"; }
          form.submit();
          return "form-submit";
        }
        return null;
      });

      if (submitted) {
        logger.info({ method: submitted }, "BB worker: TOTP code submitted via same-form method");
      } else {
        const submitBtn = await findSelector(page, ['button[type="submit"]', 'button[name="action"]'], 5_000);
        if (submitBtn) {
          try { await submitBtn.click(); } catch (_) {
            await submitBtn.evaluate((el: HTMLElement) => el.click());
          }
          logger.info("BB worker: TOTP code submitted via global button");
        } else {
          await page.keyboard.press("Enter");
          logger.info("BB worker: TOTP code submitted via Enter");
        }
      }

      await sleep(3000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }); } catch (_) {}
      const postTotpUrl = page.url() as string;
      logger.info({ url: postTotpUrl }, "BB worker: page after TOTP submit");

      if (postTotpUrl.includes("mfa-otp-enrollment")) {
        const errText = await page.evaluate(() => {
          const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"]');
          return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
        });
        logger.warn({ errText }, "BB worker: still on OTP enrollment — code may have been rejected");
      }

      if (postTotpUrl.includes("recovery-code") || postTotpUrl.includes("new-code")) {
        const recoveryText = await getPageText(page);
        logger.info({ pageTextSnippet: recoveryText.substring(0, 300) }, "BB worker: recovery code page detected");

        const checkbox = await page.$('input[type="checkbox"]');
        if (checkbox) {
          await checkbox.click();
          logger.info("BB worker: checked recovery code confirmation checkbox");
          await sleep(1000);
        }

        const formSubmitted = await page.evaluate(() => {
          const forms = document.querySelectorAll("form");
          for (const form of forms) {
            const btn = form.querySelector('button[type="submit"], button[name="action"]') as HTMLButtonElement | null;
            if (btn && !btn.disabled) { btn.click(); return btn.textContent?.trim() || "submit"; }
          }
          return null;
        });
        if (formSubmitted) {
          logger.info({ clicked: formSubmitted }, "BB worker: submitted recovery code form");
        } else {
          const continueBtn = await clickLinkByText(page, ["continue", "done", "next", "i have saved it", "i've saved"]);
          if (continueBtn) logger.info({ clicked: continueBtn }, "BB worker: clicked continue on recovery code page");
        }
        await sleep(3000);
        try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}

        const afterRecoveryUrl = page.url() as string;
        logger.info({ url: afterRecoveryUrl }, "BB worker: page after recovery code");

        if (afterRecoveryUrl.includes("recovery-code")) {
          logger.info("BB worker: still on recovery code page — trying all buttons");
          await page.evaluate(() => {
            const btns = document.querySelectorAll("button");
            for (const btn of btns) {
              if (!btn.disabled && btn.offsetParent !== null) { btn.click(); break; }
            }
          });
          await sleep(3000);
          try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}
          logger.info({ url: page.url() }, "BB worker: page after recovery code retry");
        }
      }

      const afterUrl = page.url() as string;
      if (afterUrl.includes("mfa-sms-enrollment")) {
        logger.info("BB worker: redirected to SMS enrollment after OTP — attempting to skip");
        const skipBtn = await clickLinkByText(page, [
          "skip", "not now", "maybe later", "do it later", "remind me later",
        ]);
        if (skipBtn) {
          logger.info({ clicked: skipBtn }, "BB worker: skipped SMS enrollment");
          await sleep(3000);
          try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}
        }
        logger.info({ url: page.url() }, "BB worker: page after SMS enrollment skip attempt");
      }
    } else {
      logger.error("BB worker: could not find OTP input field");
    }
  } else {
    logger.warn("BB worker: no TOTP secret — cannot handle 2FA automatically");
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function isLoggedIn(page: any): Promise<boolean> {
  try {
    await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(2000);
    const url     = page.url() as string;
    const content = (await page.content() as string).toLowerCase();
    const onAuth  = url.includes("auth0.com") || url.includes("/login");
    const hasDash = content.includes("application") || content.includes("dashboard") || content.includes("deal");
    return !onAuth && hasDash;
  } catch {
    return false;
  }
}

async function loginWithAuth0(page: any): Promise<boolean> {
  logger.info("BB worker: navigating to CreditApp login");
  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  } catch (err: any) {
    logger.error({ err: err.message }, "BB worker: login page navigation failed");
    return false;
  }
  await sleep(2000);

  const loginUrl = page.url() as string;
  logger.info({ url: loginUrl }, "BB worker: login page loaded");

  const emailInput = await findSelector(page, AUTH0_EMAIL_SELECTORS, 12_000);
  if (!emailInput) { logger.error("BB worker: email input not found"); return false; }
  logger.info("BB worker: email input found — typing email");
  await humanType(page, emailInput, CREDITAPP_EMAIL);

  const maybeBtn = await findSelector(page, ['button[type="submit"]'], 2000);
  if (maybeBtn) {
    logger.info("BB worker: clicking continue/submit after email");
    try { await maybeBtn.click(); } catch (_) {
      await maybeBtn.evaluate((el: HTMLElement) => el.click());
    }
    await sleep(3000);
  }

  const passUrl = page.url() as string;
  logger.info({ url: passUrl }, "BB worker: page after email submit");

  const passInput = await findSelector(page, AUTH0_PASS_SELECTORS, 12_000);
  if (!passInput) { logger.error("BB worker: password input not found"); return false; }

  await passInput.click().catch(() => passInput.focus());
  await sleep(500);

  for (const ch of CREDITAPP_PASSWORD) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
    await sleep(rand(40, 80));
  }
  await sleep(1000);

  const typedLen = await passInput.evaluate((el: HTMLInputElement) => el.value.length);
  logger.info({ typedLen, expected: CREDITAPP_PASSWORD.length }, "BB worker: password typed");

  if (typedLen !== CREDITAPP_PASSWORD.length) {
    logger.warn("BB worker: keyboard.press didn't fill — falling back to element.type()");
    await passInput.evaluate((el: HTMLInputElement) => {
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      nativeSet.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(200);
    await passInput.type(CREDITAPP_PASSWORD, { delay: 50 });
    await sleep(500);
  }

  await sleep(500);
  logger.info("BB worker: submitting password via Enter key");
  await page.keyboard.press("Enter");

  logger.info("BB worker: waiting for post-password navigation");
  await sleep(4000);
  try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }); } catch (_) {}
  await sleep(2000);

  const postPasswordUrl = page.url() as string;
  const postPasswordText = await getPageText(page);
  logger.info({ url: postPasswordUrl, textSnippet: postPasswordText.substring(0, 500) }, "BB worker: page state after password submit");

  const stillOnPassword = postPasswordUrl.includes("/u/login/password") || postPasswordText.includes("enter your password");
  if (stillOnPassword) {
    const errorText = await page.evaluate(() => {
      const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"], .ulp-input-error');
      return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
    });
    logger.error({ errorText }, "BB worker: still on password page — checking for error messages");

    logger.info("BB worker: retrying password — select all + retype");
    const passRetry = await findSelector(page, AUTH0_PASS_SELECTORS, 5_000);
    if (passRetry) {
      await passRetry.click({ clickCount: 3 }).catch(() => passRetry.focus());
      await sleep(300);
      await passRetry.type(CREDITAPP_PASSWORD, { delay: 40 });
      await sleep(500);
      await page.keyboard.press("Enter");
      await sleep(5000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }); } catch (_) {}
      await sleep(2000);
      const retryUrl = page.url() as string;
      logger.info({ url: retryUrl }, "BB worker: URL after password retry");
      if (retryUrl.includes("/u/login/password")) {
        const retryErrors = await page.evaluate(() => {
          const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"], .ulp-input-error');
          return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
        });
        logger.error({ retryErrors }, "BB worker: still on password page after retry — login failed");
        return false;
      }
    }
  }

  await handle2FA(page);
  await sleep(3000);

  const postUrl = page.url() as string;
  const postContent = (await page.content() as string).substring(0, 500);
  logger.info({ url: postUrl, contentSnippet: postContent.substring(0, 200) }, "BB worker: page state after 2FA");

  const onAuthDomain = postUrl.includes("auth0.com") || postUrl.includes("auth.admin.creditapp.ca") || postUrl.includes("/login");
  if (onAuthDomain) {
    logger.info("BB worker: still on auth page after 2FA — navigating to CreditApp home");
    try {
      await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (_) {}
    await sleep(3000);
    const redirectedUrl = page.url() as string;
    logger.info({ url: redirectedUrl }, "BB worker: URL after navigating to CreditApp home");

    if (redirectedUrl.includes("mfa-otp-challenge") || redirectedUrl.includes("mfa-sms-challenge") ||
        redirectedUrl.includes("mfa-otp-enrollment") || redirectedUrl.includes("mfa-sms-enrollment")) {
      logger.info("BB worker: redirected to MFA page after nav — handling second 2FA round");
      await handle2FA(page);
      await sleep(3000);

      const post2ndUrl = page.url() as string;
      logger.info({ url: post2ndUrl }, "BB worker: URL after second 2FA round");

      if (post2ndUrl.includes("auth.admin.creditapp.ca")) {
        logger.info("BB worker: still on auth domain after second 2FA — navigating to CreditApp home again");
        try {
          await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
        } catch (_) {}
        await sleep(3000);
        logger.info({ url: page.url() }, "BB worker: URL after second CreditApp nav");
      }
    }
  }

  const ok = await isLoggedIn(page);
  logger.info({ ok }, "BB worker: login result");
  return ok;
}

// ---------------------------------------------------------------------------
// Direct API call — no browser needed after login
// ---------------------------------------------------------------------------

async function callCbbEndpoint(appSession: string, csrfToken: string, vin: string, km: number): Promise<any[]> {
  const resp = await fetch(CBB_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type":           "application/json",
      "accept":                 "*/*",
      "origin":                 "https://admin.creditapp.ca",
      "referer":                "https://admin.creditapp.ca/",
      "x-creditapp-csrf-token": csrfToken,
      "cookie":                 `appSession=${appSession}; CA_CSRF_TOKEN=${csrfToken}`,
      "user-agent":             "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ vin, province: "AB", kilometers: km, frequency: "DEFAULT", kmsperyear: 0 }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`CBB endpoint returned HTTP ${resp.status}`);

  const data = await resp.json();
  if (!Array.isArray(data)) throw new Error(`CBB endpoint returned non-array: ${typeof data}`);
  return data;
}

// ---------------------------------------------------------------------------
// Health check — validates endpoint before processing any VINs
// ---------------------------------------------------------------------------

async function healthCheck(appSession: string, csrfToken: string): Promise<boolean> {
  try {
    const data = await callCbbEndpoint(appSession, csrfToken, HEALTH_CHECK_VIN, HEALTH_CHECK_KM);
    if (!Array.isArray(data) || data.length === 0) {
      logger.warn({ data }, "BB worker: health check — empty or non-array response");
      return false;
    }
    const ok = "adjusted_whole_avg" in data[0] && "uvc" in data[0];
    if (!ok) logger.warn({ keys: Object.keys(data[0]) }, "BB worker: health check — unexpected response structure");
    return ok;
  } catch (err: any) {
    logger.warn({ err: err.message ?? String(err), cause: err.cause?.message }, "BB worker: health check failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// NHTSA — free VIN decode for trim matching
// ---------------------------------------------------------------------------

interface NhtsaInfo {
  trim:         string;
  series:       string;
  bodyClass:    string;
  driveType:    string;
  displacement: string;
  cylinders:    string;
  fuelType:     string;
}

const EMPTY_NHTSA: NhtsaInfo = { trim: "", series: "", bodyClass: "", driveType: "", displacement: "", cylinders: "", fuelType: "" };

const nhtsaCache = new Map<string, NhtsaInfo>();

async function decodeVinNhtsa(vin: string): Promise<NhtsaInfo> {
  const key = vin.toUpperCase();
  const cached = nhtsaCache.get(key);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!resp.ok) return { ...EMPTY_NHTSA };
    const body: any = await resp.json();
    const results: any[] = body?.Results ?? [];
    const get = (variable: string) =>
      (results.find((r) => r.Variable === variable)?.Value ?? "").toString().trim();
    const info: NhtsaInfo = {
      trim:         get("Trim"),
      series:       get("Series"),
      bodyClass:    get("Body Class"),
      driveType:    get("Drive Type"),
      displacement: get("Displacement (L)"),
      cylinders:    get("Engine Number of Cylinders"),
      fuelType:     get("Fuel Type - Primary"),
    };
    nhtsaCache.set(key, info);
    return info;
  } catch {
    return { ...EMPTY_NHTSA };
  }
}

// ---------------------------------------------------------------------------
// Trim matching
// ---------------------------------------------------------------------------

const NOISE_WORDS = new Set([
  "the","and","or","of","in","for","with","a","an","to",
  "2wd","4wd","awd","fwd","rwd","4x4",
  "white","black","silver","grey","gray","red","blue","green",
  "burgundy","brown","gold","beige","orange","yellow","purple",
]);

const MULTI_WORD_MODELS = new Set([
  "grand caravan", "grand cherokee", "grand marquis", "grand prix",
  "grand vitara", "town car", "monte carlo", "land cruiser",
  "rav4", "cr-v", "cx-5", "cx-9", "hr-v", "br-v",
  "e-pace", "f-pace", "f-type", "range rover",
  "model 3", "model s", "model x", "model y",
  "wrangler unlimited", "sierra 1500", "sierra 2500", "sierra 3500",
  "ram 1500", "ram 2500", "ram 3500",
]);

function tokenize(s: string): string[] {
  const tokens: string[] = [];
  const parts = s.toLowerCase().split(/[\s,\-()]+/).filter(Boolean);
  for (const p of parts) {
    if (p.includes("/") && p.length <= 5) {
      tokens.push(p);
    } else if (p.includes("/")) {
      tokens.push(...p.split("/").filter(t => t.length >= 2));
    } else if (p.length >= 2) {
      tokens.push(p);
    }
  }
  return tokens;
}

function trimTokens(vehicleStr: string, make: string, model: string): string[] {
  const all = tokenize(vehicleStr);
  const makeTokens  = tokenize(make || "");
  const modelTokens = tokenize(model || "");
  const skip = new Set([...makeTokens, ...modelTokens]);
  return all.filter(t => !skip.has(t) && !NOISE_WORDS.has(t) && !/^\d{4}$/.test(t) && !/^\d+$/.test(t));
}

function extractMakeModel(vehicleStr: string): { make: string; model: string } {
  const parts = vehicleStr.trim().split(/\s+/);
  const startIdx = (parts.length >= 3 && /^\d{4}$/.test(parts[0])) ? 1 : 0;
  if (startIdx >= parts.length) return { make: "", model: "" };
  const make = parts[startIdx] || "";
  const remaining = parts.slice(startIdx + 1).join(" ").toLowerCase();
  for (const mm of MULTI_WORD_MODELS) {
    if (remaining.startsWith(mm)) {
      return { make, model: mm.toUpperCase().replace(/ /g, " ") };
    }
  }
  return { make, model: parts[startIdx + 1] || "" };
}

function matchBestTrim(vehicleStr: string, nhtsa: NhtsaInfo, options: any[], vin: string): any | null {
  if (!options || options.length === 0) return null;

  if (options.length > 1) {
    logger.info(
      {
        vin,
        vehicle: vehicleStr,
        optionCount: options.length,
        trims: options.map(o => ({
          series: o.series ?? "?",
          style: o.style ?? "?",
          avg: o.adjusted_whole_avg,
        })),
      },
      "BB worker: CBB returned multiple trims — scoring",
    );
  }

  if (options.length === 1) return options[0];

  const { make, model } = extractMakeModel(vehicleStr);
  const vTrimTokens = trimTokens(vehicleStr, make, model);
  const tLower  = nhtsa.trim.toLowerCase();
  const sLower  = nhtsa.series.toLowerCase();
  const nhtsaDrive = nhtsa.driveType.toLowerCase();

  const scored = options.map((opt) => {
    const series    = (opt.series ?? "").toLowerCase().trim();
    const style     = (opt.style ?? "").toLowerCase().trim();
    const seriesTokens = tokenize(series);
    const styleTokens  = tokenize(style);
    let score = 0;

    if (series) {
      if (vTrimTokens.includes(series)) score += 30;
      else if (vTrimTokens.some(t => t === series || series === t)) score += 30;

      for (const st of seriesTokens) {
        if (vTrimTokens.includes(st)) score += 20;
      }

      if (tLower && tLower === series) score += 25;
      else if (tLower && (tLower.includes(series) || series.includes(tLower))) score += 15;

      if (sLower && sLower === series) score += 20;
      else if (sLower && (sLower.includes(series) || series.includes(sLower))) score += 10;
    }

    if (style) {
      for (const st of styleTokens) {
        if (vTrimTokens.includes(st)) score += 10;
        if (tLower && tLower.includes(st)) score += 5;
      }
    }

    const is4wd = /4wd|4x4|4-wheel|awd/i.test(nhtsaDrive) ||
                  vTrimTokens.some(t => ["4wd","4x4","awd"].includes(t));
    const opt4wd = /4wd|4x4|awd|4-wheel/i.test(`${series} ${style}`);
    const opt2wd = /2wd|rwd|fwd/i.test(`${series} ${style}`);
    if (is4wd && opt4wd) score += 5;
    if (is4wd && opt2wd) score -= 5;
    if (!is4wd && opt4wd) score -= 3;

    if (nhtsa.bodyClass) {
      const bc = nhtsa.bodyClass.toLowerCase();
      if (style.includes("crew") && (bc.includes("crew") || vehicleStr.toLowerCase().includes("crew"))) score += 5;
      if (style.includes("supercrew") && vehicleStr.toLowerCase().includes("supercrew")) score += 8;
      if (style.includes("supercab") && vehicleStr.toLowerCase().includes("supercab")) score += 8;
      if (style.includes("regular") && vehicleStr.toLowerCase().includes("regular")) score += 5;
    }

    return { opt, score };
  });

  scored.sort((a, b) => b.score - a.score);

  logger.info(
    {
      vin,
      vTrimTokens,
      nhtsaTrim: tLower || "(none)",
      nhtsaSeries: sLower || "(none)",
      scores: scored.map(s => ({ series: s.opt.series, score: s.score, avg: s.opt.adjusted_whole_avg })),
    },
    "BB worker: trim scoring results",
  );

  if (scored[0].score > 0) {
    logger.info(
      { vin, series: scored[0].opt.series, style: scored[0].opt.style, score: scored[0].score, avg: scored[0].opt.adjusted_whole_avg },
      "BB worker: trim matched by scoring",
    );
    return scored[0].opt;
  }

  const sorted = [...options].sort(
    (a, b) => (a.adjusted_whole_avg ?? 0) - (b.adjusted_whole_avg ?? 0),
  );
  const midIdx   = Math.floor(sorted.length / 2);
  const fallback = sorted[midIdx];
  logger.info(
    {
      vin,
      series: fallback.series,
      avg: fallback.adjusted_whole_avg,
      note: "fallback-median",
      range: `${sorted[0].adjusted_whole_avg}–${sorted[sorted.length - 1].adjusted_whole_avg}`,
    },
    "BB worker: no trim match — using median value",
  );
  return fallback;
}

// ---------------------------------------------------------------------------
// Main batch
// ---------------------------------------------------------------------------

async function runBlackBookBatch(): Promise<{
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  updated: number;
}> {
  const { data: items } = getCacheState();
  if (items.length === 0) throw new Error("Inventory cache is empty — cannot run BB batch");

  // --- Get valid auth cookies (DB → file → browser login) ---
  const authRef = { current: await getAuthCookies() };
  logger.info("BB worker: auth ready — proceeding with API calls");

  // --- Process each VIN ---
  const bbMap = new Map<string, string>();
  const bbDetailMap = new Map<string, { xclean: number; clean: number; avg: number; rough: number }>();
  let succeeded = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const item of items) {
    const { vin, vehicle, km } = item;
    if (!vin || vin.length < 10) continue;

    try {
      const kmInt = parseKm(km);

      const nhtsa = await decodeVinNhtsa(vin);

      const options = await callCbbWithAutoReauth(authRef, vin, kmInt);

      if (options.length === 0) {
        logger.info({ vin }, "BB worker: no options returned (VIN not in CBB)");
        skipped++;
        continue;
      }

      if (!("adjusted_whole_avg" in options[0])) {
        logger.warn({ vin, keys: Object.keys(options[0]) }, "BB worker: unexpected option structure — skipping VIN");
        skipped++;
        continue;
      }

      const best = matchBestTrim(vehicle, nhtsa, options, vin);
      if (!best) { skipped++; continue; }

      const vinKey = vin.toUpperCase();
      bbMap.set(vinKey, String(Math.round(best.adjusted_whole_avg)));

      // Second call with 0 KM to get unadjusted wholesale grades
      await sleep(rand(1000, 2000));
      try {
        const unadjOptions = await callCbbWithAutoReauth(authRef, vin, 0);
        const unadjBest = matchBestTrim(vehicle, nhtsa, unadjOptions, vin);
        if (unadjBest) {
          bbDetailMap.set(vinKey, {
            xclean: Math.round(unadjBest.adjusted_whole_xclean ?? 0),
            clean:  Math.round(unadjBest.adjusted_whole_clean ?? 0),
            avg:    Math.round(unadjBest.adjusted_whole_avg ?? 0),
            rough:  Math.round(unadjBest.adjusted_whole_rough ?? 0),
          });
        }
      } catch (err) {
        logger.warn({ vin, err: String(err) }, "BB worker: unadjusted lookup failed (non-fatal)");
      }

      succeeded++;

      logger.info({ vin, series: best.series, avg: best.adjusted_whole_avg }, "BB worker: VIN processed");

      await sleep(rand(1500, 3000));
    } catch (err) {
      logger.warn({ vin, err: String(err) }, "BB worker: VIN lookup failed — skipping");
      failed++;
    }
  }

  logger.info({ succeeded, skipped, failed, total: items.length }, "BB worker: batch complete");

  let updated = 0;
  if (bbMap.size > 0) {
    await applyBlackBookValues(bbMap, bbDetailMap);
    updated = bbMap.size;

    const valuesRecord: Record<string, any> = {};
    for (const [vin, val] of bbMap) {
      const detail = bbDetailMap.get(vin);
      valuesRecord[vin] = detail
        ? { avg: val, xclean: detail.xclean, clean: detail.clean, average: detail.avg, rough: detail.rough }
        : val;
    }
    await saveBbValuesToStore(valuesRecord);
    logger.info({ count: bbMap.size }, "BB worker: BB values saved to shared object storage");
  }

  return { total: items.length, succeeded, skipped, failed, updated };
}

// ---------------------------------------------------------------------------
// Self-healing retry — bounded; avoids wedging status.running forever
// ---------------------------------------------------------------------------

const PERMANENT_ERROR_PREFIX = "BB worker: session cookies expired in production";
/** Matches runBlackBookBatch() when the in-memory inventory list is empty */
const EMPTY_INVENTORY_MSG = "Inventory cache is empty";
/** Cap transient retries so the worker cannot block all future runs indefinitely */
const MAX_BATCH_ATTEMPTS = 20;

async function runWithRetry(attempt = 1): Promise<{
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  updated: number;
}> {
  return withRetry({
    retries: MAX_BATCH_ATTEMPTS - 1,
    baseDelayMs: 60_000,
    jitterMs: 1000,
    shouldRetry: (error, idx) => {
      const msg = String(error);
      if (msg.includes(PERMANENT_ERROR_PREFIX)) return false;
      if (msg.includes(EMPTY_INVENTORY_MSG)) return false;
      const nextAttempt = idx + 1;
      const waitMin = Math.min(nextAttempt * 5, 30);
      logger.warn({ err: msg, attempt: nextAttempt, waitMin }, "BB worker: run failed — self-healing, will retry");
      return true;
    },
  }, async () => runBlackBookBatch());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runBlackBookWorker(): Promise<void> {
  if (!BB_ENABLED) {
    const err = "BB worker: CREDITAPP_EMAIL or CREDITAPP_PASSWORD not set — skipping";
    status.lastOutcome = "failed";
    status.lastError = err;
    status.lastBatch = null;
    logger.warn(err);
    await updateBbSessionState({
      lastOutcome: "failed",
      lastErrorReason: "PERMISSION_DENIED",
      lastErrorMessage: err,
      consecutiveFailures: 1,
    });
    return;
  }
  if (status.running) {
    logger.warn("BB worker: already running — skipping duplicate trigger");
    return;
  }

  status.running   = true;
  status.startedAt = new Date().toISOString();

  try {
    const batch = await withCircuitBreaker("blackBook", async () => runWithRetry(), { threshold: 3, cooldownMs: 60_000 });
    status.lastRun   = new Date().toISOString();
    status.lastCount = getCacheState().data.filter((i) => !!i.bbAvgWholesale).length;
    status.lastOutcome = batch.failed === 0 && batch.skipped === 0 ? "success" : "partial";
    status.lastError = null;
    status.lastBatch = batch;
    await recordRunDateToDb();
    await updateBbSessionState({
      lastOutcome: status.lastOutcome,
      consecutiveFailures: 0,
    });
  } catch (err) {
    status.lastOutcome = "failed";
    status.lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err: status.lastError }, "BB worker: run failed");
    const reason = isLikelyAuthExpiryError(status.lastError) ? "AUTH_EXPIRED" : "UNKNOWN";
    await recordFailure(new PlatformError({
      subsystem: "blackBook",
      reason,
      recoverability: reason === "AUTH_EXPIRED" ? "needsReauth" : "transient",
      message: status.lastError,
      payload: { where: "runBlackBookWorker" },
    }));
    await updateBbSessionState({
      lastOutcome: "failed",
      lastErrorReason: reason,
      lastErrorMessage: status.lastError,
      consecutiveFailures: 1,
    });
  } finally {
    status.running   = false;
    status.startedAt = null;
  }
  await drainPendingTargetVins("after-full-run");
}

// ---------------------------------------------------------------------------
// Persistent run tracking — stored in DB so restarts and dev/prod don't
// double-fire the same day's run
// ---------------------------------------------------------------------------

async function getLastRunDateFromDb(): Promise<string> {
  try {
    // Lazy: DB only needed for session/schedule bookkeeping
    const { db, bbSessionTable } = await import("@workspace/db");
    const { eq }                 = await import("drizzle-orm");
    const rows = await db.select({ lastRunAt: bbSessionTable.lastRunAt })
      .from(bbSessionTable)
      .where(eq(bbSessionTable.id, "singleton"));
    if (rows.length > 0 && rows[0].lastRunAt) {
      return toMountainDateStr(rows[0].lastRunAt);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not read last run date from DB");
  }
  return "";
}

async function recordRunDateToDb(): Promise<void> {
  try {
    // Lazy: DB only needed for session/schedule bookkeeping
    const { db, bbSessionTable } = await import("@workspace/db");
    await db
      .insert(bbSessionTable)
      .values({ id: "singleton", cookies: "[]", lastRunAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: bbSessionTable.id,
        set:    { lastRunAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not record run date to DB");
  }
}

// ---------------------------------------------------------------------------
// Scheduler — randomized business-hours with DB-persisted run guard
// ---------------------------------------------------------------------------

export function scheduleBlackBookWorker(): void {
  scheduleRandomDaily({
    name: "BB worker",
    hasRunToday: async () => {
      const today = toMountainDateStr();
      const lastRan = await getLastRunDateFromDb();
      return lastRan === today;
    },
    execute: (reason: string) => {
      runBlackBookWorker().catch((err) => logger.error({ err }, "BB worker: scheduled run error"));
    },
  });

  startBlackBookSelfHealLoop();
  logger.info("BB worker scheduled — randomized daily within business hours (Mountain Time)");
}

let bbSelfHealTimer: NodeJS.Timeout | null = null;

function startBlackBookSelfHealLoop(): void {
  if (bbSelfHealTimer) return;

  bbSelfHealTimer = setInterval(() => {
    if (status.running || !BB_ENABLED) return;

    const lastRunAt = status.lastRun ? Date.parse(status.lastRun) : NaN;
    const stale = !Number.isFinite(lastRunAt) || (Date.now() - lastRunAt) >= BB_SELF_HEAL_STALE_MS;
    const failedRecently = status.lastOutcome === "failed";
    const authError = isLikelyAuthExpiryError(status.lastError ?? "");

    if (!(stale || failedRecently || authError)) return;

    const reason = stale
      ? "stale-last-run"
      : authError
        ? "auth-error-recovery"
        : "failed-run-recovery";
    logger.warn({ reason }, "BB worker: self-heal watchdog triggering recovery run");
    runBlackBookWorker().catch((err) => logger.error({ err, reason }, "BB worker: self-heal run failed"));
  }, BB_SELF_HEAL_INTERVAL_MS);

  logger.info(
    { intervalMin: env.BB_SELF_HEAL_INTERVAL_MIN, staleHours: env.BB_SELF_HEAL_STALE_HOURS },
    "BB worker: self-heal watchdog enabled",
  );
}

// ---------------------------------------------------------------------------
// Targeted processing — run BB for a specific list of VINs (new-unit detection)
// ---------------------------------------------------------------------------

export async function runBlackBookForVins(targetVins: string[]): Promise<void> {
  const normalizedTargets = [...new Set(targetVins.map((v) => v.trim().toUpperCase()).filter(Boolean))];
  if (normalizedTargets.length === 0) return;

  if (!BB_ENABLED) {
    logger.info("BB worker (targeted): CREDITAPP_EMAIL or CREDITAPP_PASSWORD not set — skipping");
    return;
  }
  if (status.running) {
    enqueueTargetVins(normalizedTargets);
    logger.warn("BB worker (targeted): batch already running — skipping");
    return;
  }

  const { data: items } = getCacheState();
  const targetSet = new Set(normalizedTargets);
  const targetItems = items.filter(i => targetSet.has(i.vin.toUpperCase()));

  if (targetItems.length === 0) {
    logger.info({ vins: normalizedTargets }, "BB worker (targeted): no matching items in cache — skipping");
    return;
  }

  status.running   = true;
  status.startedAt = new Date().toISOString();
  logger.info({ count: targetItems.length }, "BB worker (targeted): processing new VINs");

  try {
    const authRef = { current: await getAuthCookies() };

    const bbMap = new Map<string, string>();
    const bbDetailMap = new Map<string, { xclean: number; clean: number; avg: number; rough: number }>();
    let succeeded = 0, skipped = 0, failed = 0;

    for (const item of targetItems) {
      const { vin, vehicle, km } = item;
      if (!vin || vin.length < 10) continue;

      try {
        const kmInt = parseKm(km);
        const nhtsa = await decodeVinNhtsa(vin);
        const options = await callCbbWithAutoReauth(authRef, vin, kmInt);

        if (options.length === 0) { skipped++; continue; }
        if (!("adjusted_whole_avg" in options[0])) { skipped++; continue; }

        const best = matchBestTrim(vehicle, nhtsa, options, vin);
        if (!best) { skipped++; continue; }

        const vinKey = vin.toUpperCase();
        bbMap.set(vinKey, String(Math.round(best.adjusted_whole_avg)));

        await sleep(rand(1000, 2000));
        try {
          const unadjOptions = await callCbbWithAutoReauth(authRef, vin, 0);
          const unadjBest = matchBestTrim(vehicle, nhtsa, unadjOptions, vin);
          if (unadjBest) {
            bbDetailMap.set(vinKey, {
              xclean: Math.round(unadjBest.adjusted_whole_xclean ?? 0),
              clean:  Math.round(unadjBest.adjusted_whole_clean ?? 0),
              avg:    Math.round(unadjBest.adjusted_whole_avg ?? 0),
              rough:  Math.round(unadjBest.adjusted_whole_rough ?? 0),
            });
          }
        } catch (err) {
          logger.warn({ vin, err: String(err) }, "BB worker (targeted): unadjusted lookup failed (non-fatal)");
        }

        succeeded++;
        logger.info({ vin, series: best.series, avg: best.adjusted_whole_avg }, "BB worker (targeted): VIN processed");
        await sleep(rand(1500, 3000));
      } catch (err) {
        logger.warn({ vin, err: String(err) }, "BB worker (targeted): VIN lookup failed — skipping");
        failed++;
      }
    }

    logger.info({ succeeded, skipped, failed, total: targetItems.length }, "BB worker (targeted): batch complete");

    if (bbMap.size > 0) {
      await applyBlackBookValues(bbMap, bbDetailMap);
      const valuesRecord: Record<string, any> = {};
      for (const [vin, val] of bbMap) {
        const detail = bbDetailMap.get(vin);
        valuesRecord[vin] = detail
          ? { avg: val, xclean: detail.xclean, clean: detail.clean, average: detail.avg, rough: detail.rough }
          : val;
      }
      await saveBbValuesToStore(valuesRecord);
      logger.info({ count: bbMap.size }, "BB worker (targeted): BB values saved to shared object storage");
    }
  } catch (err) {
    logger.error({ err }, "BB worker (targeted): run failed");
  } finally {
    status.running   = false;
    status.startedAt = null;
  }
  await drainPendingTargetVins("after-targeted-run");
}

```

### `artifacts/api-server/src/lib/carfaxWorker.ts` (1290 lines)

```typescript
/**
 * Carfax Cloud Worker
 *
 * Runs daily at a random time during business hours (Mountain Time).
 * Modelled on the proven desktop script — uses the dealer portal VIN search
 * at dealer.carfax.ca/MyReports, hides automation detection, and saves the
 * login session to disk so login only happens once.
 *
 * REQUIRED ENVIRONMENT VARIABLES:
 *   APPS_SCRIPT_WEB_APP_URL  — deployed Apps Script web app URL
 *   CARFAX_EMAIL             — Carfax Canada dealer login email
 *   CARFAX_PASSWORD          — Carfax Canada dealer login password
 *   CARFAX_ENABLED           — set to "true" to activate
 */

import { logger } from "./logger.js";
import { env } from "./env.js";
import { scheduleRandomDaily, toMountainDateStr } from "./randomScheduler.js";
import { loadCarfaxRunsFromStore, saveCarfaxRunsToStore } from "./bbObjectStore.js";
import * as fs   from "fs";
import * as path from "path";
import { PlatformError } from "./platformError.js";
import { recordFailure, updateCarfaxSessionState, recordIncident } from "./incidentService.js";
import { withRetry } from "./selfHeal/withRetry.js";
import { withCircuitBreaker } from "./selfHeal/circuitBreaker.js";

const APPS_SCRIPT_URL = env.APPS_SCRIPT_WEB_APP_URL;
const CARFAX_EMAIL    = env.CARFAX_EMAIL;
const CARFAX_PASSWORD = env.CARFAX_PASSWORD;
const CARFAX_ENABLED  = env.CARFAX_ENABLED;

// Per-session profile picked at browser launch — keeps a single run consistent
// (UA, viewport, headers all match) while varying across runs to look human.
interface SessionProfile {
  chromeMajor:  number;
  chromeFull:   string;
  viewportW:    number;
  viewportH:    number;
  userAgent:    string;
  acceptLang:   string;
}

function pickSessionProfile(): SessionProfile {
  const versions = [
    { major: 124, full: "124.0.6367.60" },
    { major: 125, full: "125.0.6422.60" },
    { major: 126, full: "126.0.6478.114" },
  ];
  const v = versions[Math.floor(Math.random() * versions.length)];
  const widthVariants  = [1280, 1366, 1440, 1536];
  const heightVariants = [800, 864, 900, 960];
  const viewportW = widthVariants[Math.floor(Math.random() * widthVariants.length)] +
    Math.floor((Math.random() * 30) - 15);
  const viewportH = heightVariants[Math.floor(Math.random() * heightVariants.length)] +
    Math.floor((Math.random() * 30) - 15);
  const acceptLangs = [
    "en-CA,en-US;q=0.9,en;q=0.8,fr;q=0.7",
    "en-CA,en;q=0.9,en-US;q=0.8,fr-CA;q=0.7",
    "en-US,en-CA;q=0.9,en;q=0.8",
  ];
  return {
    chromeMajor: v.major,
    chromeFull:  v.full,
    viewportW,
    viewportH,
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v.major}.0.0.0 Safari/537.36`,
    acceptLang: acceptLangs[Math.floor(Math.random() * acceptLangs.length)],
  };
}

// Picked once per worker run; consumed by launchBrowser + addAntiDetectionScripts.
let activeProfile: SessionProfile | null = null;

// Dealer portal URLs — same as the desktop script
const CARFAX_HOME      = "https://dealer.carfax.ca/";
const CARFAX_LOGIN_URL = "https://dealer.carfax.ca/login";
const CARFAX_VHR_URL   = "https://dealer.carfax.ca/MyReports";

// Session cookies saved to disk so login persists between server restarts
const SESSION_FILE = path.join(process.cwd(), ".carfax-session.json");

// Selectors — mirrors the desktop script exactly
const VIN_SEARCH_SELECTORS = [
  "input.searchVehicle",
  "input.searchbox.searchVehicle",
  'input[placeholder*="VIN"]',
  "input[type=\"search\"]",
];

const REPORT_LINK_SELECTORS = [
  "a.reportLink",
  'a[href*="cfm/display_cfm"]',
  'a[href*="vhr"]',
  'a[href*="/cfm/"]',
];

const GLOBAL_ARCHIVE_SELECTORS = [
  "label#global-archive",
  "input#globalreports",
];

// Auth0 login selectors (dealer.carfax.ca uses Auth0)
const AUTH0_EMAIL_SELECTORS    = ["#username", 'input[name="username"]', 'input[type="email"]'];
const AUTH0_PASSWORD_SELECTORS = ["#password", 'input[name="password"]', 'input[type="password"]'];

export interface CarfaxTestResult {
  vin:    string;
  status: "found" | "not_found" | "error" | "captcha";
  url?:   string;
  error?: string;
}

interface PendingVin {
  rowIndex: number;
  vin:      string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function humanDelay(base: number): Promise<void> {
  return sleep(base + rand(0, 1000));
}

// ---------------------------------------------------------------------------
// Apps Script communication
// ---------------------------------------------------------------------------

async function fetchPendingVins(): Promise<PendingVin[]> {
  if (!APPS_SCRIPT_URL) {
    logger.warn("APPS_SCRIPT_WEB_APP_URL not configured");
    return [];
  }
  let retries = 3;
  while (retries > 0) {
    try {
      const resp = await fetch(APPS_SCRIPT_URL, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as PendingVin[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      retries--;
      if (retries === 0) {
        logger.error({ err }, "Carfax worker: failed to fetch pending VINs after 3 attempts");
        return [];
      }
      logger.warn({ err, retriesLeft: retries }, "Carfax worker: fetch failed, retrying in 2s");
      await sleep(2_000);
    }
  }
  return [];
}

async function writeCarfaxResult(rowIndex: number, value: string, batchComplete = false): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  let retries = 3;
  while (retries > 0) {
    try {
      await fetch(APPS_SCRIPT_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rowIndex, value, batchComplete }),
        signal:  AbortSignal.timeout(15_000),
      });
      return;
    } catch (err) {
      retries--;
      if (retries === 0) {
        logger.error({ err, rowIndex, value }, "Carfax worker: failed to write result after 3 attempts");
      } else {
        await sleep(1_000);
      }
    }
  }
}

async function sendAlert(message: string): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "notify", message }),
    });
  } catch (_) { /* silent */ }
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

function loadSavedCookies(): any[] {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, "utf8");
      const cookies = JSON.parse(raw);
      logger.info({ count: cookies.length, file: SESSION_FILE }, "Carfax worker: loaded saved session cookies");
      return cookies;
    }
  } catch (_) { /* ignore corrupt file */ }
  return [];
}

function saveCookies(cookies: any[]): void {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2), "utf8");
    logger.info({ count: cookies.length }, "Carfax worker: session cookies saved to disk");
  } catch (err) {
    logger.warn({ err }, "Carfax worker: could not save session cookies");
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function launchBrowser(): Promise<any> {
  // Lazy: heavy deps loaded only when browser automation runs
  let puppeteer: any;
  try {
    puppeteer = (await import("puppeteer-extra")).default;
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(StealthPlugin());
    logger.info("Carfax worker: using puppeteer-extra with stealth plugin");
  } catch (_) {
    // Fallback to plain puppeteer if extra not available
    logger.warn("Carfax worker: puppeteer-extra not available, falling back to plain puppeteer");
    try {
      puppeteer = (await import("puppeteer")).default;
    } catch (__) {
      throw new Error("puppeteer not installed");
    }
  }

  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process"); // Lazy: heavy deps loaded only when browser automation runs
    const found = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) {
      executablePath = found;
      logger.info({ executablePath }, "Carfax worker: using system Chromium");
    }
  } catch (_) { /* use bundled */ }

  const profile = activeProfile ?? pickSessionProfile();
  activeProfile = profile;
  logger.info(
    {
      chromeMajor: profile.chromeMajor,
      viewportW:   profile.viewportW,
      viewportH:   profile.viewportH,
    },
    "Carfax worker: launching browser with session profile",
  );

  const browser = await puppeteer.launch({
    headless: "new" as any,
    executablePath,
    timeout: 90_000,           // give Chromium 90s to start (default 30s causes crashes under load)
    protocolTimeout: 90_000,   // same for CDP protocol handshake
    defaultViewport: { width: profile.viewportW, height: profile.viewportH },
    args: [
      // Required for Replit/Linux container environments
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      // Anti-detection
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--disable-extensions-except=",
      "--disable-plugins-discovery",
      `--window-size=${profile.viewportW},${profile.viewportH}`,
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  return browser;
}

async function addAntiDetectionScripts(page: any): Promise<void> {
  const profile = activeProfile ?? pickSessionProfile();
  activeProfile = profile;

  await page.setUserAgent(profile.userAgent);

  // Realistic HTTP headers — every request looks like real Chrome on Windows
  await page.setExtraHTTPHeaders({
    "Accept-Language":           profile.acceptLang,
    "Accept-Encoding":           "gzip, deflate, br",
    "Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Sec-Fetch-Site":            "none",
    "Sec-Fetch-Mode":            "navigate",
    "Sec-Fetch-User":            "?1",
    "Sec-Fetch-Dest":            "document",
    "Sec-Ch-Ua":                 `"Google Chrome";v="${profile.chromeMajor}", "Chromium";v="${profile.chromeMajor}", "Not-A.Brand";v="99"`,
    "Sec-Ch-Ua-Mobile":          "?0",
    "Sec-Ch-Ua-Platform":        '"Windows"',
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control":             "max-age=0",
  });

  await page.setCacheEnabled(true);

  // Runs before any page script — covers all fingerprinting vectors.
  // Profile values injected so navigator.userAgentData matches the UA header.
  const fingerprint = {
    chromeMajor: profile.chromeMajor,
    chromeFull:  profile.chromeFull,
    viewportW:   profile.viewportW,
    viewportH:   profile.viewportH,
  };
  await page.evaluateOnNewDocument((fp: typeof fingerprint) => {
    // 1. navigator.webdriver — primary automation flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // 2. window.chrome — real Chrome has a rich object with callable methods
    (window as any).chrome = {
      runtime: {
        connect:       () => {},
        sendMessage:   () => {},
        onMessage:     { addListener: () => {}, removeListener: () => {} },
      },
      loadTimes: () => {},
      csi:       () => {},
      app:       {},
    };

    // 3. navigator.userAgentData — Chrome 90+ API; missing = instant bot flag.
    // Brand version MUST match Sec-Ch-Ua HTTP header set on requests above.
    Object.defineProperty(navigator, "userAgentData", {
      get: () => ({
        brands: [
          { brand: "Google Chrome", version: String(fp.chromeMajor) },
          { brand: "Chromium",      version: String(fp.chromeMajor) },
          { brand: "Not-A.Brand",   version: "99"  },
        ],
        mobile:   false,
        platform: "Windows",
        getHighEntropyValues: async (_hints: string[]) => ({
          brands: [
            { brand: "Google Chrome", version: String(fp.chromeMajor) },
            { brand: "Chromium",      version: String(fp.chromeMajor) },
            { brand: "Not-A.Brand",   version: "99"  },
          ],
          mobile:          false,
          platform:        "Windows",
          platformVersion: "10.0.0",
          architecture:    "x86",
          bitness:         "64",
          model:           "",
          uaFullVersion:   fp.chromeFull,
          fullVersionList: [
            { brand: "Google Chrome", version: fp.chromeFull },
            { brand: "Chromium",      version: fp.chromeFull },
            { brand: "Not-A.Brand",   version: "99.0.0.0"      },
          ],
        }),
      }),
    });

    // 4. navigator.plugins — headless has 0; real Chrome has several
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer",              description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client",     filename: "internal-nacl-plugin",             description: "" },
        ];
        return Object.assign(plugins, {
          item:      (i: number) => plugins[i],
          namedItem: (n: string) => plugins.find(p => p.name === n) || null,
          refresh:   () => {},
          length:    plugins.length,
        });
      },
    });

    // 5. navigator.mimeTypes
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => {
        const types = [
          { type: "application/pdf",               description: "Portable Document Format", suffixes: "pdf" },
          { type: "application/x-google-chrome-pdf", description: "Portable Document Format", suffixes: "pdf" },
        ];
        return Object.assign(types, {
          item:      (i: number) => types[i],
          namedItem: (n: string) => types.find(t => t.type === n) || null,
          length:    types.length,
        });
      },
    });

    // 6. navigator.languages
    Object.defineProperty(navigator, "languages", { get: () => ["en-CA", "en-US", "en", "fr-CA"] });
    Object.defineProperty(navigator, "language",  { get: () => "en-CA" });

    // 7. Hardware profile — server CPUs/memory differ from a desktop
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory",        { get: () => 8 });

    // 8. Network connection — headless exposes server connection
    Object.defineProperty(navigator, "connection", {
      get: () => ({
        effectiveType:    "4g",
        rtt:              50 + Math.floor(Math.random() * 50),
        downlink:         5 + Math.random() * 5,
        saveData:         false,
        addEventListener:    () => {},
        removeEventListener: () => {},
        dispatchEvent:       () => true,
      }),
    });

    // 9. Screen dimensions — derived from session profile to match viewport
    Object.defineProperty(screen, "width",       { get: () => fp.viewportW });
    Object.defineProperty(screen, "height",      { get: () => fp.viewportH });
    Object.defineProperty(screen, "availWidth",  { get: () => fp.viewportW });
    Object.defineProperty(screen, "availHeight", { get: () => fp.viewportH - 40 });
    Object.defineProperty(screen, "colorDepth",  { get: () => 24 });
    Object.defineProperty(screen, "pixelDepth",  { get: () => 24 });
    Object.defineProperty(window, "outerWidth",  { get: () => fp.viewportW });
    Object.defineProperty(window, "outerHeight", { get: () => fp.viewportH });

    // 10. Canvas fingerprint noise — each run produces a unique fingerprint
    const _origToDataURL   = HTMLCanvasElement.prototype.toDataURL;
    const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const noise = () => Math.floor(Math.random() * 3) - 1; // -1, 0, or +1

    HTMLCanvasElement.prototype.toDataURL = function(...args: any[]) {
      const ctx = this.getContext("2d");
      if (ctx) {
        const img = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i]   += noise();
          img.data[i+1] += noise();
          img.data[i+2] += noise();
        }
        ctx.putImageData(img, 0, 0);
      }
      return _origToDataURL.apply(this, args);
    };

    CanvasRenderingContext2D.prototype.getImageData = function(...args: any[]) {
      const img = _origGetImageData.apply(this, args);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i]   += noise();
        img.data[i+1] += noise();
        img.data[i+2] += noise();
      }
      return img;
    };

    // 11. Permissions API
    const _origQuery = window.navigator.permissions?.query.bind(navigator.permissions);
    if (_origQuery) {
      (navigator.permissions as any).query = (parameters: any) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: "denied" } as PermissionStatus)
          : _origQuery(parameters);
    }
  }, fingerprint);
}

async function findSelector(page: any, selectors: string[], timeout = 5000): Promise<any> {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout });
      if (el) return el;
    } catch (_) { /* try next */ }
  }
  return null;
}

// Human-like mouse movement and click
async function humanClick(page: any, element: any): Promise<void> {
  const box = await element.boundingBox();
  if (!box) { await element.click(); return; }
  const tx = box.x + rand(Math.floor(box.width * 0.2),  Math.floor(box.width * 0.8));
  const ty = box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8));
  const sx = rand(100, 900);
  const sy = rand(100, 600);
  const steps = rand(12, 22);
  for (let i = 0; i <= steps; i++) {
    const t    = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await page.mouse.move(
      sx + (tx - sx) * ease + rand(-3, 3),
      sy + (ty - sy) * ease + rand(-3, 3),
    );
    await sleep(rand(8, 22));
  }
  await sleep(rand(60, 180));
  await page.mouse.click(tx, ty);
}

async function humanType(page: any, element: any, text: string): Promise<void> {
  await element.click();
  await sleep(rand(80, 200));
  for (let i = 0; i < text.length; i++) {
    await element.type(text[i], { delay: 0 });
    let d = rand(60, 160);
    if (i > 0 && i % rand(4, 7) === 0) d += rand(150, 400);
    await sleep(d);
  }
  await sleep(rand(200, 500));
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function isLoggedIn(page: any): Promise<boolean> {
  try {
    await page.goto(CARFAX_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (navErr: any) {
    logger.warn({ err: navErr.message }, "Carfax worker: isLoggedIn navigation timed out — treating as not logged in");
    return false;
  }
  await humanDelay(1500);
  const content = (await page.content()).toLowerCase();
  return (
    content.includes("sign out")   ||
    content.includes("log out")    ||
    content.includes("my account") ||
    content.includes("my carfax")  ||
    content.includes("my vhrs")
  );
}

async function loginWithAuth0(page: any): Promise<boolean> {
  logger.info("Carfax worker: navigating to Auth0 login page");
  try {
    await page.goto(CARFAX_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (navErr: any) {
    logger.error({ err: navErr.message }, "Carfax worker: login page navigation timed out — cannot log in");
    return false;
  }
  await humanDelay(1500);

  const emailInput = await findSelector(page, AUTH0_EMAIL_SELECTORS, 10_000);
  if (!emailInput) {
    logger.error("Carfax worker: could not find email/username input on login page");
    return false;
  }
  await humanClick(page, emailInput);
  await humanType(page, emailInput, CARFAX_EMAIL);

  const passInput = await findSelector(page, AUTH0_PASSWORD_SELECTORS, 5_000);
  if (!passInput) {
    logger.error("Carfax worker: could not find password input on login page");
    return false;
  }
  await humanClick(page, passInput);
  await humanType(page, passInput, CARFAX_PASSWORD);

  const submitBtn = await findSelector(page, ['button[type="submit"]'], 5_000);
  if (submitBtn) {
    await humanClick(page, submitBtn);
    await humanDelay(3000);
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
    await humanDelay(2000);
  }

  const confirmed = await isLoggedIn(page);
  if (confirmed) {
    const cookies = await page.cookies();
    saveCookies(cookies);
    logger.info("Carfax worker: login successful — session saved");
  } else {
    logger.error("Carfax worker: login failed — still not authenticated after submit");
  }
  return confirmed;
}

// Try saved cookies first, fall back to full login
async function ensureLoggedIn(browser: any, page: any): Promise<boolean> {
  const savedCookies = loadSavedCookies();
  if (savedCookies.length > 0) {
    logger.info("Carfax worker: restoring saved session cookies");
    await page.setCookie(...savedCookies);
    const loggedIn = await isLoggedIn(page);
    if (loggedIn) {
      logger.info("Carfax worker: session restored — already logged in");
      return true;
    }
    logger.info("Carfax worker: saved session expired — performing fresh login");
  }
  return loginWithAuth0(page);
}

// ---------------------------------------------------------------------------
// VIN lookup — uses dealer portal search, same as desktop script
// ---------------------------------------------------------------------------

function isValidReportHref(href: string | null): boolean {
  if (!href) return false;
  const h = href.trim();
  // Reject placeholders, fragments-only, javascript links, empty
  if (!h || h === "#" || h.startsWith("javascript:") || h === "about:blank") return false;
  return true;
}

async function getRawHref(el: any): Promise<string | null> {
  // Use getAttribute for raw HTML value — mirrors original Playwright getAttribute behaviour
  // Avoids Puppeteer's getProperty('href') which resolves relative/fragment URLs into full URLs
  try {
    return await el.evaluate((a: Element) => a.getAttribute("href"));
  } catch (_) { return null; }
}

async function findReportLink(page: any): Promise<string | null> {
  for (const sel of REPORT_LINK_SELECTORS) {
    try {
      // visible:true mirrors Playwright's default — skips hidden template/placeholder elements
      const el = await page.$(sel + ":not([style*='display: none']):not([style*='display:none'])");
      if (el) {
        const visible = await el.evaluate((e: Element) => {
          const s = window.getComputedStyle(e);
          return s.display !== "none" && s.visibility !== "hidden" && (e as HTMLElement).offsetParent !== null;
        }).catch(() => false);
        if (!visible) continue;

        const href = await getRawHref(el);
        if (isValidReportHref(href)) {
          let resolved = href!;
          if (resolved.startsWith("/")) resolved = "https://dealer.carfax.ca" + resolved;
          return resolved;
        }
      }
    } catch (_) { /* try next */ }
  }
  // Fallback: scan all visible links for known report URL patterns
  try {
    const links = await page.$$("a[href]");
    for (const link of links) {
      const href = await getRawHref(link);
      if (!isValidReportHref(href)) continue;
      const h = href!;
      if (
        h.includes("cfm/display_cfm") ||
        h.includes("cfm/vhr") ||
        h.includes("vehicle-history") ||
        h.includes("vhr.carfax.ca") ||
        h.includes("carfax.ca/cfm")
      ) {
        return h.startsWith("/") ? "https://dealer.carfax.ca" + h : h;
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

// Force-clears an input regardless of framework state and types VIN cleanly.
// Avoids the humanType() bug where a single click after triple-click deselects
// the selection and causes the new VIN to be appended to the previous one.
async function clearAndTypeVin(page: any, element: any, vin: string): Promise<void> {
  await element.evaluate((el: HTMLInputElement) => {
    el.focus();
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    nativeSet.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(rand(120, 220));

  const residual = await element.evaluate((el: HTMLInputElement) => el.value).catch(() => "");
  if (residual && residual.length > 0) {
    await element.click();
    await sleep(rand(60, 120));
    for (let i = 0; i < residual.length + 5; i++) {
      await page.keyboard.press("Backspace");
    }
    await sleep(rand(120, 220));
  }

  for (const ch of vin) {
    await element.type(ch, { delay: 0 });
    await sleep(rand(45, 110));
  }
  await sleep(rand(300, 600));

  const typed = await element.evaluate((el: HTMLInputElement) => el.value).catch(() => "");
  if (typed.trim().toUpperCase() !== vin.toUpperCase()) {
    logger.warn(
      { vin, actual: typed, len: typed.length },
      "Carfax worker: search input mismatch after typing — forcing native value set",
    );
    await element.evaluate((el: HTMLInputElement, v: string) => {
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      nativeSet.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, vin);
    await sleep(rand(300, 500));
  }
}

// Detects captcha/anti-bot challenge pages so we abort safely instead of
// silently looping with an "error" status for every VIN.
async function detectChallengePage(page: any): Promise<boolean> {
  try {
    const text = await page.evaluate(() => (document.body?.innerText ?? "").toLowerCase()).catch(() => "");
    if (!text) return false;
    const triggers = [
      "are you a robot",
      "verify you are human",
      "verify you're human",
      "i'm not a robot",
      "captcha",
      "unusual activity",
      "security challenge",
      "access denied",
    ];
    return triggers.some((t) => text.includes(t));
  } catch {
    return false;
  }
}

// Brief human-like idle: short scroll + read pause. Occasionally a longer
// "interruption" pause so cadence between VINs varies the way a real user does.
async function humanIdleBetweenVins(page: any): Promise<void> {
  if (Math.random() > 0.4) {
    try {
      await page.mouse.wheel({ deltaY: rand(50, 220) * (Math.random() > 0.5 ? 1 : -1) });
    } catch (_) { /* viewport may be busy mid-AJAX */ }
    await sleep(rand(400, 900));
  }
  if (Math.random() < 0.2) {
    const pause = rand(15_000, 30_000);
    logger.info({ pauseMs: pause }, "Carfax worker: simulating user-interruption pause");
    await sleep(pause);
  } else {
    await sleep(rand(4_000, 9_000));
  }
}

// Some Carfax report URLs do not contain the VIN (opaque report ids).
// Only flag a mismatch when the URL clearly references a DIFFERENT VIN.
function reportUrlMatchesVin(url: string, vin: string): boolean {
  if (!url) return false;
  const upperUrl = url.toUpperCase();
  const upperVin = vin.toUpperCase();
  if (upperUrl.includes(upperVin)) return true;
  const matches = url.match(/[A-HJ-NPR-Z0-9]{17}/gi);
  if (!matches || matches.length === 0) return true;
  return matches.some((m) => m.toUpperCase() === upperVin);
}

async function lookupVinOnDealerPortal(
  page:    any,
  vin:     string,
): Promise<{ status: "found" | "not_found" | "session_expired" | "captcha" | "error"; url?: string }> {
  try {
    logger.info({ vin }, "Carfax worker: navigating to dealer VHR page");
    try {
      await page.goto(CARFAX_VHR_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (navErr: any) {
      logger.warn({ vin, err: navErr?.message }, "Carfax worker: VHR navigation failed — retrying once");
      await sleep(2_000);
      await page.goto(CARFAX_VHR_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await humanDelay(2000);

    // Check if session expired mid-run
    const currentUrl: string = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("signin")) {
      logger.warn({ vin }, "Carfax worker: redirected to login mid-batch — session expired");
      return { status: "session_expired" };
    }

    if (await detectChallengePage(page)) {
      logger.warn({ vin, currentUrl }, "Carfax worker: anti-bot challenge detected — aborting batch");
      return { status: "captcha" };
    }

    const searchInput = await findSelector(page, VIN_SEARCH_SELECTORS, 8_000);
    if (!searchInput) {
      logger.error({ vin }, "Carfax worker: could not find VIN search input on dealer portal");
      return { status: "error" };
    }

    await clearAndTypeVin(page, searchInput, vin);

    // Human scroll after typing — gives any debounced AJAX search time to fire.
    await page.mouse.wheel({ deltaY: rand(60, 220) * (Math.random() > 0.3 ? 1 : -1) });
    await sleep(rand(300, 700));
    if (Math.random() > 0.6) {
      await page.mouse.wheel({ deltaY: -rand(20, 80) });
      await sleep(rand(200, 400));
    }

    let found = false;
    try {
      await page.waitForSelector("a.reportLink", { visible: true, timeout: 12_000 });
      found = true;
    } catch (_) { found = false; }

    if (found) {
      const link = await findReportLink(page);
      if (link && reportUrlMatchesVin(link, vin)) {
        logger.info({ vin, url: link }, "Carfax worker: found in My VHRs ✓");
        return { status: "found", url: link };
      }
      if (link) {
        logger.warn(
          { vin, link },
          "Carfax worker: My VHRs link did not match VIN — treating as stale, falling back to archive",
        );
      }
    }

    logger.info({ vin }, "Carfax worker: not in My VHRs — trying Global Archive");
    const archiveToggle = await findSelector(page, GLOBAL_ARCHIVE_SELECTORS, 5_000);
    if (!archiveToggle) {
      logger.info({ vin }, "Carfax worker: no Global Archive toggle found — not found");
      return { status: "not_found" };
    }

    await humanClick(page, archiveToggle);
    let found2 = false;
    try {
      await page.waitForSelector("a.reportLink", { visible: true, timeout: 8_000 });
      found2 = true;
    } catch (_) { found2 = false; }

    if (found2) {
      const link2 = await findReportLink(page);
      if (link2 && reportUrlMatchesVin(link2, vin)) {
        logger.info({ vin, url: link2 }, "Carfax worker: found in Global Archive ✓");
        return { status: "found", url: link2 };
      }
      if (link2) {
        logger.warn(
          { vin, link: link2 },
          "Carfax worker: archive link did not match VIN — discarding as stale",
        );
      }
    }

    logger.info({ vin }, "Carfax worker: VIN not found in Carfax");
    return { status: "not_found" };
  } catch (err: any) {
    logger.error({ vin, err }, "Carfax worker: VIN lookup error");
    return { status: "error" };
  }
}

// ---------------------------------------------------------------------------
// Public: run against real pending VINs from Apps Script
// ---------------------------------------------------------------------------
let batchRunning = false;
let batchStartedAt: Date | null = null;

export function getCarfaxBatchStatus(): { running: boolean; startedAt: string | null } {
  return { running: batchRunning, startedAt: batchStartedAt?.toISOString() ?? null };
}

export async function runCarfaxWorker(opts: { force?: boolean } = {}): Promise<boolean> {
  if (batchRunning) {
    logger.warn("Carfax worker: batch already in progress — skipping duplicate trigger");
    return false;
  }

  logger.info("Carfax worker: starting run");

  if (!opts.force && !CARFAX_ENABLED) {
    logger.info("Carfax worker: DISABLED (set CARFAX_ENABLED=true to activate)");
    return false;
  }
  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    logger.warn("Carfax worker: CARFAX_EMAIL or CARFAX_PASSWORD not set — skipping");
    await sendAlert("Carfax worker could not run: credentials not set in Replit secrets.");
    await updateCarfaxSessionState({
      lastOutcome: "failed",
      lastErrorReason: "PERMISSION_DENIED",
      lastErrorMessage: "Missing CARFAX_EMAIL/CARFAX_PASSWORD",
      consecutiveFailures: 1,
    });
    return false;
  }

  batchRunning   = true;
  batchStartedAt = new Date();

  const rawPending = await withCircuitBreaker(
    "carfax",
    async () => withRetry({ retries: 2, baseDelayMs: 2_000, jitterMs: 500 }, () => fetchPendingVins()),
    { threshold: 3, cooldownMs: 60_000 },
  );
  if (rawPending.length === 0) {
    logger.info("Carfax worker: no pending VINs — nothing to do");
    batchRunning = false; batchStartedAt = null;
    await updateCarfaxSessionState({ lastOutcome: "partial", consecutiveFailures: 0 });
    return true;
  }

  const { getCacheState } = await import("./inventoryCache.js");
  const cache = getCacheState();
  const pendingVins = rawPending.filter(({ vin }) => {
    const item = cache.data.find(i => i.vin.toUpperCase() === vin.toUpperCase());
    if (item) {
      const url = item.carfax?.trim();
      if (url && url.startsWith("http")) {
        logger.info({ vin }, "Carfax worker: skipping VIN — already has Carfax URL in cache");
        return false;
      }
    }
    return true;
  });

  if (pendingVins.length === 0) {
    logger.info({ originalCount: rawPending.length }, "Carfax worker: all pending VINs already have URLs — nothing to do");
    batchRunning = false; batchStartedAt = null;
    await updateCarfaxSessionState({ lastOutcome: "partial", consecutiveFailures: 0 });
    return true;
  }
  logger.info({ count: pendingVins.length, skipped: rawPending.length - pendingVins.length }, "Carfax worker: fetched pending VINs (after skip-if-has-URL filter)");

  let browser: any = null;
  let processed = 0, succeeded = 0, notFound = 0, failed = 0;
  const carfaxResults = new Map<string, string>();

  try {
    // Retry browser launch up to 3 times — Chromium occasionally times out under container load
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        browser = await launchBrowser();
        break;
      } catch (launchErr: any) {
        logger.warn({ attempt, err: String(launchErr) }, "Carfax worker: browser launch attempt failed");
        if (attempt === 3) throw launchErr;
        await sleep(10_000 * attempt); // 10s, 20s back-off
      }
    }
    const page = await browser.newPage();
    await addAntiDetectionScripts(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      await sendAlert("Carfax worker login failed. Check credentials.");
      return false;
    }

    let aborted = false;
    for (const { rowIndex, vin } of pendingVins) {
      logger.info(
        { vin, rowIndex, processed: processed + 1, total: pendingVins.length },
        "Carfax worker: processing VIN",
      );

      let result = await lookupVinOnDealerPortal(page, vin);

      if (result.status === "captcha") {
        logger.warn("Carfax worker: anti-bot challenge — aborting batch to avoid escalation");
        await sendAlert("Carfax worker hit an anti-bot challenge and stopped early.");
        await recordIncident({
          subsystem: "carfax",
          reason: "CAPTCHA",
          recoverability: "transient",
          message: "Anti-bot challenge detected during run",
          payload: { vin },
        });
        aborted = true;
        break;
      }

      if (result.status === "session_expired") {
        logger.info("Carfax worker: re-logging in after session expiry");
        await recordIncident({
          subsystem: "carfax",
          reason: "AUTH_EXPIRED",
          recoverability: "needsReauth",
          message: "Carfax session expired mid-batch",
          payload: { vin },
        });
        const relogged = await loginWithAuth0(page);
        if (!relogged) { failed++; processed++; continue; }
        result = await lookupVinOnDealerPortal(page, vin);
        if (result.status === "captcha") {
          await sendAlert("Carfax worker hit an anti-bot challenge after re-login and stopped early.");
          aborted = true;
          break;
        }
      }

      // One in-batch retry for transient errors (network blips, slow renders)
      if (result.status === "error") {
        logger.info({ vin }, "Carfax worker: transient error — retrying once");
        await sleep(rand(2_500, 5_000));
        result = await lookupVinOnDealerPortal(page, vin);
        if (result.status === "captcha") {
          await sendAlert("Carfax worker hit an anti-bot challenge during retry and stopped early.");
          aborted = true;
          break;
        }
      }

      if (result.status === "found" && result.url) {
        await writeCarfaxResult(rowIndex, result.url);
        carfaxResults.set(vin.toUpperCase(), result.url);
        succeeded++;
      } else if (result.status === "not_found") {
        await writeCarfaxResult(rowIndex, "NOT FOUND");
        carfaxResults.set(vin.toUpperCase(), "NOT FOUND");
        notFound++;
      } else {
        failed++;
      }

      processed++;
      await humanIdleBetweenVins(page);
    }

    if (processed > 0) await writeCarfaxResult(0, "", true);
    if (carfaxResults.size > 0) {
      const { applyCarfaxResults } = await import("./inventoryCache.js");
      await applyCarfaxResults(carfaxResults);
    }

    if (aborted) {
      logger.warn({ processed, succeeded, notFound, failed }, "Carfax worker: run aborted early");
    }

  } catch (err) {
    logger.error({ err }, "Carfax worker: unexpected crash");
    await sendAlert("Carfax worker crashed: " + String(err));
    await recordFailure(new PlatformError({
      subsystem: "carfax",
      reason: "UNKNOWN",
      recoverability: "transient",
      message: String(err),
      payload: { where: "runCarfaxWorker" },
    }));
    await updateCarfaxSessionState({
      lastOutcome: "failed",
      lastErrorReason: "UNKNOWN",
      lastErrorMessage: String(err),
      consecutiveFailures: 1,
    });
    return false;
  } finally {
    if (browser) await browser.close();
    batchRunning   = false;
    batchStartedAt = null;
    activeProfile  = null;
  }

  logger.info({ processed, succeeded, notFound, failed }, "Carfax worker: run complete");
  const success = failed === 0;
  await updateCarfaxSessionState({
    lastOutcome: success ? "success" : "partial",
    consecutiveFailures: success ? 0 : 1,
    lastErrorReason: success ? null : "UNKNOWN",
    lastErrorMessage: success ? null : `${failed} failed rows in latest batch`,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Public: test with specific VINs — no Apps Script writes
// ---------------------------------------------------------------------------
export async function runCarfaxWorkerForVins(vins: string[]): Promise<CarfaxTestResult[]> {
  const results: CarfaxTestResult[] = [];
  logger.info({ vins }, "Carfax test run: starting");

  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    return vins.map((vin) => ({ vin, status: "error" as const, error: "Missing CARFAX_EMAIL / CARFAX_PASSWORD" }));
  }

  let browser: any = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await addAntiDetectionScripts(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      return vins.map((vin) => ({ vin, status: "error" as const, error: "Login failed" }));
    }

    for (const vin of vins) {
      logger.info({ vin }, "Carfax test run: looking up VIN");
      const result = await lookupVinOnDealerPortal(page, vin);

      if (result.status === "found" && result.url) {
        results.push({ vin, status: "found", url: result.url });
      } else if (result.status === "not_found") {
        results.push({ vin, status: "not_found" });
      } else if (result.status === "captcha") {
        results.push({ vin, status: "captcha", error: "Anti-bot challenge presented" });
      } else if (result.status === "session_expired") {
        results.push({ vin, status: "error", error: "Session expired during test" });
      } else {
        results.push({ vin, status: "error", error: "Lookup error" });
      }

      await humanDelay(rand(2_000, 4_000));
    }
  } catch (err: any) {
    logger.error({ err }, "Carfax test run: crash");
    const remaining = vins.filter((v) => !results.find((r) => r.vin === v));
    for (const vin of remaining) results.push({ vin, status: "error", error: err.message });
  } finally {
    if (browser) await browser.close();
  }

  logger.info({ results }, "Carfax test run: complete");
  return results;
}

// ---------------------------------------------------------------------------
// Scheduler — randomized business-hours with object-storage run guard so
// restarts cannot double-fire the worker on the same day.
// ---------------------------------------------------------------------------
export function scheduleCarfaxWorker(): void {
  let memoryLastRunDate = "";

  scheduleRandomDaily({
    name: "Carfax worker",
    hasRunToday: async () => {
      const today = toMountainDateStr();
      if (memoryLastRunDate === today) return true;
      try {
        const blob = await loadCarfaxRunsFromStore();
        if (blob?.lastRunDate === today) {
          memoryLastRunDate = today;
          return true;
        }
      } catch (err) {
        logger.warn({ err: String(err) }, "Carfax worker: could not read run history (treating as not run today)");
      }
      return false;
    },
    execute: (reason: string) => {
      logger.info({ reason }, "Carfax worker: triggering run");
      runCarfaxWorker()
        .then(async (ok) => {
          if (!ok) return;
          const today = toMountainDateStr();
          memoryLastRunDate = today;
          await saveCarfaxRunsToStore(today);
        })
        .catch((err) => logger.error({ err }, "Carfax worker: run error"));
    },
  });

  logger.info("Carfax cloud worker scheduled — randomized daily within business hours (Mountain Time)");
}

// ---------------------------------------------------------------------------
// Targeted Carfax lookup for specific new VINs (skips VINs with existing URLs)
// ---------------------------------------------------------------------------
export async function runCarfaxForNewVins(vins: string[]): Promise<void> {
  if (!CARFAX_ENABLED) {
    logger.info("Carfax worker (targeted): CARFAX_ENABLED is not true — skipping");
    return;
  }
  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    logger.warn("Carfax worker (targeted): credentials not set — skipping");
    return;
  }
  if (batchRunning) {
    logger.warn("Carfax worker (targeted): batch already in progress — skipping");
    return;
  }

  const { getCacheState } = await import("./inventoryCache.js");
  const cache = getCacheState();
  const filteredVins = vins.filter(vin => {
    const item = cache.data.find(i => i.vin.toUpperCase() === vin.toUpperCase());
    if (!item) return true;
    const url = item.carfax?.trim();
    if (url && url.startsWith("http")) {
      logger.info({ vin }, "Carfax worker (targeted): skipping VIN — already has Carfax URL");
      return false;
    }
    return true;
  });

  if (filteredVins.length === 0) {
    logger.info("Carfax worker (targeted): all VINs already have Carfax URLs — nothing to do");
    return;
  }

  logger.info({ count: filteredVins.length, vins: filteredVins }, "Carfax worker (targeted): processing new VINs");

  batchRunning   = true;
  batchStartedAt = new Date();
  let browser: any = null;
  let processed = 0, succeeded = 0, notFound = 0, failed = 0;
  const carfaxResults = new Map<string, string>();

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        browser = await launchBrowser();
        break;
      } catch (launchErr: any) {
        logger.warn({ attempt, err: String(launchErr) }, "Carfax worker (targeted): browser launch attempt failed");
        if (attempt === 3) throw launchErr;
        await sleep(10_000 * attempt);
      }
    }
    const page = await browser.newPage();
    await addAntiDetectionScripts(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      logger.warn("Carfax worker (targeted): login failed — aborting");
      return;
    }

    let aborted = false;
    for (const vin of filteredVins) {
      logger.info(
        { vin, processed: processed + 1, total: filteredVins.length },
        "Carfax worker (targeted): processing VIN",
      );

      let result = await lookupVinOnDealerPortal(page, vin);

      if (result.status === "captcha") {
        logger.warn("Carfax worker (targeted): anti-bot challenge — aborting");
        aborted = true;
        break;
      }

      if (result.status === "session_expired") {
        logger.info("Carfax worker (targeted): re-logging in after session expiry");
        const relogged = await loginWithAuth0(page);
        if (!relogged) { failed++; processed++; continue; }
        result = await lookupVinOnDealerPortal(page, vin);
        if (result.status === "captcha") { aborted = true; break; }
      }

      if (result.status === "error") {
        logger.info({ vin }, "Carfax worker (targeted): transient error — retrying once");
        await sleep(rand(2_500, 5_000));
        result = await lookupVinOnDealerPortal(page, vin);
        if (result.status === "captcha") { aborted = true; break; }
      }

      if (result.status === "found" && result.url) {
        carfaxResults.set(vin.toUpperCase(), result.url);
        succeeded++;
      } else if (result.status === "not_found") {
        carfaxResults.set(vin.toUpperCase(), "NOT FOUND");
        notFound++;
      } else {
        failed++;
      }

      processed++;
      await humanIdleBetweenVins(page);
    }

    if (carfaxResults.size > 0) {
      const { applyCarfaxResults } = await import("./inventoryCache.js");
      await applyCarfaxResults(carfaxResults);
    }

    if (aborted) {
      logger.warn({ processed, succeeded, notFound, failed }, "Carfax worker (targeted): run aborted early");
    }
  } catch (err) {
    logger.error({ err }, "Carfax worker (targeted): unexpected crash");
  } finally {
    if (browser) await browser.close();
    batchRunning   = false;
    batchStartedAt = null;
    activeProfile  = null;
  }

  logger.info({ processed, succeeded, notFound, failed }, "Carfax worker (targeted): run complete");
}

```

### `artifacts/api-server/src/routes/carfax.ts` (51 lines)

```typescript
import { Router } from "express";
import { requireOwner } from "../lib/auth.js";
import { runCarfaxWorkerForVins, runCarfaxWorker, getCarfaxBatchStatus } from "../lib/carfaxWorker.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/carfax/batch-status", requireOwner, (_req, res) => {
  res.json(getCarfaxBatchStatus());
});

router.post("/carfax/run-batch", requireOwner, (req, res) => {
  const status = getCarfaxBatchStatus();
  if (status.running) {
    res.status(409).json({ ok: false, error: "A batch is already running", startedAt: status.startedAt });
    return;
  }
  logger.info({ requestedBy: req.user?.email }, "Manual Carfax batch triggered via API");
  runCarfaxWorker({ force: true }).catch((err) =>
    logger.error({ err }, "Manual Carfax batch failed")
  );
  res.json({ ok: true, message: "Carfax batch started. Check server logs for progress." });
});

router.post("/carfax/test", requireOwner, async (req, res) => {
  const { vins } = req.body as { vins?: string[] };

  if (!Array.isArray(vins) || vins.length === 0) {
    res.status(400).json({ error: "Provide an array of VINs in the request body: { vins: [...] }" });
    return;
  }

  if (vins.length > 10) {
    res.status(400).json({ error: "Maximum 10 VINs per test run" });
    return;
  }

  const cleanVins = vins.map((v) => String(v).trim().toUpperCase()).filter(Boolean);
  logger.info({ vins: cleanVins, requestedBy: req.user?.email }, "Carfax test run requested via API");

  try {
    const results = await runCarfaxWorkerForVins(cleanVins);
    res.json({ ok: true, results });
  } catch (err) {
    logger.error({ err }, "Carfax test endpoint error");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;

```

### `artifacts/api-server/src/scripts/testCarfax.ts` (36 lines)

```typescript
/**
 * Quick Carfax test — run directly with:
 *   npx tsx src/scripts/testCarfax.ts 2C4RC1ZG7RR152266 5YFB4MDE3PP000858
 */
import { runCarfaxWorkerForVins } from "../lib/carfaxWorker.js";

const vins = process.argv.slice(2);

if (vins.length === 0) {
  console.error("Usage: npx tsx src/scripts/testCarfax.ts <VIN1> <VIN2> ...");
  process.exit(1);
}

console.log(`\nRunning Carfax test on ${vins.length} VIN(s): ${vins.join(", ")}\n`);

runCarfaxWorkerForVins(vins).then((results) => {
  console.log("\n========== RESULTS ==========");
  for (const r of results) {
    if (r.status === "found") {
      console.log(`✓ ${r.vin} — FOUND`);
      console.log(`  URL: ${r.url}`);
    } else if (r.status === "not_found") {
      console.log(`✗ ${r.vin} — NOT FOUND in Carfax`);
    } else if (r.status === "captcha") {
      console.log(`! ${r.vin} — CAPTCHA blocked`);
    } else {
      console.log(`✗ ${r.vin} — ERROR: ${r.error}`);
    }
  }
  console.log("=============================\n");
  process.exit(0);
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

```

---

<a id="ops-self-heal"></a>
## 11b. API server — ops, incidents, self-heal & code repair

*20 file(s).*

### `artifacts/api-server/src/lib/backupScheduler.ts` (62 lines)

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger.js";
import { sendOpsAlert } from "./emailService.js";

const execFileAsync = promisify(execFile);

const TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 min hard cap per script

/**
 * Spawn a pnpm scripts target as a child process. We invoke pnpm rather than
 * importing the script module directly because the backup scripts shell out to
 * pg_dump/psql via execFile and need a clean process per run for proper stdout
 * buffering and signal handling.
 */
async function runScriptsTask(name: string, target: string): Promise<{ ok: boolean; error?: string; stdout?: string; stderr?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["--filter", "@workspace/scripts", target],
      { timeout: TASK_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 50 },
    );
    logger.info({ task: name, target, stdout: stdout.slice(-2000) }, `Backup task ${name} completed`);
    return { ok: true, stdout, stderr };
  } catch (err: any) {
    logger.error({ task: name, target, err: err?.message ?? String(err) }, `Backup task ${name} failed`);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function runNightlyBackupTasks(): Promise<void> {
  logger.info("Backup scheduler: nightly backup task triggered");

  const dbResult = await runScriptsTask("backup:db", "backup:db");
  const blobsResult = await runScriptsTask("backup:blobs", "backup:blobs");
  const rotateResult = await runScriptsTask("backup:rotate", "backup:rotate");

  const failed = [dbResult, blobsResult, rotateResult].filter((r) => !r.ok);
  if (failed.length > 0) {
    await sendOpsAlert(
      "critical",
      "Nightly backup failed",
      `<p>One or more nightly backup tasks failed.</p><ul>${[
        ["backup:db", dbResult],
        ["backup:blobs", blobsResult],
        ["backup:rotate", rotateResult],
      ]
        .map(([name, r]) => `<li><strong>${name}</strong>: ${(r as any).ok ? "ok" : (r as any).error}</li>`)
        .join("")}</ul>`,
    );
  }
}

export async function runQuarterlyReminderTasks(): Promise<void> {
  logger.info("Backup scheduler: quarterly reminder task triggered");
  // Quarterly reminder dispatching is owned by scripts/src/quarterly-reminders.ts
  // and scripts/src/dr-drill.ts (run via cron / manual). The in-server scheduler
  // only logs that the daily pass occurred so there is a heartbeat in /ops/incidents
  // when wired by the operator. No-op by design until quarterly automation is
  // expanded (see post-4b-review-advisory: deferred items B7/S1).
}

```

### `artifacts/api-server/src/lib/codeRepair/allowlist.ts` (45 lines)

```typescript
export const TIER_A_ALLOWLIST = {
  "artifacts/api-server/src/lib/typesense.ts": [
    "probeFieldCandidates",
    "probeSelectorCandidates",
    "imageDelimiterList",
  ],
  "artifacts/api-server/src/lib/inventoryCache.ts": [
    "inventoryFeedColumnAliasMap",
  ],
  "artifacts/api-server/src/lib/blackBookWorker.ts": [
    "AUTH0_EMAIL_SELECTORS",
    "AUTH0_PASS_SELECTORS",
  ],
  "artifacts/api-server/src/lib/carfaxWorker.ts": [
    "VIN_SEARCH_SELECTORS",
    "REPORT_LINK_SELECTORS",
    "GLOBAL_ARCHIVE_SELECTORS",
    "AUTH0_EMAIL_SELECTORS",
    "AUTH0_PASSWORD_SELECTORS",
  ],
  "artifacts/api-server/src/lib/lenderAuth.ts": [
    "AUTH0_EMAIL_SELECTORS",
    "AUTH0_PASSWORD_SELECTORS",
  ],
} as const;

export const REFUSED_DANGEROUS_CORE_PREFIXES = [
  "artifacts/api-server/src/lib/lenderCalcEngine.ts",
  "artifacts/api-server/src/lib/auth.ts",
  "artifacts/api-server/src/lib/roleFilter.ts",
  "artifacts/api-server/src/lib/env.ts",
  "lib/db/src/schema/",
  "artifacts/api-server/src/routes/lender/",
  "lib/api-spec/",
];

export function isTierAPath(filePath: string): boolean {
  return Object.hasOwn(TIER_A_ALLOWLIST, filePath);
}

export function isDangerousCorePath(filePath: string): boolean {
  return REFUSED_DANGEROUS_CORE_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}


```

### `artifacts/api-server/src/lib/codeRepair/generator.ts` (60 lines)

```typescript
import { isDangerousCorePath, isTierAPath } from "./allowlist.js";
import type { RepairPatchResult, RepairRequest } from "./templates.js";
import { sendOpsAlert } from "../emailService.js";
import { recordIncident } from "../incidentService.js";
import { env } from "../env.js";

/**
 * Classify a repair request as Tier-A (auto-merge eligible), Tier-2 (draft PR),
 * or refused (dangerous core).
 *
 * Until env.SELF_HEAL_GATE_ACTIVE is true, every result is forced to draft.
 * This is the "graduation" gate: Phase 5a CI gate must be live and verified
 * before any patch can be titled [self-heal-automerge]. See the post-4b
 * advisory and docs/self-heal.md for the activation contract.
 */
export async function evaluateRepairRequest(request: RepairRequest): Promise<RepairPatchResult> {
  if (isDangerousCorePath(request.filePath)) {
    await recordIncident({
      subsystem: "selfHeal",
      reason: "PATCH_REFUSED_DANGEROUS_CORE",
      recoverability: "needsCodeRepair",
      message: `Self-heal patch refused for dangerous-core path ${request.filePath}`,
      payload: { request },
    });
    await sendOpsAlert(
      "critical",
      "Self-heal refused dangerous-core patch",
      `<p>Template: <code>${request.template}</code></p><p>Path: <code>${request.filePath}</code></p><p>Target symbol: <code>${request.targetSymbol}</code></p>`,
    );
    return {
      title: `[self-heal-draft] ${request.template}: refused dangerous core`,
      body: `Patch refused for dangerous-core path: ${request.filePath}`,
      isTierA: false,
      isRefused: true,
      reason: "PATCH_REFUSED_DANGEROUS_CORE",
    };
  }

  const tierAEligible = isTierAPath(request.filePath);
  const gateActive = env.SELF_HEAL_GATE_ACTIVE === true;
  const tierA = tierAEligible && gateActive;
  const prefix = tierA ? "[self-heal-automerge]" : "[self-heal-draft]";
  const gateNote = tierAEligible && !gateActive
    ? "\nForced draft mode: SELF_HEAL_GATE_ACTIVE is not true."
    : "";
  return {
    title: `${prefix} ${request.template}: ${request.targetSymbol}`,
    body: [
      `Template: ${request.template}`,
      `Target file: ${request.filePath}`,
      `Target symbol: ${request.targetSymbol}`,
      `Candidate: ${request.candidate}`,
      `Tier A eligible: ${tierAEligible ? "yes" : "no"}`,
      `Auto-merge enabled: ${tierA ? "yes" : "no"}${gateNote}`,
    ].join("\n"),
    isTierA: tierA,
    isRefused: false,
  };
}

```

### `artifacts/api-server/src/lib/codeRepair/invariants.ts` (105 lines)

```typescript
export interface FieldInvariant {
  validate: (value: unknown) => boolean;
  description: string;
}

export const FIELD_INVARIANTS: Record<string, FieldInvariant> = {
  location: {
    validate: (value) => typeof value === "string",
    description: "Location should be a string.",
  },
  vehicle: {
    validate: (value) => typeof value === "string",
    description: "Vehicle descriptor should be a string.",
  },
  vin: {
    validate: (value) => typeof value === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(value.trim()),
    description: "VIN must be 17 alphanumeric characters (excluding I/O/Q).",
  },
  onlinePrice: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return Number.isFinite(parsed) && parsed > 0 && parsed < 500000;
    },
    description: "Online price must parse as positive currency under 500k.",
  },
  price: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return Number.isFinite(parsed) && parsed >= 0 && parsed < 500000;
    },
    description: "Price must parse as non-negative currency under 500k.",
  },
  km: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
      return Number.isFinite(parsed) && parsed >= 0 && parsed < 2_000_000;
    },
    description: "KM must parse as non-negative integer under 2 million.",
  },
  matrixPrice: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return Number.isFinite(parsed) || String(value ?? "").trim() === "";
    },
    description: "Matrix price is numeric or empty.",
  },
  cost: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return Number.isFinite(parsed) || String(value ?? "").trim() === "";
    },
    description: "Cost is numeric or empty.",
  },
  hasPhotos: {
    validate: (value) => typeof value === "boolean",
    description: "hasPhotos must be boolean.",
  },
  bbAvgWholesale: {
    validate: (value) => value === undefined || value === null || typeof value === "string",
    description: "BB average wholesale is optional string.",
  },
  bbValues: {
    validate: (value) => value === undefined || value === null || typeof value === "object",
    description: "bbValues is optional object.",
  },
  xclean: {
    validate: (value) => Number.isFinite(Number(value)),
    description: "bbValues.xclean must be numeric.",
  },
  clean: {
    validate: (value) => Number.isFinite(Number(value)),
    description: "bbValues.clean must be numeric.",
  },
  avg: {
    validate: (value) => Number.isFinite(Number(value)),
    description: "bbValues.avg must be numeric.",
  },
  rough: {
    validate: (value) => Number.isFinite(Number(value)),
    description: "bbValues.rough must be numeric.",
  },
  year: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").trim());
      return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2035;
    },
    description: "Year must be integer between 1900 and 2035.",
  },
  website: {
    validate: (value) => typeof value === "string" && (value.startsWith("http") || value === "NOT FOUND" || value === ""),
    description: "Website field should be URL, NOT FOUND, or empty.",
  },
  carfax: {
    validate: (value) => typeof value === "string" && (value.startsWith("http") || value === "NOT FOUND" || value === ""),
    description: "Carfax field should be URL, NOT FOUND, or empty.",
  },
};

export function validateInvariant(field: string, value: unknown): boolean {
  const invariant = FIELD_INVARIANTS[field];
  if (!invariant) return true;
  return invariant.validate(value);
}


```

### `artifacts/api-server/src/lib/codeRepair/templates.ts` (18 lines)

```typescript
export type RepairTemplate = "addFieldCandidate" | "addSelector" | "addColumnAlias";

export interface RepairRequest {
  template: RepairTemplate;
  filePath: string;
  targetSymbol: string;
  candidate: string;
}

export interface RepairPatchResult {
  title: string;
  body: string;
  isTierA: boolean;
  isRefused: boolean;
  reason?: string;
}


```

### `artifacts/api-server/src/lib/incidentService.ts` (237 lines)

```typescript
import {
  db,
  incidentLogTable,
  bbSessionTable,
  lenderSessionTable,
  carfaxSessionTable,
  deadLetterQueueTable,
  selfHealFlagsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { PlatformError, PlatformReason, PlatformRecoverability, PlatformSubsystem } from "./platformError.js";
import { logger } from "./logger.js";
import { saveSelfHealFlagToStore } from "./bbObjectStore.js";

const KEEP_REASONS: PlatformReason[] = [
  "SCHEMA_DRIFT",
  "PATCH_REFUSED_DANGEROUS_CORE",
  "SELF_HEAL_RATE_LIMITED",
  "AUTOMERGE_ROLLBACK",
  "AUTOMERGE_ROLLBACK_CONFLICT",
];

export async function recordIncident(input: {
  subsystem: PlatformSubsystem;
  reason: PlatformReason;
  recoverability: PlatformRecoverability;
  message: string;
  payload?: Record<string, unknown> | null;
}): Promise<number | null> {
  try {
    const [row] = await db.insert(incidentLogTable).values({
      subsystem: input.subsystem,
      reason: input.reason,
      recoverability: input.recoverability,
      message: input.message,
      payload: input.payload ?? null,
    }).returning({ id: incidentLogTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.warn({ err: String(err), input }, "incident_log insert failed");
    return null;
  }
}

export async function recordFailure(err: PlatformError): Promise<number | null> {
  logger.failure(err);
  return recordIncident({
    subsystem: err.subsystem,
    reason: err.reason,
    recoverability: err.recoverability,
    message: err.message,
    payload: err.payload,
  });
}

export async function pruneIncidentLog(now = new Date()): Promise<number> {
  const transientBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(incidentLogTable)
    .where(and(
      eq(incidentLogTable.recoverability, "transient"),
      lt(incidentLogTable.createdAt, transientBefore),
      notInArray(incidentLogTable.reason, KEEP_REASONS),
    ))
    .returning({ id: incidentLogTable.id });

  const total = await db.select({ count: sql<number>`count(*)::int` }).from(incidentLogTable);
  const count = total[0]?.count ?? 0;
  if (count > 100000) {
    const overflow = count - 100000;
    const oldRows = await db.select({ id: incidentLogTable.id })
      .from(incidentLogTable)
      .where(and(
        eq(incidentLogTable.recoverability, "transient"),
        notInArray(incidentLogTable.reason, KEEP_REASONS),
      ))
      .orderBy(incidentLogTable.createdAt)
      .limit(overflow);

    if (oldRows.length > 0) {
      const ids = oldRows.map((r) => r.id);
      await db.delete(incidentLogTable).where(inArray(incidentLogTable.id, ids));
    }
  }

  if (deleted.length > 0) {
    await recordIncident({
      subsystem: "ops",
      reason: "INCIDENT_LOG_PRUNED",
      recoverability: "transient",
      message: `Pruned ${deleted.length} transient incidents`,
      payload: { prunedCount: deleted.length },
    });
  }
  return deleted.length;
}

export async function listIncidents(opts: { includeTransients?: boolean; limit?: number; offset?: number }) {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  if (opts.includeTransients) {
    return db.select().from(incidentLogTable).orderBy(desc(incidentLogTable.createdAt)).limit(limit).offset(offset);
  }
  return db.select().from(incidentLogTable)
    .where(sql`${incidentLogTable.recoverability} <> 'transient'`)
    .orderBy(desc(incidentLogTable.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function enqueueDeadLetter(input: {
  subsystem: PlatformSubsystem;
  reason: PlatformReason;
  payload: Record<string, unknown>;
}) {
  try {
    await db.insert(deadLetterQueueTable).values({
      subsystem: input.subsystem,
      reason: input.reason,
      payload: input.payload,
    });
  } catch (err) {
    logger.warn({ err: String(err), input }, "dead_letter_queue insert failed");
  }
}

type SessionStateInput = {
  lastOutcome: "success" | "partial" | "failed";
  lastErrorReason?: string | null;
  lastErrorMessage?: string | null;
  consecutiveFailures: number;
};

export async function updateBbSessionState(input: SessionStateInput) {
  try {
    await db.update(bbSessionTable)
      .set({
        lastOutcome: input.lastOutcome,
        lastErrorReason: input.lastErrorReason ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastErrorAt: input.lastErrorReason ? new Date() : null,
        consecutiveFailures: input.consecutiveFailures,
        updatedAt: new Date(),
      })
      .where(eq(bbSessionTable.id, "singleton"));
  } catch (err) {
    logger.warn({ err: String(err), input }, "bb_session state update failed");
  }
}

export async function updateLenderSessionState(input: SessionStateInput) {
  try {
    await db.update(lenderSessionTable)
      .set({
        lastOutcome: input.lastOutcome,
        lastErrorReason: input.lastErrorReason ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastErrorAt: input.lastErrorReason ? new Date() : null,
        consecutiveFailures: input.consecutiveFailures,
        updatedAt: new Date(),
      })
      .where(eq(lenderSessionTable.id, "singleton"));
  } catch (err) {
    logger.warn({ err: String(err), input }, "lender_session state update failed");
  }
}

export async function updateCarfaxSessionState(input: SessionStateInput) {
  try {
    const now = new Date();
    const row = {
      id: "singleton",
      updatedAt: now,
      lastOutcome: input.lastOutcome,
      lastErrorReason: input.lastErrorReason ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
      lastErrorAt: input.lastErrorReason ? now : null,
      consecutiveFailures: input.consecutiveFailures,
    };
    await db.insert(carfaxSessionTable).values(row).onConflictDoUpdate({
      target: carfaxSessionTable.id,
      set: row,
    });
  } catch (err) {
    logger.warn({ err: String(err), input }, "carfax_session state update failed");
  }
}

export async function setSelfHealFlag(input: {
  patchId: string;
  subsystem: PlatformSubsystem;
  flagState: "canary" | "promoted" | "rolled_back";
  prUrl?: string | null;
  incidentLogId?: number | null;
  rollbackReason?: string | null;
}) {
  const now = new Date();
  const row = {
    patchId: input.patchId,
    subsystem: input.subsystem,
    flagState: input.flagState,
    prUrl: input.prUrl ?? null,
    incidentLogId: input.incidentLogId ? String(input.incidentLogId) : null,
    rollbackReason: input.rollbackReason ?? null,
    updatedAt: now,
  };
  await db.insert(selfHealFlagsTable).values({ ...row, createdAt: now }).onConflictDoUpdate({
    target: selfHealFlagsTable.patchId,
    set: row,
  });
  await saveSelfHealFlagToStore(input.patchId, {
    subsystem: input.subsystem,
    flagState: input.flagState,
    prUrl: input.prUrl ?? null,
    incidentLogId: input.incidentLogId ?? null,
    rollbackReason: input.rollbackReason ?? null,
    updatedAt: now.toISOString(),
  });
}

export async function getSelfHealFlag(patchId: string) {
  const [row] = await db.select().from(selfHealFlagsTable).where(eq(selfHealFlagsTable.patchId, patchId)).limit(1);
  return row ?? null;
}

export async function archiveDeadLettersOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const updated = await db.update(deadLetterQueueTable)
    .set({ archivedAt: new Date() })
    .where(and(
      isNull(deadLetterQueueTable.archivedAt),
      lt(deadLetterQueueTable.enqueuedAt, cutoff),
    ))
    .returning({ id: deadLetterQueueTable.id });
  return updated.length;
}


```

### `artifacts/api-server/src/lib/platformError.ts` (67 lines)

```typescript
/**
 * Typed failure model for cross-subsystem observability and self-healing.
 */
export type PlatformSubsystem =
  | "blackBook"
  | "carfax"
  | "lender"
  | "inventoryFeed"
  | "typesense"
  | "oauth"
  | "appsScriptFeed"
  | "selfHeal"
  | "ops";

export type PlatformReason =
  | "AUTH_REJECTED"
  | "AUTH_EXPIRED"
  | "SELECTOR_MISS"
  | "SCHEMA_DRIFT"
  | "MISSING_FIELD"
  | "RATE_LIMITED"
  | "NETWORK_TIMEOUT"
  | "CAPTCHA"
  | "STALE_FEED"
  | "EMPTY_RESPONSE"
  | "PERMISSION_DENIED"
  | "PATCH_REFUSED_DANGEROUS_CORE"
  | "SELF_HEAL_RATE_LIMITED"
  | "AUTOMERGE_ROLLBACK"
  | "AUTOMERGE_ROLLBACK_CONFLICT"
  | "INCIDENT_LOG_PRUNED"
  | "UNKNOWN";

export type PlatformRecoverability = "transient" | "needsReauth" | "needsCodeRepair" | "permanent";

export interface PlatformErrorInput {
  subsystem: PlatformSubsystem;
  reason: PlatformReason;
  recoverability: PlatformRecoverability;
  message: string;
  payload?: Record<string, unknown> | null;
  cause?: unknown;
}

export class PlatformError extends Error {
  readonly subsystem: PlatformSubsystem;
  readonly reason: PlatformReason;
  readonly recoverability: PlatformRecoverability;
  readonly payload: Record<string, unknown> | null;
  readonly cause?: unknown;

  constructor(input: PlatformErrorInput) {
    super(input.message);
    this.name = "PlatformError";
    this.subsystem = input.subsystem;
    this.reason = input.reason;
    this.recoverability = input.recoverability;
    this.payload = input.payload ?? null;
    this.cause = input.cause;
  }
}

export function isPlatformError(value: unknown): value is PlatformError {
  return value instanceof PlatformError;
}


```

### `artifacts/api-server/src/lib/selfHeal/auditTrail.ts` (22 lines)

```typescript
export interface SelfHealCommitTrailer {
  incident: number;
  template: string;
  subsystem: string;
  canarySoakMin: number;
  canaryErrorRateDelta: string;
  syntheticProbes: string;
}

export function formatSelfHealTrailer(trailer: SelfHealCommitTrailer): string {
  return [
    "[self-heal-automerge]",
    `incident: ${trailer.incident}`,
    `template: ${trailer.template}`,
    `subsystem: ${trailer.subsystem}`,
    `canary-soak-min: ${trailer.canarySoakMin}`,
    `canary-error-rate-delta: ${trailer.canaryErrorRateDelta}`,
    `synthetic-probes: ${trailer.syntheticProbes}`,
  ].join("\n");
}


```

### `artifacts/api-server/src/lib/selfHeal/authHealthcheck.ts` (53 lines)

```typescript
import { recordIncident } from "../incidentService.js";
import { logger } from "../logger.js";
import { env } from "../env.js";

let lastAuthHealthcheckAt = 0;

export async function runSelfHealAuthHealthcheck(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastAuthHealthcheckAt < 24 * 60 * 60 * 1000) return;
  lastAuthHealthcheckAt = now;

  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) {
    await recordIncident({
      subsystem: "selfHeal",
      reason: "PERMISSION_DENIED",
      recoverability: "permanent",
      message: "Self-heal auth healthcheck: missing GITHUB_TOKEN/GH_TOKEN",
      payload: { check: "github-token" },
    });
    return;
  }

  try {
    const resp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!resp.ok) {
      await recordIncident({
        subsystem: "selfHeal",
        reason: "PERMISSION_DENIED",
        recoverability: "permanent",
        message: `Self-heal auth healthcheck failed with status ${resp.status}`,
        payload: { check: "github-user" },
      });
      return;
    }
    logger.info({ checkedAt: new Date().toISOString() }, "Self-heal auth healthcheck: GitHub credentials OK");
  } catch (err) {
    await recordIncident({
      subsystem: "selfHeal",
      reason: "NETWORK_TIMEOUT",
      recoverability: "transient",
      message: "Self-heal auth healthcheck network error",
      payload: { details: String(err) },
    });
  }
}


```

### `artifacts/api-server/src/lib/selfHeal/canary.ts` (48 lines)

```typescript
import { recordIncident, setSelfHealFlag } from "../incidentService.js";
import { validateInvariant } from "../codeRepair/invariants.js";
import { logger } from "../logger.js";
import type { PlatformSubsystem } from "../platformError.js";

export async function runCanaryForPatch(input: {
  patchId: string;
  subsystem: PlatformSubsystem;
  sampleField?: string;
  sampleValues?: unknown[];
}) {
  await setSelfHealFlag({
    patchId: input.patchId,
    subsystem: input.subsystem,
    flagState: "canary",
  });

  const values = input.sampleValues ?? [];
  if (input.sampleField && values.length > 0) {
    const invalid = values.filter((value) => !validateInvariant(input.sampleField!, value));
    if (invalid.length > 0) {
      await setSelfHealFlag({
        patchId: input.patchId,
        subsystem: input.subsystem,
        flagState: "rolled_back",
        rollbackReason: `Semantic validation failed for ${input.sampleField}`,
      });
      await recordIncident({
        subsystem: "selfHeal",
        reason: "AUTOMERGE_ROLLBACK",
        recoverability: "needsCodeRepair",
        message: `Canary semantic validation failed for patch ${input.patchId}`,
        payload: { sampleField: input.sampleField, invalidCount: invalid.length },
      });
      return { promoted: false, reason: "semantic_validation_failed" };
    }
  }

  await setSelfHealFlag({
    patchId: input.patchId,
    subsystem: input.subsystem,
    flagState: "promoted",
  });
  logger.info({ patchId: input.patchId, subsystem: input.subsystem }, "Canary: patch promoted");
  return { promoted: true };
}


```

### `artifacts/api-server/src/lib/selfHeal/circuitBreaker.ts` (61 lines)

```typescript
type BreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  threshold?: number;
  cooldownMs?: number;
}

interface CircuitEntry {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
}

const circuitEntries = new Map<string, CircuitEntry>();

function getEntry(key: string): CircuitEntry {
  const existing = circuitEntries.get(key);
  if (existing) return existing;
  const created: CircuitEntry = { state: "closed", consecutiveFailures: 0, openedAt: null };
  circuitEntries.set(key, created);
  return created;
}

export async function withCircuitBreaker<T>(
  key: string,
  fn: () => Promise<T>,
  options: CircuitBreakerOptions = {},
): Promise<T> {
  const threshold = Math.max(1, options.threshold ?? 3);
  const cooldownMs = Math.max(1000, options.cooldownMs ?? 60_000);
  const entry = getEntry(key);

  if (entry.state === "open") {
    if (entry.openedAt && Date.now() - entry.openedAt >= cooldownMs) {
      entry.state = "half-open";
    } else {
      throw new Error(`Circuit breaker open for ${key}`);
    }
  }

  try {
    const value = await fn();
    entry.state = "closed";
    entry.consecutiveFailures = 0;
    entry.openedAt = null;
    return value;
  } catch (error) {
    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= threshold) {
      entry.state = "open";
      entry.openedAt = Date.now();
    }
    throw error;
  }
}

export function getCircuitState(key: string): BreakerState {
  return getEntry(key).state;
}


```

### `artifacts/api-server/src/lib/selfHeal/deadLetter.ts` (8 lines)

```typescript
import type { PlatformReason, PlatformSubsystem } from "../platformError.js";
import { enqueueDeadLetter } from "../incidentService.js";

export async function deadLetter(subsystem: PlatformSubsystem, reason: PlatformReason, payload: Record<string, unknown>) {
  await enqueueDeadLetter({ subsystem, reason, payload });
}


```

### `artifacts/api-server/src/lib/selfHeal/index.ts` (12 lines)

```typescript
export * from "./withRetry.js";
export * from "./circuitBreaker.js";
export * from "./probeField.js";
export * from "./probeSelector.js";
export * from "./reauthIfNeeded.js";
export * from "./deadLetter.js";
export * from "./staleButServing.js";
export * from "./canary.js";
export * from "./rollbackWatcher.js";
export * from "./auditTrail.js";


```

### `artifacts/api-server/src/lib/selfHeal/probeField.ts` (26 lines)

```typescript
export interface ProbeFieldResult<T> {
  value: T | null;
  matchedCandidate: string | null;
  usedFallback: boolean;
}

export function probeField<T = unknown>(
  document: Record<string, unknown> | null | undefined,
  candidates: string[],
): ProbeFieldResult<T> {
  const doc = document ?? {};
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const raw = doc[candidate];
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      return {
        value: raw as T,
        matchedCandidate: candidate,
        usedFallback: i > 0,
      };
    }
  }
  return { value: null, matchedCandidate: null, usedFallback: false };
}


```

### `artifacts/api-server/src/lib/selfHeal/probeSelector.ts` (25 lines)

```typescript
export interface ProbeSelectorResult<T> {
  element: T | null;
  matchedSelector: string | null;
  usedFallback: boolean;
}

export async function probeSelector<T>(
  resolver: (selector: string) => Promise<T | null>,
  selectors: string[],
): Promise<ProbeSelectorResult<T>> {
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i];
    const element = await resolver(selector);
    if (element) {
      return {
        element,
        matchedSelector: selector,
        usedFallback: i > 0,
      };
    }
  }
  return { element: null, matchedSelector: null, usedFallback: false };
}


```

### `artifacts/api-server/src/lib/selfHeal/reauthIfNeeded.ts` (15 lines)

```typescript
export async function reauthIfNeeded<T>(opts: {
  shouldReauth: (error: unknown) => boolean;
  reauth: () => Promise<void>;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await opts.run();
  } catch (error) {
    if (!opts.shouldReauth(error)) throw error;
    await opts.reauth();
    return opts.run();
  }
}


```

### `artifacts/api-server/src/lib/selfHeal/rollbackWatcher.ts` (38 lines)

```typescript
import { sendOpsAlert } from "../emailService.js";
import { recordIncident, setSelfHealFlag } from "../incidentService.js";
import type { PlatformSubsystem } from "../platformError.js";

export async function rollbackPatch(input: {
  patchId: string;
  subsystem: PlatformSubsystem;
  reason: string;
  prUrl?: string | null;
  conflict?: boolean;
}) {
  await setSelfHealFlag({
    patchId: input.patchId,
    subsystem: input.subsystem,
    flagState: "rolled_back",
    rollbackReason: input.reason,
    prUrl: input.prUrl ?? null,
  });

  const reasonCode = input.conflict ? "AUTOMERGE_ROLLBACK_CONFLICT" : "AUTOMERGE_ROLLBACK";
  await recordIncident({
    subsystem: "selfHeal",
    reason: reasonCode,
    recoverability: input.conflict ? "needsCodeRepair" : "transient",
    message: `Rollback ${input.conflict ? "conflict" : "executed"} for patch ${input.patchId}`,
    payload: { subsystem: input.subsystem, reason: input.reason, prUrl: input.prUrl ?? null },
  });

  if (input.conflict) {
    await sendOpsAlert(
      "critical",
      "Self-heal rollback PR unresolved",
      `<p>Patch <strong>${input.patchId}</strong> hit rollback conflict.</p><p>Subsystem: ${input.subsystem}</p><p>Reason: ${input.reason}</p><p>PR: ${input.prUrl ?? "n/a"}</p>`,
    );
  }
}


```

### `artifacts/api-server/src/lib/selfHeal/staleButServing.ts` (27 lines)

```typescript
interface StaleCacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const staleCache = new Map<string, StaleCacheEntry<unknown>>();

export async function staleButServing<T>(opts: {
  key: string;
  fetchFn: () => Promise<T>;
}): Promise<{ value: T; stale: boolean; stalenessMs: number }> {
  try {
    const value = await opts.fetchFn();
    staleCache.set(opts.key, { value, fetchedAt: Date.now() });
    return { value, stale: false, stalenessMs: 0 };
  } catch (error) {
    const cached = staleCache.get(opts.key) as StaleCacheEntry<T> | undefined;
    if (!cached) throw error;
    return {
      value: cached.value,
      stale: true,
      stalenessMs: Date.now() - cached.fetchedAt,
    };
  }
}


```

### `artifacts/api-server/src/lib/selfHeal/withRetry.ts` (32 lines)

```typescript
export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  jitterMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(opts: RetryOptions, fn: (attempt: number) => Promise<T>): Promise<T> {
  const retries = Math.max(0, opts.retries);
  const baseDelayMs = Math.max(1, opts.baseDelayMs ?? 500);
  const jitterMs = Math.max(0, opts.jitterMs ?? 200);
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) break;
      const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
      const delay = baseDelayMs * (2 ** attempt) + jitter;
      await wait(delay);
    }
  }
  throw lastError;
}


```

### `artifacts/api-server/src/routes/ops.ts` (346 lines)

```typescript
import { Router } from "express";
import { runDeepHealth } from "./health.js";
import { db, bbSessionTable, lenderSessionTable, carfaxSessionTable } from "@workspace/db";
import { deadLetterQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAccess, requireOwner } from "../lib/auth.js";
import { getCacheState } from "../lib/inventoryCache.js";
import { getBlackBookLastRunAtIso, getBlackBookStatus, getBlackBookConfigStatus } from "../lib/blackBookWorker.js";
import { getCachedLenderPrograms, getLenderSyncStatus } from "../lib/lenderWorker.js";
import {
  TYPESENSE_HOST,
  DEALER_COLLECTIONS,
  extractDocVin,
  extractDocImagePaths,
  extractWebsiteUrl,
  typesenseSearch,
  type TypesenseSearchResponse,
} from "../lib/typesense.js";
import { getRuntimeFingerprint } from "../lib/runtimeFingerprint.js";
import { logger } from "../lib/logger.js";
import { listIncidents, recordIncident } from "../lib/incidentService.js";
import { env } from "../lib/env.js";
import { loadSelfHealAutomergeToggle, saveSelfHealAutomergeToggle } from "../lib/bbObjectStore.js";

const router = Router();

function isWithinLastHours(iso: string | null, hours: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  return (Date.now() - at) <= hours * 60 * 60 * 1000;
}

// GET /ops/function-status — explicit operational checks for core data functions
router.get("/ops/function-status", requireAccess, async (_req, res) => {
  const { data } = getCacheState();
  const bbStatus = getBlackBookStatus();
  const bbConfig = getBlackBookConfigStatus();
  const lenderStatus = getLenderSyncStatus();
  const lenderPrograms = getCachedLenderPrograms();

  const bbLastRunIso = bbStatus.lastRun ?? await getBlackBookLastRunAtIso();
  const blackBookWithin24h = isWithinLastHours(bbLastRunIso, 24);
  const blackBookPass = bbConfig.enabled && blackBookWithin24h && bbStatus.lastOutcome !== "failed";
  const bbCoveragePct = data.length > 0 ? Math.round((bbStatus.lastCount / data.length) * 10000) / 100 : 0;

  const carfaxUrlCount = data.filter((item) => item.carfax?.trim().startsWith("http")).length;
  const carfaxNotFoundCount = data.filter((item) => item.carfax?.trim().toUpperCase() === "NOT FOUND").length;
  const carfaxAttemptedCount = carfaxUrlCount + carfaxNotFoundCount;

  const websiteUrlCount = data.filter((item) => item.website?.trim().startsWith("http")).length;
  const websiteNotFoundCount = data.filter((item) => item.website?.trim().toUpperCase() === "NOT FOUND").length;

  const lenderProgramCount = lenderPrograms?.programs.length ?? 0;
  const lenderUpdatedAt = lenderPrograms?.updatedAt ?? null;

  const [bbPersisted] = await db.select().from(bbSessionTable).where(eq(bbSessionTable.id, "singleton")).limit(1);
  const [lenderPersisted] = await db.select().from(lenderSessionTable).where(eq(lenderSessionTable.id, "singleton")).limit(1);
  const [carfaxPersisted] = await db.select().from(carfaxSessionTable).where(eq(carfaxSessionTable.id, "singleton")).limit(1);
  const gcsToggle = await loadSelfHealAutomergeToggle().catch(() => null);

  res.set("Cache-Control", "no-store");
  res.json({
    inventoryCount: data.length,
    selfHeal: {
      enabled: env.SELF_HEAL_ENABLED,
      dryRun: env.SELF_HEAL_DRY_RUN,
      automergeEnabled: env.SELF_HEAL_AUTOMERGE_ENABLED,
      automergeEnabledGcs: gcsToggle?.enabled ?? null,
      gateActive: env.SELF_HEAL_GATE_ACTIVE,
    },
    checks: {
      blackBookUpdatedWithin24Hours: {
        pass: blackBookPass,
        lastRunAt: bbLastRunIso,
        running: bbStatus.running,
        enabled: bbConfig.enabled,
        missingEnv: bbConfig.missingEnv,
        allowProdBrowserLogin: bbConfig.allowProdBrowserLogin,
        valuedInventoryCount: bbStatus.lastCount,
        coveragePct: bbCoveragePct,
        outcome: bbStatus.lastOutcome,
        error: bbStatus.lastError,
        batch: bbStatus.lastBatch,
        pendingTargetVinCount: bbStatus.pendingTargetVinCount,
      },
      carfaxLookupActivity: {
        pass: carfaxAttemptedCount > 0,
        attemptedCount: carfaxAttemptedCount,
        foundUrlCount: carfaxUrlCount,
        notFoundCount: carfaxNotFoundCount,
      },
      websiteLinkDiscovery: {
        pass: websiteUrlCount > 0,
        foundUrlCount: websiteUrlCount,
        notFoundCount: websiteNotFoundCount,
        coveragePct: data.length > 0 ? Math.round((websiteUrlCount / data.length) * 10000) / 100 : 0,
      },
      lenderProgramsLoaded: {
        pass: lenderProgramCount > 0,
        lenderProgramCount,
        updatedAt: lenderUpdatedAt,
        running: lenderStatus.running,
        error: lenderStatus.error ?? null,
      },
      oauthConfiguration: {
        pass: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        callbackConfigured: Boolean(env.REPLIT_DOMAINS || env.NODE_ENV === "development"),
        missingEnv: [
          !env.GOOGLE_CLIENT_ID ? "GOOGLE_CLIENT_ID" : null,
          !env.GOOGLE_CLIENT_SECRET ? "GOOGLE_CLIENT_SECRET" : null,
        ].filter(Boolean),
      },
    },
    subsystems: [
      {
        subsystem: "blackBook",
        lastOutcome: bbPersisted?.lastOutcome ?? bbStatus.lastOutcome ?? null,
        lastErrorReason: bbPersisted?.lastErrorReason ?? null,
        lastErrorAt: bbPersisted?.lastErrorAt?.toISOString() ?? null,
        consecutiveFailures: bbPersisted?.consecutiveFailures ?? 0,
        recoveryInProgress: bbStatus.running,
      },
      {
        subsystem: "lender",
        lastOutcome: lenderPersisted?.lastOutcome ?? null,
        lastErrorReason: lenderPersisted?.lastErrorReason ?? null,
        lastErrorAt: lenderPersisted?.lastErrorAt?.toISOString() ?? null,
        consecutiveFailures: lenderPersisted?.consecutiveFailures ?? 0,
        recoveryInProgress: lenderStatus.running,
      },
      {
        subsystem: "carfax",
        lastOutcome: carfaxPersisted?.lastOutcome ?? null,
        lastErrorReason: carfaxPersisted?.lastErrorReason ?? null,
        lastErrorAt: carfaxPersisted?.lastErrorAt?.toISOString() ?? null,
        consecutiveFailures: carfaxPersisted?.consecutiveFailures ?? 0,
        recoveryInProgress: false,
      },
    ],
  });
});

router.get("/ops/incidents", requireOwner, async (req, res) => {
  const includeTransients = String(req.query.include_transients ?? "") === "1";
  const limit = Number(req.query.limit ?? 50);
  const offset = Number(req.query.offset ?? 0);
  const rows = await listIncidents({ includeTransients, limit, offset });
  res.set("Cache-Control", "no-store");
  res.json({
    includeTransients,
    limit,
    offset,
    count: rows.length,
    incidents: rows,
  });
});

router.get("/ops/dependencies", requireOwner, async (_req, res) => {
  try {
    const payload = await runDeepHealth();
    res.set("Cache-Control", "no-store");
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch deep dependency status", details: String(err) });
  }
});

router.post("/ops/self-heal-toggle", requireOwner, async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  await saveSelfHealAutomergeToggle(enabled);
  res.json({ ok: true, enabled });
});

router.get("/ops/dead-letters", requireOwner, async (_req, res) => {
  const rows = await db.select().from(deadLetterQueueTable).orderBy(deadLetterQueueTable.enqueuedAt).limit(200);
  const active = rows.filter((r) => !r.archivedAt);
  const countsBySubsystem = active.reduce<Record<string, number>>((acc, row) => {
    acc[row.subsystem] = (acc[row.subsystem] ?? 0) + 1;
    return acc;
  }, {});
  res.json({
    activeCount: active.length,
    countsBySubsystem,
    thresholds: {
      carfax: 50,
      blackBook: 20,
      lender: 5,
    },
    weeklyDigestBanner:
      active.length > 0
        ? `Dead-letter queue has ${active.length} active entries; review top subsystem counts.`
        : null,
    rows: active,
  });
});

router.post("/ops/dead-letters/:id/retrigger", requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid dead-letter id" });
    return;
  }
  const [row] = await db.select().from(deadLetterQueueTable).where(eq(deadLetterQueueTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Dead-letter row not found" });
    return;
  }
  await recordIncident({
    subsystem: row.subsystem as any,
    reason: "UNKNOWN",
    recoverability: "transient",
    message: "Dead-letter re-trigger requested",
    payload: { deadLetterId: id, originalReason: row.reason, payload: row.payload },
  });
  res.json({ ok: true, retriggered: id });
});

// GET /ops/diagnostics — owner-only deep diagnostics.
//
// Probes each Typesense collection live (small per_page) and reports:
//   - HTTP status, error body if any
//   - hits.length and total found
//   - which fields are present on a sample doc
//   - VIN, image_urls, page_url, and price detection counts
//
// Also returns cache-derived ground truth so we can tell whether the
// inventory pipeline is enriching or whether values came from the sheet.
//
// Designed so a single fetch by the owner makes it obvious whether the
// bulk Typesense fetch is succeeding and whether the documents contain
// the fields our enrichment code expects.
router.get("/ops/diagnostics", requireOwner, async (_req, res) => {
  const { data, lastUpdated, isRefreshing } = getCacheState();

  const cache = {
    count:              data.length,
    lastUpdated:        lastUpdated?.toISOString() ?? null,
    isRefreshing,
    withWebsite:        data.filter((i) => i.website?.trim().startsWith("http")).length,
    withWebsiteNotFound: data.filter((i) => i.website?.trim().toUpperCase() === "NOT FOUND").length,
    withOnlinePrice:    data.filter((i) => {
      const v = i.onlinePrice?.trim();
      return !!v && v !== "NOT FOUND" && v !== "0";
    }).length,
    withPhotos:         data.filter((i) => i.hasPhotos).length,
    withCarfaxUrl:      data.filter((i) => i.carfax?.trim().startsWith("http")).length,
    withCarfaxNotFound: data.filter((i) => i.carfax?.trim().toUpperCase() === "NOT FOUND").length,
    withBbAvgWholesale: data.filter((i) => !!i.bbAvgWholesale).length,
  };

  const collections = await Promise.all(DEALER_COLLECTIONS.map(async (col) => {
    try {
      const t0 = Date.now();
      const params = new URLSearchParams({ q: "*", per_page: "3" });
      const resp = await typesenseSearch(col, params, 8_000);
      const elapsedMs = Date.now() - t0;

      if (!resp.ok) {
        let errBody = "";
        try { errBody = (await resp.text()).slice(0, 400); } catch { /* ignore */ }
        return {
          name: col.name,
          collection: col.collection,
          ok: false,
          status: resp.status,
          elapsedMs,
          error: errBody || resp.statusText,
        };
      }

      const body = await resp.json() as TypesenseSearchResponse;
      const hits = body.hits ?? [];
      const sampleDoc = (hits[0]?.document ?? {}) as Record<string, any>;
      const sampleKeys = Object.keys(sampleDoc).sort();

      // Field-presence counts across the small sample
      let withVin = 0;
      let withImageUrls = 0;
      let withPageUrl = 0;
      let withPrice = 0;
      const sampleSummaries = hits.map((hit) => {
        const doc = (hit.document ?? {}) as Record<string, any>;
        const vin = extractDocVin(doc);
        const imagePaths = extractDocImagePaths(doc);
        const websiteUrl = extractWebsiteUrl(doc, col.siteUrl);
        const priceRaw = doc.price ?? doc.internet_price ?? doc.online_price ?? doc.list_price;

        if (vin) withVin++;
        if (imagePaths.length > 0) withImageUrls++;
        if (websiteUrl) withPageUrl++;
        if (priceRaw != null && String(priceRaw).trim() !== "") withPrice++;

        return {
          docId:        String(doc.id ?? doc.post_id ?? doc.vehicle_id ?? ""),
          vin:          vin || null,
          year:         doc.year ?? null,
          make:         doc.make ?? null,
          model:        doc.model ?? null,
          imageCount:   imagePaths.length,
          websiteUrl,
          priceRaw:     priceRaw ?? null,
        };
      });

      return {
        name: col.name,
        collection: col.collection,
        ok: true,
        status: resp.status,
        elapsedMs,
        found: body.found ?? null,
        hitsReturned: hits.length,
        // Field presence in the small sample — these tell us at a glance
        // whether the bulk pipeline can extract VIN / photos / URL / price.
        sampleStats: {
          withVin,
          withImageUrls,
          withPageUrl,
          withPrice,
        },
        sampleKeys,
        sampleDocs: sampleSummaries,
      };
    } catch (err: any) {
      logger.warn({ err: err.message, collection: col.collection }, "diagnostics: typesense probe failed");
      return {
        name: col.name,
        collection: col.collection,
        ok: false,
        error: err.message ?? String(err),
      };
    }
  }));

  res.set("Cache-Control", "no-store");
  res.json({
    runtime: getRuntimeFingerprint(),
    typesenseHost: TYPESENSE_HOST,
    cache,
    collections,
  });
});

export default router;

```

---

<a id="server-cross"></a>
## 12. API server — cross-cutting (health, routing, logging, types)

*10 file(s).*

### `artifacts/api-server/src/lib/env.ts` (102 lines)

```typescript
/**
 * Centralized environment access. Import from here instead of process.env.
 * Validated at import time — the server crashes immediately with a clear
 * message if a required variable is missing or malformed.
 */
import { z } from "zod";

const optStr = z.string().trim().optional().default("");

const envSchema = z.object({
  PORT:                          z.coerce.number().int().positive().default(3000),
  NODE_ENV:                      z.string().trim().default("development"),
  REPLIT_DEPLOYMENT:             z.enum(["0", "1"]).default("0"),
  REPLIT_DOMAINS:                optStr,

  SESSION_SECRET:                z.string().trim().optional(),
  OWNER_EMAIL:                   z.string().trim().toLowerCase().default(""),

  GOOGLE_CLIENT_ID:              optStr,
  GOOGLE_CLIENT_SECRET:          optStr,

  DATABASE_URL:                  z.string().trim().default(""),

  INVENTORY_DATA_URL:            optStr,
  REFRESH_SECRET:                optStr,

  DEFAULT_OBJECT_STORAGE_BUCKET_ID: optStr,
  PRIVATE_OBJECT_DIR:            optStr,

  CREDITAPP_EMAIL:               optStr,
  CREDITAPP_PASSWORD:            optStr,
  CREDITAPP_TOTP_SECRET:         optStr,
  BB_CBB_ENDPOINT:               optStr,
  BB_SELF_HEAL_INTERVAL_MIN:     z.coerce.number().int().positive().default(120),
  BB_SELF_HEAL_STALE_HOURS:      z.coerce.number().int().positive().default(12),
  BB_ALLOW_PROD_BROWSER_LOGIN:   z.string().trim().toLowerCase()
                                   .transform((v) => v === "true")
                                   .default("true"),

  LENDER_CREDITAPP_EMAIL:        optStr,
  LENDER_CREDITAPP_PASSWORD:     optStr,
  LENDER_CREDITAPP_TOTP_SECRET:  optStr,
  LENDER_CREDITAPP_2FA_CODE:     optStr,

  CARFAX_EMAIL:                  optStr,
  CARFAX_PASSWORD:               optStr,
  CARFAX_ENABLED:                z.string().trim().toLowerCase()
                                   .transform((v) => v === "true")
                                   .default("false"),

  TYPESENSE_HOST:                z.string().trim().default("v6eba1srpfohj89dp-1.a1.typesense.net"),
  TYPESENSE_KEY_PARKDALE:        optStr,
  TYPESENSE_KEY_MATRIX:          optStr,
  TYPESENSE_COLLECTION_PARKDALE: z.string().trim().default("37042ac7ece3a217b1a41d6f54ba6855"),
  TYPESENSE_COLLECTION_MATRIX:   z.string().trim().default("cebacbca97920d818d57c6f0526d7413"),

  APPS_SCRIPT_WEB_APP_URL:       optStr,

  RESEND_API_KEY:                optStr,
  GITHUB_TOKEN:                  optStr,
  GH_TOKEN:                      optStr,
  SELF_HEAL_ENABLED:             z.string().trim().toLowerCase().transform((v) => v === "true").default("true"),
  SELF_HEAL_DRY_RUN:             z.string().trim().toLowerCase().transform((v) => v === "true").default("true"),
  SELF_HEAL_AUTOMERGE_ENABLED:   z.string().trim().toLowerCase().transform((v) => v === "true").default("false"),
  SELF_HEAL_GATE_ACTIVE:         z.string().trim().toLowerCase().transform((v) => v === "true").default("false"),
  SELF_HEAL_AUTOMERGE_FLAG_PATH: optStr,
  SELF_HEAL_HANDOFF_ALERT_HOURS: z.coerce.number().int().positive().default(4),

  GIT_SHA:                       optStr,
  REPL_GIT_COMMIT:               optStr,
  VERCEL_GIT_COMMIT_SHA:         optStr,

  LOG_LEVEL:                     z.string().trim().default("info"),
}).superRefine((data, ctx) => {
  const isProd = data.REPLIT_DEPLOYMENT === "1" || data.NODE_ENV === "production";
  if (isProd && !data.SESSION_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SESSION_SECRET"],
      message: "SESSION_SECRET is required in production",
    });
  }
}).transform((data) => ({
  ...data,
  SESSION_SECRET: data.SESSION_SECRET || "dev-secret-change-me",
}));

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`Environment validation failed:\n${formatted}`);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export const isProduction = env.REPLIT_DEPLOYMENT === "1" || env.NODE_ENV === "production";

```

### `artifacts/api-server/src/lib/logger.ts` (41 lines)

```typescript
import pino from "pino";
import { env, isProduction } from "./env.js";
import type { PlatformError } from "./platformError.js";

const baseLogger = pino({
  level: env.LOG_LEVEL,
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

type FailureLogger = {
  failure: (error: PlatformError, message?: string) => void;
};

export const logger = Object.assign(baseLogger, {
  failure(error: PlatformError, message = "Platform failure") {
    baseLogger.error(
      {
        event: "platform_failure",
        subsystem: error.subsystem,
        reason: error.reason,
        recoverability: error.recoverability,
        payload: error.payload ?? null,
        causedBy: error.cause ? String(error.cause) : null,
      },
      `${message}: ${error.message}`,
    );
  },
}) as typeof baseLogger & FailureLogger;

```

### `artifacts/api-server/src/lib/randomScheduler.ts` (195 lines)

```typescript
/**
 * Random Scheduler
 *
 * Schedules daily tasks at a random time within business hours (Mountain Time)
 * so that worker runs are spread throughout the day and don't cluster at startup.
 *
 * Exports:
 *   toMountainDateStr()     — "YYYY-MM-DD" string for today in Mountain Time
 *   scheduleRandomDaily(opts) — registers a daily job within the defined window
 *
 * Business hours (Mountain Time):
 *   Weekdays: 8:30 AM – 7:00 PM
 *   Weekends: 10:00 AM – 4:00 PM
 *
 * @example
 * ```ts
 * import { scheduleRandomDaily } from "../lib/randomScheduler.js";
 *
 * scheduleRandomDaily({
 *   name: "carfax-worker",
 *   run: async () => { await runCarfaxWorker(); },
 * });
 * ```
 *
 * Consumers: lib/blackBookWorker.ts, lib/carfaxWorker.ts, lib/lenderWorker.ts
 */
import { logger } from "./logger.js";

const MOUNTAIN_TZ = "America/Edmonton";

interface DayWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const WEEKDAY_WINDOW: DayWindow = { startHour: 8, startMinute: 30, endHour: 19, endMinute: 0 };
const WEEKEND_WINDOW: DayWindow = { startHour: 10, startMinute: 0, endHour: 16, endMinute: 0 };

interface MountainTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

function getMountainComponents(d: Date = new Date()): MountainTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MOUNTAIN_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);

  const get = (type: string) => {
    const val = parts.find(p => p.type === type)?.value ?? "0";
    return parseInt(val, 10);
  };

  const weekdayStr = parts.find(p => p.type === "weekday")?.value ?? "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
    second: get("second"),
    dayOfWeek: dowMap[weekdayStr] ?? 0,
  };
}

export function toMountainDateStr(d: Date = new Date()): string {
  const mt = getMountainComponents(d);
  return `${mt.year}-${String(mt.month).padStart(2, "0")}-${String(mt.day).padStart(2, "0")}`;
}

function getWindowForDow(dow: number): DayWindow {
  return (dow === 0 || dow === 6) ? WEEKEND_WINDOW : WEEKDAY_WINDOW;
}

function mtMinutesSinceMidnight(mt: MountainTime): number {
  return mt.hour * 60 + mt.minute;
}

function windowStartMinutes(w: DayWindow): number {
  return w.startHour * 60 + w.startMinute;
}

function windowEndMinutes(w: DayWindow): number {
  return w.endHour * 60 + w.endMinute;
}

function randomInRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

export interface ScheduleOptions {
  name: string;
  hasRunToday: () => Promise<boolean> | boolean;
  execute: (reason: string) => void;
}

export function scheduleRandomDaily(opts: ScheduleOptions): void {
  const { name, hasRunToday, execute } = opts;

  const scheduleForDay = async () => {
    const alreadyRan = await hasRunToday();
    const mt = getMountainComponents();
    const w = getWindowForDow(mt.dayOfWeek);
    const nowMinutes = mtMinutesSinceMidnight(mt);
    const wStartMin = windowStartMinutes(w);
    const wEndMin = windowEndMinutes(w);

    if (alreadyRan) {
      logger.info({ name }, `${name}: already ran today — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    if (nowMinutes >= wEndMin) {
      logger.info({ name }, `${name}: past today's window — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    const effectiveStartMin = Math.max(wStartMin, nowMinutes + 1);
    if (effectiveStartMin >= wEndMin) {
      logger.info({ name }, `${name}: window too narrow — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    const chosenMinute = randomInRange(effectiveStartMin, wEndMin);
    const delayMs = minutesToMs(chosenMinute - nowMinutes);

    const chosenHour = Math.floor(chosenMinute / 60);
    const chosenMin = chosenMinute % 60;
    const period = chosenHour >= 12 ? "PM" : "AM";
    const displayHour = chosenHour > 12 ? chosenHour - 12 : chosenHour === 0 ? 12 : chosenHour;
    const timeStr = `${displayHour}:${String(chosenMin).padStart(2, "0")} ${period}`;

    logger.info({ name, scheduledFor: timeStr, delayMs }, `${name}: scheduled for ${timeStr} MT today`);

    setTimeout(async () => {
      try {
        const stillNeeded = !(await hasRunToday());
        if (!stillNeeded) {
          logger.info({ name }, `${name}: already ran (manual trigger?) — skipping scheduled fire`);
          scheduleNextDay(getMountainComponents());
          return;
        }
        logger.info({ name }, `${name}: randomized schedule firing now`);
        execute("randomized schedule");
        scheduleNextDay(getMountainComponents());
      } catch (err) {
        logger.warn({ err, name }, `${name}: scheduled fire failed`);
        scheduleNextDay(getMountainComponents());
      }
    }, delayMs);
  };

  const scheduleNextDay = (mt: MountainTime) => {
    const nextDow = (mt.dayOfWeek + 1) % 7;
    const nextW = getWindowForDow(nextDow);
    const nextWStartMin = windowStartMinutes(nextW);

    const minutesUntilMidnight = (24 * 60) - mtMinutesSinceMidnight(mt);
    const delayMs = minutesToMs(minutesUntilMidnight + nextWStartMin);
    const safeDelayMs = Math.max(delayMs, 60_000);

    const tomorrow = new Date(Date.now() + safeDelayMs);
    const nextDate = toMountainDateStr(tomorrow);
    logger.info({ name, nextDate, delayMs: safeDelayMs }, `${name}: will re-evaluate on ${nextDate}`);

    setTimeout(() => scheduleForDay(), safeDelayMs);
  };

  setTimeout(() => scheduleForDay(), 5_000);
}

```

### `artifacts/api-server/src/lib/README.md` (117 lines)

```markdown
# Backend Libraries

All paths relative to `artifacts/api-server/src/lib/`.

## File Index
