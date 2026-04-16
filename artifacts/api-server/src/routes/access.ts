import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable, auditLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireOwner } from "../lib/auth.js";
import { sendInvitationEmail } from "../lib/emailService.js";

const router = Router();

async function writeAudit(
  action: string,
  targetEmail: string,
  changedBy: string,
  roleFrom?: string | null,
  roleTo?: string | null,
) {
  try {
    await db.insert(auditLogTable).values({
      action,
      targetEmail,
      changedBy,
      roleFrom:  roleFrom  ?? null,
      roleTo:    roleTo    ?? null,
    });
  } catch (_err) {
    // Audit failures are non-fatal
  }
}

// GET /access — list all approved users (owner only)
router.get("/access", requireOwner, async (_req, res) => {
  const list = await db.select().from(accessListTable).orderBy(accessListTable.addedAt);
  res.json(list);
});

// POST /access — add a user (owner only)
router.post("/access", requireOwner, async (req, res) => {
  const rawEmail = (req.body?.email ?? "").toString().trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes("@")) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  const role  = ["viewer", "guest"].includes(req.body?.role) ? req.body.role : "viewer";
  const owner = (req.user as { email: string }).email;

  const [entry] = await db
    .insert(accessListTable)
    .values({ email: rawEmail, addedBy: owner, role })
    .onConflictDoNothing()
    .returning();

  await writeAudit("add", rawEmail, owner, null, role);

  // Send invitation email (non-blocking — failure doesn't affect response)
  if (entry) {
    sendInvitationEmail(rawEmail, role, owner).catch(() => {});
  }

  res.json(entry ?? { email: rawEmail, addedBy: owner, addedAt: new Date().toISOString(), role });
});

// PATCH /access/:email — update a user's role (owner only)
router.patch("/access/:email", requireOwner, async (req, res) => {
  const email   = decodeURIComponent(String(req.params.email ?? "")).toLowerCase();
  const newRole = (req.body?.role ?? "").toString().trim().toLowerCase();

  if (!["viewer", "guest"].includes(newRole)) {
    res.status(400).json({ error: "Role must be 'viewer' or 'guest'" });
    return;
  }

  const [existing] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [updated] = await db
    .update(accessListTable)
    .set({ role: newRole })
    .where(eq(accessListTable.email, email))
    .returning();

  const owner = (req.user as { email: string }).email;
  await writeAudit("role_change", email, owner, existing.role, newRole);

  res.json(updated);
});

// DELETE /access/:email — remove a user (owner only)
router.delete("/access/:email", requireOwner, async (req, res) => {
  const email = decodeURIComponent(String(req.params.email ?? "")).toLowerCase();
  const owner = (req.user as { email: string }).email;

  const [existing] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);

  await db.delete(accessListTable).where(eq(accessListTable.email, email));
  await writeAudit("remove", email, owner, existing?.role ?? null, null);

  try {
    const { pool } = await import("@workspace/db");
    await pool.query(
      `DELETE FROM "session" WHERE sess->'passport'->'user'->>'email' = $1`,
      [email],
    );
  } catch (_err) {}

  res.json({ ok: true });
});

// GET /audit-log — audit log of all access changes (owner only)
router.get("/audit-log", requireOwner, async (_req, res) => {
  const entries = await db
    .select()
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.timestamp))
    .limit(200);
  res.json(entries);
});

export default router;
