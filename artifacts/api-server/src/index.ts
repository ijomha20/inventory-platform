import app from "./app";
import { logger } from "./lib/logger";
import { env, isProduction } from "./lib/env";
import { startBackgroundRefresh } from "./lib/inventoryCache";
import { scheduleCarfaxWorker } from "./lib/carfaxWorker";
import { scheduleBlackBookWorker } from "./lib/blackBookWorker";
import { scheduleLenderSync } from "./lib/lenderWorker";

const port = env.PORT;

// Load inventory from DB first (instant), then start background refresh cycle.
// await ensures the DB snapshot is in memory before we accept any requests.
startBackgroundRefresh().then(() => {
  if (isProduction) {
    logger.info("Production deployment — Carfax worker disabled");
  } else {
    scheduleCarfaxWorker();
  }

  // Black Book worker runs in both environments — manual trigger must work from production
  scheduleBlackBookWorker();

  // Lender sync worker — caches lender program matrices from CreditApp GraphQL
  scheduleLenderSync();

  const server = app.listen(port, () => logger.info({ port }, "Server listening"));
  server.on("error", (err) => { logger.error({ err }, "Listen failed"); process.exit(1); });
}).catch((err) => {
  logger.error({ err }, "Failed to initialise inventory cache — starting anyway");
  if (!isProduction) scheduleCarfaxWorker();
  scheduleBlackBookWorker();
  scheduleLenderSync();
  const server = app.listen(port, () => logger.info({ port }, "Server listening (cache init failed)"));
  server.on("error", (err) => { logger.error({ err }, "Listen failed"); process.exit(1); });
});
