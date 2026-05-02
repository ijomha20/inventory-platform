import { logger } from "./logger.js";

export async function runNightlyBackupTasks(): Promise<void> {
  logger.info("Backup scheduler: nightly backup task triggered (stub — wire to backup scripts in Phase 5e review)");
}

export async function runQuarterlyReminderTasks(): Promise<void> {
  logger.info("Backup scheduler: quarterly reminder task triggered (stub — wire to dr-drill/quarterly scripts in Phase 5e review)");
}
