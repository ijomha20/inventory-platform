# Inventory Platform — Complete Source Code
## Part 3 of 10

API Server (lenderAuth, lenderWorker, lenderCalcEngine, routes: index through inventory)

Lines 5551-8563 of 27,616 total

---

### `artifacts/api-server/src/routes/carfax.ts` (63 lines)

```typescript
import { Router } from "express";
import { isOwner } from "../lib/auth.js";
import { runCarfaxWorkerForVins, runCarfaxWorker, getCarfaxBatchStatus } from "../lib/carfaxWorker.js";
import { logger } from "../lib/logger.js";

const router = Router();

function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as { email: string };
  if (!isOwner(user.email)) {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

router.get("/carfax/batch-status", requireOwner, (_req, res) => {
  res.json(getCarfaxBatchStatus());
});

router.post("/carfax/run-batch", requireOwner, (req: any, res: any) => {
  const status = getCarfaxBatchStatus();
  if (status.running) {
    res.status(409).json({ ok: false, error: "A batch is already running", startedAt: status.startedAt });
    return;
  }
  logger.info({ requestedBy: (req.user as any)?.email }, "Manual Carfax batch triggered via API");
  runCarfaxWorker({ force: true }).catch((err) =>
    logger.error({ err }, "Manual Carfax batch failed")
  );
  res.json({ ok: true, message: "Carfax batch started. Check server logs for progress." });
});

router.post("/carfax/test", requireOwner, async (req: any, res: any) => {
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
  logger.info({ vins: cleanVins, requestedBy: (req.user as any)?.email }, "Carfax test run requested via API");

  try {
    const results = await runCarfaxWorkerForVins(cleanVins);
    res.json({ ok: true, results });
  } catch (err: any) {
    logger.error({ err }, "Carfax test endpoint error");
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;

```


### `artifacts/api-server/src/routes/lender.ts` (793 lines)

```typescript
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
  adminFee?:     number;
  termStretchMonths?:      number;
  /** When true, keep vehicles that fail LTV/payment and report required extra cash down */
  showAllWithDownPayment?: boolean;
}

/** Accepts boolean or common string/number serializations from proxies and clients */
function truthyOptionalFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "on";
  }
  return false;
}

/** +6/+12 mo only; coerces strings so JSON/proxies cannot break [0,6,12].includes */
function normalizeTermStretchMonths(v: unknown): 0 | 6 | 12 {
  const n = typeof v === "string" ? parseInt(v.trim(), 10) : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n === 6 || n === 12) return n;
  return 0;
}

/** Hard cap on total finance term (months) when applying an exception stretch */
const MAX_FINANCE_TERM_MONTHS = 84;

/** Largest stretch in {12,6,0} such that baseTerm + stretch <= maxTotal (default 84) */
function largestStretchNotExceeding(baseTerm: number, maxTotal: number = MAX_FINANCE_TERM_MONTHS): 0 | 6 | 12 {
  if (baseTerm >= maxTotal) return 0;
  const order: (0 | 6 | 12)[] = [12, 6, 0];
  for (const s of order) {
    if (baseTerm + s <= maxTotal) return s;
  }
  return 0;
}

/**
 * Term exception rules:
 * - If the matrix already qualifies at 84 months, do not stretch (even if +6/+12 is selected).
 * - Otherwise stretch is limited so base + stretch never exceeds 84 (e.g. 78 can only use +6 to reach 84; +12 becomes +6).
 */
function resolveEffectiveTermStretch(
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

  /** Stack products into available room: doc fee first, then warranty, then GAP. */
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

    // ============================================================
    //  Two-tier qualification logic
    //
    //  PATH A (online price): Tier 1 = sell at online price, max products.
    //         Tier 2 = reduce price to LTV ceiling, recover profit via products.
    //         Profit target = onlinePrice - pacCost.
    //
    //  PATH B (no online price): sell at PAC, stack products.
    //         Profit target = 0 (break even).
    //
    //  Hard constraint: sellingPrice >= pacCost always.
    // ============================================================

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

    /** Compute product room given a lender exposure value */
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


### `artifacts/api-server/src/routes/price-lookup.ts` (105 lines)

```typescript
import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

