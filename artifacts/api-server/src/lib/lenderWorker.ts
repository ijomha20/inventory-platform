import { logger } from "./logger.js";
import {
  loadLenderProgramsFromStore,
  saveLenderProgramsToStore,
  type LenderProgram,
  type LenderProgramGuide,
  type LenderProgramTier,
  type LenderProgramsBlob,
  type VehicleTermMatrixEntry,
  type VehicleConditionMatrixEntry,
} from "./bbObjectStore.js";
import { getLenderAuthCookies, callGraphQL, LENDER_ENABLED } from "./lenderAuth.js";

const CREDITOR_NAME_TO_CODE: Record<string, { code: string; name: string }> = {
  SANTANDER:  { code: "SAN", name: "Santander" },
  EDEN_PARK:  { code: "EPI", name: "Eden Park" },
  ACC:        { code: "ACC", name: "ACC" },
  IAF:        { code: "iAF", name: "iA Auto Finance" },
  QUANTIFI:   { code: "QLI", name: "Quantifi" },
  RIFCO:      { code: "RFC", name: "Rifco" },
};

const IN_HOUSE_PROGRAM_MAP: Record<string, { code: string; name: string }> = {
  "Cavalcade":              { code: "CAV", name: "Cavalcade" },
  "Cavalcade Tier Program": { code: "CAV", name: "Cavalcade" },
  "Powersports":            { code: "THF", name: "The House Finance Corp" },
  "Auto Program":           { code: "THF", name: "The House Finance Corp" },
};

interface LenderStatus {
  running:   boolean;
  startedAt: string | null;
  lastRun:   string | null;
  lastCount: number;
  error?:    string;
}

const status: LenderStatus = { running: false, startedAt: null, lastRun: null, lastCount: 0 };

export function getLenderSyncStatus(): LenderStatus {
  return { ...status };
}

let cachedPrograms: LenderProgramsBlob | null = null;

export function getCachedLenderPrograms(): LenderProgramsBlob | null {
  return cachedPrograms;
}

export async function loadLenderProgramsFromCache(): Promise<LenderProgramsBlob | null> {
  if (cachedPrograms) return cachedPrograms;
  try {
    const blob = await loadLenderProgramsFromStore();
    if (blob) {
      cachedPrograms = blob;
      logger.info({ count: blob.programs.length, updatedAt: blob.updatedAt }, "Lender programs loaded from object storage");
    }
    return blob;
  } catch (err: any) {
    logger.warn({ err: err.message }, "Could not load lender programs from object storage");
    return null;
  }
}

const CREDITORS_PROGRAMS_QUERY = `{
  creditors {
    id
    name
    status
    programs {
      id
      type
      title
      tiers {
        id
        name
        maxPayment { amount currency }
        interestRate { from to }
        maxAdvanceLTV
        maxAftermarketLTV
        maxAllInLTV
        creditorFee { amount currency }
        dealerReserve { amount currency }
      }
      vehicleTermMatrix {
        year
        data {
          term
          milage { from to }
        }
      }
      vehicleConditionMatrix {
        year
        extraClean { milage { from to } }
        clean { milage { from to } }
        average { milage { from to } }
        rough { milage { from to } }
      }
      backendLtvCalculation
      allInLtvCalculation
      maxExtendedWarrantyFeeCalculation
      maxGapInsuranceFeeCalculation
      maxDealerAdminFeeCalculation
      backendRemainingCalculation
      allInRemainingCalculation
    }
  }
}`;

function mapCreditorToLenderPrograms(creditor: any): LenderProgram[] {
  const creditorName: string = creditor.name ?? "";
  const creditorId: string = creditor.id;

  if (creditorName === "IN_HOUSE") {
    const grouped = new Map<string, { code: string; name: string; guides: LenderProgramGuide[] }>();

    for (const prog of creditor.programs ?? []) {
      const match = IN_HOUSE_PROGRAM_MAP[prog.title];
      if (!match) continue;
      if (!grouped.has(match.code)) {
        grouped.set(match.code, { code: match.code, name: match.name, guides: [] });
      }
      grouped.get(match.code)!.guides.push(mapProgramGuide(prog));
    }

    return [...grouped.values()].map(g => ({
      lenderCode: g.code,
      lenderName: g.name,
      creditorId,
      programs: g.guides,
    }));
  }

  const mapping = CREDITOR_NAME_TO_CODE[creditorName];
  if (!mapping) {
    logger.info({ creditorName, creditorId }, "Lender sync: unknown creditor — skipping");
    return [];
  }

  const guides: LenderProgramGuide[] = (creditor.programs ?? []).map(mapProgramGuide);

  return [{
    lenderCode: mapping.code,
    lenderName: mapping.name,
    creditorId,
    programs: guides,
  }];
}

