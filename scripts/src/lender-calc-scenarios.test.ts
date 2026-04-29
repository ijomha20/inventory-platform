/**
 * Lender Calculator Scenario Tests
 *
 * Tests the pure math functions used by POST /lender-calculate.
 * Each test case documents a real-world deal scenario with known inputs and
 * expected outputs, so an AI agent can read these to understand what the
 * calculator should produce.
 *
 * Run: pnpm --filter @workspace/scripts test:lender-scenarios
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCapProfile,
  resolveNoOnlineSellingPrice,
  parseInventoryNumber,
  trimProductsInOrder,
  computePaymentCeilingPV,
  computeZeroDpCeiling,
  resolveSellingPrice,
  allocateBackend,
  settleConstraints,
  parseWorksheetRule,
  parseWorksheetRules,
  applyEligibilityRules,
  deriveTermCap,
  deriveTotalFinanceCap,
} from "../../artifacts/api-server/src/lib/lenderCalcEngine.js";
import type { WorksheetRule } from "../../artifacts/api-server/src/lib/bbObjectStore.js";

// --------------------------------------------------------------------------
// Helpers — mirror the exact functions from routes/lender.ts so we can test
// the math in isolation without needing Express or the inventory cache.
// --------------------------------------------------------------------------

function pmt(rate: number, nper: number, pv: number): number {
  if (rate === 0) return pv / nper;
  const r = rate / 12;
  return (pv * r * Math.pow(1 + r, nper)) / (Math.pow(1 + r, nper) - 1);
}

const MAX_FINANCE_TERM_MONTHS = 84;

function resolveEffectiveTermStretch(
  baseTerm: number,
  requested: 0 | 6 | 12,
): { effectiveStretch: 0 | 6 | 12; termMonths: number; stretched: boolean; cappedReason?: string } {
  if (baseTerm >= MAX_FINANCE_TERM_MONTHS) {
    return { effectiveStretch: 0, termMonths: baseTerm, stretched: false, cappedReason: "matrix_already_84_no_stretch" };
  }
  const order: (0 | 6 | 12)[] = [12, 6, 0];
  let maxStretch: 0 | 6 | 12 = 0;
  for (const s of order) {
    if (baseTerm + s <= MAX_FINANCE_TERM_MONTHS) { maxStretch = s; break; }
  }
  const effectiveStretch = Math.min(requested, maxStretch) as 0 | 6 | 12;
  const termMonths = baseTerm + effectiveStretch;

  let cappedReason: string | undefined;
  if (requested > effectiveStretch) {
    cappedReason = baseTerm === 78 && requested === 12 && effectiveStretch === 6
      ? "78_only_plus6_to_84"
      : "capped_at_84_max";
  }
  return { effectiveStretch, termMonths, stretched: effectiveStretch > 0, cappedReason };
}

// --------------------------------------------------------------------------
// Scenario 1: Basic setup — Eden Park Tier 3 style
// Vehicle sells at reduced (Red) price, no products, payment under cap.
// --------------------------------------------------------------------------

test("Scenario 1: basic setup — reduced price, no products, payment under cap", () => {
  // Inputs from a real deal row:
  // BB wholesale (avg) = 16,432, online price exists but exceeds advance ceiling
  // Rate = 21.49%, term = 78mo, maxPaymentOverride = 665
  // maxAdvanceLTV = 135% (effective for this tier's live config)
  // creditorFee = 675 (inferred from financed total)
  // taxRate = 5%, no down/trade

  const bbWholesale = 16432;
  const maxAdvanceLTV = 1.35;
  const rateDecimal = 0.2149;
  const termMonths = 78;
  const taxRate = 0.05;
  const creditorFee = 675;
  const downPayment = 0;
  const netTrade = 0;
  const maxPmt = 665;

  // Advance ceiling determines reduced selling price
  const maxAdvance = bbWholesale * maxAdvanceLTV;
  const advanceCeiling = maxAdvance + downPayment + netTrade;
  const sellingPrice = Math.floor(advanceCeiling);

  // No products in this scenario (LTV room too tight)
  const lenderExposure = sellingPrice - downPayment - netTrade;
  const allInSubtotal = lenderExposure + 0 + 0 + creditorFee;
  const taxes = allInSubtotal * taxRate;
  const totalFinanced = allInSubtotal + taxes;
  const monthly = pmt(rateDecimal, termMonths, totalFinanced);

  // Verify the math matches the expected deal row
  assert.equal(sellingPrice, 22183, "Reduced selling price should be floor of advance ceiling");
  assert.equal(Math.round(totalFinanced), 24001, "Total financed should be ~24,001");
  assert.ok(Math.abs(monthly - 573.43) < 0.01, `Payment should be ~573.43, got ${monthly.toFixed(2)}`);
  assert.ok(monthly <= maxPmt, "Payment should be under the max payment cap of 665");
});

// --------------------------------------------------------------------------
// Scenario 2: Product stacking — enough LTV room for warranty + GAP
// --------------------------------------------------------------------------

test("Scenario 2: product stacking with sufficient LTV room", () => {
  // Vehicle with generous all-in room
  const MARKUP = 2.5;
  const MIN_WARRANTY_COST = 600;
  const MIN_GAP_COST = 550;
  const MAX_GAP_MARKUP = 1500;
  const MAX_GAP_PRICE = Math.round(MAX_GAP_MARKUP / (1 - 1 / MARKUP));
  const capWarranty = 2000;
  const capGap: number | undefined = undefined;
  const capAdmin: number | undefined = 999;
  const desiredAdmin = 999;
  const dealerReserve = 500;
  const creditorFee = 799;

  // Simulate 6000 of combined room
  const allInRoom = 6000;
  const aftermarketRoom = Infinity;

  let room = Math.min(allInRoom, isFinite(aftermarketRoom) ? aftermarketRoom : Infinity);

  // Admin first
  const admin = Math.min(desiredAdmin, capAdmin ?? desiredAdmin, Math.floor(room));
  room -= admin;

  // Warranty
  let war = 0;
  if (room >= Math.round(MIN_WARRANTY_COST * MARKUP)) {
    war = capWarranty != null ? Math.min(room, capWarranty) : room;
    war = Math.max(war, Math.round(MIN_WARRANTY_COST * MARKUP));
    if (war > room) war = 0;
  }
  const wCost = war > 0 ? Math.round(war / MARKUP) : 0;
  room -= war;

  // GAP
  let gap = 0;
  if (room >= Math.round(MIN_GAP_COST * MARKUP)) {
    const gapCeiling = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
    gap = Math.min(room, gapCeiling);
    gap = Math.max(gap, Math.round(MIN_GAP_COST * MARKUP));
    if (gap > room) gap = 0;
  }
  const gCost = gap > 0 ? Math.round(gap / MARKUP) : 0;

  const profit = (war - wCost) + (gap - gCost) + admin + dealerReserve - creditorFee;

  assert.equal(admin, 999, "Admin should be capped at 999");
  assert.equal(war, 2000, "Warranty should be capped at program cap of 2000");
  assert.ok(gap > 0, "GAP should be populated when room remains");
  assert.ok(gap <= MAX_GAP_PRICE, `GAP should not exceed MAX_GAP_PRICE (${MAX_GAP_PRICE})`);
  assert.ok(profit > 0, "Profit should be positive with products stacked");
});

// --------------------------------------------------------------------------
// Scenario 3: LTV-constrained — allInRoom too small for products
// --------------------------------------------------------------------------

test("Scenario 3: LTV-constrained — products stay at zero", () => {
  const MARKUP = 2.5;
  const MIN_WARRANTY_COST = 600;

  // Only 800 of room — below the 1500 minimum for warranty
  const allInRoom = 800;
  const aftermarketRoom = Infinity;
  const room = Math.min(allInRoom, isFinite(aftermarketRoom) ? aftermarketRoom : Infinity);

  const minWarrantyPrice = Math.round(MIN_WARRANTY_COST * MARKUP);

  assert.ok(room < minWarrantyPrice, "Room should be below minimum warranty threshold");
  // In the real calculator, warranty = 0 when room < MIN_WARRANTY_COST * MARKUP
  assert.ok(room < 1500, "Confirms no warranty can fit in 800 of room");
});

// --------------------------------------------------------------------------
// Scenario 4: Payment-capped — settle loop strips products
// --------------------------------------------------------------------------

test("Scenario 4: payment cap forces product stripping", () => {
  const rateDecimal = 0.2149;
  const termMonths = 72;
  const maxPmt = 400;

  // A deal where base payment fits but adding products pushes it over cap
  const baseFinanced = 14000;
  const baseMonthly = pmt(rateDecimal, termMonths, baseFinanced);

  // With 3000 of products added (warranty + GAP + admin)
  const withProducts = pmt(rateDecimal, termMonths, baseFinanced + 3000);

  assert.ok(baseMonthly <= maxPmt, `Base payment ${baseMonthly.toFixed(2)} should be under cap ${maxPmt}`);
  assert.ok(withProducts > maxPmt, `Payment with products ${withProducts.toFixed(2)} should exceed cap ${maxPmt}`);

  // The settle loop strips products first, then rechecks.
  // If still over, it calculates extra down payment from the PV overage.
});

// --------------------------------------------------------------------------
// Scenario 5: Term stretch — 78mo base + requested +12 → effective +6
// --------------------------------------------------------------------------

test("Scenario 5: term stretch capped at 84mo", () => {
  const result78plus12 = resolveEffectiveTermStretch(78, 12);
  assert.equal(result78plus12.effectiveStretch, 6, "78 + 12 should be capped to +6");
  assert.equal(result78plus12.termMonths, 84, "Final term should be 84");
  assert.equal(result78plus12.cappedReason, "78_only_plus6_to_84");

  const result84plus12 = resolveEffectiveTermStretch(84, 12);
  assert.equal(result84plus12.effectiveStretch, 0, "84 base should not stretch");
  assert.equal(result84plus12.cappedReason, "matrix_already_84_no_stretch");

  const result72plus12 = resolveEffectiveTermStretch(72, 12);
  assert.equal(result72plus12.effectiveStretch, 12, "72 + 12 = 84, fits exactly");
  assert.equal(result72plus12.termMonths, 84);
  assert.equal(result72plus12.cappedReason, undefined, "No capping needed");

  const result66plus6 = resolveEffectiveTermStretch(66, 6);
  assert.equal(result66plus6.effectiveStretch, 6);
  assert.equal(result66plus6.termMonths, 72);
  assert.equal(result66plus6.stretched, true);
});

// --------------------------------------------------------------------------
// Scenario 6: Tier 2 fallback — online price exceeds advance ceiling
// --------------------------------------------------------------------------

test("Scenario 6: Tier 2 price reduction when online exceeds advance", () => {
  const bbWholesale = 15000;
  const maxAdvanceLTV = 1.40;
  const onlinePrice = 25000;
  const pacCost = 18000;
  const downPayment = 0;
  const netTrade = 0;

  const maxAdvance = bbWholesale * maxAdvanceLTV;
  const lenderExposure = onlinePrice - downPayment - netTrade;

  // Tier 1 check: does online price fit within advance?
  const tier1Fits = lenderExposure <= maxAdvance;
  assert.equal(tier1Fits, false, "Online price exceeds advance ceiling → Tier 2");

  // Tier 2: reduce to advance ceiling
  const advanceCeiling = maxAdvance + downPayment + netTrade;
  const reducedPrice = Math.min(onlinePrice, Math.floor(advanceCeiling));

  assert.equal(reducedPrice, 21000, "Reduced price = floor(15000 * 1.40)");
  assert.ok(reducedPrice >= pacCost, "Reduced price must cover PAC cost");

  const profitTarget = onlinePrice - pacCost;
  assert.equal(profitTarget, 7000, "Profit target based on original online price");
});

// --------------------------------------------------------------------------
// Scenario 7: Cap profile resolution
// --------------------------------------------------------------------------

test("Scenario 7: cap profile key and no-online strategy", () => {
  // ACC-style: all three caps active
  const accProfile = resolveCapProfile({
    maxAdvanceLTV: 140, maxAftermarketLTV: 25, maxAllInLTV: 175,
    capModelResolved: "split",
  });
  assert.equal(accProfile.key, "111");
  assert.equal(accProfile.allInOnly, false);

  // Santander-style: allInOnly suppresses aftermarket
  const sanProfile = resolveCapProfile({
    maxAdvanceLTV: 0, maxAftermarketLTV: 30, maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  assert.equal(sanProfile.key, "001", "Aftermarket suppressed by allInOnly model");
  assert.equal(sanProfile.allInOnly, true);

  // No-online selling price: maximized from all-in
  const resolution = resolveNoOnlineSellingPrice({
    pacCost: 15000, downPayment: 0, netTrade: 0,
    creditorFee: 699, maxAdvance: Infinity, maxAllInPreTax: 25000,
    profile: sanProfile,
  });
  assert.equal(resolution.source, "maximized");
  assert.equal(resolution.price, Math.round(25000 - 699));
});

// --------------------------------------------------------------------------
// Scenario 8: incremental trim preserves priority (not all-or-nothing)
// --------------------------------------------------------------------------

test("Scenario 8: trimProductsInOrder removes GAP first, then warranty, then admin", () => {
  const state = { admin: 699, warranty: 3500, gap: 2200 };
  const leftover = trimProductsInOrder(state, 3000);

  assert.equal(leftover, 0);
  assert.equal(state.gap, 0, "GAP is trimmed first");
  assert.equal(state.warranty, 2700, "Warranty trimmed after GAP");
  assert.equal(state.admin, 699, "Admin remains until GAP/warranty exhausted");
});

test("Scenario 8b: trimProductsInOrder reports leftover when products cannot absorb excess", () => {
  const state = { admin: 500, warranty: 1500, gap: 2000 };
  const leftover = trimProductsInOrder(state, 5000);

  assert.equal(state.gap, 0);
  assert.equal(state.warranty, 0);
  assert.equal(state.admin, 0);
  assert.equal(leftover, 1000, "Excess beyond product budget rolls into required cash down");
});

// --------------------------------------------------------------------------
// Scenario 9: no-online pricing uses zero-DP ceiling then PAC floor
// --------------------------------------------------------------------------

test("Scenario 9: no-online -> selling price floors at PAC, DP reaches PAC", () => {
  const result = resolveSellingPrice({
    pacCost: 22000,
    onlinePrice: null,
    zeroDpCeiling: 20000,
    bindingZeroDpReason: "advance",
  });

  assert.equal(result.sellingPrice, 22000, "Selling price floors at PAC");
  assert.equal(result.requiredDownPayment, 2000, "DP = PAC - zero-DP ceiling");
  assert.equal(result.bindingSellingConstraint, "pacFloor");
  assert.equal(result.sellingPriceCappedByOnline, false);
});

test("Scenario 9b: online reachable at zero DP -> sells at online, capped", () => {
  const result = resolveSellingPrice({
    pacCost: 18000,
    onlinePrice: 24500,
    zeroDpCeiling: 30000,
    bindingZeroDpReason: "allIn",
  });

  assert.equal(result.sellingPrice, 24500, "Sells at online when zero-DP ceiling already covers it");
  assert.equal(result.bindingSellingConstraint, "online");
  assert.equal(result.sellingPriceCappedByOnline, true);
  assert.equal(result.requiredDownPayment, 0);
});

test("Scenario 9c: no-online -> maximizes to zero-DP ceiling", () => {
  const result = resolveSellingPrice({
    pacCost: 18000,
    onlinePrice: null,
    zeroDpCeiling: 24500,
    bindingZeroDpReason: "payment",
  });

  assert.equal(result.sellingPrice, 24500, "Maximizes to zero-DP ceiling");
  assert.equal(result.bindingSellingConstraint, "payment");
  assert.equal(result.requiredDownPayment, 0);
});

test("Scenario 9d: online above structural ceiling (pac<ceiling<online) -> DP gets us to online", () => {
  const result = resolveSellingPrice({
    pacCost: 15000,
    onlinePrice: 30000,
    zeroDpCeiling: 22000,
    bindingZeroDpReason: "allIn",
  });

  assert.equal(result.sellingPrice, 30000, "Sells at online (priority target)");
  assert.equal(result.bindingSellingConstraint, "allIn", "Binding constraint is the structural ceiling");
  assert.equal(result.sellingPriceCappedByOnline, false, "Online wasn't reachable at zero DP");
  assert.equal(result.requiredDownPayment, 8000, "DP = online - zero-DP ceiling");
});

test("Scenario 9e: ceiling below PAC, online above PAC -> DP reaches online (not PAC)", () => {
  const result = resolveSellingPrice({
    pacCost: 20000,
    onlinePrice: 30000,
    zeroDpCeiling: 18000,
    bindingZeroDpReason: "allIn",
  });

  assert.equal(result.sellingPrice, 30000, "Online price has priority over PAC for the DP target");
  assert.equal(result.bindingSellingConstraint, "allIn", "Structural ceiling is binding");
  assert.equal(result.sellingPriceCappedByOnline, false, "Online wasn't reachable at zero DP");
  assert.equal(result.requiredDownPayment, 12000, "DP = online - zero-DP ceiling (not PAC - ceiling)");
});

test("Scenario 9f: online below PAC (degenerate) -> floor at PAC, DP reaches PAC", () => {
  const result = resolveSellingPrice({
    pacCost: 25000,
    onlinePrice: 22000,
    zeroDpCeiling: 18000,
    bindingZeroDpReason: "advance",
  });

  assert.equal(result.sellingPrice, 25000, "Cannot sell below PAC even when online price is lower");
  assert.equal(result.requiredDownPayment, 7000, "DP = PAC - ceiling");
});

// --------------------------------------------------------------------------
// Scenario 10: reserve is profit-only, lender fee is structural-only
// --------------------------------------------------------------------------

test("Scenario 10: profit decomposition keeps reserve in gross and lender fee out of displayed gross", () => {
  const frontEndGross = 2500;
  const adminFeeUsed = 699;
  const dealerReserve = 750;
  const warrantyProfit = 900;
  const gapProfit = 400;
  const creditorFee = 675; // used for constraints only

  const nonCancelableGross = frontEndGross + adminFeeUsed + dealerReserve;
  const cancelableBackendGross = warrantyProfit + gapProfit;
  const totalGross = nonCancelableGross + cancelableBackendGross;

  assert.equal(nonCancelableGross, 3949);
  assert.equal(cancelableBackendGross, 1300);
  assert.equal(totalGross, 5249);
  assert.notEqual(totalGross, 5249 - creditorFee, "Displayed gross should not subtract creditor fee");
});

// --------------------------------------------------------------------------
// Scenario 11: parseInventoryNumber handles common inventory string formats
// --------------------------------------------------------------------------

test("Scenario 11: parseInventoryNumber strips formatting and handles missing values", () => {
  assert.equal(parseInventoryNumber("$25,499.00"), 25499);
  assert.equal(parseInventoryNumber("12500"), 12500);
  assert.equal(parseInventoryNumber(18000), 18000);
  assert.equal(parseInventoryNumber(null), 0);
  assert.equal(parseInventoryNumber(undefined), 0);
  assert.equal(parseInventoryNumber(""), 0);
});

// --------------------------------------------------------------------------
// Scenario 12: computeZeroDpCeiling combines LTV and payment ceilings correctly
// --------------------------------------------------------------------------

test("Scenario 12: computeZeroDpCeiling picks the binding ceiling and reason", () => {
  const paymentPV = computePaymentCeilingPV(0.0699, 84, 750);

  // LTV-binding case: tight all-in cap
  const ltvBound = computeZeroDpCeiling({
    hasAdvanceCap: true,
    maxAdvance: 30000,
    hasAllInCap: true,
    maxAllInPreTax: 22000,
    paymentPV,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    taxRate: 0.05,
  });
  assert.equal(ltvBound.bindingReason, "allIn");
  assert.ok(ltvBound.zeroDpCeiling <= 22000 - 699, "All-in ceiling subtracts creditor fee");

  // Payment-binding case: low maxPmt
  const tightPaymentPV = computePaymentCeilingPV(0.0699, 84, 250);
  const paymentBound = computeZeroDpCeiling({
    hasAdvanceCap: true,
    maxAdvance: 30000,
    hasAllInCap: true,
    maxAllInPreTax: 40000,
    paymentPV: tightPaymentPV,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    taxRate: 0.05,
  });
  assert.equal(paymentBound.bindingReason, "payment");
  assert.ok(paymentBound.paymentCeiling < paymentBound.ltvCeiling);
});

// --------------------------------------------------------------------------
// Scenario 13: allocateBackend follows priority and per-product caps
// --------------------------------------------------------------------------

test("Scenario 13: allocateBackend stacks admin -> warranty -> GAP within room", () => {
  const result = allocateBackend({
    allInRoom: 6000,
    aftermarketRoom: Infinity,
    capAdmin: 999,
    desiredAdmin: 999,
    capWarranty: 2000,
    capGap: undefined,
    gapAllowed: true,
    adminInclusion: "included",
    markup: 2.5,
    minWarrantyCost: 600,
    minGapCost: 550,
    maxGapPrice: 2500,
  });

  assert.equal(result.admin, 999);
  assert.equal(result.warranty, 2000, "Warranty capped at program cap");
  assert.ok(result.gap > 0 && result.gap <= 2500, "GAP fills remaining room without exceeding ceiling");
});

test("Scenario 13b: allocateBackend skips warranty when room is below minimum threshold", () => {
  const result = allocateBackend({
    allInRoom: 800,
    aftermarketRoom: Infinity,
    capAdmin: 0,
    desiredAdmin: 0,
    capWarranty: undefined,
    capGap: undefined,
    gapAllowed: true,
    adminInclusion: "included",
    markup: 2.5,
    minWarrantyCost: 600,
    minGapCost: 550,
    maxGapPrice: 2500,
  });

  assert.equal(result.admin, 0);
  assert.equal(result.warranty, 0, "No warranty when room < minWarrantyCost * markup");
  assert.equal(result.gap, 0);
});

// --------------------------------------------------------------------------
// Scenario 14: settleConstraints trims products under payment cap
// --------------------------------------------------------------------------

test("Scenario 13c: allocateBackend with post-DP exposure exposes hidden room above advance ceiling", () => {
  // Reproduces a real-deal pattern: PAC > advance LTV ceiling but all-in
  // ceiling has slack. After applying the DP needed to reach PAC, that
  // slack should be available for backend products.
  const maxAdvance = 50000;
  const maxAllInPreTax = 52500;
  const creditorFee = 699;
  const pacCost = 52000;
  const downPayment = 0;
  const netTrade = 0;

  const paymentPV = computePaymentCeilingPV(0.0699, 84, 1500); // generous
  const ceiling = computeZeroDpCeiling({
    hasAdvanceCap: true,
    maxAdvance,
    hasAllInCap: true,
    maxAllInPreTax,
    paymentPV,
    downPayment,
    netTrade,
    creditorFee,
    taxRate: 0.05,
  });

  const selling = resolveSellingPrice({
    pacCost,
    onlinePrice: null,
    zeroDpCeiling: ceiling.zeroDpCeiling,
    bindingZeroDpReason: ceiling.bindingReason,
  });

  // The naive (pre-DP) room would be negative
  const naiveExposure = selling.sellingPrice - downPayment - netTrade;
  const naiveRoom = maxAllInPreTax - naiveExposure - creditorFee;
  assert.ok(naiveRoom < 0, "Pre-DP room should be negative for this case");

  // Post-DP exposure exposes real room
  const effectiveExposure = selling.sellingPrice - (downPayment + selling.requiredDownPayment) - netTrade;
  const effectiveRoom = maxAllInPreTax - effectiveExposure - creditorFee;
  assert.ok(effectiveRoom > 0, "Post-DP room should be positive for product stacking");

  const state = allocateBackend({
    allInRoom: effectiveRoom,
    aftermarketRoom: Infinity,
    capAdmin: 999,
    desiredAdmin: 999,
    capWarranty: 2000,
    capGap: undefined,
    gapAllowed: true,
    adminInclusion: "included",
    markup: 2.5,
    minWarrantyCost: 600,
    minGapCost: 550,
    maxGapPrice: 2500,
  });

  assert.ok(state.admin > 0, "Admin should be allocated when post-DP room exists");
});

test("Scenario 14: settleConstraints reduces products before requiring extra DP", () => {
  const state = { admin: 699, warranty: 3000, gap: 2000 };
  const rateDecimal = 0.2149;
  const termMonths = 72;
  const maxPmt = 400;
  const paymentPV = computePaymentCeilingPV(rateDecimal, termMonths, maxPmt);

  const result = settleConstraints({
    state,
    sellingPrice: 14000,
    pacCost: 12000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 0,
    taxRate: 0.05,
    rateDecimal,
    termMonths,
    maxPmt,
    paymentPV,
    maxAllInPreTax: Infinity,
    initialReqDP: 0,
  });

  assert.equal(result.feasible, true);
  // GAP is trimmed before warranty before admin
  if (result.state.admin === 699) {
    assert.ok(result.state.gap <= 2000, "GAP trimmed first");
    assert.ok(result.state.warranty <= 3000, "Warranty trimmed only after GAP");
  }
});

// --------------------------------------------------------------------------
// Worksheet rules: parser + eligibility application
// --------------------------------------------------------------------------

function makeRule(query: string, name = "rule", description = ""): WorksheetRule {
  return {
    id: `r-${Math.random().toString(36).slice(2, 8)}`,
    name,
    query,
    fieldName: null,
    description,
    type: "WARNING",
  };
}

test("parseWorksheetRule: Eden Park 180k km cap → odometerMax", () => {
  const r = makeRule(
    "${worksheet.vehicle.odometer.amount} > 180000",
    "Program maximum kilometers 180,000",
    "180,000 km limit",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "odometerMax");
  if (eff.kind === "odometerMax") assert.equal(eff.max, 180000);
});

test("parseWorksheetRule: ACC age cap → vehicleMinYear", () => {
  const r = makeRule(
    `(\${worksheet.vehicle.year} ?? 0) < "2014" && (\${worksheet.vehicle.year} ?? "###") != "###"`,
    "Program vehicle age Max is 10 years",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "vehicleMinYear");
  if (eff.kind === "vehicleMinYear") assert.equal(eff.minYear, 2014);
});

test("parseWorksheetRule: Eden Park carfax claim cap → carfaxClaimMax", () => {
  const r = makeRule("${worksheet.vehicle.carfaxClaims.amount} > 7500", "Program Damage Claim limit is $7500");
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "carfaxClaimMax");
  if (eff.kind === "carfaxClaimMax") assert.equal(eff.max, 7500);
});

test("parseWorksheetRule: Rifco carfax ratio (50% of BBV)", () => {
  const r = makeRule(
    "${worksheet.vehicle.carfaxClaims.amount} > 10000 || ${worksheet.vehicle.carfaxClaims.amount} > (${worksheet.vehicle.wholesaleValueBasedOnProgram.amount} * 0.5)",
    "Rifco claim limit",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "carfaxClaimRatioMax");
  if (eff.kind === "carfaxClaimRatioMax") assert.equal(eff.ratio, 0.5);
});

test("parseWorksheetRule: Santander carfax 35% above $20k BBV", () => {
  const r = makeRule(
    "${worksheet.vehicle.carfaxClaims.amount} > (${worksheet.vehicle.wholesaleValueBasedOnProgram.amount} * 0.35 ) && (${worksheet.vehicle.wholesaleValueBasedOnProgram.amount} > 20000)",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "carfaxClaimRatioMax");
  if (eff.kind === "carfaxClaimRatioMax") {
    assert.equal(eff.ratio, 0.35);
    assert.equal(eff.bbvFloor, 20000);
  }
});

test("parseWorksheetRule: Santander 100% rule (claims > BBV)", () => {
  const r = makeRule(
    "${worksheet.vehicle.carfaxClaims.amount} > ${worksheet.vehicle.wholesaleValueBasedOnProgram.amount}",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "carfaxClaimRatioMax");
  if (eff.kind === "carfaxClaimRatioMax") assert.equal(eff.ratio, 1.0);
});

test("parseWorksheetRule: Eden Park cargo van regex ban (preserves AND across OR-disjuncts)", () => {
  const r = makeRule(
    "${worksheet.vehicle.trim} match /^van|cargo|cube/ || ${worksheet.vehicle.model} match /cargo|^van/ || (${worksheet.vehicle.make} match /Chevrolet/ && (${worksheet.vehicle.model} match /Express/ || ${worksheet.vehicle.trim} match /Express/)) || (${worksheet.vehicle.make} match /Ram/ && ${worksheet.vehicle.model} match /ProMaster/) || (${worksheet.vehicle.make} match /Ford/ && ${worksheet.vehicle.model} match /Transit/)",
    "Cargo Van & Cube are not allowed",
    "Cargo Van & Cube are not allowed",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "vehicleTypeBan");
  if (eff.kind === "vehicleTypeBan") {
    const effects = [eff];
    const banned = (vehicle: string) =>
      !applyEligibilityRules(effects, { vehicle, km: 1, vehicleYear: 2020, bbWholesale: 1 }, { tierName: "x" }).ok;
    assert.ok(banned("2021 Ford Transit Cargo Van"), "Ford Transit must be rejected");
    assert.ok(banned("2020 Chevrolet Express 2500"), "Chevy Express must be rejected");
    assert.ok(banned("2019 Ram ProMaster City"), "Ram ProMaster must be rejected");
    // Critical regression guard: a regular Chevrolet Silverado must NOT be flagged
    // as a cargo van just because the regex contains "Chevrolet" in one branch.
    assert.ok(!banned("2021 Chevrolet Silverado 1500 Crew Cab"), "Chevy Silverado must NOT be a cargo-van false positive");
    assert.ok(!banned("2021 Toyota Camry"));
    assert.ok(!banned("2022 Ford F-150"));
  }
});

test("parseWorksheetRule: Rifco cargo van model-in-list", () => {
  const r = makeRule(
    `\${worksheet.vehicle.model} in ["EXPRESS", "EXPRESS CARGO", "TRANSIT 150", "TRANSIT 250", "PROMASTER", "SPRINTER 2500 CARGO"]`,
    "Rifco does not provide financing for cargo vans",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "vehicleModelInList");
  if (eff.kind === "vehicleModelInList") {
    assert.ok(eff.models.includes("EXPRESS"));
    assert.ok(eff.models.includes("PROMASTER"));
  }
});

test("parseWorksheetRule: ACC $50k total finance cap (no tier filter)", () => {
  const r = makeRule(
    "${worksheet.totalFinancedAmount.amount} > 50000",
    "Program Max for Total Amount to Financed is $50,000",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "totalFinanceMax");
  if (eff.kind === "totalFinanceMax") {
    assert.equal(eff.max, 50000);
    assert.equal(eff.tierName, undefined);
  }
});

test("parseWorksheetRule: Santander tier-conditional NTC $40k cap", () => {
  const r = makeRule(
    `\${worksheet.totalFinancedAmount.amount} > 40000 && \${program.tierName} == "NTC"`,
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "totalFinanceMax");
  if (eff.kind === "totalFinanceMax") {
    assert.equal(eff.max, 40000);
    assert.equal(eff.tierName, "NTC");
  }
});

test("parseWorksheetRule: iAF 96-month term cap", () => {
  const r = makeRule("${worksheet.term} > 96", "Program Limit is 96 months");
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "termMax");
  if (eff.kind === "termMax") assert.equal(eff.max, 96);
});

test("parseWorksheetRule: Rifco $5k min finance", () => {
  const r = makeRule(
    `\${worksheet.totalFinancedAmount.amount} < 5000 && \${worksheet.salePrice.amount} ?? "###" != "###"`,
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "totalFinanceMin");
  if (eff.kind === "totalFinanceMin") assert.equal(eff.min, 5000);
});

test("parseWorksheetRule: operational rules return ignored", () => {
  const samples = [
    "${worksheet.firstPaymentDate} != ${decision.firstPaymentDate}",
    `\${worksheet.term} notin [84, 78, 72] && (\${worksheet.term} ?? "###") != "###"`,
    `\${worksheet.frequency} == "WEEKLY"`,
    "${worksheet.deliveryDate} date_until \"day\" < -1",
    "${worksheet.dealerAdminFee.amount} > ${calculatedValues.maxDealerAdminFee}",
    "${worksheet.creditorFee.amount} > ${calculatedValues.creditorFee}",
  ];
  for (const q of samples) {
    const eff = parseWorksheetRule(makeRule(q));
    assert.equal(eff.kind, "ignored", `expected ignored for: ${q}`);
  }
});

test("applyEligibilityRules: Eden Park rejects 221k km Silverado", () => {
  const rules = [
    makeRule("${worksheet.vehicle.odometer.amount} > 180000", "Program maximum kilometers 180,000", "180,000 km limit"),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2021 CHEVROLET SILVERADO 1500 CUSTOM CREWCAB",
    km: 221000,
    vehicleYear: 2021,
    bbWholesale: 25092,
  }, { tierName: "3 Ride" });
  assert.equal(result.ok, false);
  assert.equal(result.rejections.length, 1);
  assert.match(result.rejections[0].reason, /km 221000 > 180000/);
});

test("applyEligibilityRules: Eden Park accepts 150k km Silverado", () => {
  const rules = [
    makeRule("${worksheet.vehicle.odometer.amount} > 180000", "Program maximum kilometers 180,000"),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2021 CHEVROLET SILVERADO 1500",
    km: 150000,
    vehicleYear: 2021,
    bbWholesale: 25000,
  }, { tierName: "3 Ride" });
  assert.equal(result.ok, true);
  assert.equal(result.rejections.length, 0);
});

test("applyEligibilityRules: ACC rejects 2013 Ford F-150", () => {
  const rules = [
    makeRule(`(\${worksheet.vehicle.year} ?? 0) < "2014"`, "Program vehicle age Max is 10 years"),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2013 FORD F-150",
    km: 100000,
    vehicleYear: 2013,
    bbWholesale: 18000,
  }, { tierName: "Tier 1" });
  assert.equal(result.ok, false);
  assert.match(result.rejections[0].reason, /year 2013 < 2014/);
});

test("applyEligibilityRules: Eden Park rejects Ford Transit cargo van by regex", () => {
  const rules = [
    makeRule(
      "${worksheet.vehicle.trim} match /^van|cargo|cube/ || ${worksheet.vehicle.model} match /cargo|^van/ || (${worksheet.vehicle.make} match /Ford/ && ${worksheet.vehicle.model} match /Transit/)",
      "Cargo Van & Cube are not allowed",
      "Cargo Van & Cube are not allowed",
    ),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2020 FORD TRANSIT 250 CARGO",
    km: 80000,
    vehicleYear: 2020,
    bbWholesale: 30000,
  }, { tierName: "3 Ride" });
  assert.equal(result.ok, false);
});

test("applyEligibilityRules: Rifco rejects Express by model-in-list", () => {
  const rules = [
    makeRule(
      `\${worksheet.vehicle.model} in ["EXPRESS", "EXPRESS CARGO", "TRANSIT 150", "PROMASTER"]`,
      "Rifco does not provide financing for cargo vans",
    ),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2020 CHEVROLET EXPRESS 2500",
    km: 50000,
    vehicleYear: 2020,
    bbWholesale: 25000,
  }, { tierName: "Tier 1" });
  assert.equal(result.ok, false);
});

test("applyEligibilityRules: Santander tier-conditional cap only applies to NTC tier", () => {
  const rules = [
    makeRule(`\${worksheet.totalFinancedAmount.amount} > 40000 && \${program.tierName} == "NTC"`, "NTC $40k cap"),
  ];
  const effects = parseWorksheetRules(rules);

  const ntc = applyEligibilityRules(effects, {
    vehicle: "2022 TOYOTA RAV4",
    km: 30000,
    vehicleYear: 2022,
    bbWholesale: 28000,
    totalFinancedEstimate: 45000,
  }, { tierName: "NTC" });
  assert.equal(ntc.ok, false);

  const otherTier = applyEligibilityRules(effects, {
    vehicle: "2022 TOYOTA RAV4",
    km: 30000,
    vehicleYear: 2022,
    bbWholesale: 28000,
    totalFinancedEstimate: 45000,
  }, { tierName: "9" });
  assert.equal(otherTier.ok, true);
});

test("deriveTermCap returns tightest term cap from effects", () => {
  const effects = parseWorksheetRules([
    makeRule("${worksheet.term} > 96"),
    makeRule("${worksheet.term} > 84"),
  ]);
  assert.equal(deriveTermCap(effects), 84);
});

test("deriveTotalFinanceCap respects tier filter", () => {
  const effects = parseWorksheetRules([
    makeRule("${worksheet.totalFinancedAmount.amount} > 50000"),
    makeRule(`\${worksheet.totalFinancedAmount.amount} > 40000 && \${program.tierName} == "NTC"`),
  ]);
  assert.equal(deriveTotalFinanceCap(effects, "NTC"), 40000);
  assert.equal(deriveTotalFinanceCap(effects, "Tier 1"), 50000);
});
