import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { makeReplitStorage, getRequiredBucketId } from "./lib/replit-gcs.js";

const execFileAsync = promisify(execFile);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const bucketId = getRequiredBucketId();

  const date = new Date().toISOString().slice(0, 10);
  const gzPath = resolve(process.cwd(), `.tmp/db-backup-${date}.sql.gz`);
  mkdirSync(dirname(gzPath), { recursive: true });

  // pg_dump output → gzip in memory → write only the .gz file (skip raw SQL on disk)
  const { stdout } = await execFileAsync("pg_dump", [databaseUrl], { maxBuffer: 1024 * 1024 * 200 });
  const gz = gzipSync(stdout);
  writeFileSync(gzPath, gz);

  const bucket = makeReplitStorage().bucket(bucketId);
  await bucket.upload(gzPath, { destination: `backups/db/${date}.sql.gz`, resumable: false });
  console.log(`uploaded backups/db/${date}.sql.gz`);

  try { unlinkSync(gzPath); } catch { /* best-effort cleanup */ }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

