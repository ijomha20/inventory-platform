/**
 * bbObjectStore.ts
 *
 * Thin wrapper around Replit's GCS-backed object storage for two JSON blobs
 * that must be shared between the dev and production environments:
 *
 *   bb-session.json  — CreditApp session cookies (written by dev, read by both)
 *   bb-values.json   — VIN → bbAvgWholesale map (written by dev, read by both)
 *
 * Object storage is per-workspace (not per-environment), so the same bucket
 * is accessible from both dev and production deployments.
 */

import { Storage } from "@google-cloud/storage";
import { logger } from "./logger.js";
import { env } from "./env.js";

const SIDECAR = "http://127.0.0.1:1106";

const gcs = new Storage({
  credentials: {
    audience:            "replit",
    subject_token_type:  "access_token",
    token_url:           `${SIDECAR}/token`,
    type:                "external_account",
    credential_source: {
      url:    `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

function bucket() {
  if (!env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return gcs.bucket(env.DEFAULT_OBJECT_STORAGE_BUCKET_ID);
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    const [contents] = await bucket().file(name).download();
    return JSON.parse(contents.toString("utf8")) as T;
  } catch (err: any) {
    if (err.code === 404 || err.message?.includes("No such object")) return null;
    logger.warn({ err: err.message, name }, "bbObjectStore: read failed");
    return null;
  }
}

async function writeJson(name: string, data: unknown): Promise<void> {
  try {
    await bucket().file(name).save(JSON.stringify(data), {
      contentType: "application/json",
    });
  } catch (err: any) {
    logger.warn({ err: err.message, name }, "bbObjectStore: write failed");
  }
}

// ---------------------------------------------------------------------------
// Session cookies (CreditApp auth — written by dev browser login)
// ---------------------------------------------------------------------------

export interface BbSessionBlob {
  cookies:   any[];
  updatedAt: string;
}

export async function loadSessionFromStore(): Promise<BbSessionBlob | null> {
  return readJson<BbSessionBlob>("bb-session.json");
}

export async function saveSessionToStore(cookies: any[]): Promise<void> {
  await writeJson("bb-session.json", {
    cookies,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// BB values map (VIN → bbAvgWholesale string — written by dev worker)
// ---------------------------------------------------------------------------

export interface BbValueEntry {
  avg:     string;
  xclean:  number;
  clean:   number;
  average: number;
  rough:   number;
}

export interface BbValuesBlob {
  values:    Record<string, string | BbValueEntry>;
  updatedAt: string;
}

export function parseBbEntry(raw: string | BbValueEntry): BbValueEntry | null {
  if (typeof raw === "object" && raw !== null && "avg" in raw) return raw as BbValueEntry;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    if (!isNaN(n) && cleaned.length > 0) return { avg: raw, xclean: 0, clean: 0, average: n, rough: 0 };
  }
  return null;
}

export async function loadBbValuesFromStore(): Promise<BbValuesBlob | null> {
  return readJson<BbValuesBlob>("bb-values.json");
}

export async function saveBbValuesToStore(values: Record<string, BbValueEntry>): Promise<void> {
  const existing = await loadBbValuesFromStore();
  const merged = existing?.values ? { ...existing.values } : {};
  for (const [vin, entry] of Object.entries(values)) {
    merged[vin.toUpperCase()] = entry;
  }
  await writeJson("bb-values.json", {
    values: merged,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Lender session cookies (CreditApp lender account — separate from BB)
// ---------------------------------------------------------------------------

export async function loadLenderSessionFromStore(): Promise<BbSessionBlob | null> {
  return readJson<BbSessionBlob>("lender-session.json");
}

export async function saveLenderSessionToStore(cookies: any[]): Promise<void> {
  await writeJson("lender-session.json", {
    cookies,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Lender programs cache (program matrices from CreditApp GraphQL)
// ---------------------------------------------------------------------------

export interface LenderProgramTier {
  tierName:         string;
  minRate:          number;
  maxRate:          number;
  maxPayment:       number;
  maxAdvanceLTV:    number;
  maxAftermarketLTV: number;
  maxAllInLTV:      number;
  creditorFee:      number;
  dealerReserve:    number;
}

export interface VehicleTermMatrixEntry {
  year: number;
  data: { term: number; kmFrom: number; kmTo: number }[];
}

export interface VehicleConditionMatrixEntry {
  year: number;
  extraClean: { kmFrom: number; kmTo: number };
  clean:      { kmFrom: number; kmTo: number };
  average:    { kmFrom: number; kmTo: number };
  rough:      { kmFrom: number; kmTo: number };
}

export interface LenderProgramGuide {
  programId:              string;
  programTitle:           string;
  programType:            string;
  tiers:                  LenderProgramTier[];
  vehicleTermMatrix:      VehicleTermMatrixEntry[];
  vehicleConditionMatrix: VehicleConditionMatrixEntry[];
  maxTerm?:               number;
  maxWarrantyPrice?:      number;
  maxGapPrice?:           number;
  maxAdminFee?:           number;
  /** CreditApp routing: when AH_INSURANCE, GAP sells in AH field; cap may be maxAhInsuranceFeeCalculation */
  gapInsuranceTarget?:    string | null;
  feeCalculationsRaw?: {
    maxExtendedWarrantyFeeCalculation?: string;
    maxGapInsuranceFeeCalculation?:     string;
    maxDealerAdminFeeCalculation?:       string;
    maxAhInsuranceFeeCalculation?:      string;
    resolvedGapCapSource?:             string;
  };
  capModelResolved?: "allInOnly" | "split" | "backendOnly" | "unknown";
  backendLtvCalculation?: string;
  allInLtvCalculation?: string;
  backendRemainingCalculation?: string;
  allInRemainingCalculation?: string;
  aftermarketBase?: "bbWholesale" | "salePrice" | "unknown";
  allInOnlyRules?: boolean;
  adminFeeInclusion?: "backend" | "allIn" | "excluded" | "unknown";
}

export interface LenderProgram {
  lenderCode:   string;
  lenderName:   string;
  creditorId:   string;
  programs:     LenderProgramGuide[];
}

export interface LenderProgramsBlob {
  programs:   LenderProgram[];
  updatedAt:  string;
}

export async function loadLenderProgramsFromStore(): Promise<LenderProgramsBlob | null> {
  return readJson<LenderProgramsBlob>("lender-programs.json");
}

export async function saveLenderProgramsToStore(data: LenderProgramsBlob): Promise<void> {
  await writeJson("lender-programs.json", data);
}
