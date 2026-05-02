/**
 * Inventory Cache
 *
 * Central in-memory store for all vehicle inventory. Loads from DB on startup
 * so the API can serve immediately without waiting for an Apps Script fetch.
 *
 * Exports:
 *   InventoryItem        — canonical vehicle record shape
 *   getCacheState()      — returns current { data, lastUpdated, isRefreshing }
 *   refreshCache()       — full refresh from Apps Script + Typesense enrichment
 *   applyCarfaxResults() — merges Carfax VHR URLs into the in-memory + DB cache
 *   applyBlackBookValues()— merges BB wholesale values into the in-memory + DB cache
 *   getFuzzyResolvedDoc()— returns Typesense doc for a VIN (with fuzzy fallback)
 *   startBackgroundRefresh() — starts the hourly auto-refresh loop
 *
 * Data flow:
 *   Apps Script JSON feed
 *     → normalize fields (normalizeCarfaxValue, extractOnlinePrice)
 *     → Typesense enrichment (fetchFromTypesense + applyFuzzyFallback)
 *     → merge BB values + Carfax URLs
 *     → persistToDb (singleton DB row)
 *
 * Consumers: routes/inventory.ts, routes/lender/, lib/blackBookWorker.ts,
 *            lib/carfaxWorker.ts
 */

import { db, inventoryCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { env, isProduction } from "./env.js";

export interface InventoryItem {
  location:       string;
  vehicle:        string;
  vin:            string;
  price:          string;
  km:             string;
  carfax:         string;
  website:        string;
  onlinePrice:    string;
  matrixPrice:    string;   // Column F — matrix list price (owner only)
  cost:           string;   // Column G — business acquisition cost (owner only)
  hasPhotos:      boolean;
  bbAvgWholesale?: string;  // KM-adjusted average wholesale from Canadian Black Book (owner only)
  bbValues?: {
    xclean: number;
    clean:  number;
    avg:    number;
    rough:  number;
  };
}

interface CacheState {
  data:         InventoryItem[];
  lastUpdated:  Date | null;
  isRefreshing: boolean;
}

const state: CacheState = {
  data:         [],
  lastUpdated:  null,
  isRefreshing: false,
};

function normalizeCarfaxValue(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.toUpperCase() === "NOT FOUND") return "NOT FOUND";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `https://dealer.carfax.ca${value}`;
  if (value.startsWith("cfm/")) return `https://dealer.carfax.ca/${value}`;
  if (value.includes("dealer.carfax.ca")) return `https://${value.replace(/^\/+/, "")}`;
  return value;
}

let mutexPromise: Promise<void> = Promise.resolve();

function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = mutexPromise;
  let resolve: () => void;
  mutexPromise = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

export function getCacheState(): CacheState {
  return state;
}

// ---------------------------------------------------------------------------
// Database persistence — load on startup, save after every successful fetch
// ---------------------------------------------------------------------------

