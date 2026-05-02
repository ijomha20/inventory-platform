# Inventory Platform — Complete source (part 5 of 10)

Generated: 2026-05-02T06:08:07 UTC

Machine-generated split of `downloads/inventory-platform-complete-source.md`. Each file in the bundle starts with a `### \`path\`` heading followed by a fenced code block — this split only cuts **between** those blocks so fences stay intact.

- **Single-file bundle:** run `pnpm --filter @workspace/scripts export:complete-md`
- **Parts:** `inventory-platform-complete-source-part-NN-of-10.md` (this is part 5)
- **Replication:** Part 1 begins with the original preamble (quickstart + included roots + TOC). Other parts continue body content only.

---

### `auth.ts`
- **Exports:** `isOwner(email)`, `getUserRole(email)`, `requireOwner`, `requireAccess`, `requireOwnerOrViewer`, `configurePassport()`, `UserRole` (type)
- **Purpose:** Google OAuth via Passport.js. Compares emails against `OWNER_EMAIL` env var. Provides shared Express middleware for role-based route gating.
- **Consumed by:** `app.ts` (passport init), all route files (auth middleware)

### `inventoryCache.ts`
- **Exports:** `InventoryItem` (type), `getCacheState()`, `refreshCache()`, `applyCarfaxResults()`, `applyBlackBookValues()`, `startBackgroundRefresh()`, `getFuzzyResolvedDoc(vin)`
- **Purpose:** Central inventory data store. Loads from DB on startup, refreshes hourly from Apps Script JSON feed, enriches with Typesense (prices/URLs/photos) and BB values.
- **Consumed by:** `routes/inventory.ts`, `routes/lender/`, all workers (BB, Carfax)
- **Data flow:** Apps Script feed → normalize → Typesense enrichment → merge BB/Carfax → persist to DB
- **Note:** `getFuzzyResolvedDoc(vin)` returns the Typesense doc resolved for a VIN (including fuzzy-match results); consumed by `routes/inventory.ts` `/vehicle-images` handler.

### `lenderCalcEngine.ts`
- **Exports:** `resolveCapProfile(input)`, `resolveNoOnlineSellingPrice(ctx)`, `NO_ONLINE_STRATEGY_BY_PROFILE`, type exports
- **Purpose:** Determines how LTV caps combine (advance/aftermarket/allIn) using a 3-bit key system. Resolves maximized selling price when no online listing exists.
- **Consumed by:** `routes/lender/lender-calculate.ts` (calculator), `scripts/src/lender-engine.golden.test.ts` (tests)

### `lenderWorker.ts`
- **Exports:** `getLenderSyncStatus()`, `getCachedLenderPrograms()`, `loadLenderProgramsFromCache()`, `runLenderSync()`, `scheduleLenderSync()`
- **Purpose:** Syncs lender program matrices from CreditApp GraphQL API. Normalizes creditors (Santander, Eden Park, ACC, iAF, Quantifi, Rifco, in-house) into a uniform `LenderProgram[]` structure. Stores to GCS blob.
- **Consumed by:** `routes/lender/` (reads cached programs), `index.ts` (schedules sync)
- **Key mapping:** `CREDITOR_NAME_TO_CODE` maps CreditApp names → dealer codes (SAN, EPI, ACC, etc.)

### `lenderAuth.ts`
- **Exports:** `LENDER_ENABLED`, `getLenderAuthCookies()`, `callGraphQL()`, `graphqlHealthCheck()`
- **Purpose:** Authenticates to CreditApp admin portal, manages session cookies, provides GraphQL client.
- **Consumed by:** `lenderWorker.ts`
- **Required env:** `LENDER_CREDITAPP_EMAIL`, `LENDER_CREDITAPP_PASSWORD`

### `blackBookWorker.ts`
- **Exports:** `getBlackBookStatus()`, `runBlackBookWorker()`, `scheduleBlackBookWorker()`, `runBlackBookForVins(vins)`
- **Purpose:** Fetches Canadian Black Book wholesale valuations via CreditApp browser automation. Logs into admin.creditapp.ca, calls CBB API per VIN, matches best trim, stores results.
- **Consumed by:** `routes/inventory.ts` (manual trigger), `inventoryCache.ts` (new VIN detection), `index.ts` (scheduling)
- **Required env:** `CREDITAPP_EMAIL`, `CREDITAPP_PASSWORD`

