import { Router } from "express";
import { getUserRole, requireAccess } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, getFuzzyResolvedDoc, refreshCache } from "../lib/inventoryCache.js";
import { filterInventoryByRole } from "../lib/roleFilter.js";
import { runBlackBookWorker, getBlackBookStatus } from "../lib/blackBookWorker.js";
import {
  DEALER_COLLECTIONS,
  IMAGE_CDN_BASE,
  extractWebsiteUrl,
  extractDocVin,
  typesenseSearch,
  type TypesenseSearchResponse,
} from "../lib/typesense.js";
import { validateQuery } from "../lib/validate.js";
import { GetVehicleImagesQueryParams } from "@workspace/api-zod";
import { env } from "../lib/env.js";

const router = Router();

// GET /inventory — instant response from server-side cache, role-filtered
router.get("/inventory", requireAccess, async (req, res) => {
  const role = await getUserRole(req) ?? "guest";
  const { data } = getCacheState();
  res.set("Cache-Control", "no-store");
  res.json(filterInventoryByRole(data, role));
});

// GET /cache-status — lightweight poll so the portal can detect updates.
// All count fields are derived from the actual cache (not just the last
// worker-run snapshot) so this endpoint reflects ground truth even after
// a server restart before any worker has run again.
router.get("/cache-status", requireAccess, (_req, res) => {
  const { lastUpdated, isRefreshing, data } = getCacheState();
  const bb = getBlackBookStatus();

  const bbCachedCount = data.filter((i) => !!i.bbAvgWholesale).length;
  const websiteCount  = data.filter((i) => i.website?.trim().startsWith("http")).length;
  const onlinePriceCount = data.filter((i) => {
    const v = i.onlinePrice?.trim();
    return !!v && v !== "NOT FOUND" && v !== "0";
  }).length;
  const photosCount = data.filter((i) => i.hasPhotos).length;
  const carfaxUrlCount = data.filter((i) => i.carfax?.trim().startsWith("http")).length;

  const bbCoveragePct = data.length > 0
    ? Math.round((bbCachedCount / data.length) * 10000) / 100
    : 0;

  res.set("Cache-Control", "no-store");
  res.json({
    lastUpdated:    lastUpdated?.toISOString() ?? null,
    isRefreshing,
    count:          data.length,
    // Cache-derived counts — accurate even before any worker has run this boot
    websiteCount,
    onlinePriceCount,
    photosCount,
    carfaxUrlCount,
    bbCount:        bbCachedCount,
    bbCoveragePct,
    // Worker live status (separate concern from cache contents)
    bbRunning:      bb.running,
    bbLastRun:      bb.lastRun,
    bbLastRunCount: bb.lastCount,
    bbOutcome:      bb.lastOutcome,
    bbLastError:    bb.lastError,
    bbLastBatch:    bb.lastBatch,
    bbPendingTargetVinCount: bb.pendingTargetVinCount,
  });
});

// POST /refresh-blackbook — owner only, triggers manual Black Book refresh
router.post("/refresh-blackbook", requireAccess, async (req, res) => {
  const role = await getUserRole(req) ?? "guest";
  if (role !== "owner") {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  const { running } = getBlackBookStatus();
  if (running) {
    res.json({ ok: true, message: "Already running", running: true });
    return;
  }
  runBlackBookWorker().catch((err) =>
    logger.error({ err }, "Manual BB refresh error"),
  );
  res.json({ ok: true, message: "Black Book refresh started", running: true });
});

// POST /refresh — webhook from Apps Script to trigger an immediate cache refresh
router.post("/refresh", (req, res) => {
  const secret   = req.headers["x-refresh-secret"];
  const expected = env.REFRESH_SECRET;

  if (!expected || secret !== expected) {
    logger.warn({ ip: req.ip }, "Unauthorized /refresh attempt");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  refreshCache().catch((err) =>
    logger.error({ err }, "Webhook-triggered refresh failed"),
  );

  res.json({ ok: true, message: "Cache refresh triggered" });
});

// GET /vehicle-images?vin=XXX — fetch photo gallery from Typesense CDN
router.get("/vehicle-images", requireAccess, validateQuery(GetVehicleImagesQueryParams), async (req, res) => {
  const vin = (req.query["vin"] as string ?? "").trim().toUpperCase();
  if (!vin || vin.length < 10) {
    res.json({ vin, urls: [] });
    return;
  }

  const urls: string[] = [];
  let websiteUrl: string | null = null;

  // First check the fuzzy-resolved doc — handles Matrix vehicles whose VIN is
  // not exposed in Typesense.  Resolves to listing photos via the same CDN.
  const fuzzyDoc = getFuzzyResolvedDoc(vin);
  if (fuzzyDoc) {
    for (const path of fuzzyDoc.imagePaths) {
      if (path) urls.push(IMAGE_CDN_BASE + path);
    }
    websiteUrl = fuzzyDoc.websiteUrl;
    if (urls.length > 0) {
      res.set("Cache-Control", "public, max-age=300");
      res.json({ vin, urls, websiteUrl });
      return;
    }
  }

  for (const dealer of DEALER_COLLECTIONS) {
    try {
      const params = new URLSearchParams({
        q:         vin,
        query_by:  "vin",
        num_typos: "0",
        per_page:  "1",
      });
      const resp = await typesenseSearch(dealer, params, 8_000);
      if (!resp.ok) {
        logger.warn(
          { collection: dealer.collection, status: resp.status, vin },
          "Typesense image lookup returned non-OK status",
        );
        continue;
      }

      const body = await resp.json() as TypesenseSearchResponse;
      if (!body.hits?.length) continue;

      const doc    = body.hits[0].document as Record<string, any>;
      const docVin = extractDocVin(doc);
      if (docVin !== vin) continue;

      const rawUrls: string = doc.image_urls ?? "";
      if (!rawUrls) continue;

      rawUrls.split(";").forEach((path: string) => {
        const trimmed = path.trim();
        if (trimmed) urls.push(IMAGE_CDN_BASE + trimmed);
      });

      // Extract website listing URL from the same document
      websiteUrl = extractWebsiteUrl(doc, dealer.siteUrl);

      break; // Stop after first successful collection
    } catch (err) {
      logger.warn({ err }, "Typesense image fetch failed for collection");
    }
  }

  res.set("Cache-Control", "public, max-age=300"); // Cache images for 5 min
  res.json({ vin, urls, websiteUrl });
});

export default router;