async function loadFromDb(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(inventoryCacheTable)
      .where(eq(inventoryCacheTable.id, 1));

    if (rows.length > 0) {
      const row = rows[0];
      const items = row.data as InventoryItem[];
      if (Array.isArray(items) && items.length > 0) {
        state.data        = items;
        state.lastUpdated = row.lastUpdated;
        logger.info({ count: state.data.length }, "Inventory loaded from database — serving immediately");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Could not load inventory from database — will fetch fresh from source");
  }

  try {
    // Lazy load: defers GCS client initialization
    const { loadBbValuesFromStore, parseBbEntry } = await import("./bbObjectStore.js");
    const blob = await loadBbValuesFromStore();
    if (blob?.values) {
      let patched = 0;
      for (const item of state.data) {
        const raw = blob.values[item.vin.toUpperCase()];
        if (!raw) continue;
        const entry = parseBbEntry(raw);
        if (entry) {
          if (!item.bbAvgWholesale) { item.bbAvgWholesale = entry.avg; patched++; }
          if (!item.bbValues && (entry.xclean || entry.clean || entry.average || entry.rough)) {
            item.bbValues = { xclean: entry.xclean, clean: entry.clean, avg: entry.average, rough: entry.rough };
            patched++;
          }
        }
      }
      if (patched > 0) {
        logger.info({ patched }, "Inventory: BB values patched from shared object storage at startup");
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "Inventory: could not load BB values from object storage at startup (non-fatal)");
  }
}

async function persistToDb(): Promise<void> {
  if (!state.lastUpdated) return;
  try {
    await db
      .insert(inventoryCacheTable)
      .values({ id: 1, data: state.data, lastUpdated: state.lastUpdated })
      .onConflictDoUpdate({
        target: inventoryCacheTable.id,
        set: { data: state.data, lastUpdated: state.lastUpdated },
      });
    logger.info({ count: state.data.length }, "Inventory persisted to database");
  } catch (err) {
    logger.warn({ err }, "Could not persist inventory to database (non-fatal)");
  }
}

// ---------------------------------------------------------------------------
// Typesense — batch enrichment (prices + website URLs)
// ---------------------------------------------------------------------------

import {
  DEALER_COLLECTIONS,
  buildDocSummary,
  parseVehicleDescriptor,
  scoreFuzzyMatch,
  typesenseSearch,
  LOCATION_TO_DEALER_NAME,
  type TypesenseDocSummary,
  type TypesenseSearchResponse,
} from "./typesense.js";

interface TypesenseMaps {
  prices:    Map<string, string>;            // VIN → online price string
  website:   Map<string, string>;            // VIN → listing URL
  photos:    Set<string>;                    // VINs that have image_urls
  docsByCol: Map<string, TypesenseDocSummary[]>; // for fuzzy fallback
  vinToDoc:  Map<string, TypesenseDocSummary>;   // VIN match acceleration
}

/**
 * VIN → resolved Typesense doc.  Populated during cache refresh and consumed
 * by /vehicle-images so newly uploaded Matrix listings without a VIN can
 * still serve photos for the inventory item.  In-memory only, regenerated
 * each refresh.
 */
const fuzzyResolvedByVin = new Map<string, TypesenseDocSummary>();

export function getFuzzyResolvedDoc(vin: string): TypesenseDocSummary | null {
  if (!vin) return null;
  return fuzzyResolvedByVin.get(vin.trim().toUpperCase()) ?? null;
}

function parsePriceValue(value: unknown): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function extractOnlinePrice(doc: Record<string, unknown>): string | null {
  const specialOnRaw = String(doc["special_price_on"] ?? "").trim().toLowerCase();
  const specialOn = specialOnRaw === "1" || specialOnRaw === "true" || specialOnRaw === "yes";

  const specialCandidates = [
    doc["special_price"],
    doc["sale_price"],
    doc["specialPrice"],
  ];
  const regularCandidates = [
    doc["price"],
    doc["internet_price"],
    doc["online_price"],
    doc["list_price"],
  ];

  if (specialOn) {
    for (const candidate of specialCandidates) {
      const parsed = parsePriceValue(candidate);
      if (parsed) return String(Math.round(parsed));
    }
  }
  for (const candidate of regularCandidates) {
    const parsed = parsePriceValue(candidate);
    if (parsed) return String(Math.round(parsed));
  }
  for (const candidate of specialCandidates) {
    const parsed = parsePriceValue(candidate);
    if (parsed) return String(Math.round(parsed));
  }

  return null;
}

/**
 * Fetch ALL currently listed vehicles from Typesense in one bulk pass.
 * Returns:
 *   - VIN-keyed lookup maps (price, website, photos) for fast direct match
 *   - all docs grouped by collection for the fuzzy fallback path
 *   - VIN → doc summary (so the matched doc can fill price + photos at once)
 *
 * Downloading the full catalogue (~100–300 vehicles) is faster than per-VIN
 * filtering AND lets us run fuzzy matching for listings whose VIN field is
 * missing in Typesense (notably newly uploaded Matrix listings).
 */
async function fetchFromTypesense(): Promise<TypesenseMaps> {
  const prices    = new Map<string, string>();
  const website   = new Map<string, string>();
  const photos    = new Set<string>();
  const docsByCol = new Map<string, TypesenseDocSummary[]>();
  const vinToDoc  = new Map<string, TypesenseDocSummary>();

  for (const col of DEALER_COLLECTIONS) {
    const collectionDocs: TypesenseDocSummary[] = [];

    try {
      let page = 1;
      while (true) {
        const params = new URLSearchParams({
          q:        "*",
          per_page: "250",
          page:     String(page),
        });
        const resp = await typesenseSearch(col, params, 15_000);
        if (!resp.ok) {
          let body = "";
          try { body = (await resp.text()).slice(0, 200); } catch { /* ignore */ }
          logger.warn(
            { collection: col.collection, status: resp.status, page, body },
            "Typesense fetch returned non-OK status",
          );
          break;
        }

        const body = await resp.json() as TypesenseSearchResponse;
        const hits = body.hits ?? [];
        if (hits.length === 0) break;

        for (const hit of hits) {
          const doc = (hit.document ?? {}) as Record<string, any>;
          const summary = buildDocSummary(doc, col.name, col.siteUrl);
          summary.onlinePrice = extractOnlinePrice(doc);
          collectionDocs.push(summary);

          const vin = summary.vin;
          if (!vin) continue;
          if (!vinToDoc.has(vin)) vinToDoc.set(vin, summary);

          if (!prices.has(vin) && summary.onlinePrice) {
            prices.set(vin, summary.onlinePrice);
          }
          if (!website.has(vin) && summary.websiteUrl) {
            website.set(vin, summary.websiteUrl);
          }
          if (summary.imagePaths.length > 0) {
            photos.add(vin);
          }
        }

        if (hits.length < 250) break;
        page++;
      }
    } catch (err) {
      logger.warn({ err, collection: col.collection }, "Typesense fetch failed for collection");
    }

    docsByCol.set(col.name, collectionDocs);
    logger.info(
      { collection: col.name, count: collectionDocs.length, withVin: collectionDocs.filter((d) => d.vin).length },
      "Typesense: collection scanned",
    );
  }

  return { prices, website, photos, docsByCol, vinToDoc };
}

interface FuzzyMatchCandidate {
  itemIndex: number;
  doc:       TypesenseDocSummary;
  score:     number;
}

/**
 * Runs the fuzzy fallback for inventory items that the VIN-based pass did
 * not resolve.  Greedy assignment by score so two inventory items can never
 * map to the same listing.  Updates the item fields and the
 * fuzzyResolvedByVin map (consumed by /vehicle-images).
 */
function applyFuzzyFallback(
  items:    InventoryItem[],
  docsByCol: Map<string, TypesenseDocSummary[]>,
  resolvedVins: Set<string>,
): { matched: number } {
  const MIN_SCORE = 30; // minimum acceptance threshold (year+make+model gate)
  const usedDocKeys = new Set<string>();

  // Build candidate list for items that still need any of website/onlinePrice/photos.
  const candidates: FuzzyMatchCandidate[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (resolvedVins.has(item.vin.toUpperCase())) continue;
    if (!item.vehicle) continue;

    const itemKm    = parseInt(item.km.replace(/[^0-9]/g, ""), 10) || 0;
    const itemPrice = parseFloat(item.price.replace(/[^0-9.]/g, "")) || 0;
    const parsed = parseVehicleDescriptor(item.vehicle);
    if (!parsed.year || !parsed.make || !parsed.model) continue;

    const dealerName = LOCATION_TO_DEALER_NAME.get(item.location.trim().toLowerCase());
    const collectionsToTry = dealerName
      ? [docsByCol.get(dealerName) ?? []]
      : Array.from(docsByCol.values());

    for (const docs of collectionsToTry) {
      for (const doc of docs) {
        // Skip docs that already matched a different inventory VIN exactly.
        // (vin map already consumed those.)
        const score = scoreFuzzyMatch({
          vehicle: item.vehicle,
          km:      itemKm,
          price:   itemPrice,
        }, doc);
        if (score >= MIN_SCORE) {
          candidates.push({ itemIndex: i, doc, score });
        }
      }
    }
  }

  // Greedy: highest score wins. Each doc and each item assigned at most once.
  candidates.sort((a, b) => b.score - a.score);
  const usedItems = new Set<number>();
  let matched = 0;

  for (const cand of candidates) {
    if (usedItems.has(cand.itemIndex)) continue;
    const docKey = `${cand.doc.collection}::${cand.doc.docId}`;
    if (usedDocKeys.has(docKey)) continue;

    const item = items[cand.itemIndex];
    let updated = false;

    if ((!item.website || item.website === "NOT FOUND") && cand.doc.websiteUrl) {
      item.website = cand.doc.websiteUrl;
      updated = true;
    }
    if ((!item.onlinePrice || item.onlinePrice === "NOT FOUND") && cand.doc.onlinePrice) {
      item.onlinePrice = cand.doc.onlinePrice;
      updated = true;
    }
    if (cand.doc.imagePaths.length > 0) {
      item.hasPhotos = true;
      updated = true;
    }

    if (updated) {
      fuzzyResolvedByVin.set(item.vin.toUpperCase(), cand.doc);
      usedItems.add(cand.itemIndex);
      usedDocKeys.add(docKey);
      matched++;

      logger.info(
        {
          inventoryVin: item.vin,
          inventoryVehicle: item.vehicle,
          inventoryKm: item.km,
          docCollection: cand.doc.collection,
          docId: cand.doc.docId,
          docVin: cand.doc.vin || "(none)",
          docVehicle: `${cand.doc.year} ${cand.doc.make} ${cand.doc.model} ${cand.doc.trim}`.trim(),
          docKm: cand.doc.km,
          score: cand.score,
        },
        "Inventory: fuzzy-matched listing for VIN with no Typesense VIN field",
      );
    }
  }

  return { matched };
}

// Keep old name as alias for any future callers
async function fetchOnlinePricesFromTypesense(): Promise<Map<string, string>> {
  return (await fetchFromTypesense()).prices;
}

// ---------------------------------------------------------------------------
// Cache refresh
// ---------------------------------------------------------------------------

/**
 * Fetches fresh inventory from the Apps Script JSON feed and rebuilds the cache.
 *
 * Pipeline:
 * 1. Fetch JSON array from INVENTORY_DATA_URL
 * 2. Normalize each row into InventoryItem
 * 3. Carry forward existing BB values from previous cache + GCS blob
 * 4. Enrich with Typesense: online prices, website URLs, photo presence
 * 5. Detect new VINs and trigger targeted BB + Carfax lookups
 * 6. Persist to database for instant startup on next restart
 *
 * Guards: no-op if already refreshing. Keeps stale cache on failure.
 * Called hourly by startBackgroundRefresh, and on-demand via webhook.
 */
export async function refreshCache(): Promise<void> {
  return withCacheLock(async () => {
    if (state.isRefreshing) return;
    state.isRefreshing = true;

    try {
      const dataUrl = env.INVENTORY_DATA_URL;
      if (!dataUrl) {
        logger.warn("INVENTORY_DATA_URL is not set — cache not populated");
        return;
      }

      const response = await fetch(dataUrl, { signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);

      const raw: any = await response.json();

      if (!Array.isArray(raw)) {
        logger.error({ type: typeof raw }, "Apps Script returned non-array — keeping stale cache");
        return;
      }
      if (raw.length === 0) {
        logger.warn("Apps Script returned empty array — keeping stale cache");
        return;
      }

      const existingBb = new Map<string, string>();
      const existingBbDetail = new Map<string, { xclean: number; clean: number; avg: number; rough: number }>();
      const existingPhotos = new Set<string>();
      for (const old of state.data) {
        if (old.bbAvgWholesale) existingBb.set(old.vin.toUpperCase(), old.bbAvgWholesale);
        if (old.bbValues) existingBbDetail.set(old.vin.toUpperCase(), old.bbValues);
        if (old.hasPhotos) existingPhotos.add(old.vin.toUpperCase());
      }
      try {
        const { loadBbValuesFromStore, parseBbEntry } = await import("./bbObjectStore.js");
        const blob = await loadBbValuesFromStore();
        if (blob?.values) {
          for (const [vin, raw] of Object.entries(blob.values)) {
            if (!raw) continue;
            const entry = parseBbEntry(raw);
            if (entry) {
              existingBb.set(vin.toUpperCase(), entry.avg);
              if (entry.xclean || entry.clean || entry.average || entry.rough) {
                existingBbDetail.set(vin.toUpperCase(), { xclean: entry.xclean, clean: entry.clean, avg: entry.average, rough: entry.rough });
              }
            }
          }
          logger.info({ count: Object.keys(blob.values).length }, "Inventory: BB values loaded from shared object storage");
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, "Inventory: could not load BB values from object storage (non-fatal)");
      }

      const items: InventoryItem[] = [];
      for (const r of raw) {
        if (!r || typeof r !== "object") {
          logger.warn({ r }, "Skipping malformed inventory item");
          continue;
        }
        const vin = String(r.vin ?? "").trim().toUpperCase();
        items.push({
          location:       String(r.location    ?? "").trim(),
          vehicle:        String(r.vehicle     ?? "").trim(),
          vin,
          price:          String(r.price       ?? "").trim(),
          km:             String(r.km          ?? "").trim(),
          carfax:         normalizeCarfaxValue(r.carfax),
          website:        String(r.website     ?? "").trim(),
          onlinePrice:    String(r.onlinePrice ?? "").trim(),
          matrixPrice:    String(r.matrixPrice ?? "").trim(),
          cost:           String(r.cost        ?? "").trim(),
          hasPhotos:      existingPhotos.has(vin),
          bbAvgWholesale: existingBb.get(vin),
          bbValues:       existingBbDetail.get(vin),
        });
      }

      const { prices, website, photos, docsByCol } = await fetchFromTypesense();

      fuzzyResolvedByVin.clear();
      const resolvedVins = new Set<string>();

      for (const item of items) {
        const vinKey = item.vin.toUpperCase();
        let resolvedSomething = false;

        if (!item.onlinePrice || item.onlinePrice === "NOT FOUND") {
          const fetched = prices.get(vinKey);
          if (fetched) { item.onlinePrice = fetched; resolvedSomething = true; }
        }
        if (!item.website || item.website === "NOT FOUND") {
          const fetched = website.get(vinKey);
          if (fetched) { item.website = fetched; resolvedSomething = true; }
        }
        if (photos.has(vinKey)) {
          item.hasPhotos = true;
          resolvedSomething = true;
        } else {
          item.hasPhotos = false;
        }

        if (resolvedSomething) resolvedVins.add(vinKey);
      }

      // Fuzzy fallback for items the VIN pass could not enrich (Matrix listings
      // that don't expose VIN in Typesense, etc.). Logs every match for audit.
      const { matched: fuzzyMatched } = applyFuzzyFallback(items, docsByCol, resolvedVins);

      logger.info(
        {
          prices:       prices.size,
          websiteUrls:  website.size,
          photoVins:    photos.size,
          fuzzyMatched,
          total:        items.length,
        },
        "Typesense enrichment complete",
      );

      const previousVins = new Set(state.data.map(i => i.vin.toUpperCase()).filter(v => v.length > 0));

      state.data        = items;
      state.lastUpdated = new Date();
      logger.info({ count: items.length }, "Inventory cache refreshed");

      await persistToDb();

      if (previousVins.size > 0) {
        const newVins = [...new Set(
          items
            .map(i => i.vin.toUpperCase())
            .filter(v => v.length >= 10 && !previousVins.has(v)),
        )];

        if (newVins.length > 0) {
          logger.info({ count: newVins.length, vins: newVins }, "New VINs detected during inventory refresh");
          triggerNewVinLookups(newVins);
        }
      }
    } catch (err) {
      logger.error({ err }, "Inventory cache refresh failed — serving stale data");
    } finally {
      state.isRefreshing = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Carfax — apply targeted lookup results to cache
// ---------------------------------------------------------------------------

export async function applyCarfaxResults(results: Map<string, string>): Promise<void> {
  return withCacheLock(async () => {
    if (results.size === 0) return;
    if (!state.lastUpdated) {
      logger.warn("Carfax results received but inventory cache not yet loaded — skipping");
      return;
    }
    let updated = 0;
    for (const item of state.data) {
      const vinKey = item.vin.toUpperCase();
      const val = results.get(vinKey);
      if (val !== undefined) {
        item.carfax = normalizeCarfaxValue(val);
        updated++;
      }
    }
    if (updated > 0) {
      await persistToDb();
      logger.info({ updated, total: state.data.length }, "Carfax results applied to inventory cache");
    }
  });
}

// ---------------------------------------------------------------------------
// New-VIN detection — trigger targeted BB and Carfax lookups
// ---------------------------------------------------------------------------

function triggerNewVinLookups(newVins: string[]): void {

  // Breaks static cycle: blackBookWorker statically imports inventoryCache
  import("./blackBookWorker.js").then(({ runBlackBookForVins }) => {
    runBlackBookForVins(newVins).catch(err =>
      logger.error({ err }, "Targeted BB lookup for new VINs failed"),
    );
  }).catch(err => logger.error({ err }, "Failed to import blackBookWorker for targeted run"));

  if (!isProduction) {
    // Breaks static cycle: carfaxWorker statically imports inventoryCache
    import("./carfaxWorker.js").then(({ runCarfaxForNewVins }) => {
      runCarfaxForNewVins(newVins).catch(err =>
        logger.error({ err }, "Targeted Carfax lookup for new VINs failed"),
      );
    }).catch(err => logger.error({ err }, "Failed to import carfaxWorker for targeted run"));
  } else {
    logger.info("Production deployment — skipping targeted Carfax lookup for new VINs");
  }
}

// ---------------------------------------------------------------------------
// Black Book — apply values from worker run
// ---------------------------------------------------------------------------

export async function applyBlackBookValues(
  bbMap: Map<string, string>,
  bbDetailMap?: Map<string, { xclean: number; clean: number; avg: number; rough: number }>,
): Promise<void> {
  return withCacheLock(async () => {
    if (bbMap.size === 0) return;
    if (!state.lastUpdated) {
      logger.warn("BB values received but inventory cache not yet loaded — skipping persist");
      return;
    }
    let updated = 0;
    for (const item of state.data) {
      const vinKey = item.vin.toUpperCase();
      const val = bbMap.get(vinKey);
      if (val !== undefined) {
        item.bbAvgWholesale = val;
        const detail = bbDetailMap?.get(vinKey);
        if (detail) item.bbValues = detail;
        updated++;
      }
    }
    if (updated > 0) {
      await persistToDb();
      logger.info({ updated, total: state.data.length }, "Black Book values applied to inventory");
    }
  });
}

/**
 * Initializes the inventory cache lifecycle:
 * 1. Loads last-known inventory from DB (instant data for users on startup)
 * 2. Kicks off a background fetch from Apps Script (with retry up to 3 attempts)
 * 3. Sets up hourly refresh interval
 *
 * Called once from index.ts. The await ensures DB snapshot is in memory
 * before the server accepts requests.
 *
 * @param intervalMs - Refresh interval in ms (default: 1 hour)
 */
export async function startBackgroundRefresh(intervalMs = 60 * 60 * 1000): Promise<void> {
  // Step 1: load the last-known inventory from the database immediately.
  // Users see data right away — no waiting for Apps Script on startup.
  await loadFromDb();

  // Step 2: kick off a fresh fetch in the background.
  // If it succeeds, the in-memory cache and DB are both updated.
  // If it fails, we already have the DB snapshot serving users.
  async function fetchWithRetry(attempt = 1): Promise<void> {
    try {
      await refreshCache();
      if (state.data.length === 0 && attempt <= 3) {
        const delay = attempt * 30_000;
        logger.warn({ attempt, delayMs: delay }, "Cache still empty after refresh — retrying");
        setTimeout(() => fetchWithRetry(attempt + 1), delay);
      }
    } catch (err) {
      logger.error({ err, attempt }, "Inventory cache fetch failed");
      if (attempt <= 3) {
        const delay = attempt * 30_000;
        logger.info({ delayMs: delay }, "Scheduling retry");
        setTimeout(() => fetchWithRetry(attempt + 1), delay);
      }
    }
  }

  fetchWithRetry();

  // Step 3: hourly refresh keeps the data current
  setInterval(() => {
    refreshCache().catch((err) =>
      logger.error({ err }, "Background inventory cache refresh failed"),
    );
  }, intervalMs);
}

