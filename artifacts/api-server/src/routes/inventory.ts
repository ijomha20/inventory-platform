import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, refreshCache } from "../lib/inventoryCache.js";

const router = Router();

async function requireAccess(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();

  if (isOwner(email)) { next(); return; }

  const entries = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);

  if (entries.length > 0) { next(); return; }

  res.status(403).json({ error: "Access denied" });
}

// GET /inventory — instant response from server-side cache
router.get("/inventory", requireAccess, (_req, res) => {
  const { data } = getCacheState();
  res.set("Cache-Control", "no-store");
  res.json(data);
});

// GET /cache-status — returns last updated timestamp and item count
// Used by the portal to detect when fresh data is available
router.get("/cache-status", requireAccess, (_req, res) => {
  const { lastUpdated, isRefreshing, data } = getCacheState();
  res.set("Cache-Control", "no-store");
  res.json({
    lastUpdated:  lastUpdated?.toISOString() ?? null,
    isRefreshing,
    count:        data.length,
  });
});

// POST /refresh — trigger immediate cache refresh
// Called by Apps Script at the end of each sync so the portal updates within seconds
// Secured by a shared secret in the x-refresh-secret header
router.post("/refresh", (req, res) => {
  const secret   = req.headers["x-refresh-secret"];
  const expected = process.env["REFRESH_SECRET"]?.trim();

  if (!expected || secret !== expected) {
    logger.warn({ ip: (req as any).ip }, "Unauthorized /refresh attempt");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  refreshCache().catch((err) =>
    logger.error({ err }, "Webhook-triggered refresh failed"),
  );

  res.json({ ok: true, message: "Cache refresh triggered" });
});

export default router;
