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

router.post("/probe-tier-fields", async (_req, res) => {
  try {
    const { getLenderAuthCookies } = await import("../lib/lenderAuth.js");
    const auth = await getLenderAuthCookies();
    const GRAPHQL_URL = "https://admin.creditapp.ca/api/graphql";

    async function rawGql(query: string) {
      const resp = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "*/*",
          "origin": "https://admin.creditapp.ca",
          "referer": "https://admin.creditapp.ca/",
          "x-creditapp-csrf-token": auth.csrfToken,
          "cookie": `appSession=${auth.appSession}; CA_CSRF_TOKEN=${auth.csrfToken}`,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(15_000),
      });
      return resp.json() as any;
    }

    async function probeField(context: string, field: string): Promise<{ field: string; context: string; result: string; data?: any }> {
      const scalar = await rawGql(`{ ${context} { ${field} } }`);
      const err = scalar.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        if (err.includes("must have a selection")) {
          for (const sub of ["amount currency", "from to", "id name value", "value percentage"]) {
            const obj = await rawGql(`{ ${context} { ${field} { ${sub} } } }`);
            if (!obj.errors?.length) {
              return { field, context, result: `OBJECT {${sub}}`, data: obj.data };
            }
          }
          return { field, context, result: "OBJECT (unknown sub-fields)" };
        }
        if (!err) return { field, context, result: "SCALAR", data: scalar.data };
        return { field, context, result: "EXISTS_WITH_ERROR", data: err };
      }
      return { field, context, result: "NOT_FOUND" };
    }

    const results: any = {};

    // PHASE 1: Root queries (parallel)
    const rootCandidates = [
      "creditors", "creditor", "programs", "programGuides",
      "worksheets", "worksheet", "deals", "applications",
      "vehicles", "inventory", "rates", "rateSheets",
      "guidelines", "eligibility", "rules",
      "termMatrix", "tiers", "me", "currentUser",
      "retailers", "dealer",
    ];
    const rootResults = await Promise.all(rootCandidates.map(async q => {
      const r = await rawGql(`{ ${q} { __typename } }`);
      const err = r.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        return { query: q, typename: r.data?.[q]?.__typename || r.data?.[q]?.[0]?.__typename, error: err || null };
      }
      return null;
    }));
    results.rootQueries = rootResults.filter(Boolean);

    // PHASE 2: ALL tier fields (parallel batches of 20)
    const allTierFields = [
      "term", "termRange", "termLength", "loanTerm", "financingTerm",
      "amortization", "amortizationPeriod", "maxTerm", "minTerm",
      "vehicleAge", "age", "ageRange", "maxAge", "minAge",
      "vehicleYear", "yearRange", "modelYear", "maxYear", "minYear",
      "mileage", "km", "kilometers", "odometer", "maxKm", "maxMileage",
      "maxOdometer", "mileageRange", "odometerRange",
      "ltv", "ltvRange", "loanToValue", "maxLtv", "minLtv",
      "maxAdvance", "minAdvance", "advanceRate",
      "bookValue", "wholesaleValue", "vehicleValue", "vehiclePrice",
      "creditScore", "minCreditScore", "maxCreditScore", "beaconScore",
      "downPayment", "minDownPayment", "maxDownPayment",
      "fee", "fees", "creditorFee", "dealerReserve", "dealerFee", "adminFee",
      "maxPayment", "minPayment", "interestRate",
      "restrictions", "rules", "guidelines", "conditions", "eligibility",
      "description", "notes", "label", "code", "status", "active",
      "maxAmountFinanced", "minAmountFinanced", "maxLoanAmount",
      "config", "matrix", "ltvMatrix", "termMatrix",
      "collateral", "assetRules", "vehicleRestrictions",
      "order", "position", "priority", "rank",
      "createdAt", "updatedAt",
    ];
    const tierCtx = "creditors { programs { tiers { name";
    const tierClose = "} } }";
    const tierFieldResults = await Promise.all(
      allTierFields.map(f => probeField(`${tierCtx}`, f).then(r => ({ ...r, field: f })).catch(() => ({ field: f, result: "ERROR" })))
    );
    // Actually we need to restructure - probeField can't handle nested context well
    // Let's do it properly
    results.tierFields = {};
    const tierBatch = allTierFields.map(async f => {
      const r = await rawGql(`{ creditors { programs { tiers { name ${f} } } } }`);
      const err = r.errors?.[0]?.message || "";
      if (err.includes("Cannot query field")) return;
      if (err.includes("must have a selection")) {
        for (const sub of ["amount currency", "from to", "id name", "value percentage", "min max"]) {
          const r2 = await rawGql(`{ creditors { programs { tiers { name ${f} { ${sub} } } } } }`);
          if (!r2.errors?.length) {
            const allTiers: any[] = [];
            for (const c of (r2.data?.creditors || [])) for (const p of (c.programs || [])) for (const t of (p.tiers || [])) allTiers.push({ creditor: c.name, prog: p.title, tier: t.name, [f]: t[f] });
            results.tierFields[f] = { type: `OBJECT {${sub}}`, samples: allTiers.slice(0, 8) };
            return;
          }
        }
        results.tierFields[f] = { type: "OBJECT (sub-fields unknown)" };
        return;
      }
      if (!err) {
        const allTiers: any[] = [];
        for (const c of (r.data?.creditors || [])) for (const p of (c.programs || [])) for (const t of (p.tiers || [])) {
          if (t[f] !== null && t[f] !== undefined) allTiers.push({ creditor: c.name, prog: p.title, tier: t.name, [f]: t[f] });
        }
        results.tierFields[f] = { type: "SCALAR", samples: allTiers.slice(0, 8) };
      }
    });
    await Promise.all(tierBatch);

    // PHASE 3: ALL program-level fields (parallel)
    const allProgFields = [
      "term", "termRange", "maxTerm", "minTerm",
      "vehicleAge", "age", "maxAge", "minAge", "ageRange",
      "vehicleYear", "yearRange", "maxYear", "minYear", "modelYear",
      "mileage", "km", "maxKm", "maxMileage", "maxOdometer",
      "ltv", "maxLtv", "ltvRange",
      "restrictions", "rules", "guidelines", "conditions", "eligibility",
      "description", "notes", "code", "status", "active",
      "matrix", "rateMatrix", "termMatrix", "ltvMatrix",
      "maxAmountFinanced", "creditorFee", "dealerReserve", "fees",
      "region", "province", "provinces",
      "collateral", "assetRules",
      "config", "settings",
    ];
    results.programFields = {};
    const progBatch = allProgFields.map(async f => {
      const r = await rawGql(`{ creditors { programs { title ${f} } } }`);
      const err = r.errors?.[0]?.message || "";
      if (err.includes("Cannot query field")) return;
      if (err.includes("must have a selection")) {
        for (const sub of ["from to", "amount currency", "id name", "value"]) {
          const r2 = await rawGql(`{ creditors { programs { title ${f} { ${sub} } } } }`);
          if (!r2.errors?.length) {
            const progs = r2.data?.creditors?.[0]?.programs || [];
            results.programFields[f] = { type: `OBJECT {${sub}}`, samples: progs.slice(0, 5).map((p: any) => ({ title: p.title, [f]: p[f] })) };
            return;
          }
        }
        results.programFields[f] = { type: "OBJECT (sub-fields unknown)" };
        return;
      }
      if (!err) {
        const progs = r.data?.creditors?.[0]?.programs || [];
        results.programFields[f] = { type: "SCALAR", samples: progs.slice(0, 5).map((p: any) => ({ title: p.title, [f]: p[f] })) };
      }
    });
    await Promise.all(progBatch);

    // PHASE 4: Creditor-level fields (parallel)
    const allCredFields = [
      "guidelines", "programGuidelines", "documents", "attachments",
      "restrictions", "rules", "requirements", "config", "settings",
      "region", "province", "website", "url", "contact",
    ];
    results.creditorFields = {};
    const credBatch = allCredFields.map(async f => {
      const r = await rawGql(`{ creditors { name ${f} } }`);
      const err = r.errors?.[0]?.message || "";
      if (err.includes("Cannot query field")) return;
      if (err.includes("must have a selection")) {
        results.creditorFields[f] = { type: "OBJECT" };
        return;
      }
      if (!err) {
        const creds = r.data?.creditors || [];
        results.creditorFields[f] = { type: "SCALAR", samples: creds.slice(0, 3).map((c: any) => ({ name: c.name, [f]: c[f] })) };
      }
    });
    await Promise.all(credBatch);

    // PHASE 5: Full data dump with all known fields
    const fullDump = await rawGql(`{
      creditors {
        id name status
        programs {
          id title type
          tiers {
            id name
            interestRate { from to }
            maxPayment { amount currency }
            creditorFee { amount currency }
            dealerReserve { amount currency }
          }
        }
      }
    }`);
    results.fullDump = fullDump.data?.creditors;

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  approvedTerm:  number;
  maxPaymentOverride?: number;
  downPayment?:  number;
  tradeValue?:   number;
  tradeLien?:    number;
  taxRate?:      number;
}

