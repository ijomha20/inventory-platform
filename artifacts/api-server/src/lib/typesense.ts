/**
 * Single source of truth for Typesense config, dealer collections, and URL helpers.
 * All Typesense consumers import from here — no duplication.
 * API keys and collection IDs come from env.ts; rotate keys in the
 * Typesense dashboard if they were ever committed to git history.
 */
import { env } from "./env.js";

export const TYPESENSE_HOST = env.TYPESENSE_HOST
  .trim()
  .replace(/^https?:\/\//i, "")
  .replace(/\/+$/g, "");

export interface DealerCollection {
  name:       string;
  collection: string;
  apiKey:     string;
  siteUrl:    string;
}

export const DEALER_COLLECTIONS: readonly DealerCollection[] = [
  {
    name:       "Parkdale",
    collection: env.TYPESENSE_COLLECTION_PARKDALE,
    apiKey:     env.TYPESENSE_KEY_PARKDALE,
    siteUrl:    "https://www.parkdalemotors.ca",
  },
  {
    name:       "Matrix",
    collection: env.TYPESENSE_COLLECTION_MATRIX,
    apiKey:     env.TYPESENSE_KEY_MATRIX,
    siteUrl:    "https://www.matrixmotorsyeg.ca",
  },
];

/** Map hostname (without www.) → DealerCollection for price-lookup matching. */
export const DEALER_BY_HOSTNAME: ReadonlyMap<string, DealerCollection> = new Map(
  DEALER_COLLECTIONS.map((d) => {
    const host = new URL(d.siteUrl).hostname.replace(/^www\./, "");
    return [host, d] as const;
  }),
);

export const IMAGE_CDN_BASE = "https://zopsoftware-asset.b-cdn.net";

/** Build a Typesense search URL for a given collection. */
export function typesenseSearchUrl(
  collection: string,
  apiKey: string,
  params: URLSearchParams,
): string {
  params.set("x-typesense-api-key", apiKey);
  return `https://${TYPESENSE_HOST}/collections/${collection}/documents/search?${params}`;
}

/**
 * Resolve a Typesense document to a dealer website listing URL.
 * Tries page_url first, then builds from slug + id.
 */
export function extractWebsiteUrl(doc: any, siteUrl: string): string | null {
  if (doc.page_url) {
    const raw = doc.page_url.toString().trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = raw.replace(/^\/+|\/+$/g, "");
    return `${siteUrl}/${path}/`;
  }
  const id   = doc.id || doc.post_id || doc.vehicle_id || "";
  let   slug = doc.slug || doc.url_slug || "";
  if (!slug && doc.year && doc.make && doc.model) {
    slug = [doc.year, doc.make, doc.model, doc.trim || ""]
      .filter((p: any) => String(p).trim() !== "")
      .join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  if (!id || !slug) return null;
  return `${siteUrl}/inventory/${slug}/${id}/`;
}

/**
 * Resolve VIN from Typesense document variants.
 * Some collections use non-standard field names.
 */
export function extractDocVin(doc: Record<string, unknown>): string {
  const candidates = [
    doc["vin"],
    doc["VIN"],
    doc["vin_number"],
    doc["vehicle_vin"],
    doc["stock_vin"],
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim().toUpperCase();
    if (normalized) return normalized;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Fuzzy match helpers — used when Typesense docs don't expose a VIN
// (e.g. newly uploaded Matrix listings) so we can still resolve a vehicle
// to its listing using year/make/model + km signals.
// ---------------------------------------------------------------------------

const FUZZY_NOISE_TOKENS = new Set([
  "the","and","or","of","in","for","with","a","an","to","auto",
  "2wd","4wd","awd","fwd","rwd","4x4",
  "white","black","silver","grey","gray","red","blue","green",
  "burgundy","brown","gold","beige","orange","yellow","purple",
]);

const MULTI_WORD_MODELS = new Set([
  "grand caravan", "grand cherokee", "grand marquis", "grand prix",
  "grand vitara", "town car", "monte carlo", "land cruiser",
  "rav4", "cr-v", "cx-5", "cx-9", "hr-v", "br-v",
  "e-pace", "f-pace", "f-type", "range rover",
  "model 3", "model s", "model x", "model y",
  "wrangler unlimited", "sierra 1500", "sierra 2500", "sierra 3500",
  "ram 1500", "ram 2500", "ram 3500",
]);

function fuzzyTokenize(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .split(/[\s,/\-]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !FUZZY_NOISE_TOKENS.has(t));
}

function parseInteger(value: unknown): number {
  if (value == null) return 0;
  const cleaned = String(value).replace(/[^0-9]/g, "");
  if (!cleaned) return 0;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseFloatLoose(value: unknown): number {
  if (value == null) return 0;
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Year/make/model parsed from an inventory `vehicle` description string. */
export interface ParsedVehicleDescriptor {
  year:  number;
  make:  string;          // lowercase, single token
  model: string;          // lowercase, single token (or known multi-word)
  trimTokens: string[];   // remaining lowercase tokens
}

/** Parse a vehicle description like "2024 RAM 1500 Big Horn Crew Cab". */
export function parseVehicleDescriptor(vehicle: string): ParsedVehicleDescriptor {
  const parts = (vehicle ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { year: 0, make: "", model: "", trimTokens: [] };

  let idx = 0;
  let year = 0;
  if (/^(19|20)\d{2}$/.test(parts[0])) {
    year = Number.parseInt(parts[0], 10);
    idx = 1;
  }

  const make = (parts[idx] ?? "").toLowerCase();
  idx += 1;

  const remainder = parts.slice(idx).join(" ").toLowerCase();
  let model = "";
  let consumedFromRemainder = 0;
  for (const candidate of MULTI_WORD_MODELS) {
    if (remainder.startsWith(candidate)) {
      model = candidate;
      consumedFromRemainder = candidate.split(/\s+/).length;
      break;
    }
  }
  if (!model && parts[idx]) {
    model = parts[idx].toLowerCase();
    consumedFromRemainder = 1;
  }

  const trimRest = parts.slice(idx + consumedFromRemainder).join(" ");
  const trimTokens = fuzzyTokenize(trimRest);

  return { year, make, model, trimTokens };
}

export interface TypesenseDocSummary {
  collection:  string;
  siteUrl:     string;
  docId:       string;
  vin:         string;       // may be ""
  year:        number;
  make:        string;       // lowercase
  model:       string;       // lowercase
  trim:        string;       // lowercase
  km:          number;
  price:       number;
  websiteUrl:  string | null;
  onlinePrice: string | null;
  imagePaths:  string[];     // raw paths (use IMAGE_CDN_BASE prefix to render)
  rawDoc:      Record<string, any>;
}

/** Extract image paths from a Typesense document — handles ; or , separated lists. */
export function extractDocImagePaths(doc: Record<string, any>): string[] {
  const raw = String(doc.image_urls ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[;|]/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Score how well a Typesense doc matches an inventory item when no VIN match
 * is available. Returns 0 when the candidate is not viable. Higher is better.
 *
 * Gates (any failure → 0):
 *   - Year exact match
 *   - Make match (substring either direction)
 *   - Model match (substring either direction)
 *
 * Bonuses:
 *   - Each trim token overlap
 *   - KM closeness (within 1500/3000/8000 km tiers)
 *   - Price closeness (within $2k/$5k tiers)
 */
export function scoreFuzzyMatch(
  item: { vehicle: string; km: number; price: number },
  doc:  TypesenseDocSummary,
): number {
  const parsed = parseVehicleDescriptor(item.vehicle);
  if (!parsed.year || !parsed.make || !parsed.model) return 0;
  if (!doc.year || !doc.make || !doc.model) return 0;

  if (parsed.year !== doc.year) return 0;

  const docMake = doc.make.toLowerCase();
  const docModel = doc.model.toLowerCase();
  const makeOk = docMake.includes(parsed.make) || parsed.make.includes(docMake);
  if (!makeOk) return 0;
  const modelOk = docModel.includes(parsed.model) || parsed.model.includes(docModel);
  if (!modelOk) return 0;

  let score = 30;

  const docTrimTokens = fuzzyTokenize(doc.trim);
  const overlap = parsed.trimTokens.filter((t) => docTrimTokens.includes(t)).length;
  score += overlap * 5;

  if (item.km > 0 && doc.km > 0) {
    const diff = Math.abs(item.km - doc.km);
    if (diff <= 1500) score += 12;
    else if (diff <= 3000) score += 7;
    else if (diff <= 8000) score += 3;
    else if (diff > 25000) score -= 5;
  }

  if (item.price > 0 && doc.price > 0) {
    const diff = Math.abs(item.price - doc.price);
    if (diff <= 2000) score += 4;
    else if (diff <= 5000) score += 2;
  }

  return score;
}

/** Build a normalized doc summary used by both VIN and fuzzy matching paths. */
export function buildDocSummary(
  doc: Record<string, any>,
  collection: string,
  siteUrl: string,
): TypesenseDocSummary {
  return {
    collection,
    siteUrl,
    docId:       String(doc.id ?? doc.post_id ?? doc.vehicle_id ?? ""),
    vin:         extractDocVin(doc),
    year:        parseInteger(doc.year),
    make:        String(doc.make ?? "").trim().toLowerCase(),
    model:       String(doc.model ?? "").trim().toLowerCase(),
    trim:        String(doc.trim ?? "").trim().toLowerCase(),
    km:          parseInteger(doc.mileage ?? doc.km ?? doc.odometer),
    price:       parseFloatLoose(doc.price ?? doc.internet_price ?? doc.list_price),
    websiteUrl:  extractWebsiteUrl(doc, siteUrl),
    onlinePrice: null,        // populated by caller — depends on special_price_on logic
    imagePaths:  extractDocImagePaths(doc),
    rawDoc:      doc,
  };
}

/** Map dealer location code (e.g. "MM") to its dealer collection name. */
export const LOCATION_TO_DEALER_NAME: ReadonlyMap<string, string> = new Map([
  ["mm",       "Matrix"],
  ["matrix",   "Matrix"],
  ["pd",       "Parkdale"],
  ["parkdale", "Parkdale"],
]);

/** Typed shape of a Typesense search API response. */
export interface TypesenseSearchResponse<T = Record<string, unknown>> {
  found: number;
  hits: Array<{ document: T }>;
}
