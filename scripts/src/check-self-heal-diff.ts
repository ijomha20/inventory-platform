import { execSync } from "node:child_process";
import { TIER_A_ALLOWLIST } from "../../artifacts/api-server/src/lib/codeRepair/allowlist.js";

function getChangedFiles(base = "origin/main"): string[] {
  const output = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" });
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function main() {
  const changedFiles = getChangedFiles();
  if (changedFiles.length === 0) {
    console.log("No changed files in diff");
    return;
  }

  const allowlist = new Set(Object.keys(TIER_A_ALLOWLIST));
  const outOfPolicy = changedFiles.filter((file) => !allowlist.has(file));
  if (outOfPolicy.length > 0) {
    console.error("Self-heal contract violation: changed files outside Tier A allowlist");
    for (const file of outOfPolicy) console.error(` - ${file}`);
    process.exit(1);
  }
  console.log(`✓ check-self-heal-diff: ${changedFiles.length} changed file(s) within allowlist`);
}

main();