### `carfaxWorker.ts`
- **Exports:** `CarfaxTestResult` (type), `getCarfaxBatchStatus()`, `runCarfaxWorker()`, `runCarfaxWorkerForVins(vins)`, `scheduleCarfaxWorker()`, `runCarfaxForNewVins(vins)`
- **Purpose:** Automates Carfax dealer portal (dealer.carfax.ca) via Puppeteer to resolve Vehicle History Report URLs per VIN.
- **Consumed by:** `routes/carfax.ts`, `inventoryCache.ts` (new VIN detection), `index.ts` (scheduling)
- **Required env:** `CARFAX_EMAIL`, `CARFAX_PASSWORD`, `CARFAX_ENABLED`
- **Note:** Only runs in dev environment (production containers lack persistent sessions)

### `bbObjectStore.ts`
- **Exports:** Load/save helpers for BB values, BB sessions, and lender programs (all via GCS). `parseBbEntry()`, lender program type definitions.
- **Purpose:** Shared GCS blob storage for cross-restart persistence of valuations, sessions, and program data.
- **Consumed by:** `blackBookWorker.ts`, `lenderWorker.ts`, `inventoryCache.ts`

### `emailService.ts`
- **Exports:** `sendInvitationEmail(toEmail, role, invitedBy)`
- **Purpose:** Sends HTML invitation emails via Resend when users are added to the access list.
- **Consumed by:** `routes/access.ts`
- **Optional env:** `RESEND_API_KEY`

### `logger.ts`
- **Exports:** `logger`
- **Purpose:** Pino structured logger with sensitive field redaction.
- **Consumed by:** All files

### `randomScheduler.ts`
- **Exports:** `toMountainDateStr()`, `scheduleRandomDaily(opts)`
- **Purpose:** Schedules daily tasks at random times within business hours (Mountain Time). Weekday window: 8:30 AM – 7 PM, weekend: 10 AM – 4 PM.
- **Consumed by:** `blackBookWorker.ts`, `carfaxWorker.ts`, `lenderWorker.ts`

### `roleFilter.ts`
- **Exports:** `filterInventoryByRole(items, role)`
- **Purpose:** Strips role-gated fields from inventory items based on the calling user's role. Owner sees all fields; viewer hides `matrixPrice` and `cost`; guest hides those plus `bbAvgWholesale`, `bbValues`, and `price`.
- **Consumed by:** `routes/inventory.ts`

### `typesense.ts`
- **Exports:** `TYPESENSE_HOST`, `DealerCollection` (type), `DEALER_COLLECTIONS`, `DEALER_BY_HOSTNAME`, `IMAGE_CDN_BASE`, `typesenseSearch(dealer, params, timeoutMs?)`, `typesenseSearchUrl(collection, apiKey, params)`, `extractWebsiteUrl(doc, siteUrl)`, `extractDocVin(doc)`, `extractDocImagePaths(doc)`, `parseVehicleDescriptor(vehicle)`, `scoreFuzzyMatch(item, doc)`, `buildDocSummary(doc, collection, siteUrl)`, `LOCATION_TO_DEALER_NAME`, `TypesenseDocSummary` (type), `TypesenseSearchResponse<T>` (type), `ParsedVehicleDescriptor` (type)
- **Purpose:** Single source of truth for Typesense configuration, dealer collections, document extraction helpers, VIN normalization, fuzzy-match scoring, and typed Typesense API wrappers. All Typesense consumers import from here — never hardcode keys or collection IDs.
- **Consumed by:** `inventoryCache.ts` (batch enrichment, fuzzy fallback), `routes/price-lookup.ts` (live price lookup), `routes/inventory.ts` (vehicle images), `routes/ops.ts` (diagnostics probe)
- **Key patterns:**
  - `typesenseSearch` sends the API key in a **header** (not URL) — scoped keys contain `+`/`/`/`=` that corrupt URL encoding.
  - `probeField` pattern: `extractDocVin` tries 5 candidates; `extractOnlinePrice` tries `special_price`, `sale_price`, `price`, `internet_price`, `online_price`, `list_price` with `special_price_on` gating.
  - `scoreFuzzyMatch` gates on exact year + make/model substring, then scores trim tokens + km/price proximity. Minimum acceptance: 30 points.