// Dealer configs: hostname → { collection, apiKey }
const DEALERS: Record<string, { collection: string; apiKey: string }> = {
  "matrixmotorsyeg.ca": {
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey: "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
  "parkdalemotors.ca": {
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey: "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
};

function formatPrice(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// GET /api/price-lookup?url=<encoded_url>
router.get("/price-lookup", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Never cache — prices change and we must always serve a fresh Typesense result
  res.set("Cache-Control", "no-store");

  const url = (req.query.url as string ?? "").trim();
  if (!url || !url.startsWith("http")) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    const parsed = new URL(url);

    // Match dealer by hostname (strip www.)
    const hostname = parsed.hostname.replace(/^www\./, "");
    const dealer = DEALERS[hostname];

    if (!dealer) {
      // Unknown dealer — fall back to null (no scraping attempt)
      res.json({ price: null });
      return;
    }

    // Extract numeric document ID from URL path: e.g. /inventory/2017-subaru-wrx/1535/
    const idMatch = parsed.pathname.match(/\/(\d+)\/?$/);
    if (!idMatch) {
      res.json({ price: null });
      return;
    }
    const docId = idMatch[1];

    // Query Typesense via search endpoint (search key doesn't allow direct document fetch)
    const params = new URLSearchParams({
      q: "*",
      filter_by: `id:=[${docId}]`,
      per_page: "1",
      "x-typesense-api-key": dealer.apiKey,
    });
    const tsUrl = `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search?${params}`;
    const tsRes = await fetch(tsUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!tsRes.ok) {
      logger.warn({ status: tsRes.status, url, docId }, "Typesense lookup failed");
      res.json({ price: null });
      return;
    }

    const body = await tsRes.json() as { hits?: Array<{ document: Record<string, unknown> }> };
    if (!body.hits || body.hits.length === 0) {
      res.json({ price: null });
      return;
    }
    const doc = body.hits[0].document;

    // Use special_price if active, otherwise regular price
    const specialOn = Number(doc.special_price_on) === 1;
    const specialPrice = Number(doc.special_price);
    const regularPrice = Number(doc.price);

    const rawPrice = specialOn && specialPrice > 0 ? specialPrice : regularPrice;

    if (!rawPrice || rawPrice <= 0) {
      res.json({ price: null });
      return;
    }

    res.json({ price: formatPrice(rawPrice) });
  } catch (err) {
    logger.warn({ err, url }, "price-lookup error");
    res.json({ price: null });
  }
});

export default router;

```


### `artifacts/api-server/src/scripts/testCarfax.ts` (35 lines)

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

## Inventory Portal


### `artifacts/inventory-portal/package.json` (77 lines)

```json
{
  "name": "@workspace/inventory-portal",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --config vite.config.ts --host 0.0.0.0",
    "build": "vite build --config vite.config.ts",
    "serve": "vite preview --config vite.config.ts --host 0.0.0.0",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@radix-ui/react-aspect-ratio": "^1.1.3",
    "@radix-ui/react-avatar": "^1.1.4",
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-collapsible": "^1.1.4",
    "@radix-ui/react-context-menu": "^2.2.7",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-hover-card": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-menubar": "^1.1.7",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-progress": "^1.1.3",
    "@radix-ui/react-radio-group": "^1.2.4",
    "@radix-ui/react-scroll-area": "^1.2.4",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.3",
    "@radix-ui/react-toggle-group": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@replit/vite-plugin-cartographer": "catalog:",
    "@replit/vite-plugin-dev-banner": "catalog:",
    "@replit/vite-plugin-runtime-error-modal": "catalog:",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "@workspace/api-client-react": "workspace:*",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "cmdk": "^1.1.1",
    "date-fns": "^3.6.0",
    "embla-carousel-react": "^8.6.0",
    "framer-motion": "catalog:",
    "input-otp": "^1.4.2",
    "lucide-react": "catalog:",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-day-picker": "^9.11.1",
    "react-dom": "catalog:",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "react-resizable-panels": "^2.1.7",
    "recharts": "^2.15.2",
    "sonner": "^2.0.7",
    "tailwind-merge": "catalog:",
    "tailwindcss": "catalog:",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "vite": "catalog:",
    "wouter": "^3.3.5",
    "zod": "catalog:"
  }
}

```


### `artifacts/inventory-portal/tsconfig.json` (22 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "dist", "**/*.test.ts"],
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["esnext", "dom", "dom.iterable"],
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "types": ["node", "vite/client"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "references": [
    {
      "path": "../../lib/api-client-react"
    }
  ]
}

```


### `artifacts/inventory-portal/vite.config.ts` (86 lines)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

const basePath = process.env.BASE_PATH || "/";

/**
 * Replit / local split dev: browser talks to Vite (this port), Express usually runs on another port.
 * Forward same-origin `/api/*` to the API so `fetch("/api/...")` works without CORS or wrong host.
 * Override if your API listens elsewhere: `INVENTORY_DEV_API_ORIGIN=http://127.0.0.1:PORT`
 */
const devApiProxyTarget =
  process.env["INVENTORY_DEV_API_ORIGIN"]?.trim()
  || process.env["VITE_DEV_API_ORIGIN"]?.trim()
  || "http://127.0.0.1:3000";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    // Replit + some browsers cache dev responses aggressively; avoid "stale UI" confusion
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

```


### `artifacts/inventory-portal/index.html` (16 lines)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
    <title>Inventory Portal</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```


### `artifacts/inventory-portal/src/main.tsx` (5 lines)

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

```


### `artifacts/inventory-portal/src/App.tsx` (86 lines)

```tsx
import React from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe } from "@workspace/api-client-react";

import { Layout } from "@/components/layout";
import { FullScreenSpinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import AccessDenied from "@/pages/denied";
import Inventory from "@/pages/inventory";
import Admin from "@/pages/admin";
import LenderCalculator from "@/pages/lender-calculator";

const queryClient = new QueryClient();

// Auth Guard component to protect routes
function RequireAuth({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { isLoading, error } = useGetMe({ query: { retry: false } });

  React.useEffect(() => {
    if (!error) return;
    const status = (error as any)?.response?.status;
    if (status === 401) setLocation("/login");
    else if (status === 403) setLocation("/denied");
  }, [error, setLocation]);

  if (isLoading) return <FullScreenSpinner />;
  if (error)     return null;

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/denied" component={AccessDenied} />
      
      {/* Protected Routes */}
      <Route path="/">
        <RequireAuth>
          <Layout>
            <Inventory />
          </Layout>
        </RequireAuth>
      </Route>
      
      <Route path="/admin">
        <RequireAuth>
          <Layout>
            <Admin />
          </Layout>
        </RequireAuth>
      </Route>

      <Route path="/calculator">
        <RequireAuth>
          <Layout wide>
            <LenderCalculator />
          </Layout>
        </RequireAuth>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

```


### `artifacts/inventory-portal/src/index.css` (121 lines)

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
@import "tailwindcss";
@import "tw-animate-css";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-card-border: hsl(var(--border));

  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));

  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));

  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));

  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));

  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));

  --color-surface:        hsl(var(--surface));
  --color-surface-raised: hsl(var(--surface-raised));
  --color-hover:          hsl(var(--hover));

  --font-sans: 'Inter', sans-serif;
  --font-display: 'Outfit', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
}

:root {
  /* Clean light theme */
  --background:    0 0% 97%;
  --foreground:    220 13% 13%;

  --card:          0 0% 100%;
  --card-foreground: 220 13% 13%;

  --popover:       0 0% 100%;
  --popover-foreground: 220 13% 13%;

  --primary:       221 83% 53%;
  --primary-foreground: 0 0% 100%;

  --secondary:     220 14% 96%;
  --secondary-foreground: 220 13% 13%;

  --muted:         220 14% 96%;
  --muted-foreground: 220 9% 46%;

  --accent:        221 83% 53%;
  --accent-foreground: 0 0% 100%;

  --destructive:   0 72% 51%;
  --destructive-foreground: 0 0% 100%;

  --border:        220 13% 91%;
  --input:         220 13% 91%;
  --ring:          221 83% 53%;

  --radius: 0.5rem;

  --surface:       0 0% 100%;
  --surface-raised: 220 14% 97%;
  --hover:         220 14% 96%;
}

@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply font-sans antialiased bg-background text-foreground min-h-screen selection:bg-primary/20 selection:text-foreground;
  }

  h1, h2, h3, h4, h5, h6 {
    @apply font-display tracking-tight;
  }
}

/* Custom Scrollbar for a premium feel */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  @apply bg-background;
}

::-webkit-scrollbar-thumb {
  @apply bg-border rounded-full border-2 border-solid border-background;
}

::-webkit-scrollbar-thumb:hover {
  @apply bg-muted-foreground;
}

/* Glass panel utility */
.glass-panel {
  @apply bg-card/60 backdrop-blur-xl border border-white/5 shadow-2xl shadow-black/40;
}

```


### `artifacts/inventory-portal/src/lib/utils.ts` (6 lines)

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

```


### `artifacts/inventory-portal/src/hooks/use-mobile.tsx` (19 lines)

```tsx
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

```


### `artifacts/inventory-portal/src/hooks/use-toast.ts` (191 lines)

```typescript
import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id)
        })
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

