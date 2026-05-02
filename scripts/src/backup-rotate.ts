/**
 * Backup retention rotation for backups/db/YYYY-MM-DD.sql.gz files in GCS.
 *
 * Retention tiers:
 *   - 30 most recent daily backups
 *   - 12 weekly backups (first day-of-ISO-week within the file set)
 *   - 12 monthly backups (first day-of-month within the file set)
 *
 * Anything not in any tier is deleted. Tiers may overlap; a file in multiple
 * tiers is kept once and counted under each.
 */
import { makeReplitStorage, getRequiredBucketId } from "./lib/replit-gcs.js";

const FILENAME_RE = /backups\/db\/(\d{4})-(\d{2})-(\d{2})\.sql\.gz$/;

interface BackupFile {
  name: string;
  date: Date;
  isoWeekKey: string; // "YYYY-Www"
  monthKey: string;   // "YYYY-MM"
}

function parseBackupName(name: string): BackupFile | null {
  const m = FILENAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return { name, date, isoWeekKey: isoWeekKey(date), monthKey: `${y}-${mo}` };
}

function isoWeekKey(date: Date): string {
  // ISO week: Thursday of the same week determines the year/week.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function main() {
  const bucketId = getRequiredBucketId();
  const bucket = makeReplitStorage().bucket(bucketId);
  const [files] = await bucket.getFiles({ prefix: "backups/db/" });

  const parsed: BackupFile[] = files
    .map((f: { name: string }) => parseBackupName(f.name))
    .filter((b): b is BackupFile => b !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // newest first

  const keepDaily = 30;
  const keepWeekly = 12;
  const keepMonthly = 12;

  const keepSet = new Set<string>();

  // Daily: keep the N most recent
  for (let i = 0; i < Math.min(keepDaily, parsed.length); i++) {
    keepSet.add(parsed[i].name);
  }

  // Weekly: scan newest-first; keep the first backup encountered for each ISO week
  // until we have N distinct weeks
  const seenWeeks = new Set<string>();
  for (const f of parsed) {
    if (seenWeeks.size >= keepWeekly) break;
    if (!seenWeeks.has(f.isoWeekKey)) {
      seenWeeks.add(f.isoWeekKey);
      keepSet.add(f.name);
    }
  }

  // Monthly: same pattern, keyed by year-month
  const seenMonths = new Set<string>();
  for (const f of parsed) {
    if (seenMonths.size >= keepMonthly) break;
    if (!seenMonths.has(f.monthKey)) {
      seenMonths.add(f.monthKey);
      keepSet.add(f.name);
    }
  }

  let deleted = 0;
  for (const f of parsed) {
    if (keepSet.has(f.name)) continue;
    await bucket.file(f.name).delete({ ignoreNotFound: true });
    console.log(`deleted ${f.name}`);
    deleted++;
  }

  console.log(`rotation complete: ${parsed.length} total, ${keepSet.size} kept (30/12/12 tiers), ${deleted} deleted`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