### `env.ts`
- **Exports:** `env` (Zod-validated environment object), `isProduction`
- **Purpose:** Single source of truth for environment variables. Validates all required env vars at startup via Zod schemas. Exports `isProduction` flag for environment-dependent behavior.
- **Consumed by:** All files needing environment access

### `validate.ts`
- **Exports:** `validateBody(Schema)`, `validateQuery(Schema)`, `validateParams(Schema)`
- **Purpose:** Express middleware factories that validate request body/query/params against a Zod schema, returning 400 with structured errors on failure.
- **Consumed by:** `routes/access.ts`, `routes/inventory.ts`, `routes/lender/lender-calculate.ts`
- **Note:** `validateQuery` stores validated data on `req.validatedQuery` (typed via `Express.Request` extension in `types/passport.d.ts`) because Express 5 made `req.query` read-only.

### `runtimeFingerprint.ts`
- **Exports:** `getRuntimeFingerprint()`
- **Purpose:** Returns `{ calculatorVersion, gitSha }` for response tracing. Identifies which code version produced a calculation.
- **Consumed by:** `routes/lender/`

## Cross-Reference: Data Flow Between Files

```
lenderAuth.ts ──cookies──▶ lenderWorker.ts ──programs──▶ routes/lender/
                                                              │
                                                    lenderCalcEngine.ts
                                                    (cap profiles)
                                                              │
                                               inventoryCache.ts ◀── Apps Script feed
                                               (vehicle data)       ◀── Typesense
                                                    ▲       ▲
                                                    │       │
                                          bbObjectStore.ts  │
                                               ▲            │
                                               │            │
                                    blackBookWorker.ts   carfaxWorker.ts
```

```

### `artifacts/api-server/src/lib/typesense.ts` (334 lines)

```typescript
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
 * Fetch documents from a Typesense collection.
 *
 * IMPORTANT: scoped search keys are base64 and frequently contain `+`, `/`,
 * and `=`. Embedding the key directly in a URL via string concatenation
 * corrupts it (`+` becomes a literal space at the receiving end), which
 * Typesense answers with a generic 401 "Forbidden" — a silent failure that
 * looks identical to a missing key. Always use this helper so the API key
 * travels in the standard request header where it does not require URL
 * encoding.
 *
 * Pass any Typesense query params via `params`; this function adds the
 * `x-typesense-api-key` header and times out per `timeoutMs` (default 10s).
 */
