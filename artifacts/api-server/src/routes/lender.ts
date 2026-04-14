import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState } from "../lib/inventoryCache.js";
import {
  getLenderSyncStatus,
  getCachedLenderPrograms,
  runLenderSync,
} from "../lib/lenderWorker.js";

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
  tierName:      string;
  approvedRate:  number;
  approvedTerm:  number;
  maxPayment:    number;
  downPayment?:  number;
  tradeValue?:   number;
  tradeLien?:    number;
  taxRate?:      number;
  includeAftermarket?: boolean;
  aftermarketAmount?:  number;
}

function pmt(rate: number, nper: number, pv: number): number {
  if (rate === 0) return pv / nper;
  const r = rate / 12;
  return (pv * r * Math.pow(1 + r, nper)) / (Math.pow(1 + r, nper) - 1);
}

router.post("/lender-calculate", requireOwner, async (req, res) => {
  const params = req.body as CalcParams;

  if (!params.lenderCode || !params.tierName) {
    res.status(400).json({ error: "lenderCode and tierName are required" });
    return;
  }
  if (params.approvedRate == null || params.approvedTerm == null || params.maxPayment == null) {
    res.status(400).json({ error: "approvedRate, approvedTerm, and maxPayment are required" });
    return;
  }

  const rate = Number(params.approvedRate);
  const term = Number(params.approvedTerm);
  const maxPmtVal = Number(params.maxPayment);
  if (!isFinite(rate) || rate < 0 || rate > 100) {
    res.status(400).json({ error: "approvedRate must be between 0 and 100" });
    return;
  }
  if (!isFinite(term) || term <= 0 || term > 120 || !Number.isInteger(term)) {
    res.status(400).json({ error: "approvedTerm must be a positive integer up to 120" });
    return;
  }
  if (!isFinite(maxPmtVal) || maxPmtVal <= 0) {
    res.status(400).json({ error: "maxPayment must be a positive number" });
    return;
  }
  const optionals = [params.downPayment, params.tradeValue, params.tradeLien, params.taxRate, params.aftermarketAmount];
  for (const v of optionals) {
    if (v != null && (!isFinite(Number(v)) || Number(v) < 0)) {
      res.status(400).json({ error: "Optional monetary fields must be non-negative numbers" });
      return;
    }
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

  const tier = lender.tiers.find(t => t.tierName === params.tierName);
  if (!tier) {
    res.status(404).json({ error: `Tier "${params.tierName}" not found for ${params.lenderCode}` });
    return;
  }

  const { data: inventory } = getCacheState();
  const rateDecimal   = rate / 100;
  const termMonths    = term;
  const maxPmt        = maxPmtVal;
  const downPayment   = params.downPayment ?? 0;
  const tradeValue    = params.tradeValue ?? 0;
  const tradeLien     = params.tradeLien ?? 0;
  const taxRate       = (params.taxRate ?? 5) / 100;
  const aftermarket   = params.includeAftermarket ? (params.aftermarketAmount ?? 0) : 0;
  const netTrade      = tradeValue - tradeLien;
  const creditorFee   = tier.creditorFee;
  const maxAdvLTV     = tier.maxAdvanceLTV / 100;
  const maxAllInLTV   = tier.maxAllInLTV / 100;
  const maxAftermktLTV = tier.maxAftermarketLTV / 100;

  interface Result {
    vin:             string;
    vehicle:         string;
    location:        string;
    bbWholesale:     number;
    maxAdvance:      number;
    totalFinanced:   number;
    monthlyPayment:  number;
    costOfBorrowing: number;
    ltv:             number;
    hasPhotos:       boolean;
    website:         string;
  }

  const results: Result[] = [];

  for (const item of inventory) {
    if (!item.bbAvgWholesale) continue;
    const bbWholesale = parseFloat(item.bbAvgWholesale);
    if (isNaN(bbWholesale) || bbWholesale <= 0) continue;

    const maxAdvance = bbWholesale * maxAdvLTV;

    const maxAftermktAllowed = bbWholesale * maxAftermktLTV;
    const effectiveAftermarket = Math.min(aftermarket, maxAftermktAllowed);

    const amountBeforeTax = maxAdvance + effectiveAftermarket + creditorFee - downPayment - netTrade;
    if (amountBeforeTax <= 0) continue;

    const taxes = amountBeforeTax * taxRate;
    const totalFinanced = amountBeforeTax + taxes;

    const maxAllInAllowed = bbWholesale * maxAllInLTV;
    if (totalFinanced > maxAllInAllowed && maxAllInLTV > 0) continue;

    const monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);
    if (monthlyPayment > maxPmt) continue;

    const costOfBorrowing = (monthlyPayment * termMonths) - totalFinanced;
    const ltv = bbWholesale > 0 ? (totalFinanced / bbWholesale) * 100 : 0;

    results.push({
      vin:             item.vin,
      vehicle:         item.vehicle,
      location:        item.location,
      bbWholesale,
      maxAdvance:      Math.round(maxAdvance),
      totalFinanced:   Math.round(totalFinanced),
      monthlyPayment:  Math.round(monthlyPayment * 100) / 100,
      costOfBorrowing: Math.round(costOfBorrowing),
      ltv:             Math.round(ltv * 10) / 10,
      hasPhotos:       item.hasPhotos,
      website:         item.website,
    });
  }

  results.sort((a, b) => a.monthlyPayment - b.monthlyPayment);

  res.set("Cache-Control", "no-store");
  res.json({
    lender:     params.lenderCode,
    tier:       params.tierName,
    tierConfig: tier,
    resultCount: results.length,
    results,
  });
});

export default router;
