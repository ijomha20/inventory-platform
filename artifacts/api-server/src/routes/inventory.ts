import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

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

router.get("/inventory", requireAccess, async (_req, res) => {
  const dataUrl = process.env["INVENTORY_DATA_URL"]?.trim();
  if (!dataUrl) {
    res.json([]);
    return;
  }
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Failed to fetch inventory data");
    res.status(502).json({ error: "Could not fetch inventory data" });
  }
});

export default router;
