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
  type ConditionBucket,
} from "../../lib/lenderCalcEngine.js";
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
    passed: 0,
  };

  inventory: for (const item of inventory) {
    debugCounts.total++;
    const vehicleYear = parseVehicleYear(item.vehicle);
    if (!vehicleYear) { debugCounts.noYear++; continue inventory; }

    const km = parseInt(item.km?.replace(/[^0-9]/g, "") || "0", 10);
    if (!km || km <= 0) { debugCounts.noKm++; continue inventory; }

    const baseTerm = lookupTerm(guide.vehicleTermMatrix, vehicleYear, km);
    if (!baseTerm) { debugCounts.noTerm++; continue inventory; }
    const termResolved = resolveEffectiveTermStretch(baseTerm, termStretch);
    const termMonths = termResolved.termMonths;
    const termStretched = termResolved.stretched;
    const termStretchApplied = termResolved.effectiveStretch;
    const termStretchCappedReason = termResolved.cappedReason;

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

    const maxAdvance = hasAdvanceCap ? bbWholesale * maxAdvanceLTV : Infinity;
    const maxAllInWithTax = hasAllInCap ? bbWholesale * maxAllInLTV : Infinity;
    const maxAllInPreTax = isFinite(maxAllInWithTax) ? (maxAllInWithTax / allInTaxMultiplier) : Infinity;

    const paymentPV = computePaymentCeilingPV(rateDecimal, termMonths, maxPmt);
    const ceilingResult = computeZeroDpCeiling({
      hasAdvanceCap,
      maxAdvance,
      hasAllInCap,
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

    const exposure0 = sellingPrice - downPayment - netTrade;
    const allInRoom0 = isFinite(maxAllInPreTax) ? (maxAllInPreTax - exposure0 - creditorFee) : Infinity;
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
      initialReqDP: sellingResolution.requiredDownPaymentForPac,
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
