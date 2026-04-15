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

  const hasAdvanceCap    = tier.maxAdvanceLTV > 0;
  const hasAftermarketCap = tier.maxAftermarketLTV > 0;
  const hasAllInCap       = tier.maxAllInLTV > 0;
  const allInOnly         = !hasAdvanceCap && !hasAftermarketCap && hasAllInCap;

  const maxAdvanceLTV     = hasAdvanceCap    ? tier.maxAdvanceLTV / 100    : Infinity;
  const maxAftermarketLTV = hasAftermarketCap ? tier.maxAftermarketLTV / 100 : Infinity;
  const maxAllInLTV       = hasAllInCap       ? tier.maxAllInLTV / 100       : Infinity;

  const adminInclusion = guide.adminFeeInclusion ?? "unknown";

  // For lenders with separate advance/aftermarket LTVs, use CreditApp caps
  const capWarranty = (hasAftermarketCap && guide.maxWarrantyPrice != null) ? guide.maxWarrantyPrice : undefined;
  const capGap      = (hasAftermarketCap && guide.maxGapPrice != null)      ? guide.maxGapPrice      : undefined;
  const capAdmin    = (guide.maxAdminFee != null && guide.maxAdminFee > 0)  ? guide.maxAdminFee      : undefined;
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
    const maxAllIn   = hasAllInCap   ? bbWholesale * maxAllInLTV   : Infinity;

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

      const allInRoom = isFinite(maxAllIn) ? maxAllIn - lenderExposure - creditorFee : Infinity;
      if (isFinite(allInRoom) && allInRoom <= 0) { debugCounts.ltvAllIn++; continue; }

      // Product room: limited by aftermarket LTV and/or all-in room
      const aftermarketBaseValue = guide.aftermarketBase === "salePrice" ? sellingPrice : bbWholesale;
      const aftermarketCap = hasAftermarketCap ? aftermarketBaseValue * maxAftermarketLTV : Infinity;
      let productRoom = isFinite(allInRoom) ? allInRoom : Infinity;
      if (isFinite(aftermarketCap)) productRoom = Math.min(productRoom, aftermarketCap);

      if (!isFinite(productRoom)) {
        productRoom = 0;
      }

      // Admin fee (first priority)
      if (adminInclusion === "excluded") {
        effectiveAdmin = capAdmin ?? 0;
      } else {
        effectiveAdmin = capAdmin != null ? Math.min(capAdmin, Math.floor(productRoom)) : 0;
        productRoom -= effectiveAdmin;
        if (productRoom < 0) productRoom = 0;
      }

      // Warranty (second priority)
      if (productRoom >= Math.round(MIN_WARRANTY_COST * MARKUP)) {
        warPrice = capWarranty != null ? Math.min(productRoom, capWarranty) : productRoom;
        if (gapAllowed) {
          const gapReserve = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
          if (warPrice > productRoom - gapReserve && productRoom > gapReserve) {
            warPrice = productRoom - gapReserve;
          }
        }
        warPrice = Math.max(warPrice, Math.round(MIN_WARRANTY_COST * MARKUP));
        if (warPrice > productRoom) warPrice = 0;
      }
      warCost = warPrice > 0 ? Math.round(warPrice / MARKUP) : 0;
      productRoom -= warPrice;

      // GAP (third priority, max $1500 markup)
      if (gapAllowed && productRoom >= Math.round(MIN_GAP_COST * MARKUP)) {
        const gapCeiling = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
        gapPr = Math.min(productRoom, gapCeiling);
        gapPr = Math.max(gapPr, Math.round(MIN_GAP_COST * MARKUP));
        if (gapPr > productRoom) gapPr = 0;
      }
      gCost = gapPr > 0 ? Math.round(gapPr / MARKUP) : 0;

    } else if (hasAdvanceCap) {
      // --- PATH B: no online price, lender has advance cap ---
      const advCeiling = Math.round(maxAdvance + downPayment + netTrade);
      if (advCeiling < pacCost) { debugCounts.ltvAdvance++; continue; }
      sellingPrice = advCeiling;
      priceSource  = "maximized";

      const lenderExposure = sellingPrice - downPayment - netTrade;
      const allInRoom = isFinite(maxAllIn) ? maxAllIn - lenderExposure - creditorFee : Infinity;
      if (isFinite(allInRoom) && allInRoom <= 0) { debugCounts.ltvAllIn++; continue; }

      const aftermarketBaseValue = guide.aftermarketBase === "salePrice" ? sellingPrice : bbWholesale;
      const aftermarketCap = hasAftermarketCap ? aftermarketBaseValue * maxAftermarketLTV : Infinity;
      let productRoom = isFinite(allInRoom) ? allInRoom : Infinity;
      if (isFinite(aftermarketCap)) productRoom = Math.min(productRoom, aftermarketCap);

      if (!isFinite(productRoom)) {
        productRoom = 0;
      }

      // Admin fee
      if (adminInclusion === "excluded") {
        effectiveAdmin = capAdmin ?? 0;
      } else {
        effectiveAdmin = capAdmin != null ? Math.min(capAdmin, Math.floor(productRoom)) : 0;
        productRoom -= effectiveAdmin;
        if (productRoom < 0) productRoom = 0;
      }

      // Warranty
      if (productRoom >= Math.round(MIN_WARRANTY_COST * MARKUP)) {
        warPrice = capWarranty != null ? Math.min(productRoom, capWarranty) : productRoom;
        if (gapAllowed) {
          const gapReserve = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
          if (warPrice > productRoom - gapReserve && productRoom > gapReserve) {
            warPrice = productRoom - gapReserve;
          }
        }
        warPrice = Math.max(warPrice, Math.round(MIN_WARRANTY_COST * MARKUP));
        if (warPrice > productRoom) warPrice = 0;
      }
      warCost = warPrice > 0 ? Math.round(warPrice / MARKUP) : 0;
      productRoom -= warPrice;

      // GAP
      if (gapAllowed && productRoom >= Math.round(MIN_GAP_COST * MARKUP)) {
        const gapCeiling = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
        gapPr = Math.min(productRoom, gapCeiling);
        gapPr = Math.max(gapPr, Math.round(MIN_GAP_COST * MARKUP));
        if (gapPr > productRoom) gapPr = 0;
      }
      gCost = gapPr > 0 ? Math.round(gapPr / MARKUP) : 0;

    } else if (allInOnly) {
      // --- PATH C: all-in only, no online price — max out selling price, no products ---
      const allInCeiling = Math.round(maxAllIn - creditorFee + downPayment + netTrade);
      if (allInCeiling < pacCost) { debugCounts.ltvAllIn++; continue; }
      sellingPrice = allInCeiling;
      priceSource  = "maximized";

    } else {
      // No meaningful LTV constraints at all — use PAC cost
      sellingPrice = pacCost;
      priceSource  = "pac";
    }

    if (sellingPrice < pacCost) { debugCounts.noPrice++; continue; }

    warPrice = Math.round(warPrice);
    gapPr    = Math.round(gapPr);

    const lenderExposure = sellingPrice - downPayment - netTrade;
    const aftermarketRevenue = warPrice + gapPr;
    const allInTotal = lenderExposure + aftermarketRevenue + effectiveAdmin + creditorFee;

    if (allInTotal <= 0) { debugCounts.negFinanced++; continue; }

    const taxes = allInTotal * taxRate;
    const totalFinanced = allInTotal + taxes;

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

  logger.info({ debugCounts, lender: params.lenderCode, program: guide.programTitle, tier: params.tierName, allInOnly, hasAdvanceCap, hasAftermarketCap, adminInclusion, capAdmin, capWarranty, capGap }, "Lender calculate debug");

  res.set("Cache-Control", "no-store");
  res.json({
    lender:     params.lenderCode,
    program:    guide.programTitle,
    tier:       params.tierName,
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
    },
    debugCounts,
    resultCount: results.length,
    results,
  });
});

// Diagnostic endpoint — dumps cached program metadata for debugging
router.get("/lender-debug", requireOwner, async (_req, res) => {
  const programs = getCachedLenderPrograms();
  if (!programs) {
    res.json({ error: "No cached programs", programs: [] });
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
      aftermarketBase: g.aftermarketBase ?? "unknown",
      allInOnlyRules: g.allInOnlyRules ?? false,
      adminFeeInclusion: g.adminFeeInclusion ?? "unknown",
      backendLtvCalculation: g.backendLtvCalculation ?? null,
      allInLtvCalculation: g.allInLtvCalculation ?? null,
    })),
  }));
  res.json({ updatedAt: programs.updatedAt, lenders: summary });
});

export default router;