function mapMilageRange(m: any): { kmFrom: number; kmTo: number } {
  return { kmFrom: m?.milage?.from ?? 0, kmTo: m?.milage?.to ?? 0 };
}

function mapProgramGuide(prog: any): LenderProgramGuide {
  const tiers: LenderProgramTier[] = (prog.tiers ?? []).map((t: any) => ({
    tierName:          t.name ?? "Unknown",
    minRate:           t.interestRate?.from ?? 0,
    maxRate:           t.interestRate?.to ?? 0,
    maxPayment:        t.maxPayment?.amount ?? 0,
    maxAdvanceLTV:     t.maxAdvanceLTV ?? 0,
    maxAftermarketLTV: t.maxAftermarketLTV ?? 0,
    maxAllInLTV:       t.maxAllInLTV ?? 0,
    creditorFee:       t.creditorFee?.amount ?? 0,
    dealerReserve:     t.dealerReserve?.amount ?? 0,
  }));

  const vehicleTermMatrix: VehicleTermMatrixEntry[] = (prog.vehicleTermMatrix ?? []).map((entry: any) => ({
    year: entry.year,
    data: (entry.data ?? []).map((d: any) => ({
      term:   d.term,
      kmFrom: d.milage?.from ?? 0,
      kmTo:   d.milage?.to ?? 0,
    })),
  }));

  const vehicleConditionMatrix: VehicleConditionMatrixEntry[] = (prog.vehicleConditionMatrix ?? []).map((entry: any) => ({
    year:       entry.year,
    extraClean: mapMilageRange(entry.extraClean),
    clean:      mapMilageRange(entry.clean),
    average:    mapMilageRange(entry.average),
    rough:      mapMilageRange(entry.rough),
  }));

  const maxTerm = vehicleTermMatrix.length > 0
    ? Math.max(...vehicleTermMatrix.flatMap(e => e.data.map(d => d.term)))
    : undefined;

  function parseCalcNumber(val: unknown): number | undefined {
    if (val == null) return undefined;
    const s = String(val).trim();
    if (s === "") return undefined;
    const n = Number(s);
    return isFinite(n) ? n : undefined;
  }

  function parseCalcString(val: unknown): string | undefined {
    if (typeof val !== "string") return undefined;
    const s = val.trim();
    return s.length > 0 ? s : undefined;
  }

  function inferAftermarketBase(backendRemaining?: string): "bbWholesale" | "salePrice" | "unknown" {
    if (!backendRemaining) return "unknown";
    const hasWholesale = backendRemaining.includes("wholesaleValueBasedOnProgram");
    const hasSalePrice = backendRemaining.includes("salePrice");
    if (hasWholesale && !hasSalePrice) return "bbWholesale";
    if (hasSalePrice && !hasWholesale) return "salePrice";
    return "unknown";
  }

  const backendLtvCalculation = parseCalcString(prog.backendLtvCalculation);
  const allInLtvCalculation = parseCalcString(prog.allInLtvCalculation);
  const backendRemainingCalculation = parseCalcString(prog.backendRemainingCalculation);
  const allInRemainingCalculation = parseCalcString(prog.allInRemainingCalculation);
  const aftermarketBase = inferAftermarketBase(backendRemainingCalculation);

  return {
    programId:              prog.id,
    programTitle:           prog.title ?? "Unknown",
    programType:            prog.type ?? "FINANCE",
    tiers,
    vehicleTermMatrix,
    vehicleConditionMatrix,
    maxTerm,
    maxWarrantyPrice: parseCalcNumber(prog.maxExtendedWarrantyFeeCalculation),
    maxGapPrice:      parseCalcNumber(prog.maxGapInsuranceFeeCalculation),
    maxAdminFee:      parseCalcNumber(prog.maxDealerAdminFeeCalculation),
    backendLtvCalculation,
    allInLtvCalculation,
    backendRemainingCalculation,
    allInRemainingCalculation,
    aftermarketBase,
    allInOnlyRules: !!allInRemainingCalculation && !backendRemainingCalculation,
  };
}

