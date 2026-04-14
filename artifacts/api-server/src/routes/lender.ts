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

    const results: any = {};

    // 1. Probe creditorFee and dealerReserve sub-fields
    const objFieldSubSelectors = ["amount currency", "value", "percentage rate", "from to", "min max"];
    for (const parent of ["creditorFee", "dealerReserve"]) {
      results[parent] = {};
      for (const sub of objFieldSubSelectors) {
        const r = await rawGql(`{ creditors { programs { tiers { id name ${parent} { ${sub} } } } } }`);
        const err = r.errors?.[0]?.message || "";
        if (!err.includes("Cannot query field")) {
          const tiers = r.data?.creditors?.[0]?.programs?.[0]?.tiers || [];
          results[parent][sub] = { sample: tiers.slice(0, 2).map((t: any) => ({ name: t.name, [parent]: t[parent] })), error: err || null };
        }
      }
    }

    // 2. Exhaustive tier-level field probe - try EVERY plausible field as object { from to }
    const tierObjFields = [
      "term", "termRange", "termLength", "loanTerm", "financingTerm",
      "amortization", "amortizationPeriod",
      "vehicleAge", "age", "ageRange", "maxAge", "vehicleAgeRange",
      "vehicleYear", "yearRange", "modelYear", "modelYearRange",
      "mileage", "km", "kilometers", "odometer", "odometerRange", "mileageRange", "kmRange",
      "ltv", "ltvRange", "loanToValue", "advanceRate",
      "bookValue", "wholesaleValue",
      "vehicleValue", "vehiclePrice",
      "costOfBorrowing",
    ];
    results.tierObjFields = {};
    for (const f of tierObjFields) {
      const r = await rawGql(`{ creditors { programs { tiers { id name ${f} { from to } } } } }`);
      const err = r.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        const creds = r.data?.creditors || [];
        const allTiers: any[] = [];
        for (const c of creds) for (const p of (c.programs || [])) for (const t of (p.tiers || [])) allTiers.push(t);
        results.tierObjFields[f] = { sample: allTiers.slice(0, 5).map((t: any) => ({ name: t.name, [f]: t[f] })), error: err || null };
      }
    }

    // 3. Try all those as scalar on tiers
    results.tierScalarFields = {};
    for (const f of tierObjFields) {
      const r = await rawGql(`{ creditors { programs { tiers { id name ${f} } } } }`);
      const err = r.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        const creds = r.data?.creditors || [];
        const allTiers: any[] = [];
        for (const c of creds) for (const p of (c.programs || [])) for (const t of (p.tiers || [])) allTiers.push(t);
        results.tierScalarFields[f] = { sample: allTiers.slice(0, 5).map((t: any) => ({ name: t.name, [f]: t[f] })), error: err || null };
      }
    }

    // 4. Try as money { amount currency } on tiers
    results.tierMoneyFields = {};
    for (const f of tierObjFields) {
      const r = await rawGql(`{ creditors { programs { tiers { id name ${f} { amount currency } } } } }`);
      const err = r.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        const creds = r.data?.creditors || [];
        const allTiers: any[] = [];
        for (const c of creds) for (const p of (c.programs || [])) for (const t of (p.tiers || [])) allTiers.push(t);
        results.tierMoneyFields[f] = { sample: allTiers.slice(0, 5).map((t: any) => ({ name: t.name, [f]: t[f] })), error: err || null };
      }
    }

    // 5. Program-level fields (not tier level)
    const progFields = [
      "term", "termRange", "maxTerm", "minTerm",
      "vehicleAge", "age", "maxAge", "minAge",
      "vehicleYear", "yearRange", "maxYear", "minYear",
      "mileage", "km", "maxKm", "maxMileage", "maxOdometer",
      "ltv", "maxLtv",
      "restrictions", "rules", "guidelines", "conditions",
    ];
    results.programObjFields = {};
    for (const f of progFields) {
      const r = await rawGql(`{ creditors { programs { id title ${f} { from to } } } }`);
      const err = r.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        const progs = r.data?.creditors?.[0]?.programs || [];
        results.programObjFields[f] = { sample: progs.slice(0, 3).map((p: any) => ({ title: p.title, [f]: p[f] })), error: err || null };
      }
    }
    results.programScalarFields = {};
    for (const f of progFields) {
      const r = await rawGql(`{ creditors { programs { id title ${f} } } }`);
      const err = r.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        const progs = r.data?.creditors?.[0]?.programs || [];
        results.programScalarFields[f] = { sample: progs.slice(0, 3).map((p: any) => ({ title: p.title, [f]: p[f] })), error: err || null };
      }
    }

    // 6. Creditor-level fields
    const credFields = [
      "term", "maxTerm", "vehicleAge", "maxAge", "mileage", "maxKm",
      "guidelines", "restrictions", "rules", "conditions",
    ];
    results.creditorObjFields = {};
    for (const f of credFields) {
      const r = await rawGql(`{ creditors { id name ${f} { from to } } }`);
      const err = r.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        results.creditorObjFields[f] = { exists: true, error: err || null };
      }
    }
    results.creditorScalarFields = {};
    for (const f of credFields) {
      const r = await rawGql(`{ creditors { id name ${f} } }`);
      const err = r.errors?.[0]?.message || "";
      if (!err.includes("Cannot query field")) {
        const creds = r.data?.creditors || [];
        results.creditorScalarFields[f] = { sample: creds.slice(0, 3).map((c: any) => ({ name: c.name, [f]: c[f] })), error: err || null };
      }
    }

    // 7. Get full __typename of tier/program for introspection hint
    const typeR = await rawGql(`{ creditors { __typename programs { __typename tiers { __typename } } } }`);
    results.typeNames = {
      creditor: typeR.data?.creditors?.[0]?.__typename,
      program: typeR.data?.creditors?.[0]?.programs?.[0]?.__typename,
      tier: typeR.data?.creditors?.[0]?.programs?.[0]?.tiers?.[0]?.__typename,
    };

    // 8. Try __type introspection for ProgramTierValue
    const tierTypeName = results.typeNames?.tier || "ProgramTierValue";
    const introR = await rawGql(`{ __type(name: "${tierTypeName}") { name fields { name type { name kind ofType { name kind } } } } }`);
    results.tierTypeIntrospection = introR.data?.__type || introR.errors?.[0]?.message;

    // 9. Try __type for program type
    const progTypeName = results.typeNames?.program || "CreditorProgram";
    const introP = await rawGql(`{ __type(name: "${progTypeName}") { name fields { name type { name kind ofType { name kind } } } } }`);
    results.programTypeIntrospection = introP.data?.__type || introP.errors?.[0]?.message;

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
