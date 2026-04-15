import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, type InventoryItem } from "../lib/inventoryCache.js";
import {
  getLenderSyncStatus,
  getCachedLenderPrograms,
  runLenderSync,
} from "../lib/lenderWorker.js";
import type { VehicleTermMatrixEntry, VehicleConditionMatrixEntry } from "../lib/bbObjectStore.js";
import {
  resolveCapProfile,
  resolveNoOnlineSellingPrice,
  NO_ONLINE_STRATEGY_BY_PROFILE,
} from "../lib/lenderCalcEngine.js";
import { getRuntimeFingerprint } from "../lib/runtimeFingerprint.js";

const router = Router();

async function getUserRole(req: any): Promise<string> {
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) return "owner";
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  return entry?.role ?? "viewer";
}

async function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = await getUserRole(req);
  if (role !== "owner") {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

async function requireOwnerOrViewer(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = await getUserRole(req);
  if (role !== "owner" && role !== "viewer") {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  (req as any)._role = role;
  next();
}

router.get("/lender-programs", requireOwnerOrViewer, async (req, res) => {
  const programs = getCachedLenderPrograms();
  if (!programs) {
    res.json({ programs: [], updatedAt: null, role: (req as any)._role });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json({ ...programs, role: (req as any)._role });
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
    role:         (req as any)._role,
  });
});

router.post("/refresh-lender", requireOwner, async (_req, res) => {
  const s = getLenderSyncStatus();
  if (s.running) {
    res.json({ ok: false, message: "Already running", running: true });
    return;
  }
  const { LENDER_ENABLED } = await import("../lib/lenderAuth.js");
  if (!LENDER_ENABLED) {
    res.json({ ok: false, message: "Lender credentials not configured", running: false });
    return;
  }
  runLenderSync().catch((err) =>
    logger.error({ err }, "Manual lender sync error"),
  );
  res.json({ ok: true, message: "Lender sync started", running: true });
});

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
  adminFee?:       number;
}

function pmt(rate: number, nper: number, pv: number): number {
  if (rate === 0) return pv / nper;
  const r = rate / 12;
  return (pv * r * Math.pow(1 + r, nper)) / (Math.pow(1 + r, nper) - 1);
}

function parseVehicleYear(vehicle: string): number | null {
  const match = vehicle.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}

function lookupTerm(
  matrix: VehicleTermMatrixEntry[],
  year: number,
  km: number,
): number | null {
  const entry = matrix.find(e => e.year === year);
  if (!entry) return null;
  const match = entry.data.find(d => km >= d.kmFrom && km <= d.kmTo);
  return match ? match.term : null;
}

type ConditionBucket = "extraClean" | "clean" | "average" | "rough";
const conditionToBBField: Record<ConditionBucket, keyof NonNullable<InventoryItem["bbValues"]>> = {
  extraClean: "xclean",
  clean:      "clean",
  average:    "avg",
  rough:      "rough",
};

