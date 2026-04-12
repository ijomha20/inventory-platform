import { db, inventoryCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

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

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

const TYPESENSE_COLLECTIONS = [
  {
    collection: "37042ac7ece3a217b1a41d6f54ba6855", // Parkdale (checked first — preferred)
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.parkdalemotors.ca",
  },
  {
    collection: "cebacbca97920d818d57c6f0526d7413", // Matrix
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.matrixmotorsyeg.ca",
  },
];

// Keep the old alias so the price function below still compiles
const PRICE_COLLECTIONS = TYPESENSE_COLLECTIONS;

function extractWebsiteUrl(doc: any, siteUrl: string): string | null {
  if (doc.page_url) {
    const path = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
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

interface TypesenseMaps {
  prices:  Map<string, string>; // VIN → online price string
  website: Map<string, string>; // VIN → listing URL
  photos:  Set<string>;         // VINs that have image_urls
}

/**
 * Fetch ALL currently listed vehicles from Typesense in one bulk pass and
 * return both a price map and a website URL map.  Downloading the full
 * catalogue (~100–300 vehicles) is faster than per-VIN filtering.
 */
async function fetchFromTypesense(): Promise<TypesenseMaps> {
  const prices  = new Map<string, string>();
  const website = new Map<string, string>();
  const photos  = new Set<string>();

  for (const col of TYPESENSE_COLLECTIONS) {
    try {
      let page = 1;
      while (true) {
        const url =
          `https://${TYPESENSE_HOST}/collections/${col.collection}/documents/search` +
          `?q=*&per_page=250&page=${page}&x-typesense-api-key=${col.apiKey}`;

        const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) break;

        const body: any = await resp.json();
        const hits: any[] = body.hits ?? [];
        if (hits.length === 0) break;

        for (const hit of hits) {
          const doc = hit.document ?? {};
          const vin = (doc.vin ?? "").toString().trim().toUpperCase();
          if (!vin) continue;

          // Price — first collection that has this VIN wins
          if (!prices.has(vin)) {
            const specialOn    = Number(doc.special_price_on) === 1;
            const specialPrice = parseFloat(doc.special_price);
            const regularPrice = parseFloat(doc.price);
            const raw          = specialOn && specialPrice > 0 ? specialPrice : regularPrice;
            if (!isNaN(raw) && raw > 0) prices.set(vin, String(Math.round(raw)));
          }

          // Website URL — first collection that resolves one wins
          if (!website.has(vin)) {
            const resolved = extractWebsiteUrl(doc, col.siteUrl);
            if (resolved) website.set(vin, resolved);
          }

          // Photos — mark VIN if image_urls is non-empty
          if (doc.image_urls && doc.image_urls.toString().trim()) {
            photos.add(vin);
          }
        }

        if (hits.length < 250) break;
        page++;
      }
    } catch (err) {
      logger.warn({ err, collection: col.collection }, "Typesense fetch failed for collection");
    }
  }

  return { prices, website, photos };
}

// Keep old name as alias for any future callers
async function fetchOnlinePricesFromTypesense(): Promise<Map<string, string>> {
  return (await fetchFromTypesense()).prices;
}

// ---------------------------------------------------------------------------
// Cache refresh
// ---------------------------------------------------------------------------

export async function refreshCache(): Promise<void> {
  if (state.isRefreshing) return;
  state.isRefreshing = true;

  try {
    const dataUrl = process.env["INVENTORY_DATA_URL"]?.trim();
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
    for (const old of state.data) {
      if (old.bbAvgWholesale) existingBb.set(old.vin.toUpperCase(), old.bbAvgWholesale);
      if (old.bbValues) existingBbDetail.set(old.vin.toUpperCase(), old.bbValues);
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

    // Normalise each item — guard against differing field names / missing keys
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
        carfax:         String(r.carfax      ?? "").trim(),
        website:        String(r.website     ?? "").trim(),
        onlinePrice:    String(r.onlinePrice ?? "").trim(),
        matrixPrice:    String(r.matrixPrice ?? "").trim(), // Column F
        cost:           String(r.cost        ?? "").trim(), // Column G
        hasPhotos:      false,
        bbAvgWholesale: existingBb.get(vin),
        bbValues:       existingBbDetail.get(vin),
      });
    }

    // -----------------------------------------------------------------------
    // Enrich with Typesense data (prices + website URLs) in a single pass
    // -----------------------------------------------------------------------
    const needEnrichment = items.some(
      (item) =>
        !item.onlinePrice || item.onlinePrice === "NOT FOUND" ||
        !item.website     || item.website     === "NOT FOUND",
    );

    if (needEnrichment) {
      const { prices, website, photos } = await fetchFromTypesense();

      for (const item of items) {
        if (!item.onlinePrice || item.onlinePrice === "NOT FOUND") {
          const fetched = prices.get(item.vin.toUpperCase());
          if (fetched) item.onlinePrice = fetched;
        }
        if (!item.website || item.website === "NOT FOUND") {
          const fetched = website.get(item.vin.toUpperCase());
          if (fetched) item.website = fetched;
        }
        item.hasPhotos = photos.has(item.vin.toUpperCase());
      }

      logger.info(
        { prices: prices.size, websiteUrls: website.size, total: items.length },
        "Typesense enrichment complete",
      );
    }

    const previousVins = new Set(state.data.map(i => i.vin.toUpperCase()).filter(v => v.length > 0));

    state.data        = items;
    state.lastUpdated = new Date();
    logger.info({ count: items.length }, "Inventory cache refreshed");

    // Persist the fresh data to the database so future restarts load instantly
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
}

// ---------------------------------------------------------------------------
// Carfax — apply targeted lookup results to cache
// ---------------------------------------------------------------------------

export async function applyCarfaxResults(results: Map<string, string>): Promise<void> {
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
      item.carfax = val;
      updated++;
    }
  }
  if (updated > 0) {
    await persistToDb();
    logger.info({ updated, total: state.data.length }, "Carfax results applied to inventory cache");
  }
}

// ---------------------------------------------------------------------------
// New-VIN detection — trigger targeted BB and Carfax lookups
// ---------------------------------------------------------------------------

function triggerNewVinLookups(newVins: string[]): void {
  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";

  import("./blackBookWorker.js").then(({ runBlackBookForVins }) => {
    runBlackBookForVins(newVins).catch(err =>
      logger.error({ err }, "Targeted BB lookup for new VINs failed"),
    );
  }).catch(err => logger.error({ err }, "Failed to import blackBookWorker for targeted run"));

  if (!isProduction) {
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
}

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
