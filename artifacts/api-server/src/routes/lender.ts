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

router.get("/lender-programs", requireOwner, async (_req, res) => {
  const programs = getCachedLenderPrograms();
  if (!programs) {
    res.json({ programs: [], updatedAt: null });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(programs);
});

router.get("/lender-status", requireOwner, async (_req, res) => {
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
  warrantyPrice?:  number;
  warrantyCost?:   number;
  gapPrice?:       number;
  gapCost?:        number;
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

router.post("/lender-calculate", requireOwner, async (req, res) => {
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
  const adminFee       = params.adminFee ?? 0;
  const creditorFee    = tier.creditorFee ?? 0;
  const dealerReserve  = tier.dealerReserve ?? 0;

  const MARKUP           = 2.5;
  const MIN_WARRANTY_COST = 600;
  const MIN_GAP_COST     = 550;

  const programMaxWarranty = guide.maxWarrantyPrice;
  const programMaxGap      = guide.maxGapPrice;
  const programMaxAdmin    = guide.maxAdminFee;
  const effectiveAdmin     = (programMaxAdmin != null && adminFee > programMaxAdmin) ? programMaxAdmin : adminFee;
  const gapAllowed         = programMaxGap == null || programMaxGap > 0;

  const maxAdvanceLTV      = tier.maxAdvanceLTV > 0 ? tier.maxAdvanceLTV / 100 : Infinity;
  const maxAftermarketLTV  = tier.maxAftermarketLTV > 0 ? tier.maxAftermarketLTV / 100 : Infinity;
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
    const rawMatrix = parseFloat(item.matrixPrice?.replace(/[^0-9.]/g, "") || "0");
    let sellingPrice = 0;
    let priceSource  = "";
    if (rawOnline > 0) {
      sellingPrice = rawOnline;
      priceSource  = "online";
    } else if (rawMatrix > 0) {
      sellingPrice = rawMatrix;
      priceSource  = "pac";
    } else {
      debugCounts.noPrice++;
      continue;
    }

    const rawCost = parseFloat(item.cost?.replace(/[^0-9.]/g, "") || "0");

    const maxAdvance     = bbWholesale * maxAdvanceLTV;
    const maxAftermarket = sellingPrice * maxAftermarketLTV;
    const maxAllIn       = bbWholesale * maxAllInLTV;

    const lenderExposure = sellingPrice - downPayment - netTrade;
    if (lenderExposure > maxAdvance) { debugCounts.ltvAdvance++; continue; }

    const minWarPrice = Math.round(MIN_WARRANTY_COST * MARKUP);
    const minGapPrice = Math.round(MIN_GAP_COST * MARKUP);
    const minWarPriceCapped = (programMaxWarranty != null) ? Math.min(minWarPrice, programMaxWarranty) : minWarPrice;
    const minGapPriceCapped = gapAllowed ? ((programMaxGap != null) ? Math.min(minGapPrice, programMaxGap) : minGapPrice) : 0;
    const minAftermarketTotal = minWarPriceCapped + minGapPriceCapped;

    if (minAftermarketTotal > maxAftermarket) { debugCounts.ltvMinAftermarket++; continue; }

    const allInRoomForAftermarket = maxAllIn - lenderExposure - effectiveAdmin - creditorFee;
    if (allInRoomForAftermarket < minAftermarketTotal) { debugCounts.ltvAllIn++; continue; }

    const maxAftermarketAmount = Math.min(maxAftermarket, allInRoomForAftermarket);

    let warPrice: number, warCost: number, gapPr: number, gCost: number;

    if (!gapAllowed) {
      let wp = maxAftermarketAmount;
      if (programMaxWarranty != null && wp > programMaxWarranty) wp = programMaxWarranty;
      wp = Math.max(wp, minWarPriceCapped);
      warPrice = Math.round(wp);
      warCost  = Math.round(warPrice / MARKUP);
      gapPr    = 0;
      gCost    = 0;
    } else {
      let maxWarPr = maxAftermarketAmount;
      if (programMaxWarranty != null) maxWarPr = Math.min(maxWarPr, programMaxWarranty);
      let maxGapPr = maxAftermarketAmount;
      if (programMaxGap != null) maxGapPr = Math.min(maxGapPr, programMaxGap);

      const warrantyCostShare = MIN_WARRANTY_COST / (MIN_WARRANTY_COST + MIN_GAP_COST);
      const gapCostShare      = MIN_GAP_COST / (MIN_WARRANTY_COST + MIN_GAP_COST);
      let targetWarPr = Math.round(maxAftermarketAmount * warrantyCostShare);
      let targetGapPr = Math.round(maxAftermarketAmount * gapCostShare);

      if (targetWarPr > maxWarPr) targetWarPr = maxWarPr;
      if (targetGapPr > maxGapPr) targetGapPr = maxGapPr;
      if (targetWarPr < minWarPriceCapped) targetWarPr = minWarPriceCapped;
      if (targetGapPr < minGapPriceCapped) targetGapPr = minGapPriceCapped;

      const totalAfterTarget = targetWarPr + targetGapPr;
      if (totalAfterTarget > maxAftermarketAmount) {
        const scale = maxAftermarketAmount / totalAfterTarget;
        targetWarPr = Math.round(targetWarPr * scale);
        targetGapPr = Math.round(targetGapPr * scale);
      } else if (totalAfterTarget < maxAftermarketAmount) {
        const slack = maxAftermarketAmount - totalAfterTarget;
        const warRoom = maxWarPr - targetWarPr;
        const gapRoom = maxGapPr - targetGapPr;
        const totalRoom = warRoom + gapRoom;
        if (totalRoom > 0) {
          targetWarPr += Math.round(slack * (warRoom / totalRoom));
          targetGapPr = Math.min(maxGapPr, Math.round(maxAftermarketAmount - targetWarPr));
        }
      }

      warPrice = Math.round(targetWarPr);
      warCost  = Math.round(warPrice / MARKUP);
      gapPr    = Math.round(targetGapPr);
      gCost    = Math.round(gapPr / MARKUP);
    }

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

    const frontEndGross   = sellingPrice - (rawCost > 0 ? rawCost : bbWholesale);
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

  results.sort((a, b) => a.monthlyPayment - b.monthlyPayment);

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
    },
    resultCount: results.length,
    results,
  });
});

export default router;
