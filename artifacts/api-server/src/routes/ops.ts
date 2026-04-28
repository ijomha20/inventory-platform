import { Router } from "express";
import { requireAccess } from "../lib/auth.js";
import { getCacheState } from "../lib/inventoryCache.js";
import { getBlackBookLastRunAtIso, getBlackBookStatus } from "../lib/blackBookWorker.js";
import { getCachedLenderPrograms, getLenderSyncStatus } from "../lib/lenderWorker.js";

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

export default router;
