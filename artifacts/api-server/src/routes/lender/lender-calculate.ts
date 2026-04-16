import { Router } from "express";
import { requireOwnerOrViewer } from "../../lib/auth.js";
import { logger } from "../../lib/logger.js";
import { getCacheState, type InventoryItem } from "../../lib/inventoryCache.js";
import { getCachedLenderPrograms } from "../../lib/lenderWorker.js";
import {
  resolveCapProfile,
  NO_ONLINE_STRATEGY_BY_PROFILE,
  truthyOptionalFlag,
  normalizeTermStretchMonths,
  resolveEffectiveTermStretch,
  pmt,
  parseVehicleYear,
  lookupTerm,
  lookupCondition,
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
  /** When true, keep vehicles that fail LTV/payment and report required extra cash down */
  showAllWithDownPayment?: boolean;
}

const conditionToBBField: Record<ConditionBucket, keyof NonNullable<InventoryItem["bbValues"]>> = {
  extraClean: "xclean",
  clean:      "clean",
  average:    "avg",
  rough:      "rough",
};

router.post("/lender-calculate", requireOwnerOrViewer, async (req, res) => {
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
  const showAllDP = truthyOptionalFlag((params as CalcParams & { showAllWithDownPayment?: unknown }).showAllWithDownPayment);

  interface Result {
    vin: string; vehicle: string; location: string; term: number;
    matrixTerm: number;
    termStretchApplied: 0 | 6 | 12;
    conditionUsed: string; bbWholesale: number; sellingPrice: number;
    priceSource: string; adminFeeUsed: number; warrantyPrice: number;
    warrantyCost: number; gapPrice: number; gapCost: number;
    totalFinanced: number; monthlyPayment: number; profit: number;
    profitTarget: number;
    qualificationTier: 1 | 2;
    hasPhotos: boolean; website: string;
    termStretched: boolean;
    termStretchCappedReason?: string;
    requiredDownPayment?: number;
  }

  /**
   * Allocates aftermarket products into available LTV room in priority order:
   * admin fee → warranty → GAP.
   *
   * Room is the tighter of `allInRoom` and `aftermarketRoom`. Products are only
   * added if the remaining room meets the minimum cost threshold after markup.
   *
   * Key thresholds (from outer scope):
   * - MIN_WARRANTY_COST * MARKUP = 1500 — minimum room needed to add warranty
   * - MIN_GAP_COST * MARKUP = 1375 — minimum room needed to add GAP
   * - MAX_GAP_PRICE = 2500 — hard ceiling on GAP selling price
   * - capWarranty / capGap — per-program caps from CreditApp (may be undefined = uncapped)
   *
   * Admin fee handling depends on `adminInclusion`:
   * - "excluded": admin doesn't consume aftermarket room, only all-in room
   * - other: admin is deducted from shared room before warranty/GAP
   *
   * @returns Object with allocated { admin, war, wCost, gap, gCost, profit }
   *   where profit = (war - wCost) + (gap - gCost) + admin + dealerReserve - creditorFee
   */
  function stackProducts(allInRoom: number, aftermarketRoom: number, sellPrice: number) {
    let room = isFinite(allInRoom) ? allInRoom : Infinity;
    if (isFinite(aftermarketRoom)) room = Math.min(room, aftermarketRoom);
    if (!isFinite(room) || room < 0) room = 0;

    let admin = 0, war = 0, wCost = 0, gap = 0, gCost = 0;
    let warGapRoom = room;

    if (adminInclusion === "excluded") {
      const adminFromCap = capAdmin != null ? Math.min(desiredAdmin, capAdmin) : desiredAdmin;
      const allInAdminRoom = isFinite(allInRoom) ? Math.max(0, Math.floor(allInRoom)) : adminFromCap;
      admin = Math.min(adminFromCap, allInAdminRoom);
      if (isFinite(allInRoom)) {
        warGapRoom = Math.min(warGapRoom, Math.max(0, allInRoom - admin));
      }
    } else {
      const adminFromCap = capAdmin != null ? Math.min(desiredAdmin, capAdmin) : desiredAdmin;
      admin = Math.min(adminFromCap, Math.floor(room));
      room -= admin;
      if (room < 0) room = 0;
      warGapRoom = room;
    }

    if (warGapRoom >= Math.round(MIN_WARRANTY_COST * MARKUP)) {
      war = capWarranty != null ? Math.min(warGapRoom, capWarranty) : warGapRoom;
      war = Math.max(war, Math.round(MIN_WARRANTY_COST * MARKUP));
      if (war > warGapRoom) war = 0;
    }
    wCost = war > 0 ? Math.round(war / MARKUP) : 0;
    warGapRoom -= war;

    if (gapAllowed && warGapRoom >= Math.round(MIN_GAP_COST * MARKUP)) {
      const gapCeiling = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
      gap = Math.min(warGapRoom, gapCeiling);
      gap = Math.max(gap, Math.round(MIN_GAP_COST * MARKUP));
      if (gap > warGapRoom) gap = 0;
    }
    gCost = gap > 0 ? Math.round(gap / MARKUP) : 0;

    war = Math.round(war);
    gap = Math.round(gap);

    const profit = (war - wCost) + (gap - gCost) + admin + dealerReserve - creditorFee;
    return { admin, war, wCost, gap, gCost, profit };
  }

  const results: Result[] = [];
  const debugCounts = { total: 0, noYear: 0, noKm: 0, noTerm: 0, noCondition: 0, noBB: 0, noBBVal: 0, noPrice: 0, ltvAdvance: 0, ltvMinAftermarket: 0, ltvAllIn: 0, negFinanced: 0, dealValue: 0, maxPmtFilter: 0, passed: 0 };

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

    const rawOnline = parseFloat(item.onlinePrice?.replace(/[^0-9.]/g, "") || "0");
    const pacCost   = parseFloat(item.cost?.replace(/[^0-9.]/g, "") || "0");
    if (pacCost <= 0) { debugCounts.noPrice++; continue inventory; }

    const maxAdvance = hasAdvanceCap ? bbWholesale * maxAdvanceLTV : Infinity;
    const maxAllInWithTax = hasAllInCap ? bbWholesale * maxAllInLTV : Infinity;
    const maxAllInPreTax = isFinite(maxAllInWithTax) ? (maxAllInWithTax / allInTaxMultiplier) : Infinity;

    /**
     * TWO-TIER QUALIFICATION LOGIC
     *
     * PATH A (online price exists):
     *   Tier 1: Sell at online price. If lender exposure fits within advance LTV,
     *     stack max products into remaining all-in/aftermarket room.
     *     Profit target = onlinePrice - pacCost (front-end gross).
     *   Tier 2: Online price exceeds advance ceiling. Reduce selling price to
     *     floor(maxAdvance + downPayment + netTrade). Stack products into the
     *     tighter room to recover margin. If reduced price < PAC, requires
     *     cash down (shown only when showAllDP is true).
     *
     * PATH B (no online price):
     *   Sell at PAC cost, stack products. Profit target = 0 (break even).
     *   Classified as Tier 2 (qualificationTier = 2).
     *
     * Hard constraint: sellingPrice >= pacCost in all paths.
     */

    let sellingPrice = 0;
    let priceSource  = "";
    let effectiveAdmin = 0;
    let warPrice = 0;
    let warCost  = 0;
    let gapPr    = 0;
    let gCost    = 0;
    let reqDP    = 0;
    let profitTarget = 0;
    let qualificationTier: 1 | 2 = 1;

    /**
     * Computes how much dollar room is available for aftermarket products,
     * given the lender's exposure on the base deal.
     *
     * Two independent ceilings:
     * - allInRoom: total financed (pre-tax) budget minus exposure and creditor fee.
     *   Formula: maxAllInPreTax - lenderExposure - creditorFee
     *   Returns Infinity when no all-in LTV cap exists.
     * - aftermarketRoom: percentage of a base value (BB wholesale or sale price,
     *   depending on program's `aftermarketBase` setting) times maxAftermarketLTV.
     *   Returns Infinity when no aftermarket cap exists.
     *
     * The caller uses the tighter of these two as the effective product budget.
     */
    function computeRooms(lenderExposure: number, sellPrice: number) {
      const allIn = isFinite(maxAllInPreTax) ? maxAllInPreTax - lenderExposure - creditorFee : Infinity;
      const aftermarketBase = guide.aftermarketBase === "salePrice" ? sellPrice : bbWholesale;
      const aftermarket = hasAftermarketCap ? aftermarketBase * maxAftermarketLTV : Infinity;
      return { allInRoom: allIn, aftermarketRoom: aftermarket };
    }

    if (rawOnline > 0) {
      // --- PATH A: online price exists ---
      if (rawOnline < pacCost) { debugCounts.noPrice++; continue inventory; }
      profitTarget = rawOnline - pacCost;

      const lenderExposure = rawOnline - downPayment - netTrade;
      const tier1FitsAdvance = !isFinite(maxAdvance) || lenderExposure <= maxAdvance;

      if (tier1FitsAdvance) {
        // === TIER 1: sell at online price, stack products into available room ===
        sellingPrice = rawOnline;
        priceSource  = "online";
        qualificationTier = 1;

        const { allInRoom, aftermarketRoom } = computeRooms(lenderExposure, sellingPrice);
        if (isFinite(allInRoom) && allInRoom < 0) {
          // All-in LTV exceeded even without products — needs DP
          if (!showAllDP) { debugCounts.ltvAllIn++; continue inventory; }
          reqDP = Math.ceil(-allInRoom);
        }

        if (reqDP === 0) {
          const products = stackProducts(allInRoom, aftermarketRoom, sellingPrice);
          effectiveAdmin = products.admin;
          warPrice = products.war; warCost = products.wCost;
          gapPr = products.gap;    gCost = products.gCost;
        }
      } else {
        // === TIER 2: reduce selling price to advance LTV ceiling ===
        const advanceCeiling = maxAdvance + downPayment + netTrade;
        sellingPrice = Math.min(rawOnline, Math.floor(advanceCeiling));
        qualificationTier = 2;

        if (sellingPrice < pacCost) {
          // Can't even reach PAC at $0 down — needs DP
          if (!showAllDP) { debugCounts.ltvAdvance++; continue inventory; }
          sellingPrice = pacCost;
          reqDP = Math.ceil(pacCost - advanceCeiling);
          if (reqDP < 0) reqDP = 0;
          priceSource = "pac";
        } else {
          priceSource = "reduced";
        }

        if (reqDP === 0) {
          const t2Exposure = sellingPrice - downPayment - netTrade;
          const { allInRoom, aftermarketRoom } = computeRooms(t2Exposure, sellingPrice);
          if (isFinite(allInRoom) && allInRoom < 0) {
            if (!showAllDP) { debugCounts.ltvAllIn++; continue inventory; }
            reqDP = Math.ceil(-allInRoom);
          } else {
            const products = stackProducts(allInRoom, aftermarketRoom, sellingPrice);
            effectiveAdmin = products.admin;
            warPrice = products.war; warCost = products.wCost;
            gapPr = products.gap;    gCost = products.gCost;

            const frontEnd = sellingPrice - pacCost;
            const totalProfit = frontEnd + products.profit;
            if (totalProfit < profitTarget) {
              // Tier 2 products can't recover the target margin — still include but mark as Tier 2
            }
          }
        }
      }
    } else {
      // --- PATH B: no online price — sell at PAC, stack products ---
      sellingPrice = pacCost;
      priceSource  = "pac";
      profitTarget = 0;
      qualificationTier = 2;

      const lenderExposure = sellingPrice - downPayment - netTrade;

      if (isFinite(maxAdvance) && lenderExposure > maxAdvance) {
        if (!showAllDP) { debugCounts.ltvAdvance++; continue inventory; }
        reqDP = Math.ceil(lenderExposure - maxAdvance);
      }

      if (reqDP === 0) {
        const { allInRoom, aftermarketRoom } = computeRooms(lenderExposure, sellingPrice);
        if (isFinite(allInRoom) && allInRoom < 0) {
          if (!showAllDP) { debugCounts.ltvAllIn++; continue inventory; }
          reqDP = Math.ceil(-allInRoom);
        } else {
          const products = stackProducts(allInRoom, aftermarketRoom, sellingPrice);
          effectiveAdmin = products.admin;
          warPrice = products.war; warCost = products.wCost;
          gapPr = products.gap;    gCost = products.gCost;
        }
      }
    }

    // Hard constraint: selling price must cover PAC
    if (sellingPrice < pacCost) { debugCounts.noPrice++; continue inventory; }

    // When DP is required, strip products — DP covers the base deal only
    if (reqDP > 0) {
      effectiveAdmin = 0;
      warPrice = 0; warCost = 0;
      gapPr = 0;    gCost = 0;
    }

    let aftermarketRevenue = warPrice + gapPr;
    let reqAcc = reqDP;

    let finalExposure!: number;
    let allInSubtotal!: number;
    let taxes!: number;
    let totalFinanced!: number;
    let monthlyPayment!: number;

    /**
     * SETTLE LOOP — iteratively resolves required additional cash down.
     *
     * Each pass recalculates the deal and checks two constraints:
     * 1. All-in LTV: if allInSubtotal > maxAllInPreTax, increases reqAcc
     *    (required additional cash) by the overage amount.
     * 2. Payment cap: if monthlyPayment > maxPmt, first strips all products
     *    (admin/warranty/GAP), then on subsequent passes increases reqAcc
     *    by the present-value overage.
     *
     * Max 24 iterations. Exits on first pass where both constraints are met.
     * If showAllDP is false, vehicles that fail either constraint are skipped
     * entirely (continue inventory) rather than entering this loop.
     */
    settle: for (let pass = 0; pass < 24; pass++) {
      finalExposure = sellingPrice - (downPayment + reqAcc) - netTrade;
      allInSubtotal = finalExposure + aftermarketRevenue + effectiveAdmin + creditorFee;

      if (allInSubtotal <= 0) {
        debugCounts.negFinanced++;
        continue inventory;
      }

      if (isFinite(maxAllInPreTax) && allInSubtotal > maxAllInPreTax) {
        if (!showAllDP) { debugCounts.ltvAllIn++; continue inventory; }
        reqAcc += Math.ceil(allInSubtotal - maxAllInPreTax);
        continue settle;
      }

      taxes = allInSubtotal * taxRate;
      totalFinanced = allInSubtotal + taxes;
      monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);

      if (maxPmt < Infinity && monthlyPayment > maxPmt) {
        if (!showAllDP) {
          debugCounts.maxPmtFilter++;
          continue inventory;
        }
        if (aftermarketRevenue > 0 || effectiveAdmin > 0) {
          effectiveAdmin = 0;
          warPrice = 0; warCost = 0;
          gapPr = 0;    gCost = 0;
          aftermarketRevenue = 0;
          reqAcc = reqDP;
          continue settle;
        }
        const monthlyRate = rateDecimal / 12;
        const targetPV =
          rateDecimal === 0
            ? maxPmt * termMonths
            : maxPmt * ((Math.pow(1 + monthlyRate, termMonths) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, termMonths)));
        const excessPV = totalFinanced - targetPV;
        if (excessPV > 0) {
          reqAcc += Math.ceil(excessPV / (1 + taxRate));
          continue settle;
        }
      }
      break settle;
    }

    reqDP = reqAcc;

    finalExposure = sellingPrice - (downPayment + reqDP) - netTrade;
    allInSubtotal = finalExposure + aftermarketRevenue + effectiveAdmin + creditorFee;
    taxes = allInSubtotal * taxRate;
    totalFinanced = allInSubtotal + taxes;
    monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);

    debugCounts.passed++;

    const frontEndGross  = sellingPrice - pacCost;
    const warrantyProfit = warPrice - warCost;
    const gapProfit      = gapPr - gCost;
    const profit = frontEndGross + warrantyProfit + gapProfit + effectiveAdmin + dealerReserve - creditorFee;

    results.push({
      vin:             item.vin,
      vehicle:         item.vehicle,
      location:        item.location,
      term:            termMonths,
      matrixTerm:      baseTerm,
      termStretchApplied,
      conditionUsed:   condition,
      bbWholesale,
      sellingPrice:    Math.round(sellingPrice),
      priceSource,
      adminFeeUsed:    Math.round(effectiveAdmin),
      warrantyPrice:   warPrice,
      warrantyCost:    warCost,
      gapPrice:        gapPr,
      gapCost:         gCost,
      totalFinanced:   Math.round(totalFinanced),
      monthlyPayment:  Math.round(monthlyPayment * 100) / 100,
      profit:          Math.round(profit),
      profitTarget:    Math.round(profitTarget),
      qualificationTier,
      hasPhotos:       item.hasPhotos,
      website:         item.website,
      termStretched,
      termStretchCappedReason: termStretchCappedReason,
      requiredDownPayment: reqDP > 0 ? Math.round(reqDP) : undefined,
    });
  }

  results.sort((a, b) => b.profit - a.profit);

  const runtime = getRuntimeFingerprint();

  logger.info({
    debugCounts,
    lender: params.lenderCode,
    program: guide.programTitle,
    tier: params.tierName,
    termStretchMonths: termStretch,
    showAllWithDownPayment: showAllDP,
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
    showAllWithDownPayment: showAllDP,
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
    debugCounts,
    resultCount: results.length,
    results,
  });
});

export default router;
