import { logger } from "./logger.js";

export interface InventoryItem {
  location:    string;
  vehicle:     string;
  vin:         string;
  price:       string;
  km:          string;
  carfax:      string;
  website:     string;
  onlinePrice: string;
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
// Typesense — batch price enrichment
// ---------------------------------------------------------------------------

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

const PRICE_COLLECTIONS = [
  {
    collection: "37042ac7ece3a217b1a41d6f54ba6855", // Parkdale (checked first — preferred)
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
  {
    collection: "cebacbca97920d818d57c6f0526d7413", // Matrix
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
];

/**
 * Fetch ALL currently listed vehicles from Typesense and return a
 * VIN (uppercase) → price string map.  Downloading the full catalogue
 * (~100–300 vehicles) is faster and more reliable than per-VIN filtering.
 */
async function fetchOnlinePricesFromTypesense(): Promise<Map<string, string>> {
  const priceMap = new Map<string, string>();

  for (const col of PRICE_COLLECTIONS) {
    try {
      // Paginate if there are more than 250 vehicles in a collection
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
          if (!vin || priceMap.has(vin)) continue; // first collection wins

          const specialOn    = Number(doc.special_price_on) === 1;
          const specialPrice = parseFloat(doc.special_price);
          const regularPrice = parseFloat(doc.price);
          const raw          = specialOn && specialPrice > 0 ? specialPrice : regularPrice;

          if (!isNaN(raw) && raw > 0) {
            priceMap.set(vin, String(Math.round(raw)));
          }
        }

        if (hits.length < 250) break;
        page++;
      }
    } catch (err) {
      logger.warn({ err, collection: col.collection }, "Typesense price fetch failed for collection");
    }
  }

  return priceMap;
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

    const response = await fetch(dataUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);

    const raw: any[] = await response.json();

    // Normalise each item — guard against differing field names / missing keys
    const items: InventoryItem[] = raw.map((r) => ({
      location:    String(r.location    ?? "").trim(),
      vehicle:     String(r.vehicle     ?? "").trim(),
      vin:         String(r.vin         ?? "").trim().toUpperCase(),
      price:       String(r.price       ?? "").trim(),
      km:          String(r.km          ?? "").trim(),
      carfax:      String(r.carfax      ?? "").trim(),
      website:     String(r.website     ?? "").trim(),
      onlinePrice: String(r.onlinePrice ?? "").trim(),
    }));

    // -----------------------------------------------------------------------
    // Enrich with Typesense prices for items where Apps Script didn't send one
    // (handles old Apps Script, missing Column L, or first-run before "Fetch Online Prices")
    // -----------------------------------------------------------------------
    const needPrice = items.filter(
      (item) => !item.onlinePrice || item.onlinePrice === "NOT FOUND",
    );

    if (needPrice.length > 0) {
      const priceMap = await fetchOnlinePricesFromTypesense();

      for (const item of items) {
        if (!item.onlinePrice || item.onlinePrice === "NOT FOUND") {
          const fetched = priceMap.get(item.vin.toUpperCase());
          if (fetched) item.onlinePrice = fetched;
        }
      }

      logger.info(
        { enriched: priceMap.size, total: items.length },
        "Typesense price enrichment complete",
      );
    }

    state.data        = items;
    state.lastUpdated = new Date();
    logger.info({ count: items.length }, "Inventory cache refreshed");
  } catch (err) {
    logger.error({ err }, "Inventory cache refresh failed — serving stale data");
  } finally {
    state.isRefreshing = false;
  }
}

export function startBackgroundRefresh(intervalMs = 60 * 60 * 1000): void {
  refreshCache().catch((err) =>
    logger.error({ err }, "Initial inventory cache fetch failed"),
  );

  setInterval(() => {
    refreshCache().catch((err) =>
      logger.error({ err }, "Background inventory cache refresh failed"),
    );
  }, intervalMs);
}
