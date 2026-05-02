import {
  db,
  incidentLogTable,
  bbSessionTable,
  lenderSessionTable,
  carfaxSessionTable,
  deadLetterQueueTable,
  selfHealFlagsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { PlatformError, PlatformReason, PlatformRecoverability, PlatformSubsystem } from "./platformError.js";
import { logger } from "./logger.js";
import { saveSelfHealFlagToStore } from "./bbObjectStore.js";

const KEEP_REASONS: PlatformReason[] = [
  "SCHEMA_DRIFT",
  "PATCH_REFUSED_DANGEROUS_CORE",
  "SELF_HEAL_RATE_LIMITED",
  "AUTOMERGE_ROLLBACK",
  "AUTOMERGE_ROLLBACK_CONFLICT",
];

export async function recordIncident(input: {
  subsystem: PlatformSubsystem;
  reason: PlatformReason;
  recoverability: PlatformRecoverability;
  message: string;
  payload?: Record<string, unknown> | null;
}): Promise<number | null> {
  try {
    const [row] = await db.insert(incidentLogTable).values({
      subsystem: input.subsystem,
      reason: input.reason,
      recoverability: input.recoverability,
      message: input.message,
      payload: input.payload ?? null,
    }).returning({ id: incidentLogTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.warn({ err: String(err), input }, "incident_log insert failed");
    return null;
  }
}

export async function recordFailure(err: PlatformError): Promise<number | null> {
  logger.failure(err);
  return recordIncident({
    subsystem: err.subsystem,
    reason: err.reason,
    recoverability: err.recoverability,
    message: err.message,
    payload: err.payload,
  });
}

export async function pruneIncidentLog(now = new Date()): Promise<number> {
  const transientBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(incidentLogTable)
    .where(and(
      eq(incidentLogTable.recoverability, "transient"),
      lt(incidentLogTable.createdAt, transientBefore),
      notInArray(incidentLogTable.reason, KEEP_REASONS),
    ))
    .returning({ id: incidentLogTable.id });

  const total = await db.select({ count: sql<number>`count(*)::int` }).from(incidentLogTable);
  const count = total[0]?.count ?? 0;
  if (count > 100000) {
    const overflow = count - 100000;
    const oldRows = await db.select({ id: incidentLogTable.id })
      .from(incidentLogTable)
      .where(and(
        eq(incidentLogTable.recoverability, "transient"),
        notInArray(incidentLogTable.reason, KEEP_REASONS),
      ))
      .orderBy(incidentLogTable.createdAt)
      .limit(overflow);

    if (oldRows.length > 0) {
      const ids = oldRows.map((r) => r.id);
      await db.delete(incidentLogTable).where(inArray(incidentLogTable.id, ids));
    }
  }

  if (deleted.length > 0) {
    await recordIncident({
      subsystem: "ops",
      reason: "INCIDENT_LOG_PRUNED",
      recoverability: "transient",
      message: `Pruned ${deleted.length} transient incidents`,
      payload: { prunedCount: deleted.length },
    });
  }
  return deleted.length;
}

export async function listIncidents(opts: { includeTransients?: boolean; limit?: number; offset?: number }) {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  if (opts.includeTransients) {
    return db.select().from(incidentLogTable).orderBy(desc(incidentLogTable.createdAt)).limit(limit).offset(offset);
  }
  return db.select().from(incidentLogTable)
    .where(sql`${incidentLogTable.recoverability} <> 'transient'`)
    .orderBy(desc(incidentLogTable.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function enqueueDeadLetter(input: {
  subsystem: PlatformSubsystem;
  reason: PlatformReason;
  payload: Record<string, unknown>;
}) {
  try {
    await db.insert(deadLetterQueueTable).values({
      subsystem: input.subsystem,
      reason: input.reason,
      payload: input.payload,
    });
  } catch (err) {
    logger.warn({ err: String(err), input }, "dead_letter_queue insert failed");
  }
}

type SessionStateInput = {
  lastOutcome: "success" | "partial" | "failed";
  lastErrorReason?: string | null;
  lastErrorMessage?: string | null;
  consecutiveFailures: number;
};

export async function updateBbSessionState(input: SessionStateInput) {
  try {
    await db.update(bbSessionTable)
      .set({
        lastOutcome: input.lastOutcome,
        lastErrorReason: input.lastErrorReason ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastErrorAt: input.lastErrorReason ? new Date() : null,
        consecutiveFailures: input.consecutiveFailures,
        updatedAt: new Date(),
      })
      .where(eq(bbSessionTable.id, "singleton"));
  } catch (err) {
    logger.warn({ err: String(err), input }, "bb_session state update failed");
  }
}

export async function updateLenderSessionState(input: SessionStateInput) {
  try {
    await db.update(lenderSessionTable)
      .set({
        lastOutcome: input.lastOutcome,
        lastErrorReason: input.lastErrorReason ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastErrorAt: input.lastErrorReason ? new Date() : null,
        consecutiveFailures: input.consecutiveFailures,
        updatedAt: new Date(),
      })
      .where(eq(lenderSessionTable.id, "singleton"));
  } catch (err) {
    logger.warn({ err: String(err), input }, "lender_session state update failed");
  }
}

export async function updateCarfaxSessionState(input: SessionStateInput) {
  try {
    const now = new Date();
    const row = {
      id: "singleton",
      updatedAt: now,
      lastOutcome: input.lastOutcome,
      lastErrorReason: input.lastErrorReason ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
      lastErrorAt: input.lastErrorReason ? now : null,
      consecutiveFailures: input.consecutiveFailures,
    };
    await db.insert(carfaxSessionTable).values(row).onConflictDoUpdate({
      target: carfaxSessionTable.id,
      set: row,
    });
  } catch (err) {
    logger.warn({ err: String(err), input }, "carfax_session state update failed");
  }
}

export async function setSelfHealFlag(input: {
  patchId: string;
  subsystem: PlatformSubsystem;
  flagState: "canary" | "promoted" | "rolled_back";
  prUrl?: string | null;
  incidentLogId?: number | null;
  rollbackReason?: string | null;
}) {
  const now = new Date();
  const row = {
    patchId: input.patchId,
    subsystem: input.subsystem,
    flagState: input.flagState,
    prUrl: input.prUrl ?? null,
    incidentLogId: input.incidentLogId ? String(input.incidentLogId) : null,
    rollbackReason: input.rollbackReason ?? null,
    updatedAt: now,
  };
  await db.insert(selfHealFlagsTable).values({ ...row, createdAt: now }).onConflictDoUpdate({
    target: selfHealFlagsTable.patchId,
    set: row,
  });
  await saveSelfHealFlagToStore(input.patchId, {
    subsystem: input.subsystem,
    flagState: input.flagState,
    prUrl: input.prUrl ?? null,
    incidentLogId: input.incidentLogId ?? null,
    rollbackReason: input.rollbackReason ?? null,
    updatedAt: now.toISOString(),
  });
}

export async function getSelfHealFlag(patchId: string) {
  const [row] = await db.select().from(selfHealFlagsTable).where(eq(selfHealFlagsTable.patchId, patchId)).limit(1);
  return row ?? null;
}

export async function archiveDeadLettersOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const updated = await db.update(deadLetterQueueTable)
    .set({ archivedAt: new Date() })
    .where(and(
      isNull(deadLetterQueueTable.archivedAt),
      lt(deadLetterQueueTable.enqueuedAt, cutoff),
    ))
    .returning({ id: deadLetterQueueTable.id });
  return updated.length;
}

