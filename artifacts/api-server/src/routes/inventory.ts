import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, refreshCache } from "../lib/inventoryCache.js";
import { runBlackBookWorker, getBlackBookStatus } from "../lib/blackBookWorker.js";

const router = Router();

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";
const IMAGE_CDN_BASE = "https://zopsoftware-asset.b-cdn.net";

const DEALER_COLLECTIONS = [
  {
    name:       "Matrix",
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.matrixmotorsyeg.ca",
  },
  {
    name:       "Parkdale",
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.parkdalemotors.ca",
  },
];

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

// Determine the calling user's role ('owner' | 'viewer' | 'guest')
async function getUserRole(req: any): Promise<string> {
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) return "owner";
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  return entry?.role ?? "viewer";
}

async function requireAccess(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) { next(); return; }
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  if (entry) { next(); return; }
  res.status(403).json({ error: "Access denied" });
}

// GET /inventory — instant response from server-side cache, role-filtered
router.get("/inventory", requireAccess, async (req, res) => {
  const role = await getUserRole(req);
  const { data } = getCacheState();

  const items = data.map((item) => {
    // Owners see everything
    if (role === "owner") return item;

    // Strip owner-only fields for all non-owners
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { matrixPrice, cost, bbAvgWholesale, bbValues, ...rest } = item;

    // Guests also lose the price field
    if (role === "guest") return { ...rest, price: "" };

    return rest;
  });

  res.set("Cache-Control", "no-store");
  res.json(items);
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
  const role = await getUserRole(req);
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

// GET /vehicle-images?vin=XXX — fetch photo gallery from Typesense CDN
router.get("/vehicle-images", requireAccess, async (req, res) => {
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

      const body: any = await resp.json();
      if (!body.hits?.length) continue;

      const doc    = body.hits[0].document;
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
    } catch (_err) {
      // Silently continue to next collection
    }
  }

  res.set("Cache-Control", "public, max-age=300"); // Cache images for 5 min
  res.json({ vin, urls, websiteUrl });
});

export default router;