async function syncLenderPrograms(): Promise<void> {
  const { appSession, csrfToken } = await getLenderAuthCookies();
  logger.info("Lender sync: auth ready — fetching creditor programs");

  const data = await callGraphQL(appSession, csrfToken, "", CREDITORS_PROGRAMS_QUERY);
  const creditors = data?.creditors ?? [];

  if (creditors.length === 0) {
    throw new Error("Lender sync: creditors query returned empty");
  }

  logger.info({ creditorCount: creditors.length }, "Lender sync: fetched creditors from CreditApp");

  const programs: LenderProgram[] = [];
  for (const cred of creditors) {
    if (cred.status !== "ACTIVE") continue;
    const mapped = mapCreditorToLenderPrograms(cred);
    programs.push(...mapped);
  }

  if (programs.length === 0) {
    throw new Error("Lender sync: no active lender programs found");
  }

  const totalTiers = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.tiers.length, 0), 0);
  const totalTermMatrices = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.vehicleTermMatrix.length, 0), 0);
  const totalCondMatrices = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.vehicleConditionMatrix.length, 0), 0);

  const blob: LenderProgramsBlob = {
    programs,
    updatedAt: new Date().toISOString(),
  };

  await saveLenderProgramsToStore(blob);
  cachedPrograms = blob;

  logger.info(
    { lenderCount: programs.length, totalTiers, totalTermMatrices, totalCondMatrices },
    "Lender sync: programs saved to object storage",
  );
}

export async function runLenderSync(): Promise<void> {
  if (!LENDER_ENABLED) {
    logger.info("Lender sync: LENDER_CREDITAPP_EMAIL or LENDER_CREDITAPP_PASSWORD not set — skipping");
    return;
  }
  if (status.running) {
    logger.warn("Lender sync: already running — skipping");
    return;
  }

  status.running   = true;
  status.startedAt = new Date().toISOString();
  status.error     = undefined;

  try {
    await syncLenderPrograms();
    status.lastRun   = new Date().toISOString();
    status.lastCount = cachedPrograms?.programs.length ?? 0;
    await recordRunDateToDb();
  } catch (err: any) {
    status.error = err.message;
    logger.error({ err: err.message }, "Lender sync: run failed");
    throw err;
  } finally {
    status.running   = false;
    status.startedAt = null;
  }
}

async function getLastRunDateFromDb(): Promise<string> {
  try {
    const { db, lenderSessionTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { toMountainDateStr } = await import("./randomScheduler.js");
    const rows = await db.select({ lastRunAt: lenderSessionTable.lastRunAt })
      .from(lenderSessionTable)
      .where(eq(lenderSessionTable.id, "singleton"));
    if (rows.length > 0 && rows[0].lastRunAt) {
      return toMountainDateStr(rows[0].lastRunAt);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Lender sync: could not read last run date from DB");
  }
  return "";
}

async function recordRunDateToDb(): Promise<void> {
  try {
    const { db, lenderSessionTable } = await import("@workspace/db");
    await db
      .insert(lenderSessionTable)
      .values({ id: "singleton", cookies: "[]", lastRunAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: lenderSessionTable.id,
        set: { lastRunAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err: String(err) }, "Lender sync: could not record run date to DB");
  }
}

export function scheduleLenderSync(): void {
  const { scheduleRandomDaily, toMountainDateStr } = require("./randomScheduler.js") as typeof import("./randomScheduler.js");

  loadLenderProgramsFromCache().catch(err =>
    logger.warn({ err: String(err) }, "Lender sync: could not preload programs from object storage"),
  );

  scheduleRandomDaily({
    name: "Lender sync",
    hasRunToday: async () => {
      const today = toMountainDateStr();
      const lastRan = await getLastRunDateFromDb();
      return lastRan === today;
    },
    execute: (reason: string) => {
      runLenderSync().catch(err => logger.error({ err }, "Lender sync: scheduled run error"));
    },
  });

  logger.info("Lender sync scheduled — randomized daily within business hours (Mountain Time)");
}
