import { Router } from "express";
import { getUserRole, requireAccess } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, refreshCache, filterInventoryByRole } from "../lib/inventoryCache.js";
import { runBlackBookWorker, getBlackBookStatus } from "../lib/blackBookWorker.js";
import {
  TYPESENSE_HOST,
  DEALER_COLLECTIONS,
  IMAGE_CDN_BASE,
  extractWebsiteUrl,
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

// GET /cache-status — lightweight poll so the portal can detect updates
router.get("/cache-status", requireAccess, (_req, res) => {
  const { lastUpdated, isRefreshing, data } = getCacheState();
  const bb = getBlackBookStatus();
  res.set("Cache-Control", "no-store");
  res.json({
    lastUpdated:    lastUpdated?.toISOString() ?? null,
    isRefreshing,
    count:          data.length,
    bbRunning:      bb.running,
    bbLastRun:      bb.lastRun,
    bbCount:        bb.lastCount,
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

  for (const dealer of DEALER_COLLECTIONS) {
    try {
      const endpoint =
        `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search` +
        `?q=${encodeURIComponent(vin)}&query_by=vin&num_typos=0&per_page=1` +
        `&x-typesense-api-key=${dealer.apiKey}`;

      const resp = await fetch(endpoint);
      if (!resp.ok) continue;

      const body = await resp.json() as TypesenseSearchResponse;
      if (!body.hits?.length) continue;

      const doc    = body.hits[0].document as Record<string, any>;
      const docVin = (doc.vin ?? "").toString().trim().toUpperCase();
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
