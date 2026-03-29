import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";

const router = Router();

function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as { email: string };
  if (!isOwner(user.email)) {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

router.get("/access", requireOwner, async (_req, res) => {
  const list = await db.select().from(accessListTable).orderBy(accessListTable.addedAt);
  res.json(list);
});

router.post("/access", requireOwner, async (req, res) => {
  const rawEmail = (req.body?.email ?? "").toString().trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes("@")) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  const owner = (req.user as { email: string }).email;
  const [entry] = await db
    .insert(accessListTable)
    .values({ email: rawEmail, addedBy: owner })
    .onConflictDoNothing()
    .returning();
  res.json(entry ?? { email: rawEmail, addedBy: owner, addedAt: new Date().toISOString() });
});

router.delete("/access/:email", requireOwner, async (req, res) => {
  const email = decodeURIComponent(req.params.email ?? "").toLowerCase();
  await db.delete(accessListTable).where(eq(accessListTable.email, email));
  res.json({ ok: true });
});

export default router;
