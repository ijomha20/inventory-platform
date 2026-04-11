import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundRefresh } from "./lib/inventoryCache";
import { scheduleCarfaxWorker } from "./lib/carfaxWorker";
import { scheduleBlackBookWorker } from "./lib/blackBookWorker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Carfax worker only runs in the dev environment — not on the production deployment.
// Production containers start fresh with no session file, causing guaranteed login failures.
const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";

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

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}).catch((err) => {
  logger.error({ err }, "Failed to initialise inventory cache — starting anyway");
  if (!isProduction) scheduleCarfaxWorker();
  scheduleBlackBookWorker();
  app.listen(port, () => logger.info({ port }, "Server listening (cache init failed)"));
});
