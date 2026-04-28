import { Router } from "express";
import { requireAccess, requireOwner } from "../lib/auth.js";
import { getCacheState } from "../lib/inventoryCache.js";
import { getBlackBookLastRunAtIso, getBlackBookStatus } from "../lib/blackBookWorker.js";
import { getCachedLenderPrograms, getLenderSyncStatus } from "../lib/lenderWorker.js";
import {
  TYPESENSE_HOST,
  DEALER_COLLECTIONS,
  extractDocVin,
  extractDocImagePaths,
  extractWebsiteUrl,
  type TypesenseSearchResponse,
} from "../lib/typesense.js";
import { getRuntimeFingerprint } from "../lib/runtimeFingerprint.js";
import { logger } from "../lib/logger.js";

const router = Router();

function isWithinLastHours(iso: string | null, hours: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  return (Date.now() - at) <= hours * 60 * 60 * 1000;
}

// GET /ops/function-status — explicit operational checks for core data functions
router.get("/ops/function-status", requireAccess, async (_req, res) => {
  const { data } = getCacheState();
  const bbStatus = getBlackBookStatus();
  const lenderStatus = getLenderSyncStatus();
  const lenderPrograms = getCachedLenderPrograms();

  const bbLastRunIso = bbStatus.lastRun ?? await getBlackBookLastRunAtIso();
  const blackBookWithin24h = isWithinLastHours(bbLastRunIso, 24);
  const blackBookPass = blackBookWithin24h && bbStatus.lastOutcome !== "failed";
  const bbCoveragePct = data.length > 0 ? Math.round((bbStatus.lastCount / data.length) * 10000) / 100 : 0;

  const carfaxUrlCount = data.filter((item) => item.carfax?.trim().startsWith("http")).length;
  const carfaxNotFoundCount = data.filter((item) => item.carfax?.trim().toUpperCase() === "NOT FOUND").length;
  const carfaxAttemptedCount = carfaxUrlCount + carfaxNotFoundCount;

  const websiteUrlCount = data.filter((item) => item.website?.trim().startsWith("http")).length;
  const websiteNotFoundCount = data.filter((item) => item.website?.trim().toUpperCase() === "NOT FOUND").length;

  const lenderProgramCount = lenderPrograms?.programs.length ?? 0;
  const lenderUpdatedAt = lenderPrograms?.updatedAt ?? null;

  res.set("Cache-Control", "no-store");
  res.json({
    inventoryCount: data.length,
    checks: {
      blackBookUpdatedWithin24Hours: {
        pass: blackBookPass,
        lastRunAt: bbLastRunIso,
        running: bbStatus.running,
        valuedInventoryCount: bbStatus.lastCount,
        coveragePct: bbCoveragePct,
        outcome: bbStatus.lastOutcome,
        error: bbStatus.lastError,
        batch: bbStatus.lastBatch,
        pendingTargetVinCount: bbStatus.pendingTargetVinCount,
      },
      carfaxLookupActivity: {
        pass: carfaxAttemptedCount > 0,
        attemptedCount: carfaxAttemptedCount,
        foundUrlCount: carfaxUrlCount,
        notFoundCount: carfaxNotFoundCount,
      },
      websiteLinkDiscovery: {
        pass: websiteUrlCount > 0,
        foundUrlCount: websiteUrlCount,
        notFoundCount: websiteNotFoundCount,
        coveragePct: data.length > 0 ? Math.round((websiteUrlCount / data.length) * 10000) / 100 : 0,
      },
      lenderProgramsLoaded: {
        pass: lenderProgramCount > 0,
        lenderProgramCount,
        updatedAt: lenderUpdatedAt,
        running: lenderStatus.running,
        error: lenderStatus.error ?? null,
      },
    },
  });
});

