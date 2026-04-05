import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundRefresh } from "./lib/inventoryCache";
import { scheduleCarfaxWorker } from "./lib/carfaxWorker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Load inventory from DB first (instant), then start background refresh cycle.
// await ensures the DB snapshot is in memory before we accept any requests.
startBackgroundRefresh().then(() => {
  // Schedule the Carfax cloud worker — runs nightly at 2:15am
  scheduleCarfaxWorker();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}).catch((err) => {
  logger.error({ err }, "Failed to initialise inventory cache — starting anyway");
  scheduleCarfaxWorker();
  app.listen(port, () => logger.info({ port }, "Server listening (cache init failed)"));
});
