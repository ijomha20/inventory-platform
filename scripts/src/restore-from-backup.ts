import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { makeReplitStorage, getRequiredBucketId } from "./lib/replit-gcs.js";

const execFileAsync = promisify(execFile);

function getArg(name: string): string | null {
  const prefixed = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefixed));
  return arg ? arg.slice(prefixed.length) : null;
}

async function main() {
  const date = getArg("date");
  const target = getArg("target");
  const forceCurrent = process.argv.includes("--force-current");
  if (!date || !target) {
    throw new Error("Usage: tsx scripts/src/restore-from-backup.ts --date=YYYY-MM-DD --target=DATABASE_URL [--force-current]");
  }
  if (!forceCurrent && process.env.DATABASE_URL && target === process.env.DATABASE_URL) {
    throw new Error("Refusing to restore into current DATABASE_URL without --force-current");
  }
  const bucketId = getRequiredBucketId();
  const bucket = makeReplitStorage().bucket(bucketId);
  const file = bucket.file(`backups/db/${date}.sql.gz`);
  const tmpDir = resolve(process.cwd(), ".tmp");
  mkdirSync(tmpDir, { recursive: true });
  const gzPath = resolve(tmpDir, `restore-${date}.sql.gz`);
  const sqlPath = resolve(tmpDir, `restore-${date}.sql`);
  await file.download({ destination: gzPath });
  writeFileSync(sqlPath, gunzipSync(readFileSync(gzPath)));
  await execFileAsync("psql", [target, "-f", sqlPath], { maxBuffer: 1024 * 1024 * 200 });
  console.log(`Restored backup ${date} into target database`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

