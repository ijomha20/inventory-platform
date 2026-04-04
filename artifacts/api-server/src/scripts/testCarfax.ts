/**
 * Quick Carfax test — run directly with:
 *   npx tsx src/scripts/testCarfax.ts 2C4RC1ZG7RR152266 5YFB4MDE3PP000858
 */
import { runCarfaxWorkerForVins } from "../lib/carfaxWorker.js";

const vins = process.argv.slice(2);

if (vins.length === 0) {
  console.error("Usage: npx tsx src/scripts/testCarfax.ts <VIN1> <VIN2> ...");
  process.exit(1);
}

console.log(`\nRunning Carfax test on ${vins.length} VIN(s): ${vins.join(", ")}\n`);

runCarfaxWorkerForVins(vins).then((results) => {
  console.log("\n========== RESULTS ==========");
  for (const r of results) {
    if (r.status === "found") {
      console.log(`✓ ${r.vin} — FOUND`);
      console.log(`  URL: ${r.url}`);
    } else if (r.status === "not_found") {
      console.log(`✗ ${r.vin} — NOT FOUND in Carfax`);
    } else if (r.status === "captcha") {
      console.log(`! ${r.vin} — CAPTCHA blocked`);
    } else {
      console.log(`✗ ${r.vin} — ERROR: ${r.error}`);
    }
  }
  console.log("=============================\n");
  process.exit(0);
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
