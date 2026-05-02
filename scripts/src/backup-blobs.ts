import { makeReplitStorage, getRequiredBucketId } from "./lib/replit-gcs.js";

async function main() {
  const bucketId = getRequiredBucketId();
  const bucket = makeReplitStorage().bucket(bucketId);
  const date = new Date().toISOString().slice(0, 10);
  const keys = [
    "bb-values.json",
    "bb-session.json",
    "lender-programs.json",
    "lender-session.json",
    "carfax-runs.json",
  ];
  for (const key of keys) {
    const src = bucket.file(key);
    const dest = bucket.file(`backups/blobs/${date}/${key}`);
    try {
      await src.copy(dest);
      console.log(`copied ${key}`);
    } catch (err) {
      console.warn(`skip ${key}: ${String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

