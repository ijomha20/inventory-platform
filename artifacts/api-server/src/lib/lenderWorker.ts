import { logger } from "./logger.js";
import { getCacheState } from "./inventoryCache.js";
import {
  loadLenderProgramsFromStore,
  saveLenderProgramsToStore,
  type LenderProgram,
  type LenderProgramTier,
  type LenderProgramsBlob,
} from "./bbObjectStore.js";
import { getLenderAuthCookies, callGraphQL, LENDER_ENABLED } from "./lenderAuth.js";

const RETAILER_ID = "23c5167f-22a0-47a9-b46b-a3a224f73ab7";

const KNOWN_LENDERS: { code: string; name: string }[] = [
  { code: "SAN", name: "Santander" },
  { code: "EPI", name: "Eden Park" },
  { code: "ACC", name: "ACC" },
  { code: "iAF", name: "iA Auto Finance" },
  { code: "QLI", name: "Quantifi" },
  { code: "CAV", name: "Cavalcade" },
  { code: "RFC", name: "Rifco" },
  { code: "THF", name: "The House Finance Corp" },
];

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const APPLICATIONS_QUERY = `
  query Applications($retailerId: ID!, $first: Int, $after: String) {
    applications(
      retailerId: $retailerId
      first: $first
      after: $after
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      edges {
        node {
          id
          status
          createdAt
          applicant {
            firstName
            lastName
          }
          worksheetConnections {
            edges {
              node {
                id
                creditor {
                  id
                  name
                  code
                }
                status
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const WORKSHEET_DETAIL_QUERY = `
  query WorksheetConnection($id: ID!) {
    worksheetConnection(id: $id) {
      id
      creditor {
        id
        name
        code
      }
      programs {
        edges {
          node {
            id
            name
            tiers {
              edges {
                node {
                  id
                  name
                  maxAdvanceLTV
                  maxAftermarketLTV
                  maxAllInLTV
                  creditorFee
                  dealerReserve
                  minRate
                  maxRate
                  minTerm
                  maxTerm
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function findRecentDealWithLenders(
  appSession: string,
  csrfToken: string,
): Promise<{ appId: string; worksheetMap: Map<string, string> } | null> {
  let after: string | null = null;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const variables: any = { retailerId: RETAILER_ID, first: 20 };
    if (after) variables.after = after;

    const data = await callGraphQL(appSession, csrfToken, "Applications", APPLICATIONS_QUERY, variables);
    const edges = data?.applications?.edges ?? [];

    if (edges.length === 0) break;

    for (const edge of edges) {
      const app = edge.node;
      const wsEdges = app?.worksheetConnections?.edges ?? [];
      const lenderCodes = new Set<string>();
      const worksheetMap = new Map<string, string>();

      for (const wsEdge of wsEdges) {
        const ws = wsEdge.node;
        const code = ws?.creditor?.code;
        if (code && KNOWN_LENDERS.some(l => l.code === code)) {
          lenderCodes.add(code);
          worksheetMap.set(code, ws.id);
        }
      }

      if (lenderCodes.size >= 4) {
        logger.info(
          { appId: app.id, lenderCount: lenderCodes.size, lenders: [...lenderCodes] },
          "Lender sync: found deal with multiple lenders",
        );
        return { appId: app.id, worksheetMap };
      }
    }

    const pageInfo = data?.applications?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
    await sleep(rand(500, 1000));
  }

  return null;
}

async function fetchProgramsForWorksheet(
  appSession: string,
  csrfToken: string,
  lenderCode: string,
  lenderName: string,
  worksheetId: string,
): Promise<LenderProgram | null> {
  try {
    const data = await callGraphQL(
      appSession, csrfToken,
      "WorksheetConnection",
      WORKSHEET_DETAIL_QUERY,
      { id: worksheetId },
    );

    const ws = data?.worksheetConnection;
    if (!ws) {
      logger.warn({ lenderCode, worksheetId }, "Lender sync: worksheet not found");
      return null;
    }

    const programEdges = ws?.programs?.edges ?? [];
    const tiers: LenderProgramTier[] = [];

    for (const progEdge of programEdges) {
      const program = progEdge.node;
      const tierEdges = program?.tiers?.edges ?? [];

      for (const tierEdge of tierEdges) {
        const tier = tierEdge.node;
        tiers.push({
          tierName:          tier.name ?? program.name ?? "Unknown",
          maxAdvanceLTV:     Number(tier.maxAdvanceLTV ?? 0),
          maxAftermarketLTV: Number(tier.maxAftermarketLTV ?? 0),
          maxAllInLTV:       Number(tier.maxAllInLTV ?? 0),
          creditorFee:       Number(tier.creditorFee ?? 0),
          dealerReserve:     Number(tier.dealerReserve ?? 0),
          minRate:           tier.minRate != null ? Number(tier.minRate) : undefined,
          maxRate:           tier.maxRate != null ? Number(tier.maxRate) : undefined,
          minTerm:           tier.minTerm != null ? Number(tier.minTerm) : undefined,
          maxTerm:           tier.maxTerm != null ? Number(tier.maxTerm) : undefined,
        });
      }
    }

    if (tiers.length === 0) {
      logger.info({ lenderCode }, "Lender sync: no program tiers found for lender");
      return null;
    }

    logger.info({ lenderCode, tierCount: tiers.length }, "Lender sync: fetched program tiers");
    return { lenderCode, lenderName, tiers };
  } catch (err: any) {
    logger.warn({ lenderCode, err: err.message }, "Lender sync: failed to fetch worksheet programs");
    return null;
  }
}

async function syncLenderPrograms(): Promise<void> {
  const { appSession, csrfToken } = await getLenderAuthCookies();
  logger.info("Lender sync: auth ready — searching for recent deal");

  const deal = await findRecentDealWithLenders(appSession, csrfToken);
  if (!deal) {
    throw new Error("Lender sync: could not find a recent deal submitted to known lenders");
  }

  const programs: LenderProgram[] = [];

  for (const lender of KNOWN_LENDERS) {
    const worksheetId = deal.worksheetMap.get(lender.code);
    if (!worksheetId) {
      logger.info({ lenderCode: lender.code }, "Lender sync: no worksheet for this lender in selected deal");
      continue;
    }

    const program = await fetchProgramsForWorksheet(
      appSession, csrfToken,
      lender.code, lender.name,
      worksheetId,
    );
    if (program) programs.push(program);

    await sleep(rand(800, 1500));
  }

  if (programs.length === 0) {
    throw new Error("Lender sync: fetched 0 programs from all lenders");
  }

  const blob: LenderProgramsBlob = {
    programs,
    updatedAt: new Date().toISOString(),
    sourceApp: deal.appId,
  };

  await saveLenderProgramsToStore(blob);
  cachedPrograms = blob;

  logger.info(
    { lenderCount: programs.length, totalTiers: programs.reduce((s, p) => s + p.tiers.length, 0) },
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