function lookupCondition(
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

  // CreditApp fee calculation fields: positive numbers are real caps, 0 means "no cap set"
  let capWarranty = (guide.maxWarrantyPrice != null && guide.maxWarrantyPrice > 0) ? guide.maxWarrantyPrice : undefined;
  let capGap      = (guide.maxGapPrice != null && guide.maxGapPrice > 0)           ? guide.maxGapPrice      : undefined;
  // ACC-style AH routing fallback: when GAP target is AH and gap field resolves to 0/not-set,
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

  interface Result {
    vin: string; vehicle: string; location: string; term: number;
    conditionUsed: string; bbWholesale: number; sellingPrice: number;
    priceSource: string; adminFeeUsed: number; warrantyPrice: number;
    warrantyCost: number; gapPrice: number; gapCost: number;
    totalFinanced: number; monthlyPayment: number; profit: number;
    hasPhotos: boolean; website: string;
  }

  const results: Result[] = [];
  const debugCounts = { total: 0, noYear: 0, noKm: 0, noTerm: 0, noCondition: 0, noBB: 0, noBBVal: 0, noPrice: 0, ltvAdvance: 0, ltvMinAftermarket: 0, ltvAllIn: 0, negFinanced: 0, dealValue: 0, maxPmtFilter: 0, passed: 0 };

  for (const item of inventory) {
    debugCounts.total++;
    const vehicleYear = parseVehicleYear(item.vehicle);
    if (!vehicleYear) { debugCounts.noYear++; continue; }

    const km = parseInt(item.km?.replace(/[^0-9]/g, "") || "0", 10);
    if (!km || km <= 0) { debugCounts.noKm++; continue; }

    const termMonths = lookupTerm(guide.vehicleTermMatrix, vehicleYear, km);
    if (!termMonths) { debugCounts.noTerm++; continue; }

    const condition = lookupCondition(guide.vehicleConditionMatrix, vehicleYear, km);
    if (!condition) { debugCounts.noCondition++; continue; }

    if (!item.bbValues) { debugCounts.noBB++; continue; }
    const bbField = conditionToBBField[condition];
    const bbWholesale = item.bbValues[bbField];
    if (!bbWholesale || bbWholesale <= 0) { debugCounts.noBBVal++; continue; }

    const rawOnline = parseFloat(item.onlinePrice?.replace(/[^0-9.]/g, "") || "0");
    const pacCost   = parseFloat(item.cost?.replace(/[^0-9.]/g, "") || "0");
    if (pacCost <= 0) { debugCounts.noPrice++; continue; }

    const maxAdvance = hasAdvanceCap ? bbWholesale * maxAdvanceLTV : Infinity;
    const maxAllInWithTax = hasAllInCap ? bbWholesale * maxAllInLTV : Infinity;
    const maxAllInPreTax = isFinite(maxAllInWithTax) ? (maxAllInWithTax / allInTaxMultiplier) : Infinity;

    // ============================================================
    //  PATH A: Online price exists — price is fixed, stack products
    //  PATH B: No online price + has advance cap — sell at advance
    //          ceiling, stack products in remaining room
    //  PATH C: No online price + all-in only — sell at all-in
    //          ceiling, no products
    // ============================================================

    let sellingPrice = 0;
    let priceSource  = "";
    let effectiveAdmin = 0;
    let warPrice = 0;
    let warCost  = 0;
    let gapPr    = 0;
    let gCost    = 0;

    if (rawOnline > 0) {
      // --- PATH A: online price is fixed ---
      sellingPrice = rawOnline;
      priceSource  = "online";
      if (sellingPrice < pacCost) { debugCounts.noPrice++; continue; }

      const lenderExposure = sellingPrice - downPayment - netTrade;
      if (isFinite(maxAdvance) && lenderExposure > maxAdvance) { debugCounts.ltvAdvance++; continue; }

      const allInRoom = isFinite(maxAllInPreTax) ? maxAllInPreTax - lenderExposure - creditorFee : Infinity;
      if (isFinite(allInRoom) && allInRoom < 0) { debugCounts.ltvAllIn++; continue; }

      // Product room: limited by aftermarket LTV and/or all-in room
      const aftermarketBaseValue = guide.aftermarketBase === "salePrice" ? sellingPrice : bbWholesale;
      const aftermarketCap = hasAftermarketCap ? aftermarketBaseValue * maxAftermarketLTV : Infinity;
      let productRoom = isFinite(allInRoom) ? allInRoom : Infinity;
      if (isFinite(aftermarketCap)) productRoom = Math.min(productRoom, aftermarketCap);

      if (!isFinite(productRoom)) {
        productRoom = 0;
      }

      // Room for warranty+GAP after admin takes priority
      let warGapRoom = productRoom;

      // Admin fee (first priority)
      if (adminInclusion === "excluded") {
        const adminFromCap = capAdmin != null ? Math.min(desiredAdmin, capAdmin) : desiredAdmin;
        const allInAdminRoom = isFinite(allInRoom) ? Math.max(0, Math.floor(allInRoom)) : adminFromCap;
        effectiveAdmin = Math.min(adminFromCap, allInAdminRoom);
        if (isFinite(allInRoom)) {
          warGapRoom = Math.min(warGapRoom, Math.max(0, allInRoom - effectiveAdmin));
        }
      } else {
        const adminFromCap = capAdmin != null ? Math.min(desiredAdmin, capAdmin) : desiredAdmin;
        effectiveAdmin = Math.min(adminFromCap, Math.floor(productRoom));
        productRoom -= effectiveAdmin;
        if (productRoom < 0) productRoom = 0;
        warGapRoom = productRoom;
      }

      // Warranty (second priority)
      if (warGapRoom >= Math.round(MIN_WARRANTY_COST * MARKUP)) {
        warPrice = capWarranty != null ? Math.min(warGapRoom, capWarranty) : warGapRoom;
        warPrice = Math.max(warPrice, Math.round(MIN_WARRANTY_COST * MARKUP));
        if (warPrice > warGapRoom) warPrice = 0;
      }
      warCost = warPrice > 0 ? Math.round(warPrice / MARKUP) : 0;
      warGapRoom -= warPrice;

      // GAP (third priority, max $1500 markup)
      if (gapAllowed && warGapRoom >= Math.round(MIN_GAP_COST * MARKUP)) {
        const gapCeiling = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
        gapPr = Math.min(warGapRoom, gapCeiling);
        gapPr = Math.max(gapPr, Math.round(MIN_GAP_COST * MARKUP));
        if (gapPr > warGapRoom) gapPr = 0;
      }
      gCost = gapPr > 0 ? Math.round(gapPr / MARKUP) : 0;

    } else {
      // --- PATH B/C/PROFILED: no online price ---
      const noOnlineResolution = resolveNoOnlineSellingPrice({
        pacCost,
        downPayment,
        netTrade,
        creditorFee,
        maxAdvance,
        maxAllInPreTax,
        profile: capProfile,
      });

      if (noOnlineResolution.rejection === "ltvAllIn") { debugCounts.ltvAllIn++; continue; }
      if (noOnlineResolution.rejection === "ltvAdvance") { debugCounts.ltvAdvance++; continue; }

      sellingPrice = noOnlineResolution.price;
      priceSource = noOnlineResolution.source;

      if (priceSource === "pac") {
        // No sell-price LTV ceiling exists in this cap profile; keep PAC floor path.
      }

      const lenderExposure = sellingPrice - downPayment - netTrade;
      const allInRoom = isFinite(maxAllInPreTax) ? maxAllInPreTax - lenderExposure - creditorFee : Infinity;
      if (isFinite(allInRoom) && allInRoom < 0) { debugCounts.ltvAllIn++; continue; }

      const aftermarketBaseValue = guide.aftermarketBase === "salePrice" ? sellingPrice : bbWholesale;
      const aftermarketCap = hasAftermarketCap ? aftermarketBaseValue * maxAftermarketLTV : Infinity;
      let productRoom = isFinite(allInRoom) ? allInRoom : Infinity;
      if (isFinite(aftermarketCap)) productRoom = Math.min(productRoom, aftermarketCap);

      if (!isFinite(productRoom)) {
        productRoom = 0;
      }

      // Room for warranty+GAP after admin takes priority
      let warGapRoom = productRoom;

      // Admin fee
      if (adminInclusion === "excluded") {
        const adminFromCap = capAdmin != null ? Math.min(desiredAdmin, capAdmin) : desiredAdmin;
        const allInAdminRoom = isFinite(allInRoom) ? Math.max(0, Math.floor(allInRoom)) : adminFromCap;
        effectiveAdmin = Math.min(adminFromCap, allInAdminRoom);
        if (isFinite(allInRoom)) {
          warGapRoom = Math.min(warGapRoom, Math.max(0, allInRoom - effectiveAdmin));
        }
      } else {
        const adminFromCap = capAdmin != null ? Math.min(desiredAdmin, capAdmin) : desiredAdmin;
        effectiveAdmin = Math.min(adminFromCap, Math.floor(productRoom));
        productRoom -= effectiveAdmin;
        if (productRoom < 0) productRoom = 0;
        warGapRoom = productRoom;
      }

      // Warranty
      if (warGapRoom >= Math.round(MIN_WARRANTY_COST * MARKUP)) {
        warPrice = capWarranty != null ? Math.min(warGapRoom, capWarranty) : warGapRoom;
        warPrice = Math.max(warPrice, Math.round(MIN_WARRANTY_COST * MARKUP));
        if (warPrice > warGapRoom) warPrice = 0;
      }
      warCost = warPrice > 0 ? Math.round(warPrice / MARKUP) : 0;
      warGapRoom -= warPrice;

      // GAP
      if (gapAllowed && warGapRoom >= Math.round(MIN_GAP_COST * MARKUP)) {
        const gapCeiling = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
        gapPr = Math.min(warGapRoom, gapCeiling);
        gapPr = Math.max(gapPr, Math.round(MIN_GAP_COST * MARKUP));
        if (gapPr > warGapRoom) gapPr = 0;
      }
      gCost = gapPr > 0 ? Math.round(gapPr / MARKUP) : 0;
    }

    if (sellingPrice < pacCost) { debugCounts.noPrice++; continue; }

    warPrice = Math.round(warPrice);
    gapPr    = Math.round(gapPr);

    const lenderExposure = sellingPrice - downPayment - netTrade;
    const aftermarketRevenue = warPrice + gapPr;
    const allInSubtotal = lenderExposure + aftermarketRevenue + effectiveAdmin + creditorFee;
    if (isFinite(maxAllInPreTax) && allInSubtotal > maxAllInPreTax) { debugCounts.ltvAllIn++; continue; }
    if (allInSubtotal <= 0) { debugCounts.negFinanced++; continue; }

    const taxes = allInSubtotal * taxRate;
    const totalFinanced = allInSubtotal + taxes;

    const monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);
    if (maxPmt < Infinity && monthlyPayment > maxPmt) { debugCounts.maxPmtFilter++; continue; }
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
      hasPhotos:       item.hasPhotos,
      website:         item.website,
    });
  }

  results.sort((a, b) => b.profit - a.profit);

  const runtime = getRuntimeFingerprint();

  logger.info({
    debugCounts,
    lender: params.lenderCode,
    program: guide.programTitle,
    tier: params.tierName,
    allInOnly,
    hasAdvanceCap,
    hasAftermarketCap,
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