function pmt(rate: number, nper: number, pv: number): number {
  if (rate === 0) return pv / nper;
  const r = rate / 12;
  return (pv * r * Math.pow(1 + r, nper)) / (Math.pow(1 + r, nper) - 1);
}

router.post("/lender-calculate", requireOwner, async (req, res) => {
  const params = req.body as CalcParams;

  if (!params.lenderCode || !params.tierName || !params.programId) {
    res.status(400).json({ error: "lenderCode, programId, and tierName are required" });
    return;
  }
  if (params.approvedRate == null || params.approvedTerm == null) {
    res.status(400).json({ error: "approvedRate and approvedTerm are required" });
    return;
  }

  const rate = Number(params.approvedRate);
  const term = Number(params.approvedTerm);
  if (!isFinite(rate) || rate < 0 || rate > 100) {
    res.status(400).json({ error: "approvedRate must be between 0 and 100" });
    return;
  }
  if (!isFinite(term) || term <= 0 || term > 120 || !Number.isInteger(term)) {
    res.status(400).json({ error: "approvedTerm must be a positive integer up to 120" });
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
  const rateDecimal   = rate / 100;
  const termMonths    = term;
  const tierMaxPmt    = tier.maxPayment > 0 ? tier.maxPayment : Infinity;
  const maxPmt        = params.maxPaymentOverride ? Math.min(Number(params.maxPaymentOverride), tierMaxPmt) : tierMaxPmt;
  const downPayment   = params.downPayment ?? 0;
  const tradeValue    = params.tradeValue ?? 0;
  const tradeLien     = params.tradeLien ?? 0;
  const taxRate       = (params.taxRate ?? 5) / 100;
  const netTrade      = tradeValue - tradeLien;

  interface Result {
    vin:             string;
    vehicle:         string;
    location:        string;
    bbWholesale:     number;
    totalFinanced:   number;
    monthlyPayment:  number;
    costOfBorrowing: number;
    hasPhotos:       boolean;
    website:         string;
  }

  const results: Result[] = [];

  for (const item of inventory) {
    if (!item.bbAvgWholesale) continue;
    const bbWholesale = parseFloat(item.bbAvgWholesale);
    if (isNaN(bbWholesale) || bbWholesale <= 0) continue;

    const vehicleCost = bbWholesale;
    const amountBeforeTax = vehicleCost - downPayment - netTrade;
    if (amountBeforeTax <= 0) continue;

    const taxes = amountBeforeTax * taxRate;
    const totalFinanced = amountBeforeTax + taxes;

    const monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);
    if (maxPmt < Infinity && monthlyPayment > maxPmt) continue;

    const costOfBorrowing = (monthlyPayment * termMonths) - totalFinanced;

    results.push({
      vin:             item.vin,
      vehicle:         item.vehicle,
      location:        item.location,
      bbWholesale,
      totalFinanced:   Math.round(totalFinanced),
      monthlyPayment:  Math.round(monthlyPayment * 100) / 100,
      costOfBorrowing: Math.round(costOfBorrowing),
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
    resultCount: results.length,
    results,
  });
});

export default router;
