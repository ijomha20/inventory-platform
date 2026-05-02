import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger.js";
import { sendOpsAlert } from "./emailService.js";

const execFileAsync = promisify(execFile);

const TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 min hard cap per script

/**
 * Spawn a pnpm scripts target as a child process. We invoke pnpm rather than
 * importing the script module directly because the backup scripts shell out to
 * pg_dump/psql via execFile and need a clean process per run for proper stdout
 * buffering and signal handling.
 */
async function runScriptsTask(name: string, target: string): Promise<{ ok: boolean; error?: string; stdout?: string; stderr?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["--filter", "@workspace/scripts", target],
      { timeout: TASK_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 50 },
    );
    logger.info({ task: name, target, stdout: stdout.slice(-2000) }, `Backup task ${name} completed`);
    return { ok: true, stdout, stderr };
  } catch (err: any) {
    logger.error({ task: name, target, err: err?.message ?? String(err) }, `Backup task ${name} failed`);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function runNightlyBackupTasks(): Promise<void> {
  logger.info("Backup scheduler: nightly backup task triggered");

  const dbResult = await runScriptsTask("backup:db", "backup:db");
  const blobsResult = await runScriptsTask("backup:blobs", "backup:blobs");
  const rotateResult = await runScriptsTask("backup:rotate", "backup:rotate");

  const failed = [dbResult, blobsResult, rotateResult].filter((r) => !r.ok);
  if (failed.length > 0) {
    await sendOpsAlert(
      "critical",
      "Nightly backup failed",
      `<p>One or more nightly backup tasks failed.</p><ul>${[
        ["backup:db", dbResult],
        ["backup:blobs", blobsResult],
        ["backup:rotate", rotateResult],
      ]
        .map(([name, r]) => `<li><strong>${name}</strong>: ${(r as any).ok ? "ok" : (r as any).error}</li>`)
        .join("")}</ul>`,
    );
  }
}

export async function runQuarterlyReminderTasks(): Promise<void> {
  logger.info("Backup scheduler: quarterly reminder task triggered");
  // Quarterly reminder dispatching is owned by scripts/src/quarterly-reminders.ts
  // and scripts/src/dr-drill.ts (run via cron / manual). The in-server scheduler
  // only logs that the daily pass occurred so there is a heartbeat in /ops/incidents
  // when wired by the operator. No-op by design until quarterly automation is
  // expanded (see post-4b-review-advisory: deferred items B7/S1).
}