export async function typesenseSearch(
  dealer: DealerCollection,
  params: URLSearchParams,
  timeoutMs = 10_000,
): Promise<Response> {
  const url = `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search?${params}`;
  return fetch(url, {
    headers: { "x-typesense-api-key": dealer.apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
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

```

### `artifacts/api-server/src/lib/validate.ts` (81 lines)

```typescript
/**
 * Express middleware factories for Zod schema validation.
 *
 * Exports:
 *   validateBody(schema)   — validates req.body, replaces it with parsed data
 *   validateQuery(schema)  — validates req.query, stores result on req.validatedQuery
 *   validateParams(schema) — validates req.params
 *
 * All return 400 with { error, details[] } on schema failure.
 * Use the generated schemas from @workspace/api-zod or inline Zod schemas.
 *
 * @example
 * ```ts
 * import { validateBody, validateQuery } from "../lib/validate.js";
 * import { z } from "zod";
 *
 * const BodySchema = z.object({ email: z.string().email() });
 * router.post("/foo", validateBody(BodySchema), (req, res) => {
 *   const { email } = req.body as z.infer<typeof BodySchema>;
 *   res.json({ email });
 * });
 *
 * const QuerySchema = z.object({ vin: z.string().length(17) });
 * router.get("/bar", validateQuery(QuerySchema), (req, res) => {
 *   const { vin } = req.validatedQuery as z.infer<typeof QuerySchema>;
 *   res.json({ vin });
 * });
 * ```
 *
 * Consumers: routes/access.ts, routes/inventory.ts, routes/lender/lender-calculate.ts
 */
import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      res.status(400).json({ error: "Validation failed", details });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      res.status(400).json({ error: "Validation failed", details });
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      res.status(400).json({ error: "Validation failed", details });
      return;
    }
    next();
  };
}

```

### `artifacts/api-server/src/routes/health.ts` (118 lines)

```typescript
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { requireOwner } from "../lib/auth.js";
import { DEALER_COLLECTIONS, typesenseSearch } from "../lib/typesense.js";
import { loadSessionFromStore, probeBucket } from "../lib/bbObjectStore.js";
import { graphqlHealthCheck } from "../lib/lenderAuth.js";

const router: IRouter = Router();

let deepHealthCache: { at: number; payload: DeepHealthPayload } | null = null;

export interface DeepHealthPayload {
  status: string;
  checkedAt: string;
  latencyMs: number;
  dependencies: {
    db: { ok: boolean; latencyMs: number; error: string | null };
    gcs: { ok: boolean; latencyMs: number; error: string | null };
    creditApp: { ok: boolean; latencyMs: number; error: string | null };
    typesense: Array<{ collection: string; ok: boolean; status: number; latencyMs: number; error: string | null }>;
  };
}

export async function runDeepHealth(): Promise<DeepHealthPayload> {
  if (deepHealthCache && Date.now() - deepHealthCache.at < 30_000) {
    return deepHealthCache.payload;
  }

  const started = Date.now();

  let dbProbe: { ok: boolean; latencyMs: number; error: string | null } = { ok: false, latencyMs: 0, error: null };
  try {
    const t = Date.now();
    await pool.query("select 1");
    dbProbe = { ok: true, latencyMs: Date.now() - t, error: null };
  } catch (err) {
    dbProbe = { ok: false, latencyMs: 0, error: String(err) };
  }

  const typesenseProbes = await Promise.all(DEALER_COLLECTIONS.map(async (collection) => {
    const t = Date.now();
    try {
      const params = new URLSearchParams({ q: "*", per_page: "1" });
      const resp = await typesenseSearch(collection, params, 5000);
      return {
        collection: collection.name,
        ok: resp.ok,
        status: resp.status,
        latencyMs: Date.now() - t,
        error: resp.ok ? null : await resp.text(),
      };
    } catch (err) {
      return {
        collection: collection.name,
        ok: false,
        status: 0,
        latencyMs: Date.now() - t,
        error: String(err),
      };
    }
  }));

  // Use probeBucket() which actually throws on transport/auth failure, giving
  // the health check a real signal (unlike loadSessionFromStore which swallows errors).
  const gcsProbe = await (async () => {
    const t = Date.now();
    const result = await probeBucket();
    return { ok: result.ok, latencyMs: Date.now() - t, error: result.error };
  })();

  const creditAppProbe = await (async () => {
    const t = Date.now();
    try {
      const session = await loadSessionFromStore();
      if (!session?.cookies?.length) {
        return { ok: false, latencyMs: Date.now() - t, error: "No BB session cookie blob available" };
      }
      const appSession = session.cookies.find((c: any) => c?.name === "appSession")?.value ?? "";
      const csrfToken = session.cookies.find((c: any) => c?.name === "CA_CSRF_TOKEN")?.value ?? "";
      if (!appSession || !csrfToken) {
        return { ok: false, latencyMs: Date.now() - t, error: "Missing appSession/CA_CSRF_TOKEN cookie values" };
      }
      const ok = await graphqlHealthCheck(appSession, csrfToken);
      return { ok, latencyMs: Date.now() - t, error: ok ? null : "graphqlHealthCheck returned false" };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t, error: String(err) };
    }
  })();

  const payload: DeepHealthPayload = {
    status: "ok",
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    dependencies: {
      db: dbProbe,
      gcs: gcsProbe,
      creditApp: creditAppProbe,
      typesense: typesenseProbes,
    },
  };
  deepHealthCache = { at: Date.now(), payload };
  return payload;
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/deep", requireOwner, async (_req, res) => {
  const payload = await runDeepHealth();
  res.set("Cache-Control", "no-store");
  res.json(payload);
});

export default router;

```

### `artifacts/api-server/src/routes/index.ts` (30 lines)

```typescript
/**
 * Route barrel — mounts all sub-routers onto the /api prefix.
 * Order matters: health and auth are mounted first (no auth required),
 * then data routes (inventory, access, carfax, lender), then utility
 * routes (price-lookup, ops). Each sub-router applies its own auth
 * middleware internally via requireOwner / requireAccess / requireOwnerOrViewer.
 */
