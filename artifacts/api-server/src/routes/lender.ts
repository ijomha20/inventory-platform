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

  const MARKUP           = 2.5;
  const MIN_WARRANTY_COST = 600;
  const MIN_GAP_COST     = 550;

  const programMaxWarranty = guide.maxWarrantyPrice;
  const programMaxGap      = guide.maxGapPrice;
  const programMaxAdmin    = guide.maxAdminFee;

  // allInOnlyRules: lender has no separate aftermarket LTV — all products
  // constrained by a single all-in LTV bucket.  The fee calculation numbers
  // from CreditApp (maxWarranty/Gap/Admin) are deal-specific outputs, NOT
  // static program caps, so we ignore them and use only LTV constraints.
  const allInOnlyRules     = !!guide.allInOnlyRules
                          || (tier.maxAftermarketLTV <= 0 && tier.maxAllInLTV > 0);
  const capWarranty        = allInOnlyRules ? undefined : programMaxWarranty;
  const capGap             = allInOnlyRules ? undefined : programMaxGap;
  const capAdmin           = allInOnlyRules ? undefined : programMaxAdmin;
  const gapAllowed         = capGap == null || capGap > 0;

  const maxAdvanceLTV      = tier.maxAdvanceLTV > 0 ? tier.maxAdvanceLTV / 100 : Infinity;
  const maxAftermarketLTV  = allInOnlyRules ? Infinity : (tier.maxAftermarketLTV > 0 ? tier.maxAftermarketLTV / 100 : Infinity);
  const maxAllInLTV        = tier.maxAllInLTV > 0 ? tier.maxAllInLTV / 100 : Infinity;

  interface Result {
    vin:             string;
    vehicle:         string;
    location:        string;
    term:            number;
    conditionUsed:   string;
    bbWholesale:     number;
    sellingPrice:    number;
    priceSource:     string;
    adminFeeUsed:    number;
    warrantyPrice:   number;
    warrantyCost:    number;
    gapPrice:        number;
    gapCost:         number;
    totalFinanced:   number;
    monthlyPayment:  number;
    profit:          number;
    hasPhotos:       boolean;
    website:         string;
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

    let sellingPrice = 0;
    let priceSource  = "";
    const maxAdvance = isFinite(maxAdvanceLTV) ? bbWholesale * maxAdvanceLTV : Infinity;
    const maxAllIn   = isFinite(maxAllInLTV) ? bbWholesale * maxAllInLTV : Infinity;

    // --- Step 1: Determine selling price ---
    if (rawOnline > 0) {
      sellingPrice = rawOnline;
      priceSource  = "online";
    } else if (isFinite(maxAdvance)) {
      const advCeiling = Math.round(maxAdvance + downPayment + netTrade);
      if (pacCost > 0 && advCeiling >= pacCost) {
        sellingPrice = advCeiling;
        priceSource  = "maximized";
      } else if (pacCost > 0) {
        debugCounts.ltvAdvance++;
        continue;
      } else {
        debugCounts.noPrice++;
        continue;
      }
    } else if (pacCost > 0) {
      sellingPrice = pacCost;
      priceSource  = "pac";
    } else {
      debugCounts.noPrice++;
      continue;
    }

    if (pacCost > 0 && sellingPrice < pacCost) {
      debugCounts.noPrice++;
      continue;
    }

    const aftermarketBaseValue = guide.aftermarketBase === "salePrice" ? sellingPrice : bbWholesale;
    const maxAftermarket = isFinite(maxAftermarketLTV) ? aftermarketBaseValue * maxAftermarketLTV : Infinity;

    const lenderExposure = sellingPrice - downPayment - netTrade;
    if (isFinite(maxAdvance) && lenderExposure > maxAdvance) { debugCounts.ltvAdvance++; continue; }

    const adminInclusion = guide.adminFeeInclusion ?? "unknown";
    const minWarPrice = Math.round(MIN_WARRANTY_COST * MARKUP);
    const minGapPrice = Math.round(MIN_GAP_COST * MARKUP);
    const minWarPriceCapped = (capWarranty != null) ? Math.min(minWarPrice, capWarranty) : minWarPrice;
    const minGapPriceCapped = gapAllowed ? ((capGap != null) ? Math.min(minGapPrice, capGap) : minGapPrice) : 0;
    const minProducts = minWarPriceCapped + minGapPriceCapped;

    // allInRoom = how much LTV room is left after selling price + creditor fee
    const allInRoom = isFinite(maxAllIn) ? maxAllIn - lenderExposure - creditorFee : Infinity;
    if (isFinite(allInRoom) && allInRoom < minWarPriceCapped) { debugCounts.ltvAllIn++; continue; }

    // aftermarketCap from the separate aftermarket LTV (if any)
    const aftermarketCap = isFinite(maxAftermarket) ? maxAftermarket : Infinity;

    // --- Step 2: Auto-maximize admin fee ---
    let effectiveAdmin: number;
    if (capAdmin != null && capAdmin > 0) {
      effectiveAdmin = capAdmin;
    } else if (isFinite(allInRoom)) {
      const adminBudget = allInRoom - minProducts;
      effectiveAdmin = adminBudget > 0 ? Math.floor(adminBudget) : 0;
    } else {
      effectiveAdmin = 0;
    }

    // Constrain admin by where it sits in LTV
    if (adminInclusion === "backend" && isFinite(aftermarketCap)) {
      const backendBudget = Math.min(aftermarketCap, isFinite(allInRoom) ? allInRoom : aftermarketCap);
      const adminMax = backendBudget - minWarPriceCapped;
      if (adminMax < 0) { debugCounts.ltvAllIn++; continue; }
      if (effectiveAdmin > adminMax) effectiveAdmin = Math.floor(adminMax);
    } else if ((adminInclusion === "allIn" || adminInclusion === "unknown") && isFinite(allInRoom)) {
      const adminMax = allInRoom - minWarPriceCapped;
      if (adminMax < 0) { debugCounts.ltvAllIn++; continue; }
      if (effectiveAdmin > adminMax) effectiveAdmin = Math.floor(adminMax);
    }
    if (effectiveAdmin < 0) effectiveAdmin = 0;

    // --- Step 3: Aftermarket budget (warranty + GAP) ---
    let aftermarketBudget: number;
    if (adminInclusion === "backend") {
      const backendPool = Math.min(aftermarketCap, isFinite(allInRoom) ? allInRoom : aftermarketCap);
      aftermarketBudget = backendPool - effectiveAdmin;
    } else if (adminInclusion === "excluded") {
      aftermarketBudget = isFinite(allInRoom) ? Math.min(aftermarketCap, allInRoom) : aftermarketCap;
    } else {
      const allInAfterAdmin = isFinite(allInRoom) ? allInRoom - effectiveAdmin : Infinity;
      aftermarketBudget = Math.min(aftermarketCap, isFinite(allInAfterAdmin) ? allInAfterAdmin : aftermarketCap);
    }
    if (aftermarketBudget < minWarPriceCapped) { debugCounts.ltvMinAftermarket++; continue; }

    // --- Step 3a: Maximize warranty (leave room for GAP when uncapped) ---
    let warPrice: number;
    if (capWarranty != null) {
      warPrice = Math.min(aftermarketBudget, capWarranty);
    } else {
      const reserveForGap = gapAllowed ? minGapPriceCapped : 0;
      warPrice = aftermarketBudget > reserveForGap ? aftermarketBudget - reserveForGap : aftermarketBudget;
    }
    warPrice = Math.max(warPrice, minWarPriceCapped);
    if (warPrice > aftermarketBudget) { debugCounts.ltvMinAftermarket++; continue; }
    const warCost = Math.round(warPrice / MARKUP);
    const remainingAftermarket = aftermarketBudget - warPrice;

    // --- Step 3b: Maximize GAP ---
    let gapPr = 0;
    let gCost = 0;
    if (gapAllowed && remainingAftermarket >= minGapPriceCapped && minGapPriceCapped > 0) {
      if (capGap != null) {
        gapPr = Math.min(remainingAftermarket, capGap);
      } else {
        gapPr = remainingAftermarket;
      }
      gapPr = Math.max(gapPr, minGapPriceCapped);
      if (gapPr > remainingAftermarket) gapPr = 0;
      gCost = Math.round(gapPr / MARKUP);
    }

    warPrice = Math.round(warPrice);
    gapPr    = Math.round(gapPr);

    const aftermarketRevenue = warPrice + gapPr;
    const allInTotal = lenderExposure + aftermarketRevenue + effectiveAdmin + creditorFee;

    const amountBeforeTax = allInTotal;
    if (amountBeforeTax <= 0) { debugCounts.negFinanced++; continue; }

    const taxes = amountBeforeTax * taxRate;
    const totalFinanced = amountBeforeTax + taxes;

    const totalDealValue = totalFinanced + downPayment + netTrade;
    if (totalDealValue < sellingPrice) { debugCounts.dealValue++; continue; }

    const monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);
    if (maxPmt < Infinity && monthlyPayment > maxPmt) { debugCounts.maxPmtFilter++; continue; }
    debugCounts.passed++;

    const frontEndGross   = sellingPrice - (pacCost > 0 ? pacCost : bbWholesale);
    const warrantyProfit  = warPrice - warCost;
    const gapProfit       = gapPr - gCost;
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

  logger.info({ debugCounts, lender: params.lenderCode, program: guide.programTitle, tier: params.tierName, allInOnlyRules, adminInclusion: guide.adminFeeInclusion, capAdmin, capWarranty, capGap }, "Lender calculate debug");

  res.set("Cache-Control", "no-store");
  res.json({
    lender:     params.lenderCode,
    program:    guide.programTitle,
    tier:       params.tierName,
    tierConfig: tier,
    programLimits: {
      maxWarrantyPrice: programMaxWarranty ?? null,
      maxGapPrice:      programMaxGap ?? null,
      maxAdminFee:      programMaxAdmin ?? null,
      gapAllowed,
      aftermarketBase:    guide.aftermarketBase ?? "unknown",
      allInOnlyRules,
      adminFeeInclusion:  guide.adminFeeInclusion ?? "unknown",
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