export { useToast, toast }

```


### `artifacts/inventory-portal/src/components/layout.tsx` (77 lines)

```tsx
import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Car, LogOut, Settings, Calculator } from "lucide-react";

export function Layout({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  const { data: user } = useGetMe({ query: { retry: false } });

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-40 w-full bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">

            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <Car className="w-4 h-4 text-white" />
              </div>
              <Link href="/" className="font-semibold text-gray-900 hover:text-blue-600 transition-colors text-base">
                Inventory Portal
              </Link>
            </div>

            {user && (
              <div className="flex items-center gap-3">
                {(user.isOwner || user.role === "viewer") && (
                  <Link
                    href="/calculator"
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
                  >
                    <Calculator className="w-4 h-4" />
                    <span className="hidden sm:inline">Inventory Selector</span>
                  </Link>
                )}
                {user.isOwner && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
                  >
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline">Manage Access</span>
                  </Link>
                )}

                <div className="h-5 w-px bg-gray-200 hidden sm:block" />

                <div className="flex items-center gap-2.5">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-sm font-medium text-gray-800 leading-none">{user.name}</span>
                    <span className="text-xs text-gray-400 mt-0.5">{user.email}</span>
                  </div>
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-600">{user.name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <a
                    href="/api/auth/logout"
                    title="Sign Out"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={`flex-1 w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 ${wide ? "max-w-[1880px]" : "max-w-7xl"}`}>
        {children}
      </main>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/login.tsx` (36 lines)

```tsx
import { Car, Lock } from "lucide-react";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-5">
          <Car className="w-6 h-6 text-white" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">Inventory Portal</h1>
        <p className="text-sm text-gray-500 mb-7">
          Access is restricted to authorized personnel. Sign in with your Google account to continue.
        </p>

        <a
          href="/api/auth/google"
          className="w-full inline-flex items-center justify-center gap-3 px-5 py-2.5 border border-gray-200 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </a>

        <p className="mt-6 flex items-center gap-1.5 text-xs text-gray-400">
          <Lock className="w-3 h-3" />
          Secure authentication via Google
        </p>
      </div>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/denied.tsx` (35 lines)

```tsx
import { ShieldAlert } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";

export default function AccessDenied() {
  const { data: user } = useGetMe({ query: { retry: false } });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-5">
          <ShieldAlert className="w-6 h-6 text-red-500" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-sm text-gray-500 mb-5">
          You don't have permission to view this portal. Contact the owner to request access.
        </p>

        {user && (
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 text-left">
            <p className="text-xs text-gray-400 mb-0.5">Signed in as</p>
            <p className="text-sm font-medium text-gray-800">{user.email}</p>
          </div>
        )}

        <a
          href="/api/auth/logout"
          className="w-full inline-flex items-center justify-center px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          Sign out and try another account
        </a>
      </div>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/not-found.tsx` (21 lines)

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/admin.tsx` (326 lines)

```tsx
import { useState } from "react";
import {
  useGetAccessList,
  useAddAccessEntry,
  useRemoveAccessEntry,
  useUpdateAccessRole,
  useGetAuditLog,
  getGetAccessListQueryKey,
  getGetAuditLogQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Trash2, Plus, Shield, Mail, Calendar, User as UserIcon,
  Loader2, ClipboardList, Eye, UserCheck, ChevronDown,
} from "lucide-react";
import { FullScreenSpinner } from "@/components/ui/spinner";
import { useLocation } from "wouter";

type Tab = "users" | "audit";

const ROLE_LABELS: Record<string, string> = {
  viewer: "Viewer",
  guest:  "Guest",
  owner:  "Owner",
};

const ROLE_COLORS: Record<string, string> = {
  viewer: "bg-blue-50 text-blue-700 border-blue-200",
  guest:  "bg-gray-50 text-gray-600 border-gray-200",
  owner:  "bg-purple-50 text-purple-700 border-purple-200",
};

function RoleSelector({ email, currentRole, onUpdate }: {
  email: string;
  currentRole: string;
  onUpdate: (role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = ["viewer", "guest"];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${ROLE_COLORS[currentRole] ?? ROLE_COLORS.viewer}`}>
        {ROLE_LABELS[currentRole] ?? currentRole}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-20 w-28 bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden">
            {options.map((role) => (
              <button key={role}
                onClick={() => { setOpen(false); if (role !== currentRole) onUpdate(role); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors font-medium ${role === currentRole ? "text-blue-600 bg-blue-50" : "text-gray-700"}`}>
                {ROLE_LABELS[role]}
                {role === "viewer" && <p className="text-gray-400 font-normal text-xs">Full access</p>}
                {role === "guest"  && <p className="text-gray-400 font-normal text-xs">Price hidden</p>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  add:         "Added",
  remove:      "Removed",
  role_change: "Role changed",
};

const ACTION_COLORS: Record<string, string> = {
  add:         "bg-green-100 text-green-700",
  remove:      "bg-red-100 text-red-700",
  role_change: "bg-blue-100 text-blue-700",
};

export default function Admin() {
  const queryClient    = useQueryClient();
  const [, setLocation] = useLocation();
  const [newEmail, setNewEmail] = useState("");
  const [newRole,  setNewRole]  = useState<"viewer" | "guest">("viewer");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("users");

  const { data: accessList, isLoading, error } = useGetAccessList({ query: { retry: false } });
  const { data: auditLog,   isLoading: auditLoading } = useGetAuditLog({
    query: { enabled: activeTab === "audit", retry: false },
  });

  const addMutation        = useAddAccessEntry();
  const removeMutation     = useRemoveAccessEntry();
  const updateRoleMutation = useUpdateAccessRole();

  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401 || status === 403) { setLocation("/"); return null; }
  }

  if (isLoading) return <FullScreenSpinner />;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetAccessListQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAuditLogQueryKey() });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.includes("@")) { setErrorMsg("Please enter a valid email address."); return; }
    setErrorMsg("");
    addMutation.mutate(
      { data: { email: newEmail.toLowerCase().trim(), role: newRole } },
      { onSuccess: () => { setNewEmail(""); invalidateAll(); }, onError: (err: any) => setErrorMsg(err.response?.data?.error || "Failed to add user.") }
    );
  };

  const handleRemove = (email: string) => {
    if (!confirm(`Remove access for ${email}?`)) return;
    removeMutation.mutate({ email }, { onSuccess: invalidateAll });
  };

  const handleRoleChange = (email: string, role: string) => {
    updateRoleMutation.mutate(
      { email, data: { role } },
      { onSuccess: invalidateAll }
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      <div>
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-600" />
          Access Management
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Control which Google accounts can view the inventory portal.</p>
      </div>

      {/* Add user form */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Grant Access</h2>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Enter Google email address"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
              disabled={addMutation.isPending}
            />
          </div>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "viewer" | "guest")}
            className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
            disabled={addMutation.isPending}>
            <option value="viewer">Viewer — full access</option>
            <option value="guest">Guest — price hidden</option>
          </select>
          <button type="submit"
            disabled={addMutation.isPending || !newEmail}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add User
          </button>
        </form>
        {errorMsg && <p className="text-red-500 text-xs mt-2 font-medium">{errorMsg}</p>}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          {([
            { id: "users" as Tab, label: "Users",     icon: <UserCheck className="w-4 h-4" /> },
            { id: "audit" as Tab, label: "Audit Log",  icon: <ClipboardList className="w-4 h-4" /> },
          ] as const).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Users tab */}
        {activeTab === "users" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Added</th>
                  <th className="px-5 py-3">Added By</th>
                  <th className="px-5 py-3 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accessList?.map((entry) => (
                  <tr key={entry.email} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                          {entry.email.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-800">{entry.email}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <RoleSelector
                        email={entry.email}
                        currentRole={entry.role}
                        onUpdate={(role) => handleRoleChange(entry.email, role)}
                      />
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(entry.addedAt), "MMM d, yyyy")}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <UserIcon className="w-3.5 h-3.5" />
                        {entry.addedBy}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleRemove(entry.email)}
                        disabled={removeMutation.isPending && (removeMutation.variables as any)?.email === entry.email}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center"
                        title="Remove Access">
                        {removeMutation.isPending && (removeMutation.variables as any)?.email === entry.email
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
                {(!accessList || accessList.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                      No approved users yet. Add one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Audit log tab */}
        {activeTab === "audit" && (
          <div className="overflow-x-auto">
            {auditLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3">When</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Change</th>
                    <th className="px-5 py-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLog?.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {format(new Date(entry.timestamp), "MMM d, yyyy HH:mm")}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[entry.action] ?? "bg-gray-100 text-gray-600"}`}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-800 text-xs">{entry.targetEmail}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {entry.action === "role_change"
                          ? <span>{ROLE_LABELS[entry.roleFrom ?? ""] ?? entry.roleFrom} &rarr; {ROLE_LABELS[entry.roleTo ?? ""] ?? entry.roleTo}</span>
                          : entry.action === "add" && entry.roleTo
                            ? <span>as {ROLE_LABELS[entry.roleTo] ?? entry.roleTo}</span>
                            : "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{entry.changedBy}</td>
                    </tr>
                  ))}
                  {(!auditLog || auditLog.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                        No audit log entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Role legend */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Role Permissions</p>
        <div className="grid grid-cols-2 gap-1.5 text-xs text-blue-800">
          <div><span className="font-medium">Viewer</span> — sees all data including Your Cost</div>
          <div><span className="font-medium">Guest</span> — sees vehicle info but Your Cost is hidden</div>
        </div>
      </div>

    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/inventory.tsx` (748 lines)

```tsx
import { useState, useCallback, useEffect, useRef } from "react";
import {
  useGetInventory,
  useGetCacheStatus,
  useGetVehicleImages,
  useGetMe,
} from "@workspace/api-client-react";
import {
  Search, ExternalLink, FileText, AlertCircle, ChevronUp, ChevronDown,
  ChevronsUpDown, Copy, Check, RefreshCw, Camera, X, ChevronLeft,
  ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

type SortKey = "location" | "vehicle" | "vin" | "price" | "km";
type SortDir = "asc" | "desc";

interface Filters {
  yearMin:   string;
  yearMax:   string;
  kmMax:     string;
  priceMin:  string;
  priceMax:  string;
}

const EMPTY_FILTERS: Filters = { yearMin: "", yearMax: "", kmMax: "", priceMin: "", priceMax: "" };

function parseNum(s: string): number {
  return parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
}

function extractYear(vehicle: string): number {
  const y = parseInt(vehicle.trim().split(/\s+/)[0] ?? "0", 10);
  return y > 1900 && y < 2100 ? y : 0;
}

function formatPrice(raw: string | undefined): string {
  if (!raw || raw === "NOT FOUND") return "—";
  const n = parseNum(raw);
  if (!n) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30 inline ml-1" />;
  return dir === "asc"
    ? <ChevronUp   className="w-3.5 h-3.5 text-blue-600 inline ml-1" />
    : <ChevronDown className="w-3.5 h-3.5 text-blue-600 inline ml-1" />;
}

function CopyVin({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(vin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [vin]);
  return (
    <button onClick={handleCopy} title="Click to copy VIN"
      className="group flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 transition-colors">
      <span className="font-mono text-xs">{vin}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy  className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 shrink-0 transition-opacity" />}
    </button>
  );
}

// Photo gallery modal
function PhotoGallery({ vin, onClose }: { vin: string; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const { data, isLoading } = useGetVehicleImages({ vin });
  const urls = data?.urls ?? [];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")      onClose();
      if (e.key === "ArrowRight")  setIdx((i) => Math.min(i + 1, urls.length - 1));
      if (e.key === "ArrowLeft")   setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [urls.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-4xl w-full bg-white rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 bg-white/90 rounded-full shadow hover:bg-gray-100">
          <X className="w-5 h-5 text-gray-700" />
        </button>
        {isLoading ? (
          <div className="flex items-center justify-center h-64"><RefreshCw className="w-8 h-8 text-gray-400 animate-spin" /></div>
        ) : urls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Camera className="w-10 h-10 mb-2" /><p className="text-sm">No photos available</p>
          </div>
        ) : (
          <>
            <div className="relative bg-black flex items-center justify-center" style={{ height: "420px" }}>
              <img src={urls[idx]} alt={`Photo ${idx + 1}`} className="max-h-full max-w-full object-contain" />
              {urls.length > 1 && (
                <>
                  <button onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx === 0}
                    className="absolute left-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </button>
                  <button onClick={() => setIdx((i) => Math.min(i + 1, urls.length - 1))} disabled={idx === urls.length - 1}
                    className="absolute right-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </button>
                </>
              )}
            </div>
            {urls.length > 1 && (
              <div className="flex gap-1.5 p-3 overflow-x-auto bg-gray-50">
                {urls.map((url, i) => (
                  <button key={i} onClick={() => setIdx(i)}
                    className={`shrink-0 w-16 h-12 rounded overflow-hidden border-2 transition-colors ${i === idx ? "border-blue-500" : "border-transparent hover:border-gray-300"}`}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="px-4 py-2 text-center text-xs text-gray-400 border-t">
              {idx + 1} / {urls.length} photos — VIN: {vin}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PhotoThumb({ vin, hasPhotos }: { vin: string; hasPhotos?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title={hasPhotos ? "View photos" : "No photos available"}
        className={`p-1.5 rounded transition-colors ${
          hasPhotos
            ? "text-blue-500 hover:text-blue-700 hover:bg-blue-50"
            : "text-gray-300 cursor-default"
        }`}>
        <Camera className="w-4 h-4" />
      </button>
      {open && <PhotoGallery vin={vin} onClose={() => setOpen(false)} />}
    </>
  );
}

function BbExpandedRow({ bbValues }: { bbValues?: { xclean: number; clean: number; avg: number; rough: number } }) {
  if (!bbValues || (!bbValues.xclean && !bbValues.clean && !bbValues.avg && !bbValues.rough)) return null;
  const fmt = (v: number) => v ? `$${v.toLocaleString("en-US")}` : "—";
  const grades = [
    { label: "X-Clean", value: bbValues.xclean, color: "text-emerald-700" },
    { label: "Clean", value: bbValues.clean, color: "text-blue-700" },
    { label: "Average", value: bbValues.avg, color: "text-purple-700" },
    { label: "Rough", value: bbValues.rough, color: "text-orange-700" },
  ];
  return (
    <div className="bg-purple-50 border-b border-purple-100 px-4 py-2.5 flex items-center gap-8 animate-in slide-in-from-top-1 duration-150">
      <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide shrink-0">CBB Wholesale</span>
      <div className="flex items-center gap-6">
        {grades.map((g) => (
          <div key={g.label} className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">{g.label}</span>
            <span className={`text-sm font-semibold ${g.color}`}>{fmt(g.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BbCardDetail({
  bbValues,
  bbAvgWholesale,
}: {
  bbValues?: { xclean: number; clean: number; avg: number; rough: number };
  bbAvgWholesale?: string;
}) {
  const hasGrades = bbValues && (bbValues.xclean || bbValues.clean || bbValues.avg || bbValues.rough);
  const hasAdj    = !!bbAvgWholesale && bbAvgWholesale !== "NOT FOUND";
  if (!hasGrades && !hasAdj) return null;

  const fmt = (v: number) => v ? `$${v.toLocaleString("en-US")}` : "—";

  return (
    <div className="mt-2 rounded-lg border border-purple-200 overflow-hidden text-xs">
      {/* Header */}
      <div className="bg-purple-100 px-3 py-1.5">
        <span className="font-semibold text-purple-800 text-[11px] uppercase tracking-wide">CBB Wholesale</span>
      </div>

      {/* 2-column grade grid: left = X-Clean / Clean, right = Average / Rough */}
      {hasGrades && (
        <div className="grid grid-cols-2 divide-x divide-purple-100 bg-white">
          {/* Left column */}
          <div className="divide-y divide-purple-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">X-Clean</span>
              <span className="font-semibold text-emerald-700">{fmt(bbValues!.xclean)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Clean</span>
              <span className="font-semibold text-blue-700">{fmt(bbValues!.clean)}</span>
            </div>
          </div>
          {/* Right column */}
          <div className="divide-y divide-purple-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Average</span>
              <span className="font-semibold text-purple-700">{fmt(bbValues!.avg)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Rough</span>
              <span className="font-semibold text-orange-700">{fmt(bbValues!.rough)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Full-width KM-adjusted bar */}
      {hasAdj && (
        <div className="flex items-center justify-between px-3 py-2 bg-purple-700">
          <span className="text-purple-200 font-medium">KM Adjusted</span>
          <span className="font-bold text-white">{formatPrice(bbAvgWholesale)}</span>
        </div>
      )}
    </div>
  );
}

function VehicleCard({ item, showPacCost, showOwnerCols, showBb }: { item: any; showPacCost: boolean; showOwnerCols: boolean; showBb: boolean }) {
  const kmDisplay = item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : null;
  const hasBb = showBb && (item.bbAvgWholesale || item.bbValues);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header: location + icons */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{item.location}</span>
        <div className="flex items-center gap-2">
          <PhotoThumb vin={item.vin} hasPhotos={!!item.hasPhotos} />
          {item.carfax && item.carfax !== "NOT FOUND" && (
            <a href={item.carfax} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
              <FileText className="w-4 h-4" />
            </a>
          )}
          {item.website && item.website !== "NOT FOUND" && (
            <a href={item.website} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="Listing">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {/* Line 1: vehicle name */}
        <p className="font-semibold text-gray-900 text-sm leading-snug">{item.vehicle}</p>

        {/* Line 2: VIN  •  KM */}
        <div className="flex items-center gap-2">
          <CopyVin vin={item.vin} />
          {kmDisplay && (
            <>
              <span className="text-gray-300 text-xs">•</span>
              <span className="text-xs text-gray-500 font-medium">{kmDisplay}</span>
            </>
          )}
        </div>

        {/* Owner-only row: Matrix Price + Cost */}
        {showOwnerCols && (
          <div className="flex gap-4 text-xs">
            <div>
              <p className="text-gray-400 mb-0.5">Matrix Price</p>
              <p className="font-medium text-gray-700">{formatPrice(item.matrixPrice)}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Cost</p>
              <p className="font-semibold text-red-700">{formatPrice(item.cost)}</p>
            </div>
          </div>
        )}

        {/* Line 3: PAC Cost + Online Price (always shown; PAC Cost hidden for guests/customer view) */}
        <div className="flex gap-4 text-xs">
          {showPacCost && (
            <div>
              <p className="text-gray-400 mb-0.5">PAC Cost</p>
              <p className="font-semibold text-gray-900">{formatPrice(item.price)}</p>
            </div>
          )}
          <div>
            <p className="text-gray-400 mb-0.5">Online Price</p>
            <p className="font-medium text-gray-700">{formatPrice(item.onlinePrice)}</p>
          </div>
        </div>

        {/* CBB Wholesale box */}
        {hasBb && (
          <BbCardDetail bbValues={item.bbValues} bbAvgWholesale={item.bbAvgWholesale} />
        )}
      </div>
    </div>
  );
}

// ─── Range input pair ────────────────────────────────────────────────────────
function RangeInputs({
  label, minVal, maxVal, minPlaceholder, maxPlaceholder,
  onMinChange, onMaxChange, prefix = "",
}: {
  label: string; minVal: string; maxVal: string;
  minPlaceholder: string; maxPlaceholder: string;
  onMinChange: (v: string) => void; onMaxChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={minVal} onChange={(e) => onMinChange(e.target.value)}
            placeholder={minPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
        <span className="text-gray-300 text-sm">—</span>
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={maxVal} onChange={(e) => onMaxChange(e.target.value)}
            placeholder={maxPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
      </div>
    </div>
  );
}

// ─── Active filter chip ──────────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-200">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 transition-colors"><X className="w-3 h-3" /></button>
    </span>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function Inventory() {
  const [search,      setSearch]      = useState("");
  const [sortKey,     setSortKey]     = useState<SortKey>("vehicle");
  const [sortDir,     setSortDir]     = useState<SortDir>("asc");
  const [showFilters, setShowFilters] = useState(false);
  const [filters,     setFilters]     = useState<Filters>(EMPTY_FILTERS);
  const [, setLocation]               = useLocation();
  const lastKnownUpdate               = useRef<string | null>(null);

  const { data: me } = useGetMe({ query: { retry: false } });
  const isGuest = me?.role === "guest";
  const isOwner = me?.isOwner === true;

  type ViewMode = "owner" | "user" | "customer";
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("viewMode");
    if (saved === "owner" || saved === "user" || saved === "customer") return saved;
    return "user";
  });
  useEffect(() => {
    const saved = localStorage.getItem("viewMode");
    if (isOwner && !saved) setViewMode("owner");
  }, [isOwner]);
  useEffect(() => { localStorage.setItem("viewMode", viewMode); }, [viewMode]);
  const showOwnerCols = isOwner && viewMode === "owner";
  const showPacCost   = !isGuest && viewMode !== "customer";
  const showBb        = viewMode !== "customer";

  const [expandedBbVin, setExpandedBbVin] = useState<string | null>(null);
  const [bbClicked, setBbClicked] = useState(false);
  const bbCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: inventory, isLoading, error, refetch: refetchInventory } = useGetInventory({ query: { retry: false } });

  const { data: cacheStatus } = useGetCacheStatus({ query: { refetchInterval: 60_000, retry: false } });

  const bbRunning = (cacheStatus as any)?.bbRunning === true || bbClicked;

  const triggerBbRefresh = useCallback(async () => {
    if (bbRunning) return;
    setBbClicked(true);
    if (bbCooldownRef.current) clearTimeout(bbCooldownRef.current);
    bbCooldownRef.current = setTimeout(() => setBbClicked(false), 90_000);
    try {
      const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      await fetch(`${base}/api/refresh-blackbook`, { method: "POST", credentials: "include" });
    } catch (_) {}
  }, [bbRunning]);

  useEffect(() => {
    if (!cacheStatus?.lastUpdated) return;
    if (lastKnownUpdate.current === null) { lastKnownUpdate.current = cacheStatus.lastUpdated; return; }
    if (cacheStatus.lastUpdated !== lastKnownUpdate.current) {
      lastKnownUpdate.current = cacheStatus.lastUpdated;
      refetchInventory();
    }
  }, [cacheStatus?.lastUpdated, refetchInventory]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401) { setLocation("/login"); return null; }
    if (status === 403) { setLocation("/denied"); return null; }
    return (
      <div className="p-8 text-center rounded-lg border border-red-200 bg-red-50 mt-10 max-w-xl mx-auto">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
        <h2 className="text-base font-semibold text-gray-900 mb-1">Error loading inventory</h2>
        <p className="text-sm text-gray-500">Please refresh the page or contact support.</p>
      </div>
    );
  }

  if (isLoading) return <FullScreenSpinner />;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter = (key: keyof Filters) => (val: string) =>
    setFilters((f) => ({ ...f, [key]: val }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasFilters = Object.values(filters).some(Boolean);

  // Deduplicate by VIN — keep lowest price
  const parseNumericPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || Infinity;
  type Item = NonNullable<typeof inventory>[number];
  const dedupedMap = new Map<string, Item>();
  for (const item of (inventory ?? [])) {
    const existing = dedupedMap.get(item.vin);
    if (!existing || parseNumericPrice(item.price) < parseNumericPrice(existing.price))
      dedupedMap.set(item.vin, item);
  }
  const deduped = Array.from(dedupedMap.values());

  // Derive year min/max from data for placeholders
  const years = deduped.map((i) => extractYear(i.vehicle)).filter(Boolean);
  const dataYearMin = years.length ? Math.min(...years) : 2000;
  const dataYearMax = years.length ? Math.max(...years) : new Date().getFullYear();
  const kms   = deduped.map((i) => parseNum(i.km)).filter(Boolean);
  const dataKmMax = kms.length ? Math.max(...kms) : 300000;
  const prices = deduped.map((i) => parseNum(i.price)).filter(Boolean);
  const dataPriceMax = prices.length ? Math.max(...prices) : 100000;

  // Apply all filters + search
  const filtered = deduped.filter((item) => {
    // Text search
    if (search) {
      const term = search.toLowerCase();
      if (!item.vehicle.toLowerCase().includes(term) &&
          !item.vin.toLowerCase().includes(term) &&
          !item.location.toLowerCase().includes(term)) return false;
    }
    // Year
    const year = extractYear(item.vehicle);
    if (filters.yearMin && year && year < parseInt(filters.yearMin)) return false;
    if (filters.yearMax && year && year > parseInt(filters.yearMax)) return false;
    // KM
    const km = parseNum(item.km);
    if (filters.kmMax && km && km > parseNum(filters.kmMax)) return false;
    // Price (only for non-guests)
    if (!isGuest) {
      const price = parseNum(item.price);
      if (filters.priceMin && price && price < parseNum(filters.priceMin)) return false;
      if (filters.priceMax && price && price > parseNum(filters.priceMax)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] ?? "").toLowerCase();
    const bv = (b[sortKey] ?? "").toLowerCase();
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Active filter chips
  const activeChips: { label: string; clear: () => void }[] = [
    ...(filters.yearMin || filters.yearMax ? [{
      label: `Year: ${filters.yearMin || dataYearMin}–${filters.yearMax || dataYearMax}`,
      clear: () => setFilters((f) => ({ ...f, yearMin: "", yearMax: "" })),
    }] : []),
    ...(filters.kmMax ? [{
      label: `KM ≤ ${parseInt(filters.kmMax).toLocaleString("en-US")}`,
      clear: () => setFilter("kmMax")(""),
    }] : []),
    ...(!isGuest && (filters.priceMin || filters.priceMax) ? [{
      label: `PAC Cost: $${filters.priceMin || "0"}–$${filters.priceMax || "∞"}`,
      clear: () => setFilters((f) => ({ ...f, priceMin: "", priceMax: "" })),
    }] : []),
  ];

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-20 text-center rounded-lg border border-gray-200 bg-white">
      <Search className="w-8 h-8 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-700 mb-1">No vehicles found</p>
      <p className="text-sm text-gray-400">Try adjusting your search or filters.</p>
      {(search || hasFilters) && (
        <button onClick={() => { setSearch(""); clearFilters(); }}
          className="mt-4 px-4 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          Clear all
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header + search + filter toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Vehicle Inventory</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {sorted.length} {sorted.length === 1 ? "vehicle" : "vehicles"}
              {sorted.length !== deduped.length ? ` of ${deduped.length} total` : ""}
            </p>
            {cacheStatus?.lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                {cacheStatus.isRefreshing
                  ? <><RefreshCw className="w-3 h-3 animate-spin" /> Updating…</>
                  : <>Updated {timeAgo(cacheStatus.lastUpdated)}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input type="text"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                placeholder="Search vehicle, VIN, location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowFilters((s) => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showFilters || hasFilters
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}>
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {hasFilters && <span className="bg-white text-blue-600 text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{activeChips.length}</span>}
            </button>
            {!isGuest && (
              <div className="flex items-center gap-2">
                <div className="flex rounded overflow-hidden border border-gray-200 shrink-0">
                  {isOwner && (
                    <button onClick={() => setViewMode("owner")}
                      className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "owner" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                      Own
                    </button>
                  )}
                  <button onClick={() => setViewMode("user")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "user" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    User
                  </button>
                  <button onClick={() => setViewMode("customer")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "customer" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    Cust
                  </button>
                </div>
                {showOwnerCols && (
                  <button
                    onClick={triggerBbRefresh}
                    disabled={bbRunning}
                    title={bbRunning ? "Book value refresh in progress…" : "Refresh Canadian Black Book values"}
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border transition-colors shrink-0 ${
                      bbRunning
                        ? "bg-purple-50 text-purple-400 border-purple-200 cursor-not-allowed"
                        : "bg-white text-purple-600 border-purple-200 hover:bg-purple-50"
                    }`}>
                    <RefreshCw className={`w-3 h-3 ${bbRunning ? "animate-spin" : ""}`} />
                    Book Avg
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <div className={`grid gap-4 ${isGuest ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
              <RangeInputs label="Year" minVal={filters.yearMin} maxVal={filters.yearMax}
                minPlaceholder={String(dataYearMin)} maxPlaceholder={String(dataYearMax)}
                onMinChange={setFilter("yearMin")} onMaxChange={setFilter("yearMax")} />
              <RangeInputs label="Max KM" minVal="" maxVal={filters.kmMax}
                minPlaceholder="0" maxPlaceholder={Math.round(dataKmMax / 1000) * 1000 + ""}
                onMinChange={() => {}} onMaxChange={setFilter("kmMax")} />
              {showPacCost && (
                <RangeInputs label="PAC Cost" minVal={filters.priceMin} maxVal={filters.priceMax}
                  minPlaceholder="0" maxPlaceholder={Math.round(dataPriceMax / 1000) * 1000 + ""}
                  onMinChange={setFilter("priceMin")} onMaxChange={setFilter("priceMax")} prefix="$" />
              )}
            </div>
            {hasFilters && (
              <button onClick={clearFilters}
                className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors">
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <FilterChip key={chip.label} label={chip.label} onRemove={chip.clear} />
            ))}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      {isMobile ? (
        sorted.length === 0 ? emptyState : (
          <div className="space-y-3">
            {sorted.map((item, i) => (
              <VehicleCard key={`${item.vin}-${i}`} item={item} showPacCost={showPacCost} showOwnerCols={showOwnerCols} showBb={showBb} />
            ))}
          </div>
        )
      ) : (
        /* Desktop table */
        sorted.length === 0 ? emptyState : (
          <div className="rounded-lg border border-gray-200 overflow-x-auto bg-white shadow-sm">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              {[
                { key: "location" as SortKey, label: "Location",   cls: "w-24 shrink-0" },
                { key: "vehicle"  as SortKey, label: "Vehicle",    cls: "flex-1 min-w-[280px]" },
                { key: "vin"      as SortKey, label: "VIN",        cls: "w-40 shrink-0" },
                { key: "km"       as SortKey, label: "KM",         cls: "w-24 shrink-0" },
              ].map((col) => (
                <div key={col.label} className={col.cls}>
                  <button onClick={() => handleSort(col.key)}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    {col.label}<SortIcon active={sortKey === col.key} dir={sortDir} />
                  </button>
                </div>
              ))}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Matrix Price</div>}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Cost</div>}
              {showBb && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-purple-500">Book Avg</div>}
              {showPacCost && (
                <div className="w-24 shrink-0">
                  <button onClick={() => handleSort("price")}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    PAC Cost<SortIcon active={sortKey === "price"} dir={sortDir} />
                  </button>
                </div>
              )}
              <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Online Price</div>
              <div className="w-8 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">CFX</div>
              <div className="w-8 shrink-0" />
              <div className="w-8 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Link</div>
            </div>
            <div>
              {sorted.map((item, i) => (
                <div key={`${item.vin}-${i}`}>
                  <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i < sorted.length - 1 && expandedBbVin !== item.vin ? "border-b border-gray-100" : ""}`}>
                    <div className="w-24 shrink-0 text-sm text-gray-700 truncate font-medium">{item.location || "—"}</div>
                    <div className="flex-1 min-w-[280px] text-sm text-gray-900 font-medium truncate">{item.vehicle}</div>
                    <div className="w-40 shrink-0"><CopyVin vin={item.vin} /></div>
                    <div className="w-24 shrink-0 text-sm text-gray-600">
                      {item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : "—"}
                    </div>
                    {showOwnerCols && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.matrixPrice ?? "")}</div>}
                    {showOwnerCols && <div className="w-24 shrink-0 text-sm font-medium text-red-700">{formatPrice(item.cost ?? "")}</div>}
                    {showBb && (
                      (item as any).bbValues ? (
                        <button className="w-24 shrink-0 text-sm font-medium text-purple-700 cursor-pointer hover:underline text-left"
                          onClick={() => setExpandedBbVin(expandedBbVin === item.vin ? null : item.vin)}>
                          {formatPrice((item as any).bbAvgWholesale ?? "")}
                        </button>
                      ) : (
                        <div className="w-24 shrink-0 text-sm font-medium text-purple-700">
                          {formatPrice((item as any).bbAvgWholesale ?? "")}
                        </div>
                      )
                    )}
                    {showPacCost && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.price)}</div>}
                    <div className="w-28 shrink-0 text-sm text-gray-700">{formatPrice(item.onlinePrice)}</div>
                    <div className="w-8 shrink-0 flex justify-center">
                      {item.carfax && item.carfax !== "NOT FOUND"
                        ? <a href={item.carfax} target="_blank" rel="noopener noreferrer"
                            className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
                            <FileText className="w-4 h-4" />
                          </a>
                        : <span className="text-gray-200 text-sm">—</span>}
                    </div>
                    <div className="w-8 shrink-0 flex justify-center"><PhotoThumb vin={item.vin} hasPhotos={!!item.hasPhotos} /></div>
                    <div className="w-8 shrink-0 flex justify-center">
                      {item.website && item.website !== "NOT FOUND"
                        ? <a href={item.website} target="_blank" rel="noopener noreferrer"
                            className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="View Listing">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        : <span className="text-gray-200 text-sm">—</span>}
                    </div>
                  </div>
                  {expandedBbVin === item.vin && <BbExpandedRow bbValues={(item as any).bbValues} />}
                  {(i < sorted.length - 1 || expandedBbVin === item.vin) && expandedBbVin === item.vin && <div className="border-b border-gray-100" />}
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

```