import { Router, type IRouter } from "express";
import healthRouter    from "./health.js";
import authRouter      from "./auth.js";
import inventoryRouter from "./inventory.js";
import accessRouter    from "./access.js";
import carfaxRouter    from "./carfax.js";
import lenderRouter      from "./lender/index.js";
import priceLookupRouter from "./price-lookup.js";
import opsRouter         from "./ops.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(inventoryRouter);
router.use(accessRouter);
router.use(carfaxRouter);
router.use(lenderRouter);
router.use(priceLookupRouter);
router.use(opsRouter);

export default router;

```

### `artifacts/api-server/src/routes/README.md` (131 lines)

```markdown
# API Routes

All routes are mounted under `/api` via `routes/index.ts`.
Auth middleware patterns: `requireOwner` (owner email only), `requireAccess` (owner or access-list), `requireOwnerOrViewer` (owner or viewer role).

## Route Files

### `health.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/healthz` | None | Returns `{ status: "ok" }` — uptime/ready check |

**Lib dependencies:** `@workspace/api-zod` (response validation)

---

### `auth.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/auth/google` | None | Initiates Google OAuth flow |
| GET | `/auth/google/callback` | None | OAuth callback — creates session |
| GET | `/auth/logout` | Session | Destroys session, redirects to `/` |
| GET | `/me` | Session | Returns current user profile + role |
| GET | `/auth/debug-callback` | None | Shows computed callback URL (diagnostic) |

**Lib dependencies:** `lib/auth.ts` (`isOwner`, `configurePassport`), `@workspace/db` (access list lookup)

**Role resolution:** Owner check → access_list lookup → 403 if not found

---

### `access.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/access` | Owner | List all access-list users |
| POST | `/access` | Owner | Add user (sends invitation email) |
| PATCH | `/access/:email` | Owner | Change user role (viewer ↔ guest) |
| DELETE | `/access/:email` | Owner | Remove user + destroy their sessions |
| GET | `/audit-log` | Owner | Last 200 audit entries |

**Lib dependencies:** `lib/auth.ts` (`requireOwner`), `lib/emailService.ts` (`sendInvitationEmail`), `lib/validate.ts` (`validateBody`, `validateParams`), `@workspace/db` (access_list + audit_log tables)

**Validation:** Request bodies and params are validated via Zod middleware (`AddAccessEntryBody`, etc.)

**Side effects:** Writes to `audit_log` on every add/remove/role_change. Session delete uses exact jsonb match.

---

### `inventory.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/inventory` | Access list | Returns inventory, role-filtered (owner sees all, guest hides prices) |
| GET | `/cache-status` | Access list | Cache freshness + BB worker status |
| POST | `/refresh` | Webhook secret | External trigger for cache refresh (Apps Script) |
| POST | `/refresh-blackbook` | Owner | Manual Black Book worker trigger |
| GET | `/vehicle-images?vin=` | Access list | Photo gallery URLs from Typesense CDN |

**Lib dependencies:** `lib/inventoryCache.ts` (`getCacheState`, `refreshCache`), `lib/blackBookWorker.ts` (`getBlackBookStatus`, `runBlackBookWorker`), `lib/auth.ts`, `lib/validate.ts` (`validateQuery`)

**Validation:** The `vehicle-images` query params are validated via Zod middleware.

**Role-based field filtering:**
- Owner: all fields
- Viewer: hides `matrixPrice`, `cost`
- Guest: hides above + `bbAvgWholesale`, `bbValues`, `price`

---

### `carfax.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/carfax/batch-status` | Owner | Current batch run status |
| POST | `/carfax/run-batch` | Owner | Trigger full Carfax batch |
| POST | `/carfax/test` | Owner | Test Carfax lookup for up to 10 VINs |

**Lib dependencies:** `lib/carfaxWorker.ts` (`getCarfaxBatchStatus`, `runCarfaxWorker`, `runCarfaxWorkerForVins`)

---

### `lender/` (directory)

The lender route is split into focused modules under `routes/lender/`:

| File | Endpoints | Purpose |
|------|-----------|---------|
| `index.ts` | — | Router barrel — mounts lender-read, lender-calculate, lender-admin |
| `lender-read.ts` | `GET /lender-programs`, `GET /lender-status` | Cached lender program data + sync status |
| `lender-calculate.ts` | `POST /lender-calculate` | **Main calculator engine** — evaluates inventory against lender rules |
| `lender-admin.ts` | `POST /refresh-lender`, `GET /lender-debug` | Manual sync trigger + diagnostics (owner only) |

