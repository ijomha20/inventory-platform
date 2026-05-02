/**
 * Anti-pattern checker — run in CI to catch forbidden patterns before merge.
 *
 * Checks source files under artifacts/api-server/src/ and
 * artifacts/inventory-portal/src/ for violations documented in AGENTS.md.
 *
 * Exit 0: no violations found.
 * Exit 1: one or more violations found (details printed to stdout).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts check:patterns
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");

// --------------------------------------------------------------------------
// Rules
// --------------------------------------------------------------------------

interface Rule {
  id: string;
  description: string;
  /** Returns true when the line is a violation. */
  test: (line: string, filePath: string) => boolean;
  /** Optional: false to suppress for this file path. */
  applicableTo?: (filePath: string) => boolean;
}

const RULES: Rule[] = [
  {
    id: "no-process-env",
    description: "Direct process.env access — import from lib/env.ts instead",
    test: (line) =>
      /process\.env\b/.test(line) &&
      !line.trimStart().startsWith("//") &&
      !line.trimStart().startsWith("*"),
    applicableTo: (filePath) =>
      // env.ts itself is allowed to read process.env
      !filePath.endsWith("/lib/env.ts") &&
      !filePath.endsWith("/lib/env.js") &&
      // drizzle.config files read DATABASE_URL from process.env
      !filePath.includes("drizzle.config") &&
      // CI / build scripts are outside the app bundle
      !filePath.includes("/scripts/"),
  },
  {
    id: "no-req-as-any",
    description: "(req as any) — extend Express.Request in types/passport.d.ts instead",
    test: (line) =>
      /\(req\s+as\s+any\)/.test(line) &&
      !line.trimStart().startsWith("//") &&
      !line.trimStart().startsWith("*"),
    applicableTo: (filePath) => filePath.includes("/api-server/"),
  },
  {
    id: "no-local-isProduction",
    description: "Local isProduction definition — import { isProduction } from lib/env.ts instead",
    test: (line) =>
      /const\s+isProduction\s*=/.test(line) &&
      !line.trimStart().startsWith("//") &&
      !line.trimStart().startsWith("*"),
    applicableTo: (filePath) =>
      !filePath.endsWith("/lib/env.ts") && !filePath.endsWith("/lib/env.js"),
  },
  {
    id: "no-require",
    description: "require() call — use static import or await import() with a comment explaining why",
    test: (line) =>
      /\brequire\s*\(/.test(line) &&
      !line.trimStart().startsWith("//") &&
      !line.trimStart().startsWith("*"),
    applicableTo: (filePath) =>
      // Only check TS source, not generated files or configs
      filePath.endsWith(".ts") &&
      !filePath.includes("/node_modules/") &&
      !filePath.includes(".config."),
  },
  {
    id: "no-inline-role-strip",
    description: "Inline role-based field stripping — use filterInventoryByRole() from lib/roleFilter.ts instead",
    test: (line) =>
      // Heuristic: delete obj.bbAvgWholesale or similar role-strip patterns
      /delete\s+\w+\.(bbAvgWholesale|bbValues|matrixPrice|cost)\b/.test(line) &&
      !line.trimStart().startsWith("//") &&
      !line.trimStart().startsWith("*"),
    applicableTo: (filePath) =>
      !filePath.includes("roleFilter"),
  },
  {
    id: "no-hardcoded-typesense",
    description: "Hardcoded Typesense host or collection ID — use lib/typesense.ts instead",
    test: (line) =>
      /typesense\.net|TYPESENSE_COLLECTION_/.test(line) &&
      /["'`][0-9a-f]{20,}["'`]/.test(line) &&
      !line.trimStart().startsWith("//") &&
      !line.trimStart().startsWith("*"),
    applicableTo: (filePath) =>
      !filePath.includes("/lib/typesense") && !filePath.endsWith("/lib/env.ts"),
  },
];

// --------------------------------------------------------------------------
// File walker
// --------------------------------------------------------------------------

const SCAN_DIRS = [
  path.join(WORKSPACE_ROOT, "artifacts/api-server/src"),
  path.join(WORKSPACE_ROOT, "artifacts/inventory-portal/src"),
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".vite", "__generated__"]);

function walkTs(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      results.push(full);
    }
  }
  return results;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

interface Violation {
  file: string;
  line: number;
  rule: string;
  description: string;
  content: string;
}

function checkFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.applicableTo && !rule.applicableTo(filePath)) continue;
      if (rule.test(line, filePath)) {
        violations.push({
          file: path.relative(WORKSPACE_ROOT, filePath),
          line: i + 1,
          rule: rule.id,
          description: rule.description,
          content: line.trim(),
        });
      }
    }
  }
  return violations;
}

const allFiles = SCAN_DIRS.flatMap(walkTs);
const allViolations: Violation[] = allFiles.flatMap(checkFile);

if (allViolations.length === 0) {
  console.log(`✓ check-patterns: ${allFiles.length} files scanned, 0 violations`);
  process.exit(0);
} else {
  console.error(`✗ check-patterns: ${allViolations.length} violation(s) found\n`);
  for (const v of allViolations) {
    console.error(`  [${v.rule}] ${v.file}:${v.line}`);
    console.error(`    Rule: ${v.description}`);
    console.error(`    Code: ${v.content}`);
    console.error();
  }
  process.exit(1);
}
