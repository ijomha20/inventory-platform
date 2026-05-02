import app from "./app";
import { logger } from "./lib/logger";
import { env, isProduction } from "./lib/env";
import { startBackgroundRefresh } from "./lib/inventoryCache";
import { scheduleCarfaxWorker } from "./lib/carfaxWorker";
import { scheduleBlackBookWorker } from "./lib/blackBookWorker";
import { scheduleLenderSync } from "./lib/lenderWorker";
import { scheduleRandomDaily } from "./lib/randomScheduler";
import { archiveDeadLettersOlderThan, pruneIncidentLog } from "./lib/incidentService";
import { runSelfHealAuthHealthcheck } from "./lib/selfHeal/authHealthcheck";
import { runNightlyBackupTasks, runQuarterlyReminderTasks } from "./lib/backupScheduler";

const port = env.PORT;

// Load inventory from DB first (instant), then start background refresh cycle.
// await ensures the DB snapshot is in memory before we accept any requests.
startBackgroundRefresh().then(() => {
  runSelfHealAuthHealthcheck().catch((err) => logger.warn({ err }, "Self-heal auth healthcheck failed"));
  if (isProduction) {
    logger.info("Production deployment — Carfax worker disabled");
  } else {
    scheduleCarfaxWorker();
  }

  // Black Book worker runs in both environments — manual trigger must work from production
  scheduleBlackBookWorker();

  // Lender sync worker — caches lender program matrices from CreditApp GraphQL
  scheduleLenderSync();

  scheduleRandomDaily({
    name: "incident-log-eviction",
    hasRunToday: async () => false,
    execute: async () => {
      const pruned = await pruneIncidentLog();
      const archived = await archiveDeadLettersOlderThan(90);
      logger.info({ pruned, archived }, "Scheduled incident/dead-letter maintenance run complete");
    },
  });
  scheduleRandomDaily({
    name: "nightly-backup-jobs",
    hasRunToday: async () => false,
    execute: async () => {
      await runNightlyBackupTasks();
    },
  });
  scheduleRandomDaily({
    name: "quarterly-reminder-jobs",
    hasRunToday: async () => false,
    execute: async () => {
      await runQuarterlyReminderTasks();
    },
  });

  const server = app.listen(port, "0.0.0.0", () => logger.info({ port }, "Server listening"));
  server.on("error", (err) => { logger.error({ err }, "Listen failed"); process.exit(1); });
}).catch((err) => {
  logger.error({ err }, "Failed to initialise inventory cache — starting anyway");
  runSelfHealAuthHealthcheck().catch((e) => logger.warn({ err: e }, "Self-heal auth healthcheck failed"));
  if (!isProduction) scheduleCarfaxWorker();
  scheduleBlackBookWorker();
  scheduleLenderSync();
  scheduleRandomDaily({
    name: "incident-log-eviction",
    hasRunToday: async () => false,
    execute: async () => {
      const pruned = await pruneIncidentLog();
      const archived = await archiveDeadLettersOlderThan(90);
      logger.info({ pruned, archived }, "Scheduled incident/dead-letter maintenance run complete");
    },
  });
  scheduleRandomDaily({
    name: "nightly-backup-jobs",
    hasRunToday: async () => false,
    execute: async () => {
      await runNightlyBackupTasks();
    },
  });
  scheduleRandomDaily({
    name: "quarterly-reminder-jobs",
    hasRunToday: async () => false,
    execute: async () => {
      await runQuarterlyReminderTasks();
    },
  });
  const server = app.listen(port, "0.0.0.0", () => logger.info({ port }, "Server listening (cache init failed)"));
  server.on("error", (err) => { logger.error({ err }, "Listen failed"); process.exit(1); });
});
