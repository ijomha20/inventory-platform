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

export async function refreshCache(): Promise<void> {
  if (state.isRefreshing) return;
  state.isRefreshing = true;

  try {
    const dataUrl = process.env["INVENTORY_DATA_URL"]?.trim();
    if (!dataUrl) {
      logger.warn("INVENTORY_DATA_URL is not set — cache not populated");
      return;
    }

    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);

    const data: InventoryItem[] = await response.json();
    state.data        = data;
    state.lastUpdated = new Date();
    logger.info({ count: data.length }, "Inventory cache refreshed");
  } catch (err) {
    // Keep existing stale data on failure — stale is better than empty
    logger.error({ err }, "Inventory cache refresh failed — serving stale data");
  } finally {
    state.isRefreshing = false;
  }
}

export function startBackgroundRefresh(intervalMs = 60 * 60 * 1000): void {
  // Populate cache immediately on startup
  refreshCache().catch((err) =>
    logger.error({ err }, "Initial inventory cache fetch failed"),
  );

  // Re-fetch on the given interval (default: 1 hour)
  setInterval(() => {
    refreshCache().catch((err) =>
      logger.error({ err }, "Background inventory cache refresh failed"),
    );
  }, intervalMs);
}