**Lib dependencies:** `lib/lenderWorker.ts` (program cache), `lib/lenderCalcEngine.ts` (cap profiles), `lib/inventoryCache.ts` (vehicle data), `lib/runtimeFingerprint.ts` (version tagging), `lib/auth.ts` (shared middleware)

**Calculator flow** (see JSDoc on individual functions in `lender/lender-calculate.ts`):
1. Validate params → load cached programs → find lender/program/tier
2. Resolve cap profile (`lenderCalcEngine.ts`) → compute LTV ceilings
3. Loop inventory: parse year/km → lookup term matrix → lookup condition matrix → get BB wholesale value
4. Determine selling price path (Tier 1 online / Tier 2 reduced / PAC fallback)
5. Compute LTV rooms (`computeRooms`) → stack products (`stackProducts`)
6. Settle loop: adjust down payment until LTV + payment constraints satisfied
7. Calculate final payment via `pmt()`, compute profit
8. Sort results by profit descending, return with debug counts

---

### `price-lookup.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/price-lookup?url=` | Session | Resolves a dealer listing URL to its current price via Typesense |

**Lib dependencies:** `lib/typesense.ts` (client config + `extractWebsiteUrl`)

**Note:** Mounted via `routes/index.ts`.

---

### `ops.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/ops/function-status` | Access list | Deterministic health checks for Black Book freshness, Carfax lookup activity, website-link discovery, and lender program availability |

**Lib dependencies:** `lib/inventoryCache.ts`, `lib/blackBookWorker.ts`, `lib/lenderWorker.ts`

**Why this exists:** Prevents ambiguous ops diagnosis by returning explicit pass/fail checks with supporting counts/timestamps.

```

### `artifacts/api-server/src/types/passport.d.ts` (22 lines)

```typescript
import type { UserRole } from "../lib/auth";

declare global {
  namespace Express {
    interface User {
      email:   string;
      name:    string;
      picture: string;
    }
    interface Request {
      _role?: UserRole;
      /**
       * Populated by validateQuery() middleware with the Zod-parsed query object.
       * Express 5 made req.query read-only, so we store validated data here instead.
       */
      validatedQuery?: unknown;
    }
  }
}

export {};

```

---

<a id="frontend"></a>
## 13. Frontend portal (production SPA)

*76 file(s).*

### `artifacts/inventory-portal/components.json` (20 lines)

```json
{
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "new-york",
    "rsc": false,
    "tsx": true,
    "tailwind": {
      "config": "",
      "css": "src/index.css",
      "baseColor": "neutral",
      "cssVariables": true,
      "prefix": ""
    },
    "aliases": {
      "components": "@/components",
      "utils": "@/lib/utils",
      "ui": "@/components/ui",
      "lib": "@/lib",
      "hooks": "@/hooks"
    }
}
```

### `artifacts/inventory-portal/index.html` (17 lines)

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

### `artifacts/inventory-portal/package.json` (78 lines)

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

### `artifacts/inventory-portal/public/favicon.svg` (4 lines)

```svg
<svg width="180" height="180" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="180" height="180" rx="36" fill="#FF3C00"/>
</svg>

```

### `artifacts/inventory-portal/requirements.yaml` (14 lines)

```yaml
packages:
  "framer-motion": "For premium stagger animations and page transitions"
  "clsx": "Utility for conditionally joining classNames"
  "tailwind-merge": "Utility for merging tailwind classes without style conflicts"
  "lucide-react": "Beautiful, consistent icon set"
  "date-fns": "For formatting access entry dates"

images: []

notes:
  - "The app uses a forced dark-mode premium aesthetic tailored for data-focused applications."
  - "Google OAuth routes are located at /api/auth/google and /api/auth/logout"
  - "API hooks are imported from @workspace/api-client-react per workspace conventions"

```

### `artifacts/inventory-portal/src/App.tsx` (101 lines)

```typescript
import React from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

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
  const { isLoading, error } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });

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

function RequireOwner({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });

  React.useEffect(() => {
    if (!isLoading && user && !user.isOwner) setLocation("/");
  }, [isLoading, user, setLocation]);

  if (isLoading || !user?.isOwner) return <FullScreenSpinner />;
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
          <RequireOwner>
            <Layout wide>
              <LenderCalculator />
            </Layout>
          </RequireOwner>
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