// GET /ops/diagnostics — owner-only deep diagnostics.
//
// Probes each Typesense collection live (small per_page) and reports:
//   - HTTP status, error body if any
//   - hits.length and total found
//   - which fields are present on a sample doc
//   - VIN, image_urls, page_url, and price detection counts
//
// Also returns cache-derived ground truth so we can tell whether the
// inventory pipeline is enriching or whether values came from the sheet.
//
// Designed so a single fetch by the owner makes it obvious whether the
// bulk Typesense fetch is succeeding and whether the documents contain
// the fields our enrichment code expects.
router.get("/ops/diagnostics", requireOwner, async (_req, res) => {
  const { data, lastUpdated, isRefreshing } = getCacheState();

  const cache = {
    count:              data.length,
    lastUpdated:        lastUpdated?.toISOString() ?? null,
    isRefreshing,
    withWebsite:        data.filter((i) => i.website?.trim().startsWith("http")).length,
    withWebsiteNotFound: data.filter((i) => i.website?.trim().toUpperCase() === "NOT FOUND").length,
    withOnlinePrice:    data.filter((i) => {
      const v = i.onlinePrice?.trim();
      return !!v && v !== "NOT FOUND" && v !== "0";
    }).length,
    withPhotos:         data.filter((i) => i.hasPhotos).length,
    withCarfaxUrl:      data.filter((i) => i.carfax?.trim().startsWith("http")).length,
    withCarfaxNotFound: data.filter((i) => i.carfax?.trim().toUpperCase() === "NOT FOUND").length,
    withBbAvgWholesale: data.filter((i) => !!i.bbAvgWholesale).length,
  };

  const collections = await Promise.all(DEALER_COLLECTIONS.map(async (col) => {
    const url =
      `https://${TYPESENSE_HOST}/collections/${col.collection}/documents/search` +
      `?q=*&per_page=3&x-typesense-api-key=${col.apiKey}`;

    try {
      const t0 = Date.now();
      const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      const elapsedMs = Date.now() - t0;

      if (!resp.ok) {
        let errBody = "";
        try { errBody = (await resp.text()).slice(0, 400); } catch { /* ignore */ }
        return {
          name: col.name,
          collection: col.collection,
          ok: false,
          status: resp.status,
          elapsedMs,
          error: errBody || resp.statusText,
        };
      }

      const body = await resp.json() as TypesenseSearchResponse;
      const hits = body.hits ?? [];
      const sampleDoc = (hits[0]?.document ?? {}) as Record<string, any>;
      const sampleKeys = Object.keys(sampleDoc).sort();

      // Field-presence counts across the small sample
      let withVin = 0;
      let withImageUrls = 0;
      let withPageUrl = 0;
      let withPrice = 0;
      const sampleSummaries = hits.map((hit) => {
        const doc = (hit.document ?? {}) as Record<string, any>;
        const vin = extractDocVin(doc);
        const imagePaths = extractDocImagePaths(doc);
        const websiteUrl = extractWebsiteUrl(doc, col.siteUrl);
        const priceRaw = doc.price ?? doc.internet_price ?? doc.online_price ?? doc.list_price;

        if (vin) withVin++;
        if (imagePaths.length > 0) withImageUrls++;
        if (websiteUrl) withPageUrl++;
        if (priceRaw != null && String(priceRaw).trim() !== "") withPrice++;

        return {
          docId:        String(doc.id ?? doc.post_id ?? doc.vehicle_id ?? ""),
          vin:          vin || null,
          year:         doc.year ?? null,
          make:         doc.make ?? null,
          model:        doc.model ?? null,
          imageCount:   imagePaths.length,
          websiteUrl,
          priceRaw:     priceRaw ?? null,
        };
      });

      return {
        name: col.name,
        collection: col.collection,
        ok: true,
        status: resp.status,
        elapsedMs,
        found: body.found ?? null,
        hitsReturned: hits.length,
        // Field presence in the small sample — these tell us at a glance
        // whether the bulk pipeline can extract VIN / photos / URL / price.
        sampleStats: {
          withVin,
          withImageUrls,
          withPageUrl,
          withPrice,
        },
        sampleKeys,
        sampleDocs: sampleSummaries,
      };
    } catch (err: any) {
      logger.warn({ err: err.message, collection: col.collection }, "diagnostics: typesense probe failed");
      return {
        name: col.name,
        collection: col.collection,
        ok: false,
        error: err.message ?? String(err),
      };
    }
  }));

  res.set("Cache-Control", "no-store");
  res.json({
    runtime: getRuntimeFingerprint(),
    typesenseHost: TYPESENSE_HOST,
    cache,
    collections,
  });
});

export default router;
