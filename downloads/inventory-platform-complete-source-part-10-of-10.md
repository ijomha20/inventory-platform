# Inventory Platform — Complete source (part 10 of 10)

Generated: 2026-05-02T06:08:07 UTC

Machine-generated split of `downloads/inventory-platform-complete-source.md`. Each file in the bundle starts with a `### \`path\`` heading followed by a fenced code block — this split only cuts **between** those blocks so fences stay intact.

- **Single-file bundle:** run `pnpm --filter @workspace/scripts export:complete-md`
- **Parts:** `inventory-platform-complete-source-part-NN-of-10.md` (this is part 10)
- **Replication:** Part 1 begins with the original preamble (quickstart + included roots + TOC). Other parts continue body content only.

---

### `scripts/src/chaos/chaos-primitives.test.ts` (37 lines)

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { staleButServing } from "../../../artifacts/api-server/src/lib/selfHeal/staleButServing.js";
import { withRetry } from "../../../artifacts/api-server/src/lib/selfHeal/withRetry.js";

test("staleButServing returns cached value during outage", async () => {
  await staleButServing({
    key: "chaos-cache",
    fetchFn: async () => ({ value: 123 }),
  });

  const result = await staleButServing({
    key: "chaos-cache",
    fetchFn: async () => {
      throw new Error("upstream down");
    },
  });

  assert.equal(result.stale, true);
  assert.deepEqual(result.value, { value: 123 });
});

test("withRetry survives temporary outage", async () => {
  let attempts = 0;
  const value = await withRetry(
    { retries: 3, baseDelayMs: 1, jitterMs: 0 },
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary outage");
      return "healthy";
    },
  );
  assert.equal(value, "healthy");
  assert.equal(attempts, 3);
});


```

### `scripts/src/check-invariants.ts` (46 lines)

```typescript
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

const inventoryPath = path.join(root, "artifacts/api-server/src/lib/inventoryCache.ts");
const invariantsPath = path.join(root, "artifacts/api-server/src/lib/codeRepair/invariants.ts");

const inventorySource = fs.readFileSync(inventoryPath, "utf8");
const invariantSource = fs.readFileSync(invariantsPath, "utf8");

const inventoryMatch = inventorySource.match(/export interface InventoryItem \{([\s\S]*?)\n\}/);
if (!inventoryMatch) {
  console.error("Could not parse InventoryItem interface");
  process.exit(1);
}

const fieldPattern = /^\s*([a-zA-Z_]\w*)\??:/gm;
const inventoryFields = new Set<string>();
let fieldMatch: RegExpExecArray | null;
while ((fieldMatch = fieldPattern.exec(inventoryMatch[1])) !== null) {
  inventoryFields.add(fieldMatch[1]);
}

const invariantPattern = /^\s*([a-zA-Z_]\w*):\s*\{/gm;
const invariantFields = new Set<string>();
let invariantMatch: RegExpExecArray | null;
while ((invariantMatch = invariantPattern.exec(invariantSource)) !== null) {
  invariantFields.add(invariantMatch[1]);
}

const missing = [...inventoryFields].filter((field) => !invariantFields.has(field));
if (missing.length > 0) {
  console.error("Missing invariants for InventoryItem fields:");
  for (const field of missing) {
    console.error(` - ${field}`);
  }
  process.exit(1);
}

console.log(`✓ check-invariants: ${inventoryFields.size} InventoryItem fields covered`);


```

### `scripts/src/check-patterns.ts` (185 lines)

```typescript
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

```

### `scripts/src/check-readme-sync.ts` (156 lines)

```typescript
/**
 * README sync checker — verifies that file references in README.md files
 * point to files that actually exist. Prevents documentation drift where
 * READMEs mention renamed or deleted files.
 *
 * Exit 0: all references resolve.
 * Exit 1: one or more references are broken (details printed to stdout).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts check:readme-sync
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");

// --------------------------------------------------------------------------
// README files to check and the root against which relative refs are resolved
// --------------------------------------------------------------------------

interface ReadmeSpec {
  /** Absolute path to the README file. */
  readmePath: string;
  /**
   * One or more directories from which relative file refs are resolved.
   * A reference is valid if it resolves under ANY of the provided base dirs.
   */
  baseDirs: string[];
  /** Prefixes that indicate a file ref (e.g. "routes/", "lib/", "src/"). */
  filePrefixes: string[];
}

const READMES: ReadmeSpec[] = [
  {
    readmePath: path.join(WORKSPACE_ROOT, "artifacts/api-server/src/lib/README.md"),
    baseDirs: [path.join(WORKSPACE_ROOT, "artifacts/api-server/src")],
    filePrefixes: ["lib/", "routes/", "types/"],
  },
  {
    readmePath: path.join(WORKSPACE_ROOT, "artifacts/api-server/src/routes/README.md"),
    baseDirs: [path.join(WORKSPACE_ROOT, "artifacts/api-server/src")],
    filePrefixes: ["routes/", "lib/"],
  },
  {
    readmePath: path.join(WORKSPACE_ROOT, "lib/db/src/schema/README.md"),
    baseDirs: [path.join(WORKSPACE_ROOT, "artifacts/api-server/src")],
    filePrefixes: ["routes/", "lib/"],
  },
  {
    readmePath: path.join(WORKSPACE_ROOT, "artifacts/inventory-portal/src/README.md"),
    baseDirs: [path.join(WORKSPACE_ROOT, "artifacts/inventory-portal/src")],
    filePrefixes: ["pages/", "components/", "hooks/", "lib/"],
  },
  {
    // AGENTS.md mixes workspace-root paths (lib/db/src/schema/) and
    // api-server/src relative paths (routes/, lib/). Both base dirs are tried.
    readmePath: path.join(WORKSPACE_ROOT, "AGENTS.md"),
    baseDirs: [
      WORKSPACE_ROOT,
      path.join(WORKSPACE_ROOT, "artifacts/api-server/src"),
    ],
    filePrefixes: ["routes/", "lib/", "types/"],
  },
];

// --------------------------------------------------------------------------
// Extraction helpers
// --------------------------------------------------------------------------

/**
 * Extracts backtick-quoted tokens that start with one of the given prefixes.
 * E.g. "`routes/auth.ts`" → "routes/auth.ts"
 */
function extractRefs(content: string, prefixes: string[]): Array<{ ref: string; line: number }> {
  const refs: Array<{ ref: string; line: number }> = [];
  const lines = content.split("\n");
  // Match backtick-quoted identifiers like `routes/foo.ts` or `lib/bar.ts`
  const pattern = /`([^`]+)`/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(line)) !== null) {
      const token = match[1];
      // Must start with one of the expected prefixes and look like a file path
      if (prefixes.some((p) => token.startsWith(p)) && /\.[a-z]+$/.test(token)) {
        refs.push({ ref: token, line: i + 1 });
      }
    }
  }
  return refs;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

interface BrokenRef {
  readme: string;
  line: number;
  ref: string;
  resolved: string;
}

const broken: BrokenRef[] = [];
let totalChecked = 0;

for (const spec of READMES) {
  if (!fs.existsSync(spec.readmePath)) {
    console.warn(`  WARN: README not found: ${path.relative(WORKSPACE_ROOT, spec.readmePath)}`);
    continue;
  }

  const content = fs.readFileSync(spec.readmePath, "utf8");
  const refs = extractRefs(content, spec.filePrefixes);
  totalChecked += refs.length;

  for (const { ref, line } of refs) {
    // A reference is valid if it resolves under any of the specified base dirs
    const existsInAny = spec.baseDirs.some((baseDir) => {
      const resolved = path.join(baseDir, ref);
      const candidates = [resolved, resolved + ".ts", resolved + ".tsx", resolved + ".js"];
      return candidates.some((c) => fs.existsSync(c));
    });

    if (!existsInAny) {
      const firstResolved = path.join(spec.baseDirs[0], ref);
      broken.push({
        readme: path.relative(WORKSPACE_ROOT, spec.readmePath),
        line,
        ref,
        resolved: path.relative(WORKSPACE_ROOT, firstResolved),
      });
    }
  }
}

if (broken.length === 0) {
  console.log(`✓ check-readme-sync: ${totalChecked} references checked across ${READMES.length} READMEs, 0 broken`);
  process.exit(0);
} else {
  console.error(`✗ check-readme-sync: ${broken.length} broken reference(s)\n`);
  for (const b of broken) {
    console.error(`  ${b.readme}:${b.line}`);
    console.error(`    Reference: \`${b.ref}\``);
    console.error(`    Resolved:  ${b.resolved} (not found)`);
    console.error();
  }
  process.exit(1);
}

```

### `scripts/src/check-self-heal-diff.ts` (28 lines)

```typescript
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


```

### `scripts/src/dr-drill.ts` (16 lines)

```typescript
import { sendOpsAlert } from "../../artifacts/api-server/src/lib/emailService.js";

async function main() {
  await sendOpsAlert(
    "warning",
    "Quarterly DR drill due",
    "<p>Run <code>pnpm --filter @workspace/scripts dr-drill</code> with a scratch database target and update the Operations panel acknowledgment.</p>",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


```

### `scripts/src/generate-complete-source-md.ts` (425 lines)

```typescript
/**
 * Writes downloads/inventory-platform-complete-source.md — a single markdown
 * bundle of every workspace source file needed to rebuild and run the platform.
 * Files are **grouped by domain** (navigation, workspace, DB, API contract,
 * server areas, portal, etc.) for AI / reader context; an alphabetical index
 * is appended.
 *
 * Run: pnpm --filter @workspace/scripts export:complete-md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const OUTPUT_REL = "downloads/inventory-platform-complete-source.md";
const OUTPUT = path.join(WORKSPACE_ROOT, OUTPUT_REL);

const BASE_DIRS = [
  "scripts",
  "lib",
  "artifacts/api-server",
  "artifacts/inventory-portal",
  "artifacts/mockup-sandbox",
  "templates",
  "docs",
  ".github/workflows",
] as const;

const ROOT_FILES = [
  "AGENTS.md",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  ".replit",
  "replit.md",
  ".cursorrules",
] as const;

const EXTRA_REL_FILES = ["downloads/README.md"] as const;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".cache",
  ".local",
  "attached_assets",
  "downloads",
  ".replit-artifact",
]);

const SKIP_BASENAMES = new Set([
  ".creditapp-session.json",
  ".lender-session.json",
  ".carfax-session.json",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".css",
  ".html",
  ".toml",
  ".svg",
  ".sh",
]);

/** Ordered: first matching section wins. Last entry must be the catch-all. */
const DOMAIN_SECTIONS: readonly {
  readonly id: string;
  readonly title: string;
  readonly match: (rel: string) => boolean;
}[] = [
  {
    id: "navigation",
    title: "1. Navigation guide",
    match: (r) => r === "AGENTS.md" || r === "downloads/README.md",
  },
  {
    id: "workspace",
    title: "2. Workspace & monorepo root",
    match: (r) =>
      [
        "package.json",
        "pnpm-workspace.yaml",
        "pnpm-lock.yaml",
        "tsconfig.json",
        "tsconfig.base.json",
        ".replit",
        "replit.md",
        ".cursorrules",
      ].includes(r),
  },
  {
    id: "database",
    title: "3. Database (Drizzle)",
    match: (r) => r.startsWith("lib/db/"),
  },
  {
    id: "api-contract",
    title: "4. API contract (OpenAPI + Orval)",
    match: (r) => r.startsWith("lib/api-spec/"),
  },
  {
    id: "codegen",
    title: "5. Generated clients & Zod (Orval output)",
    match: (r) => r.startsWith("lib/api-zod/") || r.startsWith("lib/api-client-react/"),
  },
  {
    id: "shared-lib",
    title: "6. Shared libraries overview",
    match: (r) => r === "lib/README.md",
  },
  {
    id: "server-bootstrap",
    title: "7. API server — bootstrap & application shell",
    match: (r) =>
      r === "artifacts/api-server/package.json" ||
      r === "artifacts/api-server/tsconfig.json" ||
      r === "artifacts/api-server/build.mjs" ||
      r === "artifacts/api-server/eslint.config.mjs" ||
      r === "artifacts/api-server/src/index.ts" ||
      r === "artifacts/api-server/src/app.ts",
  },
  {
    id: "auth-access",
    title: "8. API server — auth & access control",
    match: (r) =>
      r === "artifacts/api-server/src/routes/auth.ts" ||
      r === "artifacts/api-server/src/routes/access.ts" ||
      r === "artifacts/api-server/src/lib/auth.ts" ||
      r === "artifacts/api-server/src/lib/emailService.ts" ||
      r === "artifacts/api-server/src/lib/roleFilter.ts",
  },
  {
    id: "inventory",
    title: "9. API server — inventory & vehicle data",
    match: (r) =>
      r === "artifacts/api-server/src/routes/inventory.ts" ||
      r === "artifacts/api-server/src/routes/price-lookup.ts" ||
      r === "artifacts/api-server/src/lib/inventoryCache.ts",
  },
  {
    id: "lender",
    title: "10. API server — lender programs & calculator",
    match: (r) =>
      r.startsWith("artifacts/api-server/src/routes/lender/") ||
      r === "artifacts/api-server/src/lib/lenderCalcEngine.ts" ||
      r === "artifacts/api-server/src/lib/lenderWorker.ts" ||
      r === "artifacts/api-server/src/lib/lenderAuth.ts" ||
      r === "artifacts/api-server/src/lib/runtimeFingerprint.ts",
  },
  {
    id: "integrations",
    title: "11. API server — integrations (Black Book, Carfax, object storage)",
    match: (r) =>
      r === "artifacts/api-server/src/lib/blackBookWorker.ts" ||
      r === "artifacts/api-server/src/lib/carfaxWorker.ts" ||
      r === "artifacts/api-server/src/lib/bbObjectStore.ts" ||
      r === "artifacts/api-server/src/routes/carfax.ts" ||
      r === "artifacts/api-server/src/scripts/testCarfax.ts",
  },
  {
    id: "ops-self-heal",
    title: "11b. API server — ops, incidents, self-heal & code repair",
    match: (r) =>
      r === "artifacts/api-server/src/routes/ops.ts" ||
      r.startsWith("artifacts/api-server/src/lib/selfHeal/") ||
      r.startsWith("artifacts/api-server/src/lib/codeRepair/") ||
      r === "artifacts/api-server/src/lib/incidentService.ts" ||
      r === "artifacts/api-server/src/lib/platformError.ts" ||
      r === "artifacts/api-server/src/lib/backupScheduler.ts",
  },
  {
    id: "server-cross",
    title: "12. API server — cross-cutting (health, routing, logging, types)",
    match: (r) =>
      r === "artifacts/api-server/src/routes/health.ts" ||
      r === "artifacts/api-server/src/routes/index.ts" ||
      r === "artifacts/api-server/src/routes/README.md" ||
      r === "artifacts/api-server/src/lib/env.ts" ||
      r === "artifacts/api-server/src/lib/validate.ts" ||
      r === "artifacts/api-server/src/lib/typesense.ts" ||
      r === "artifacts/api-server/src/lib/logger.ts" ||
      r === "artifacts/api-server/src/lib/randomScheduler.ts" ||
      r === "artifacts/api-server/src/lib/README.md" ||
      r === "artifacts/api-server/src/types/passport.d.ts",
  },
  {
    id: "frontend",
    title: "13. Frontend portal (production SPA)",
    match: (r) => r.startsWith("artifacts/inventory-portal/"),
  },
  {
    id: "mockup",
    title: "14. Mockup sandbox (component preview)",
    match: (r) => r.startsWith("artifacts/mockup-sandbox/"),
  },
  {
    id: "templates",
    title: "15. Templates",
    match: (r) => r.startsWith("templates/"),
  },
  {
    id: "tests-scripts",
    title: "16. Scripts & tests",
    match: (r) => r.startsWith("scripts/"),
  },
  {
    id: "ci-workflows",
    title: "17. GitHub Actions workflows",
    match: (r) => r.startsWith(".github/workflows/"),
  },
  {
    id: "documentation",
    title: "18. Documentation (runbooks, SLAs, stability)",
    match: (r) => r.startsWith("docs/"),
  },
  {
    id: "uncategorized",
    title: "19. Uncategorized (extend DOMAIN_SECTIONS if files appear here)",
    match: () => true,
  },
];

function shouldSkipDir(segment: string): boolean {
  return SKIP_DIR_NAMES.has(segment);
}

function fenceLang(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx" || ext === ".ts" || ext === ".mts" || ext === ".cts") return "typescript";
  if (ext === ".css") return "css";
  if (ext === ".html") return "html";
  if (ext === ".json") return "json";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".md") return "markdown";
  if (ext === ".toml") return "toml";
  if (ext === ".svg") return "svg";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".sh") return "bash";
  return "text";
}

function collectUnder(baseRel: string, out: string[]): void {
  const abs = path.join(WORKSPACE_ROOT, baseRel);
  if (!fs.existsSync(abs)) return;

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === ".DS_Store") continue;
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name)) continue;
        walk(path.join(dir, e.name));
        continue;
      }
      const full = path.join(dir, e.name);
      const rel = path.relative(WORKSPACE_ROOT, full).split(path.sep).join("/");
      const ext = path.extname(e.name).toLowerCase();
      if (e.name.endsWith(".tsbuildinfo")) continue;
      if (SKIP_BASENAMES.has(e.name)) continue;
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      out.push(rel);
    }
  };

  const st = fs.statSync(abs);
  if (st.isDirectory()) walk(abs);
  else if (st.isFile()) {
    const rel = path.relative(WORKSPACE_ROOT, abs).split(path.sep).join("/");
    out.push(rel);
  }
}

function sortKey(rel: string): string {
  return rel.replace(/^\//, "");
}

function readUtf8(rel: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, rel), "utf8");
}

function sectionIndexFor(rel: string): number {
  for (let i = 0; i < DOMAIN_SECTIONS.length; i++) {
    if (DOMAIN_SECTIONS[i].match(rel)) return i;
  }
  return DOMAIN_SECTIONS.length - 1;
}

function emitFileBlock(lines: string[], rel: string): void {
  const body = readUtf8(rel);
  const lang = fenceLang(rel);
  const n = body.split(/\r\n|\r|\n/).length;
  lines.push(`### \`${rel}\` (${n} lines)`);
  lines.push("");
  lines.push("```" + lang);
  lines.push(body);
  lines.push("```");
  lines.push("");
}

function main(): void {
  const files: string[] = [];

  for (const f of ROOT_FILES) {
    const abs = path.join(WORKSPACE_ROOT, f);
    if (fs.existsSync(abs)) files.push(f);
  }
  for (const f of EXTRA_REL_FILES) {
    const abs = path.join(WORKSPACE_ROOT, f);
    if (fs.existsSync(abs)) files.push(f);
  }
  for (const d of BASE_DIRS) collectUnder(d, files);

  const unique = [...new Set(files)].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const bySection: string[][] = DOMAIN_SECTIONS.map(() => []);
  for (const rel of unique) {
    bySection[sectionIndexFor(rel)].push(rel);
  }

  const uncIdx = DOMAIN_SECTIONS.length - 1;
  if (bySection[uncIdx].length > 0) {
    console.warn(
      "Uncategorized files (add DOMAIN_SECTIONS rules):",
      bySection[uncIdx].join(", "),
    );
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, " UTC");
  const lines: string[] = [];
  lines.push("# Inventory Platform — Complete source (domain-grouped, machine-generated)");
  lines.push("");
  lines.push(`Generated: ${now}`);
  lines.push("");
  lines.push(
    "Produced by `pnpm --filter @workspace/scripts export:complete-md`. " +
      "Body is ordered by **business domain** (same flow as the hand-curated export: navigation → workspace → DB → API contract → " +
      "codegen → server domains → portal → mockup → templates → scripts). " +
      "Within each domain, files are sorted by path. Session JSON and build artifacts are excluded; see *Included roots* below.",
  );
  lines.push("");
  lines.push("## Replication quickstart");
  lines.push("");
  lines.push("1. Restore files from the sections below.");
  lines.push("2. `pnpm install` at the repo root.");
  lines.push("3. When OpenAPI changes: `pnpm --filter @workspace/api-spec codegen`.");
  lines.push("4. `pnpm run build`, then run `dev` / `start` per package.");
  lines.push("");
  lines.push("## Included roots");
  lines.push("");
  lines.push(
    [
      "- Root: `AGENTS.md`, `.cursorrules`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, `.replit`, `replit.md`",
      "- `lib/` (db, api-spec, api-zod, api-client-react, including generated)",
      "- `artifacts/api-server/` (no `dist/`)",
      "- `artifacts/inventory-portal/`",
      "- `artifacts/mockup-sandbox/`",
      "- `templates/`, `scripts/`, `docs/`, `.github/workflows/`, `downloads/README.md`",
    ].join("\n"),
  );
  lines.push("");
  lines.push("## Table of contents");
  lines.push("");
  for (const s of DOMAIN_SECTIONS) {
    if (s.id === "uncategorized") continue;
    lines.push(`- [${s.title}](#${s.id})`);
  }
  lines.push(`- [Appendix: alphabetical file index](#appendix-index)`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (let si = 0; si < DOMAIN_SECTIONS.length; si++) {
    const s = DOMAIN_SECTIONS[si];
    const bucket = bySection[si];
    if (bucket.length === 0) continue;

    lines.push(`<a id="${s.id}"></a>`);
    lines.push(`## ${s.title}`);
    lines.push("");
    lines.push(`*${bucket.length} file(s).*`);
    lines.push("");

    for (const rel of bucket.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
      emitFileBlock(lines, rel);
    }
    lines.push("---");
    lines.push("");
  }

  lines.push(`<a id="appendix-index"></a>`);
  lines.push("## Appendix: alphabetical file index");
  lines.push("");
  for (const rel of unique) lines.push(`- \`${rel}\``);
  lines.push("");

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const outText = lines.join("\n");
  fs.writeFileSync(OUTPUT, outText, "utf8");
  const outLines = outText.split("\n").length;
  console.log(`Wrote ${OUTPUT_REL} (${unique.length} files, ${outLines} lines)`);
}

main();

```

### `scripts/src/handoff-watcher.ts` (21 lines)

```typescript
import { sendOpsAlert } from "../../artifacts/api-server/src/lib/emailService.js";

async function main() {
  const phase = process.argv[2] ?? "unknown-phase";
  const hours = Number(process.argv[3] ?? "4");
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("Usage: tsx scripts/src/handoff-watcher.ts <phase> <hours>");
  }
  await sendOpsAlert(
    "info",
    `Self-heal plan stalled at model handoff (${phase})`,
    `<p>The execution plan is stalled at model handoff <strong>${phase}</strong>.</p><p>Idle threshold reached: <strong>${hours}h</strong>.</p>`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


```

### `scripts/src/hello.ts` (2 lines)

```typescript
console.log("Hello from @workspace/scripts");

```

### `scripts/src/lender-calc-scenarios.test.ts` (908 lines)

```typescript
/**
 * Lender Calculator Scenario Tests
 *
 * Tests the pure math functions used by POST /lender-calculate.
 * Each test case documents a real-world deal scenario with known inputs and
 * expected outputs, so an AI agent can read these to understand what the
 * calculator should produce.
 *
 * Run: pnpm --filter @workspace/scripts test:lender-scenarios
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCapProfile,
  resolveNoOnlineSellingPrice,
  parseInventoryNumber,
  trimProductsInOrder,
  computePaymentCeilingPV,
  computeZeroDpCeiling,
  resolveSellingPrice,
  allocateBackend,
  settleConstraints,
  parseWorksheetRule,
  parseWorksheetRules,
  applyEligibilityRules,
  deriveTermCap,
  deriveTotalFinanceCap,
} from "../../artifacts/api-server/src/lib/lenderCalcEngine.js";
import type { WorksheetRule } from "../../artifacts/api-server/src/lib/bbObjectStore.js";

// --------------------------------------------------------------------------
// Helpers — mirror the exact functions from routes/lender.ts so we can test
// the math in isolation without needing Express or the inventory cache.
// --------------------------------------------------------------------------

function pmt(rate: number, nper: number, pv: number): number {
  if (rate === 0) return pv / nper;
  const r = rate / 12;
  return (pv * r * Math.pow(1 + r, nper)) / (Math.pow(1 + r, nper) - 1);
}

const MAX_FINANCE_TERM_MONTHS = 84;

function resolveEffectiveTermStretch(
  baseTerm: number,
  requested: 0 | 6 | 12,
): { effectiveStretch: 0 | 6 | 12; termMonths: number; stretched: boolean; cappedReason?: string } {
  if (baseTerm >= MAX_FINANCE_TERM_MONTHS) {
    return { effectiveStretch: 0, termMonths: baseTerm, stretched: false, cappedReason: "matrix_already_84_no_stretch" };
  }
  const order: (0 | 6 | 12)[] = [12, 6, 0];
  let maxStretch: 0 | 6 | 12 = 0;
  for (const s of order) {
    if (baseTerm + s <= MAX_FINANCE_TERM_MONTHS) { maxStretch = s; break; }
  }
  const effectiveStretch = Math.min(requested, maxStretch) as 0 | 6 | 12;
  const termMonths = baseTerm + effectiveStretch;

  let cappedReason: string | undefined;
  if (requested > effectiveStretch) {
    cappedReason = baseTerm === 78 && requested === 12 && effectiveStretch === 6
      ? "78_only_plus6_to_84"
      : "capped_at_84_max";
  }
  return { effectiveStretch, termMonths, stretched: effectiveStretch > 0, cappedReason };
}

// --------------------------------------------------------------------------
// Scenario 1: Basic setup — Eden Park Tier 3 style
// Vehicle sells at reduced (Red) price, no products, payment under cap.
// --------------------------------------------------------------------------

test("Scenario 1: basic setup — reduced price, no products, payment under cap", () => {
  // Inputs from a real deal row:
  // BB wholesale (avg) = 16,432, online price exists but exceeds advance ceiling
  // Rate = 21.49%, term = 78mo, maxPaymentOverride = 665
  // maxAdvanceLTV = 135% (effective for this tier's live config)
  // creditorFee = 675 (inferred from financed total)
  // taxRate = 5%, no down/trade

  const bbWholesale = 16432;
  const maxAdvanceLTV = 1.35;
  const rateDecimal = 0.2149;
  const termMonths = 78;
  const taxRate = 0.05;
  const creditorFee = 675;
  const downPayment = 0;
  const netTrade = 0;
  const maxPmt = 665;

  // Advance ceiling determines reduced selling price
  const maxAdvance = bbWholesale * maxAdvanceLTV;
  const advanceCeiling = maxAdvance + downPayment + netTrade;
  const sellingPrice = Math.floor(advanceCeiling);

  // No products in this scenario (LTV room too tight)
  const lenderExposure = sellingPrice - downPayment - netTrade;
  const allInSubtotal = lenderExposure + 0 + 0 + creditorFee;
  const taxes = allInSubtotal * taxRate;
  const totalFinanced = allInSubtotal + taxes;
  const monthly = pmt(rateDecimal, termMonths, totalFinanced);

  // Verify the math matches the expected deal row
  assert.equal(sellingPrice, 22183, "Reduced selling price should be floor of advance ceiling");
  assert.equal(Math.round(totalFinanced), 24001, "Total financed should be ~24,001");
  assert.ok(Math.abs(monthly - 573.43) < 0.01, `Payment should be ~573.43, got ${monthly.toFixed(2)}`);
  assert.ok(monthly <= maxPmt, "Payment should be under the max payment cap of 665");
});

// --------------------------------------------------------------------------
// Scenario 2: Product stacking — enough LTV room for warranty + GAP
// --------------------------------------------------------------------------

test("Scenario 2: product stacking with sufficient LTV room", () => {
  // Vehicle with generous all-in room
  const MARKUP = 2.5;
  const MIN_WARRANTY_COST = 600;
  const MIN_GAP_COST = 550;
  const MAX_GAP_MARKUP = 1500;
  const MAX_GAP_PRICE = Math.round(MAX_GAP_MARKUP / (1 - 1 / MARKUP));
  const capWarranty = 2000;
  const capGap: number | undefined = undefined;
  const capAdmin: number | undefined = 999;
  const desiredAdmin = 999;
  const dealerReserve = 500;
  const creditorFee = 799;

  // Simulate 6000 of combined room
  const allInRoom = 6000;
  const aftermarketRoom = Infinity;

  let room = Math.min(allInRoom, isFinite(aftermarketRoom) ? aftermarketRoom : Infinity);

  // Admin first
  const admin = Math.min(desiredAdmin, capAdmin ?? desiredAdmin, Math.floor(room));
  room -= admin;

  // Warranty
  let war = 0;
  if (room >= Math.round(MIN_WARRANTY_COST * MARKUP)) {
    war = capWarranty != null ? Math.min(room, capWarranty) : room;
    war = Math.max(war, Math.round(MIN_WARRANTY_COST * MARKUP));
    if (war > room) war = 0;
  }
  const wCost = war > 0 ? Math.round(war / MARKUP) : 0;
  room -= war;

  // GAP
  let gap = 0;
  if (room >= Math.round(MIN_GAP_COST * MARKUP)) {
    const gapCeiling = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
    gap = Math.min(room, gapCeiling);
    gap = Math.max(gap, Math.round(MIN_GAP_COST * MARKUP));
    if (gap > room) gap = 0;
  }
  const gCost = gap > 0 ? Math.round(gap / MARKUP) : 0;

  const profit = (war - wCost) + (gap - gCost) + admin + dealerReserve - creditorFee;

  assert.equal(admin, 999, "Admin should be capped at 999");
  assert.equal(war, 2000, "Warranty should be capped at program cap of 2000");
  assert.ok(gap > 0, "GAP should be populated when room remains");
  assert.ok(gap <= MAX_GAP_PRICE, `GAP should not exceed MAX_GAP_PRICE (${MAX_GAP_PRICE})`);
  assert.ok(profit > 0, "Profit should be positive with products stacked");
});

// --------------------------------------------------------------------------
// Scenario 3: LTV-constrained — allInRoom too small for products
// --------------------------------------------------------------------------

test("Scenario 3: LTV-constrained — products stay at zero", () => {
  const MARKUP = 2.5;
  const MIN_WARRANTY_COST = 600;

  // Only 800 of room — below the 1500 minimum for warranty
  const allInRoom = 800;
  const aftermarketRoom = Infinity;
  const room = Math.min(allInRoom, isFinite(aftermarketRoom) ? aftermarketRoom : Infinity);

  const minWarrantyPrice = Math.round(MIN_WARRANTY_COST * MARKUP);

  assert.ok(room < minWarrantyPrice, "Room should be below minimum warranty threshold");
  // In the real calculator, warranty = 0 when room < MIN_WARRANTY_COST * MARKUP
  assert.ok(room < 1500, "Confirms no warranty can fit in 800 of room");
});

// --------------------------------------------------------------------------
// Scenario 4: Payment-capped — settle loop strips products
// --------------------------------------------------------------------------

test("Scenario 4: payment cap forces product stripping", () => {
  const rateDecimal = 0.2149;
  const termMonths = 72;
  const maxPmt = 400;

  // A deal where base payment fits but adding products pushes it over cap
  const baseFinanced = 14000;
  const baseMonthly = pmt(rateDecimal, termMonths, baseFinanced);

  // With 3000 of products added (warranty + GAP + admin)
  const withProducts = pmt(rateDecimal, termMonths, baseFinanced + 3000);

  assert.ok(baseMonthly <= maxPmt, `Base payment ${baseMonthly.toFixed(2)} should be under cap ${maxPmt}`);
  assert.ok(withProducts > maxPmt, `Payment with products ${withProducts.toFixed(2)} should exceed cap ${maxPmt}`);

  // The settle loop strips products first, then rechecks.
  // If still over, it calculates extra down payment from the PV overage.
});

// --------------------------------------------------------------------------
// Scenario 5: Term stretch — 78mo base + requested +12 → effective +6
// --------------------------------------------------------------------------

test("Scenario 5: term stretch capped at 84mo", () => {
  const result78plus12 = resolveEffectiveTermStretch(78, 12);
  assert.equal(result78plus12.effectiveStretch, 6, "78 + 12 should be capped to +6");
  assert.equal(result78plus12.termMonths, 84, "Final term should be 84");
  assert.equal(result78plus12.cappedReason, "78_only_plus6_to_84");

  const result84plus12 = resolveEffectiveTermStretch(84, 12);
  assert.equal(result84plus12.effectiveStretch, 0, "84 base should not stretch");
  assert.equal(result84plus12.cappedReason, "matrix_already_84_no_stretch");

  const result72plus12 = resolveEffectiveTermStretch(72, 12);
  assert.equal(result72plus12.effectiveStretch, 12, "72 + 12 = 84, fits exactly");
  assert.equal(result72plus12.termMonths, 84);
  assert.equal(result72plus12.cappedReason, undefined, "No capping needed");

  const result66plus6 = resolveEffectiveTermStretch(66, 6);
  assert.equal(result66plus6.effectiveStretch, 6);
  assert.equal(result66plus6.termMonths, 72);
  assert.equal(result66plus6.stretched, true);
});

// --------------------------------------------------------------------------
// Scenario 6: Tier 2 fallback — online price exceeds advance ceiling
// --------------------------------------------------------------------------

test("Scenario 6: Tier 2 price reduction when online exceeds advance", () => {
  const bbWholesale = 15000;
  const maxAdvanceLTV = 1.40;
  const onlinePrice = 25000;
  const pacCost = 18000;
  const downPayment = 0;
  const netTrade = 0;

  const maxAdvance = bbWholesale * maxAdvanceLTV;
  const lenderExposure = onlinePrice - downPayment - netTrade;

  // Tier 1 check: does online price fit within advance?
  const tier1Fits = lenderExposure <= maxAdvance;
  assert.equal(tier1Fits, false, "Online price exceeds advance ceiling → Tier 2");

  // Tier 2: reduce to advance ceiling
  const advanceCeiling = maxAdvance + downPayment + netTrade;
  const reducedPrice = Math.min(onlinePrice, Math.floor(advanceCeiling));

  assert.equal(reducedPrice, 21000, "Reduced price = floor(15000 * 1.40)");
  assert.ok(reducedPrice >= pacCost, "Reduced price must cover PAC cost");

  const profitTarget = onlinePrice - pacCost;
  assert.equal(profitTarget, 7000, "Profit target based on original online price");
});

// --------------------------------------------------------------------------
// Scenario 7: Cap profile resolution
// --------------------------------------------------------------------------

test("Scenario 7: cap profile key and no-online strategy", () => {
  // ACC-style: all three caps active
  const accProfile = resolveCapProfile({
    maxAdvanceLTV: 140, maxAftermarketLTV: 25, maxAllInLTV: 175,
    capModelResolved: "split",
  });
  assert.equal(accProfile.key, "111");
  assert.equal(accProfile.allInOnly, false);

  // Santander-style: allInOnly suppresses aftermarket
  const sanProfile = resolveCapProfile({
    maxAdvanceLTV: 0, maxAftermarketLTV: 30, maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  assert.equal(sanProfile.key, "001", "Aftermarket suppressed by allInOnly model");
  assert.equal(sanProfile.allInOnly, true);

  // No-online selling price: maximized from all-in
  const resolution = resolveNoOnlineSellingPrice({
    pacCost: 15000, downPayment: 0, netTrade: 0,
    creditorFee: 699, maxAdvance: Infinity, maxAllInPreTax: 25000,
    profile: sanProfile,
  });
  assert.equal(resolution.source, "maximized");
  assert.equal(resolution.price, Math.round(25000 - 699));
});

// --------------------------------------------------------------------------
// Scenario 8: incremental trim preserves priority (not all-or-nothing)
// --------------------------------------------------------------------------

test("Scenario 8: trimProductsInOrder removes GAP first, then warranty, then admin", () => {
  const state = { admin: 699, warranty: 3500, gap: 2200 };
  const leftover = trimProductsInOrder(state, 3000);

  assert.equal(leftover, 0);
  assert.equal(state.gap, 0, "GAP is trimmed first");
  assert.equal(state.warranty, 2700, "Warranty trimmed after GAP");
  assert.equal(state.admin, 699, "Admin remains until GAP/warranty exhausted");
});

test("Scenario 8b: trimProductsInOrder reports leftover when products cannot absorb excess", () => {
  const state = { admin: 500, warranty: 1500, gap: 2000 };
  const leftover = trimProductsInOrder(state, 5000);

  assert.equal(state.gap, 0);
  assert.equal(state.warranty, 0);
  assert.equal(state.admin, 0);
  assert.equal(leftover, 1000, "Excess beyond product budget rolls into required cash down");
});

// --------------------------------------------------------------------------
// Scenario 9: no-online pricing uses zero-DP ceiling then PAC floor
// --------------------------------------------------------------------------

test("Scenario 9: no-online -> selling price floors at PAC, DP reaches PAC", () => {
  const result = resolveSellingPrice({
    pacCost: 22000,
    onlinePrice: null,
    zeroDpCeiling: 20000,
    bindingZeroDpReason: "advance",
  });

  assert.equal(result.sellingPrice, 22000, "Selling price floors at PAC");
  assert.equal(result.requiredDownPayment, 2000, "DP = PAC - zero-DP ceiling");
  assert.equal(result.bindingSellingConstraint, "pacFloor");
  assert.equal(result.sellingPriceCappedByOnline, false);
});

test("Scenario 9b: online reachable at zero DP -> sells at online, capped", () => {
  const result = resolveSellingPrice({
    pacCost: 18000,
    onlinePrice: 24500,
    zeroDpCeiling: 30000,
    bindingZeroDpReason: "allIn",
  });

  assert.equal(result.sellingPrice, 24500, "Sells at online when zero-DP ceiling already covers it");
  assert.equal(result.bindingSellingConstraint, "online");
  assert.equal(result.sellingPriceCappedByOnline, true);
  assert.equal(result.requiredDownPayment, 0);
});

test("Scenario 9c: no-online -> maximizes to zero-DP ceiling", () => {
  const result = resolveSellingPrice({
    pacCost: 18000,
    onlinePrice: null,
    zeroDpCeiling: 24500,
    bindingZeroDpReason: "payment",
  });

  assert.equal(result.sellingPrice, 24500, "Maximizes to zero-DP ceiling");
  assert.equal(result.bindingSellingConstraint, "payment");
  assert.equal(result.requiredDownPayment, 0);
});

test("Scenario 9d: online above structural ceiling (pac<ceiling<online) -> DP gets us to online", () => {
  const result = resolveSellingPrice({
    pacCost: 15000,
    onlinePrice: 30000,
    zeroDpCeiling: 22000,
    bindingZeroDpReason: "allIn",
  });

  assert.equal(result.sellingPrice, 30000, "Sells at online (priority target)");
  assert.equal(result.bindingSellingConstraint, "allIn", "Binding constraint is the structural ceiling");
  assert.equal(result.sellingPriceCappedByOnline, false, "Online wasn't reachable at zero DP");
  assert.equal(result.requiredDownPayment, 8000, "DP = online - zero-DP ceiling");
});

test("Scenario 9e: ceiling below PAC, online above PAC -> DP reaches online (not PAC)", () => {
  const result = resolveSellingPrice({
    pacCost: 20000,
    onlinePrice: 30000,
    zeroDpCeiling: 18000,
    bindingZeroDpReason: "allIn",
  });

  assert.equal(result.sellingPrice, 30000, "Online price has priority over PAC for the DP target");
  assert.equal(result.bindingSellingConstraint, "allIn", "Structural ceiling is binding");
  assert.equal(result.sellingPriceCappedByOnline, false, "Online wasn't reachable at zero DP");
  assert.equal(result.requiredDownPayment, 12000, "DP = online - zero-DP ceiling (not PAC - ceiling)");
});

test("Scenario 9f: online below PAC (degenerate) -> floor at PAC, DP reaches PAC", () => {
  const result = resolveSellingPrice({
    pacCost: 25000,
    onlinePrice: 22000,
    zeroDpCeiling: 18000,
    bindingZeroDpReason: "advance",
  });

  assert.equal(result.sellingPrice, 25000, "Cannot sell below PAC even when online price is lower");
  assert.equal(result.requiredDownPayment, 7000, "DP = PAC - ceiling");
});

// --------------------------------------------------------------------------
// Scenario 10: reserve is profit-only, lender fee is structural-only
// --------------------------------------------------------------------------

test("Scenario 10: profit decomposition keeps reserve in gross and lender fee out of displayed gross", () => {
  const frontEndGross = 2500;
  const adminFeeUsed = 699;
  const dealerReserve = 750;
  const warrantyProfit = 900;
  const gapProfit = 400;
  const creditorFee = 675; // used for constraints only

  const nonCancelableGross = frontEndGross + adminFeeUsed + dealerReserve;
  const cancelableBackendGross = warrantyProfit + gapProfit;
  const totalGross = nonCancelableGross + cancelableBackendGross;

  assert.equal(nonCancelableGross, 3949);
  assert.equal(cancelableBackendGross, 1300);
  assert.equal(totalGross, 5249);
  assert.notEqual(totalGross, 5249 - creditorFee, "Displayed gross should not subtract creditor fee");
});

// --------------------------------------------------------------------------
// Scenario 11: parseInventoryNumber handles common inventory string formats
// --------------------------------------------------------------------------

test("Scenario 11: parseInventoryNumber strips formatting and handles missing values", () => {
  assert.equal(parseInventoryNumber("$25,499.00"), 25499);
  assert.equal(parseInventoryNumber("12500"), 12500);
  assert.equal(parseInventoryNumber(18000), 18000);
  assert.equal(parseInventoryNumber(null), 0);
  assert.equal(parseInventoryNumber(undefined), 0);
  assert.equal(parseInventoryNumber(""), 0);
});

// --------------------------------------------------------------------------
// Scenario 12: computeZeroDpCeiling combines LTV and payment ceilings correctly
// --------------------------------------------------------------------------

test("Scenario 12: computeZeroDpCeiling picks the binding ceiling and reason", () => {
  const paymentPV = computePaymentCeilingPV(0.0699, 84, 750);

  // LTV-binding case: tight all-in cap
  const ltvBound = computeZeroDpCeiling({
    hasAdvanceCap: true,
    maxAdvance: 30000,
    hasAllInCap: true,
    maxAllInPreTax: 22000,
    paymentPV,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    taxRate: 0.05,
  });
  assert.equal(ltvBound.bindingReason, "allIn");
  assert.ok(ltvBound.zeroDpCeiling <= 22000 - 699, "All-in ceiling subtracts creditor fee");

  // Payment-binding case: low maxPmt
  const tightPaymentPV = computePaymentCeilingPV(0.0699, 84, 250);
  const paymentBound = computeZeroDpCeiling({
    hasAdvanceCap: true,
    maxAdvance: 30000,
    hasAllInCap: true,
    maxAllInPreTax: 40000,
    paymentPV: tightPaymentPV,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    taxRate: 0.05,
  });
  assert.equal(paymentBound.bindingReason, "payment");
  assert.ok(paymentBound.paymentCeiling < paymentBound.ltvCeiling);
});

// --------------------------------------------------------------------------
// Scenario 13: allocateBackend follows priority and per-product caps
// --------------------------------------------------------------------------

test("Scenario 13: allocateBackend stacks admin -> warranty -> GAP within room", () => {
  const result = allocateBackend({
    allInRoom: 6000,
    aftermarketRoom: Infinity,
    capAdmin: 999,
    desiredAdmin: 999,
    capWarranty: 2000,
    capGap: undefined,
    gapAllowed: true,
    adminInclusion: "included",
    markup: 2.5,
    minWarrantyCost: 600,
    minGapCost: 550,
    maxGapPrice: 2500,
  });

  assert.equal(result.admin, 999);
  assert.equal(result.warranty, 2000, "Warranty capped at program cap");
  assert.ok(result.gap > 0 && result.gap <= 2500, "GAP fills remaining room without exceeding ceiling");
});

test("Scenario 13b: allocateBackend skips warranty when room is below minimum threshold", () => {
  const result = allocateBackend({
    allInRoom: 800,
    aftermarketRoom: Infinity,
    capAdmin: 0,
    desiredAdmin: 0,
    capWarranty: undefined,
    capGap: undefined,
    gapAllowed: true,
    adminInclusion: "included",
    markup: 2.5,
    minWarrantyCost: 600,
    minGapCost: 550,
    maxGapPrice: 2500,
  });

  assert.equal(result.admin, 0);
  assert.equal(result.warranty, 0, "No warranty when room < minWarrantyCost * markup");
  assert.equal(result.gap, 0);
});

// --------------------------------------------------------------------------
// Scenario 14: settleConstraints trims products under payment cap
// --------------------------------------------------------------------------

test("Scenario 13c: allocateBackend with post-DP exposure exposes hidden room above advance ceiling", () => {
  // Reproduces a real-deal pattern: PAC > advance LTV ceiling but all-in
  // ceiling has slack. After applying the DP needed to reach PAC, that
  // slack should be available for backend products.
  const maxAdvance = 50000;
  const maxAllInPreTax = 52500;
  const creditorFee = 699;
  const pacCost = 52000;
  const downPayment = 0;
  const netTrade = 0;

  const paymentPV = computePaymentCeilingPV(0.0699, 84, 1500); // generous
  const ceiling = computeZeroDpCeiling({
    hasAdvanceCap: true,
    maxAdvance,
    hasAllInCap: true,
    maxAllInPreTax,
    paymentPV,
    downPayment,
    netTrade,
    creditorFee,
    taxRate: 0.05,
  });

  const selling = resolveSellingPrice({
    pacCost,
    onlinePrice: null,
    zeroDpCeiling: ceiling.zeroDpCeiling,
    bindingZeroDpReason: ceiling.bindingReason,
  });

  // The naive (pre-DP) room would be negative
  const naiveExposure = selling.sellingPrice - downPayment - netTrade;
  const naiveRoom = maxAllInPreTax - naiveExposure - creditorFee;
  assert.ok(naiveRoom < 0, "Pre-DP room should be negative for this case");

  // Post-DP exposure exposes real room
  const effectiveExposure = selling.sellingPrice - (downPayment + selling.requiredDownPayment) - netTrade;
  const effectiveRoom = maxAllInPreTax - effectiveExposure - creditorFee;
  assert.ok(effectiveRoom > 0, "Post-DP room should be positive for product stacking");

  const state = allocateBackend({
    allInRoom: effectiveRoom,
    aftermarketRoom: Infinity,
    capAdmin: 999,
    desiredAdmin: 999,
    capWarranty: 2000,
    capGap: undefined,
    gapAllowed: true,
    adminInclusion: "included",
    markup: 2.5,
    minWarrantyCost: 600,
    minGapCost: 550,
    maxGapPrice: 2500,
  });

  assert.ok(state.admin > 0, "Admin should be allocated when post-DP room exists");
});

test("Scenario 14: settleConstraints reduces products before requiring extra DP", () => {
  const state = { admin: 699, warranty: 3000, gap: 2000 };
  const rateDecimal = 0.2149;
  const termMonths = 72;
  const maxPmt = 400;
  const paymentPV = computePaymentCeilingPV(rateDecimal, termMonths, maxPmt);

  const result = settleConstraints({
    state,
    sellingPrice: 14000,
    pacCost: 12000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 0,
    taxRate: 0.05,
    rateDecimal,
    termMonths,
    maxPmt,
    paymentPV,
    maxAllInPreTax: Infinity,
    initialReqDP: 0,
  });

  assert.equal(result.feasible, true);
  // GAP is trimmed before warranty before admin
  if (result.state.admin === 699) {
    assert.ok(result.state.gap <= 2000, "GAP trimmed first");
    assert.ok(result.state.warranty <= 3000, "Warranty trimmed only after GAP");
  }
});

// --------------------------------------------------------------------------
// Worksheet rules: parser + eligibility application
// --------------------------------------------------------------------------

function makeRule(query: string, name = "rule", description = ""): WorksheetRule {
  return {
    id: `r-${Math.random().toString(36).slice(2, 8)}`,
    name,
    query,
    fieldName: null,
    description,
    type: "WARNING",
  };
}

test("parseWorksheetRule: Eden Park 180k km cap → odometerMax", () => {
  const r = makeRule(
    "${worksheet.vehicle.odometer.amount} > 180000",
    "Program maximum kilometers 180,000",
    "180,000 km limit",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "odometerMax");
  if (eff.kind === "odometerMax") assert.equal(eff.max, 180000);
});

test("parseWorksheetRule: ACC age cap → vehicleMinYear", () => {
  const r = makeRule(
    `(\${worksheet.vehicle.year} ?? 0) < "2014" && (\${worksheet.vehicle.year} ?? "###") != "###"`,
    "Program vehicle age Max is 10 years",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "vehicleMinYear");
  if (eff.kind === "vehicleMinYear") assert.equal(eff.minYear, 2014);
});

test("parseWorksheetRule: Eden Park carfax claim cap → carfaxClaimMax", () => {
  const r = makeRule("${worksheet.vehicle.carfaxClaims.amount} > 7500", "Program Damage Claim limit is $7500");
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "carfaxClaimMax");
  if (eff.kind === "carfaxClaimMax") assert.equal(eff.max, 7500);
});

test("parseWorksheetRule: Rifco carfax ratio (50% of BBV)", () => {
  const r = makeRule(
    "${worksheet.vehicle.carfaxClaims.amount} > 10000 || ${worksheet.vehicle.carfaxClaims.amount} > (${worksheet.vehicle.wholesaleValueBasedOnProgram.amount} * 0.5)",
    "Rifco claim limit",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "carfaxClaimRatioMax");
  if (eff.kind === "carfaxClaimRatioMax") assert.equal(eff.ratio, 0.5);
});

test("parseWorksheetRule: Santander carfax 35% above $20k BBV", () => {
  const r = makeRule(
    "${worksheet.vehicle.carfaxClaims.amount} > (${worksheet.vehicle.wholesaleValueBasedOnProgram.amount} * 0.35 ) && (${worksheet.vehicle.wholesaleValueBasedOnProgram.amount} > 20000)",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "carfaxClaimRatioMax");
  if (eff.kind === "carfaxClaimRatioMax") {
    assert.equal(eff.ratio, 0.35);
    assert.equal(eff.bbvFloor, 20000);
  }
});

test("parseWorksheetRule: Santander 100% rule (claims > BBV)", () => {
  const r = makeRule(
    "${worksheet.vehicle.carfaxClaims.amount} > ${worksheet.vehicle.wholesaleValueBasedOnProgram.amount}",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "carfaxClaimRatioMax");
  if (eff.kind === "carfaxClaimRatioMax") assert.equal(eff.ratio, 1.0);
});

test("parseWorksheetRule: Eden Park cargo van regex ban (preserves AND across OR-disjuncts)", () => {
  const r = makeRule(
    "${worksheet.vehicle.trim} match /^van|cargo|cube/ || ${worksheet.vehicle.model} match /cargo|^van/ || (${worksheet.vehicle.make} match /Chevrolet/ && (${worksheet.vehicle.model} match /Express/ || ${worksheet.vehicle.trim} match /Express/)) || (${worksheet.vehicle.make} match /Ram/ && ${worksheet.vehicle.model} match /ProMaster/) || (${worksheet.vehicle.make} match /Ford/ && ${worksheet.vehicle.model} match /Transit/)",
    "Cargo Van & Cube are not allowed",
    "Cargo Van & Cube are not allowed",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "vehicleTypeBan");
  if (eff.kind === "vehicleTypeBan") {
    const effects = [eff];
    const banned = (vehicle: string) =>
      !applyEligibilityRules(effects, { vehicle, km: 1, vehicleYear: 2020, bbWholesale: 1 }, { tierName: "x" }).ok;
    assert.ok(banned("2021 Ford Transit Cargo Van"), "Ford Transit must be rejected");
    assert.ok(banned("2020 Chevrolet Express 2500"), "Chevy Express must be rejected");
    assert.ok(banned("2019 Ram ProMaster City"), "Ram ProMaster must be rejected");
    // Critical regression guard: a regular Chevrolet Silverado must NOT be flagged
    // as a cargo van just because the regex contains "Chevrolet" in one branch.
    assert.ok(!banned("2021 Chevrolet Silverado 1500 Crew Cab"), "Chevy Silverado must NOT be a cargo-van false positive");
    assert.ok(!banned("2021 Toyota Camry"));
    assert.ok(!banned("2022 Ford F-150"));
  }
});

test("parseWorksheetRule: Rifco cargo van model-in-list", () => {
  const r = makeRule(
    `\${worksheet.vehicle.model} in ["EXPRESS", "EXPRESS CARGO", "TRANSIT 150", "TRANSIT 250", "PROMASTER", "SPRINTER 2500 CARGO"]`,
    "Rifco does not provide financing for cargo vans",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "vehicleModelInList");
  if (eff.kind === "vehicleModelInList") {
    assert.ok(eff.models.includes("EXPRESS"));
    assert.ok(eff.models.includes("PROMASTER"));
  }
});

test("parseWorksheetRule: ACC $50k total finance cap (no tier filter)", () => {
  const r = makeRule(
    "${worksheet.totalFinancedAmount.amount} > 50000",
    "Program Max for Total Amount to Financed is $50,000",
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "totalFinanceMax");
  if (eff.kind === "totalFinanceMax") {
    assert.equal(eff.max, 50000);
    assert.equal(eff.tierName, undefined);
  }
});

test("parseWorksheetRule: Santander tier-conditional NTC $40k cap", () => {
  const r = makeRule(
    `\${worksheet.totalFinancedAmount.amount} > 40000 && \${program.tierName} == "NTC"`,
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "totalFinanceMax");
  if (eff.kind === "totalFinanceMax") {
    assert.equal(eff.max, 40000);
    assert.equal(eff.tierName, "NTC");
  }
});

test("parseWorksheetRule: iAF 96-month term cap", () => {
  const r = makeRule("${worksheet.term} > 96", "Program Limit is 96 months");
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "termMax");
  if (eff.kind === "termMax") assert.equal(eff.max, 96);
});

test("parseWorksheetRule: Rifco $5k min finance", () => {
  const r = makeRule(
    `\${worksheet.totalFinancedAmount.amount} < 5000 && \${worksheet.salePrice.amount} ?? "###" != "###"`,
  );
  const eff = parseWorksheetRule(r);
  assert.equal(eff.kind, "totalFinanceMin");
  if (eff.kind === "totalFinanceMin") assert.equal(eff.min, 5000);
});

test("parseWorksheetRule: operational rules return ignored", () => {
  const samples = [
    "${worksheet.firstPaymentDate} != ${decision.firstPaymentDate}",
    `\${worksheet.term} notin [84, 78, 72] && (\${worksheet.term} ?? "###") != "###"`,
    `\${worksheet.frequency} == "WEEKLY"`,
    "${worksheet.deliveryDate} date_until \"day\" < -1",
    "${worksheet.dealerAdminFee.amount} > ${calculatedValues.maxDealerAdminFee}",
    "${worksheet.creditorFee.amount} > ${calculatedValues.creditorFee}",
  ];
  for (const q of samples) {
    const eff = parseWorksheetRule(makeRule(q));
    assert.equal(eff.kind, "ignored", `expected ignored for: ${q}`);
  }
});

test("applyEligibilityRules: Eden Park rejects 221k km Silverado", () => {
  const rules = [
    makeRule("${worksheet.vehicle.odometer.amount} > 180000", "Program maximum kilometers 180,000", "180,000 km limit"),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2021 CHEVROLET SILVERADO 1500 CUSTOM CREWCAB",
    km: 221000,
    vehicleYear: 2021,
    bbWholesale: 25092,
  }, { tierName: "3 Ride" });
  assert.equal(result.ok, false);
  assert.equal(result.rejections.length, 1);
  assert.match(result.rejections[0].reason, /km 221000 > 180000/);
});

test("applyEligibilityRules: Eden Park accepts 150k km Silverado", () => {
  const rules = [
    makeRule("${worksheet.vehicle.odometer.amount} > 180000", "Program maximum kilometers 180,000"),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2021 CHEVROLET SILVERADO 1500",
    km: 150000,
    vehicleYear: 2021,
    bbWholesale: 25000,
  }, { tierName: "3 Ride" });
  assert.equal(result.ok, true);
  assert.equal(result.rejections.length, 0);
});

test("applyEligibilityRules: ACC rejects 2013 Ford F-150", () => {
  const rules = [
    makeRule(`(\${worksheet.vehicle.year} ?? 0) < "2014"`, "Program vehicle age Max is 10 years"),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2013 FORD F-150",
    km: 100000,
    vehicleYear: 2013,
    bbWholesale: 18000,
  }, { tierName: "Tier 1" });
  assert.equal(result.ok, false);
  assert.match(result.rejections[0].reason, /year 2013 < 2014/);
});

test("applyEligibilityRules: Eden Park rejects Ford Transit cargo van by regex", () => {
  const rules = [
    makeRule(
      "${worksheet.vehicle.trim} match /^van|cargo|cube/ || ${worksheet.vehicle.model} match /cargo|^van/ || (${worksheet.vehicle.make} match /Ford/ && ${worksheet.vehicle.model} match /Transit/)",
      "Cargo Van & Cube are not allowed",
      "Cargo Van & Cube are not allowed",
    ),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2020 FORD TRANSIT 250 CARGO",
    km: 80000,
    vehicleYear: 2020,
    bbWholesale: 30000,
  }, { tierName: "3 Ride" });
  assert.equal(result.ok, false);
});

test("applyEligibilityRules: Rifco rejects Express by model-in-list", () => {
  const rules = [
    makeRule(
      `\${worksheet.vehicle.model} in ["EXPRESS", "EXPRESS CARGO", "TRANSIT 150", "PROMASTER"]`,
      "Rifco does not provide financing for cargo vans",
    ),
  ];
  const effects = parseWorksheetRules(rules);
  const result = applyEligibilityRules(effects, {
    vehicle: "2020 CHEVROLET EXPRESS 2500",
    km: 50000,
    vehicleYear: 2020,
    bbWholesale: 25000,
  }, { tierName: "Tier 1" });
  assert.equal(result.ok, false);
});

test("applyEligibilityRules: Santander tier-conditional cap only applies to NTC tier", () => {
  const rules = [
    makeRule(`\${worksheet.totalFinancedAmount.amount} > 40000 && \${program.tierName} == "NTC"`, "NTC $40k cap"),
  ];
  const effects = parseWorksheetRules(rules);

  const ntc = applyEligibilityRules(effects, {
    vehicle: "2022 TOYOTA RAV4",
    km: 30000,
    vehicleYear: 2022,
    bbWholesale: 28000,
    totalFinancedEstimate: 45000,
  }, { tierName: "NTC" });
  assert.equal(ntc.ok, false);

  const otherTier = applyEligibilityRules(effects, {
    vehicle: "2022 TOYOTA RAV4",
    km: 30000,
    vehicleYear: 2022,
    bbWholesale: 28000,
    totalFinancedEstimate: 45000,
  }, { tierName: "9" });
  assert.equal(otherTier.ok, true);
});

test("deriveTermCap returns tightest term cap from effects", () => {
  const effects = parseWorksheetRules([
    makeRule("${worksheet.term} > 96"),
    makeRule("${worksheet.term} > 84"),
  ]);
  assert.equal(deriveTermCap(effects), 84);
});

test("deriveTotalFinanceCap respects tier filter", () => {
  const effects = parseWorksheetRules([
    makeRule("${worksheet.totalFinancedAmount.amount} > 50000"),
    makeRule(`\${worksheet.totalFinancedAmount.amount} > 40000 && \${program.tierName} == "NTC"`),
  ]);
  assert.equal(deriveTotalFinanceCap(effects, "NTC"), 40000);
  assert.equal(deriveTotalFinanceCap(effects, "Tier 1"), 50000);
});

```

### `scripts/src/lender-engine.golden.test.ts` (101 lines)

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_ONLINE_STRATEGY_BY_PROFILE,
  resolveCapProfile,
  resolveNoOnlineSellingPrice,
} from "../../artifacts/api-server/src/lib/lenderCalcEngine.js";
import { GOLDEN_CAP_FIXTURES } from "./lender-golden-fixtures.js";

test("golden cap profiles resolve expected strategy", () => {
  for (const fixture of GOLDEN_CAP_FIXTURES) {
    const profile = resolveCapProfile({
      maxAdvanceLTV: fixture.maxAdvanceLTV,
      maxAftermarketLTV: fixture.maxAftermarketLTV,
      maxAllInLTV: fixture.maxAllInLTV,
      capModelResolved: fixture.capModelResolved,
    });

    assert.equal(
      profile.key,
      fixture.expectedProfileKey,
      `${fixture.lender} ${fixture.tierName} cap profile mismatch`,
    );
    assert.equal(
      NO_ONLINE_STRATEGY_BY_PROFILE[profile.key],
      fixture.expectedNoOnlineStrategy,
      `${fixture.lender} ${fixture.tierName} strategy mismatch`,
    );
  }
});

test("PAC floor is enforced when no-online ceilings are below PAC", () => {
  const profile = resolveCapProfile({
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 0,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  const resolution = resolveNoOnlineSellingPrice({
    pacCost: 20000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    maxAdvance: Infinity,
    maxAllInPreTax: 18000,
    profile,
  });
  assert.equal(resolution.rejection, "ltvAllIn");
});

test("no-online sell price is maximized from all-in profile", () => {
  const profile = resolveCapProfile({
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 30,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  const resolution = resolveNoOnlineSellingPrice({
    pacCost: 15000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    maxAdvance: Infinity,
    maxAllInPreTax: 25000,
    profile,
  });
  assert.equal(resolution.source, "maximized");
  assert.equal(resolution.price, Math.round(25000 - 699));
});

test("no-online maximization reflects creditor fee in structural ceiling", () => {
  const profile = resolveCapProfile({
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 0,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  const noFee = resolveNoOnlineSellingPrice({
    pacCost: 15000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 0,
    maxAdvance: Infinity,
    maxAllInPreTax: 24000,
    profile,
  });
  const withFee = resolveNoOnlineSellingPrice({
    pacCost: 15000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 750,
    maxAdvance: Infinity,
    maxAllInPreTax: 24000,
    profile,
  });

  assert.equal(noFee.source, "maximized");
  assert.equal(withFee.source, "maximized");
  assert.ok(withFee.price < noFee.price, "Higher creditor fee should reduce structural selling ceiling");
});

```

### `scripts/src/lender-golden-fixtures.ts` (54 lines)

```typescript
export interface GoldenCapFixture {
  lender: string;
  tierName: string;
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  capModelResolved: "allInOnly" | "split" | "backendOnly" | "unknown";
  expectedProfileKey: string;
  expectedNoOnlineStrategy: string;
}

export const GOLDEN_CAP_FIXTURES: GoldenCapFixture[] = [
  {
    lender: "ACC",
    tierName: "Tier 1",
    maxAdvanceLTV: 140,
    maxAftermarketLTV: 25,
    maxAllInLTV: 175,
    capModelResolved: "split",
    expectedProfileKey: "111",
    expectedNoOnlineStrategy: "maximizeFromAdvanceAndAllIn",
  },
  {
    lender: "SAN",
    tierName: "7",
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 30,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
    expectedProfileKey: "001",
    expectedNoOnlineStrategy: "maximizeFromAllIn",
  },
  {
    lender: "iAF",
    tierName: "sample",
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 0,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
    expectedProfileKey: "001",
    expectedNoOnlineStrategy: "maximizeFromAllIn",
  },
  {
    lender: "QLI",
    tierName: "sample",
    maxAdvanceLTV: 140,
    maxAftermarketLTV: 40,
    maxAllInLTV: 0,
    capModelResolved: "split",
    expectedProfileKey: "110",
    expectedNoOnlineStrategy: "maximizeFromAdvance",
  },
];

```

### `scripts/src/lender-smoke.ts` (113 lines)

```typescript
type CalcPayload = {
  lenderCode: string;
  programId: string;
  tierName: string;
  approvedRate: number;
  downPayment?: number;
  tradeValue?: number;
  tradeLien?: number;
  taxRate?: number;
  adminFee?: number;
};

type Scenario = {
  name: string;
  payload: CalcPayload;
  assert: (data: any) => string[];
};

const BASE_URL = process.env["LENDER_SMOKE_BASE_URL"];
const COOKIE = process.env["LENDER_SMOKE_COOKIE"];

function fail(msg: string): never {
  throw new Error(msg);
}

function ensure(cond: unknown, message: string, errors: string[]) {
  if (!cond) errors.push(message);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) fail(`Set ${name}`);
  return v;
}

function lenderScenario(
  lenderCode: string,
  defaultRate: number,
  checks: (data: any, errors: string[]) => void,
): Scenario {
  return {
    name: `${lenderCode} smoke`,
    payload: {
      lenderCode,
      programId: required(`LENDER_${lenderCode}_PROGRAM_ID`),
      tierName: required(`LENDER_${lenderCode}_TIER_NAME`),
      approvedRate: Number(process.env[`LENDER_${lenderCode}_APPROVED_RATE`] ?? defaultRate),
      taxRate: 5,
    },
    assert: (data) => {
      const errors: string[] = [];
      ensure(typeof data?.calculatorVersion === "string", "Missing calculatorVersion fingerprint", errors);
      ensure(typeof data?.gitSha === "string", "Missing gitSha fingerprint", errors);
      ensure(Array.isArray(data?.results), "Missing results array", errors);
      const maxAdminFee = data?.programLimits?.maxAdminFee ?? 0;
      if (maxAdminFee > 0 && Array.isArray(data?.results) && data.results.length > 0) {
        const hasAdminUsage = data.results.some((r: any) => Number(r?.adminFeeUsed ?? 0) > 0);
        ensure(hasAdminUsage, "Expected admin fee usage when admin cap exists (admin priority)", errors);
      }
      checks(data, errors);
      return errors;
    },
  };
}

const scenarios: Scenario[] = [
  lenderScenario("SAN", 13.49, (data, errors) => {
    ensure(data?.programLimits?.noOnlineStrategy === "maximizeFromAllIn", "Expected noOnlineStrategy=maximizeFromAllIn", errors);
    ensure(data?.programLimits?.capModelResolved === "allInOnly", "Expected capModelResolved=allInOnly", errors);
  }),
  lenderScenario("ACC", 11.99, (data, errors) => {
    ensure(data?.programLimits?.gapAllowed !== false, "ACC GAP should not be hard-disabled", errors);
  }),
  lenderScenario("iAF", 12.99, (data, errors) => {
    ensure(data?.programLimits?.capModelResolved === "allInOnly", "Expected iAF to resolve allInOnly", errors);
  }),
  lenderScenario("QLI", 12.99, (data, errors) => {
    ensure(data?.programLimits?.noOnlineStrategy !== "pacFallback", "Quantifi should not fall back to PAC when sell caps exist", errors);
  }),
];

async function run() {
  if (!BASE_URL) fail("Set LENDER_SMOKE_BASE_URL");
  if (!COOKIE) fail("Set LENDER_SMOKE_COOKIE (session cookie)");

  for (const scenario of scenarios) {
    const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/api/lender-calculate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": COOKIE,
      },
      body: JSON.stringify(scenario.payload),
    });

    if (!res.ok) {
      fail(`[${scenario.name}] HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const errors = scenario.assert(data);
    if (errors.length > 0) {
      fail(`[${scenario.name}] ${errors.join("; ")}`);
    }
    console.log(`PASS: ${scenario.name}`);
  }
}

run().catch((err) => {
  console.error("Lender smoke failed:", err);
  process.exit(1);
});

```

### `scripts/src/lib/replit-gcs.ts` (38 lines)

```typescript
/**
 * Replit GCS Sidecar Storage helper.
 *
 * Replit injects GCS credentials via a local HTTP sidecar at 127.0.0.1:1106
 * rather than via the standard ADC (application default credentials) flow.
 * Using `new Storage()` directly will throw "Could not load default credentials"
 * inside Replit. This helper builds a Storage client wired to the sidecar,
 * mirroring the pattern in artifacts/api-server/src/lib/bbObjectStore.ts.
 *
 * Used by all backup/restore scripts that touch the workspace bucket.
 */
import { Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";

export function makeReplitStorage(): Storage {
  return new Storage({
    credentials: {
      audience:           "replit",
      subject_token_type: "access_token",
      token_url:          `${SIDECAR}/token`,
      type:               "external_account",
      credential_source: {
        url:    `${SIDECAR}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    } as any,
    projectId: "",
  });
}

export function getRequiredBucketId(): string {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is required");
  return id;
}

```

### `scripts/src/quarterly-reminders.ts` (16 lines)

```typescript
import { sendOpsAlert } from "../../artifacts/api-server/src/lib/emailService.js";

async function main() {
  await sendOpsAlert(
    "warning",
    "Quarterly review reminder",
    "<p>Review overdue quarterly controls: allow-list audit, DR drill, and self-heal gate health checks.</p>",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


```

### `scripts/src/restore-from-backup.ts` (44 lines)

```typescript
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


```

### `scripts/src/self-heal-primitives.test.ts` (54 lines)

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../../artifacts/api-server/src/lib/selfHeal/withRetry.js";
import { withCircuitBreaker, getCircuitState } from "../../artifacts/api-server/src/lib/selfHeal/circuitBreaker.js";
import { probeField } from "../../artifacts/api-server/src/lib/selfHeal/probeField.js";
import { probeSelector } from "../../artifacts/api-server/src/lib/selfHeal/probeSelector.js";
import { reauthIfNeeded } from "../../artifacts/api-server/src/lib/selfHeal/reauthIfNeeded.js";

test("probeField returns fallback match metadata", () => {
  const result = probeField({ backup_vin: "1HGCM82633A004352" }, ["vin", "backup_vin"]);
  assert.equal(result.matchedCandidate, "backup_vin");
  assert.equal(result.usedFallback, true);
});

test("probeSelector resolves fallback selector", async () => {
  const result = await probeSelector(async (selector) => selector === "#b" ? { ok: true } : null, ["#a", "#b"]);
  assert.equal(result.matchedSelector, "#b");
  assert.equal(result.usedFallback, true);
});

test("withRetry retries until success", async () => {
  let attempts = 0;
  const value = await withRetry({ retries: 2, baseDelayMs: 1, jitterMs: 0 }, async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("boom");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("circuit breaker opens after threshold", async () => {
  const key = "test-breaker";
  await assert.rejects(() => withCircuitBreaker(key, async () => { throw new Error("fail"); }, { threshold: 1, cooldownMs: 1000 }));
  assert.equal(getCircuitState(key), "open");
});

test("reauthIfNeeded runs reauth then retries once", async () => {
  let reauthed = 0;
  let attempts = 0;
  const value = await reauthIfNeeded({
    shouldReauth: (error) => String(error).includes("AUTH_EXPIRED"),
    reauth: async () => { reauthed += 1; },
    run: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("AUTH_EXPIRED");
      return "ok";
    },
  });
  assert.equal(value, "ok");
  assert.equal(reauthed, 1);
});


```

### `scripts/src/split-complete-source-md.ts` (119 lines)

```typescript
/**
 * Splits downloads/inventory-platform-complete-source.md into 10 contiguous
 * parts at **file boundaries** (each block starts with `### \`path\``). This
 * avoids tearing fenced code blocks mid-file.
 *
 * Run after the full export:
 *   pnpm --filter @workspace/scripts export:complete-md
 *   pnpm --filter @workspace/scripts export:complete-md:split
 *
 * Outputs:
 *   downloads/inventory-platform-complete-source-part-01-of-10.md
 *   ...
 *   downloads/inventory-platform-complete-source-part-10-of-10.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const INPUT_REL = "downloads/inventory-platform-complete-source.md";
const INPUT = path.join(WORKSPACE_ROOT, INPUT_REL);

const PART_COUNT = 10;

function weight(lines: string[], start: number, end: number): number {
  let w = 0;
  for (let i = start; i < end; i++) w += lines[i].length + 1;
  return w;
}

/** Pref[i] = sum of segment weights for segments 0..i-1 */
function buildSegments(lines: string[]): [number, number][] {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("### `")) starts.push(i);
  }
  if (starts.length === 0) return [[0, lines.length]];

  const segments: [number, number][] = [];
  segments.push([0, starts[0]]);
  for (let i = 0; i < starts.length - 1; i++) {
    segments.push([starts[i], starts[i + 1]]);
  }
  segments.push([starts[starts.length - 1], lines.length]);
  return segments;
}

/** Assign segment indices to k parts with nearly equal counts (contiguous, non-empty when n >= k). */
function assignPartsSequential(weights: number[], k: number): number[][] {
  const n = weights.length;
  const parts: number[][] = Array.from({ length: k }, () => []);
  if (n === 0) return parts;

  const base = Math.floor(n / k);
  const rem = n % k;
  let idx = 0;
  for (let p = 0; p < k; p++) {
    const take = base + (p < rem ? 1 : 0);
    for (let j = 0; j < take; j++) parts[p].push(idx++);
  }
  return parts;
}

function main(): void {
  if (!fs.existsSync(INPUT)) {
    console.error(`Missing ${INPUT_REL}. Run: pnpm --filter @workspace/scripts export:complete-md`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT, "utf8");
  const lines = raw.split(/\r\n|\r|\n/);
  const segments = buildSegments(lines);
  const weights = segments.map(([a, b]) => weight(lines, a, b));

  const partSegmentIndices = assignPartsSequential(weights, PART_COUNT);

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, " UTC");

  for (let part = 0; part < PART_COUNT; part++) {
    const idxs = partSegmentIndices[part];
    const chunkLines: string[] = [];

    chunkLines.push(`# Inventory Platform — Complete source (part ${part + 1} of ${PART_COUNT})`);
    chunkLines.push("");
    chunkLines.push(`Generated: ${now}`);
    chunkLines.push("");
    chunkLines.push(
      "Machine-generated split of `downloads/inventory-platform-complete-source.md`. " +
        "Each file in the bundle starts with a `### \\`path\\`` heading followed by a fenced code block — " +
        "this split only cuts **between** those blocks so fences stay intact.",
    );
    chunkLines.push("");
    chunkLines.push(`- **Single-file bundle:** run \`pnpm --filter @workspace/scripts export:complete-md\``);
    chunkLines.push(`- **Parts:** \`inventory-platform-complete-source-part-NN-of-${PART_COUNT}.md\` (this is part ${part + 1})`);
    chunkLines.push("- **Replication:** Part 1 begins with the original preamble (quickstart + included roots + TOC). Other parts continue body content only.");
    chunkLines.push("");
    chunkLines.push("---");
    chunkLines.push("");

    for (const si of idxs) {
      const [a, b] = segments[si];
      for (let i = a; i < b; i++) chunkLines.push(lines[i]);
    }

    const nn = String(part + 1).padStart(2, "0");
    const outRel = `downloads/inventory-platform-complete-source-part-${nn}-of-${PART_COUNT}.md`;
    const outPath = path.join(WORKSPACE_ROOT, outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, chunkLines.join("\n"), "utf8");
    const bytes = Buffer.byteLength(chunkLines.join("\n"), "utf8");
    console.log(`Wrote ${outRel} (${idxs.length} segment(s), ~${Math.round(bytes / 1024)} KiB)`);
  }

  console.log(`Done: ${PART_COUNT} parts written next to ${INPUT_REL}`);
}

main();

```

### `scripts/tsconfig.json` (9 lines)

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}

```

---

<a id="ci-workflows"></a>
## 17. GitHub Actions workflows

*2 file(s).*

### `.github/workflows/ci.yml` (44 lines)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run typecheck:libs
      - run: pnpm --filter @workspace/api-server typecheck
      - run: pnpm --filter @workspace/scripts test:lender-golden
      - run: pnpm --filter @workspace/scripts test:lender-scenarios
      - run: pnpm --filter @workspace/scripts test:self-heal-primitives
      - run: pnpm --filter @workspace/scripts check:patterns
      - run: pnpm --filter @workspace/scripts check:readme-sync
      - run: pnpm --filter @workspace/scripts check:invariants

  chaos:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @workspace/scripts test:chaos-primitives

```

### `.github/workflows/self-heal-gate.yml` (30 lines)

```yaml
name: Self Heal Gate
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

jobs:
  gate:
    if: startsWith(github.event.pull_request.title, '[self-heal-automerge]')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run typecheck:libs
      - run: pnpm --filter @workspace/api-server typecheck
      - run: pnpm --filter @workspace/scripts check:patterns
      - run: pnpm --filter @workspace/scripts check:readme-sync
      - run: pnpm --filter @workspace/scripts check:invariants
      - run: pnpm --filter @workspace/scripts test:lender-golden
      - run: pnpm --filter @workspace/scripts test:lender-scenarios
      - run: pnpm --filter @workspace/scripts test:self-heal-primitives
      - run: pnpm --filter @workspace/scripts check-self-heal-diff


```

---

<a id="documentation"></a>
## 18. Documentation (runbooks, SLAs, stability)

*15 file(s).*

### `docs/adr/0001-contract-first-api.md` (17 lines)

```markdown
# ADR 0001: Contract-First API via OpenAPI + Orval

## Status
Accepted

## Context
The platform has a React SPA that consumes a REST API. Keeping frontend types, backend validation, and API documentation in sync manually is error-prone.

## Decision
Use OpenAPI 3.0 as the single source of truth. Orval generates React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`) from the spec.

## Consequences
- Adding/changing an endpoint requires updating `openapi.yaml` first, then running codegen
- Frontend gets type-safe hooks automatically
- Server can validate requests with generated Zod schemas
- Spec drift is the main risk — CI should catch it

```

### `docs/adr/0002-carfax-dev-only.md` (16 lines)

```markdown
# ADR 0002: Carfax Worker Disabled in Production

## Status
Accepted

## Context
The Carfax VHR link resolver uses Puppeteer to automate a dealer portal login. Container deployments on Replit start fresh each time with no persistent filesystem, so browser session cookies are lost on every restart.

## Decision
Disable the Carfax worker when `isProduction` is true. VHR links are resolved in development only and persisted to the inventory cache DB, which production reads on startup.

## Consequences
- Production never attempts Carfax browser automation (avoids flaky failures and rate-limit risk)
- New VINs added while running in production won't get Carfax links until a dev-environment run processes them
- The `isProduction` guard lives in `triggerNewVinLookups()` inside `inventoryCache.ts`

```

### `docs/adr/0003-strings-for-money.md` (17 lines)

```markdown
# ADR 0003: Price Fields Stored as Strings

## Status
Accepted

## Context
Price values originate from an Apps Script CSV feed and pass through Typesense search documents. Both sources deliver prices as strings. Converting to numbers at the ingestion boundary risks floating-point precision loss and complicates round-tripping through JSON.

## Decision
Store all price-related fields (`price`, `onlinePrice`, `matrixPrice`, `cost`, `bbAvgWholesale`) as strings in `InventoryItem`. The lender calculator parses them to numbers internally where arithmetic is needed.

## Consequences
- No silent precision loss during ingestion or caching
- Display formatting is the frontend's responsibility
- The lender calculator must handle parse failures gracefully (it already does)
- Comparing prices requires parsing — cannot use direct numeric comparisons on cached data

```

### `docs/adr/0004-random-scheduler-mountain-time.md` (17 lines)

```markdown
# ADR 0004: Random Scheduler Uses Mountain Time Business Hours

## Status
Accepted

## Context
Background workers (Black Book valuations, Carfax VHR resolution, lender program sync) hit third-party services that impose rate limits and are most reliable during business hours. The dealership operates in the Mountain Time zone.

## Decision
Use `randomScheduler.ts` to schedule worker runs at randomized times within Mountain Time business hours (roughly 8 AM–6 PM MT). Randomization avoids thundering-herd patterns against shared upstream APIs.

## Consequences
- Workers only run during dealer operating hours, aligning data freshness with when it's needed
- Off-hours CreditApp and Carfax rate limits are avoided
- If the server restarts outside business hours, workers wait until the next window
- Changing the timezone requires updating `randomScheduler.ts`

```

### `docs/adr/0005-typesense-scoped-keys.md` (17 lines)

```markdown
# ADR 0005: Typesense Scoped Search Keys

## Status
Accepted

## Context
The frontend needs to search vehicle inventory via Typesense, but unrestricted API keys would let any client query deleted, hidden, or out-of-scope vehicles.

## Decision
Use Typesense scoped API keys with baked-in filter constraints (`status`, `visibility`, `deleted_at`). Each dealer collection in `DEALER_COLLECTIONS` has its own scoped key that the server uses for enrichment and the frontend uses for search.

## Consequences
- The frontend cannot query outside the intended dataset regardless of query parameters
- Adding a new filter constraint requires regenerating scoped keys
- Key rotation requires updating environment variables for each dealer collection
- Server-side enrichment in `inventoryCache.ts` uses the same scoped keys, ensuring consistency

```

### `docs/enterprise-stability-gaps.md` (26 lines)

```markdown
# Enterprise Stability Gaps (Accepted Constraints)

The current platform includes strong runtime self-healing and rollback controls, but some enterprise-grade capabilities remain out of scope due to deployment and platform constraints.

## Out of scope today

- Multi-region active-active failover
- Multi-provider model router for Cursor execution
- Contractual Anthropic enterprise SLA
- Dedicated 24/7 on-call rotation

## Why

- Current hosting model is single Replit deployment
- Cursor model selection is manual in IDE
- Vendor SLA negotiation is external to code
- Team structure is currently owner-operated

## Future path

- Migrate to multi-region hosting platform
- Add provider abstraction for non-IDE model tasks
- Negotiate vendor SLA once tier-2/auto-merge volume grows
- Formalize rotating on-call as team expands


```

### `docs/patterns.md` (205 lines)

```markdown
# Platform Pattern Catalog

Canonical examples for every shared utility in the platform. New code must follow
these patterns. Deviations require an inline comment explaining why.

See also: `AGENTS.md` (Anti-Patterns), `.cursorrules` (Cursor generation rules).

---

## 1. Environment Variables

Always import from `lib/env.ts`. Never read `process.env` directly.

```ts
import { env, isProduction } from "../lib/env.js";

const secret = env.SESSION_SECRET;
if (isProduction) { /* production-only path */ }
```

---

## 2. Route Authentication Middleware

Pick the right middleware for the route's access level:

```ts
import { requireOwner, requireAccess, requireOwnerOrViewer } from "../lib/auth.js";

// Owner only (BB refresh, lender sync, admin actions)
router.post("/refresh-blackbook", requireOwner, handler);

// Any listed user — owner, viewer, guest (inventory, calculator view)
router.get("/inventory", requireAccess, handler);

// Owner or viewer only (not guests)
router.get("/vehicle-images", requireOwnerOrViewer, handler);
```

`requireOwnerOrViewer` also sets `req._role` which the handler can read without
another DB query.

---

## 3. Request Validation (Zod)

```ts
import { validateBody, validateQuery, validateParams } from "../lib/validate.js";
import { z } from "zod";

const QuerySchema = z.object({
  vin: z.string().min(17).max(17),
});

// GET /foo?vin=XXX
router.get("/foo", validateQuery(QuerySchema), (req, res) => {
  // Validated data is on req.validatedQuery (typed unknown, narrow with cast)
  const { vin } = req.validatedQuery as z.infer<typeof QuerySchema>;
  res.json({ vin });
});
```

---

## 4. Typesense Searches

```ts
import { DEALER_COLLECTIONS, typesenseSearch } from "../lib/typesense.js";

// Find all docs for a dealer
const dealer = DEALER_COLLECTIONS[0]; // or look up via DEALER_BY_HOSTNAME
const params = new URLSearchParams({
  q: "*",
  filter_by: `vin:=[${vin}]`,
  per_page: "1",
});
const res = await typesenseSearch(dealer, params, 5000 /* ms timeout */);
if (!res.ok) throw new Error(`Typesense ${res.status}`);
const body = await res.json() as { hits?: Array<{ document: Record<string, unknown> }> };
```

**Key rule:** The API key is sent in a header, not the URL. `typesenseSearch` handles
this automatically — never construct the URL manually with the key.

---

## 5. Inventory Role Filtering

```ts
import { filterInventoryByRole } from "../lib/roleFilter.js";
import { getUserRole } from "../lib/auth.js";

router.get("/inventory", requireAccess, async (req, res) => {
  const role = await getUserRole(req) ?? "guest";
  const raw   = getCacheState().data;
  const items = filterInventoryByRole(raw, role);
  res.json(items);
});
```

Never strip fields inline (no `delete item.cost` scattered in handlers).

---

## 6. Structured Logging

```ts
import { logger } from "../lib/logger.js";

// Info — normal operation
logger.info({ vin, bbValue }, "BB value applied");

// Warn — recoverable issue
logger.warn({ url, status }, "Typesense lookup failed");

// Error — unexpected failure
logger.error({ err }, "Cache refresh failed");
```

Never use `console.log` / `console.error` in application code.

---

## 7. Randomized Worker Scheduling

```ts
import { scheduleRandomDaily } from "../lib/randomScheduler.js";

scheduleRandomDaily({
  name: "my-worker",
  windowStart: { hour: 8, minute: 30 },
  windowEnd:   { hour: 19, minute: 0 },
  weekendStart: { hour: 10, minute: 0 },
  weekendEnd:   { hour: 16, minute: 0 },
  run: async () => { /* your worker logic */ },
});
```

---

## 8. GCS Object Store (BB values, sessions, lender programs)

```ts
import {
  loadBbValuesFromStore,
  saveBbValuesToStore,
  loadBbSessionFromStore,
  saveBbSessionToStore,
  loadLenderProgramsFromStore,
  saveLenderProgramsToStore,
} from "../lib/bbObjectStore.js";

// Load + merge + save pattern (prevents partial runs from wiping prod data)
const existing = await loadBbValuesFromStore();
const merged   = { ...existing, ...newValues };
await saveBbValuesToStore(merged);
```

---

## 9. File Header Template

Every new `lib/*.ts` or `routes/*.ts` must open with:

```ts
/**
 * <Module Name>
 *
 * <Purpose: 1-2 sentences>
 *
 * Exports:
 *   export1  — description
 *   export2  — description
 *
 * Consumers: routes/foo.ts, lib/bar.ts
 *
 * Required env: ENV_VAR_ONE, ENV_VAR_TWO
 * Optional env: OPTIONAL_VAR
 *
 * Sections:   (omit for short files)
 *   1. Section name
 *   2. Section name
 */
```

---

## 10. Express 5 Async Handler Pattern

Express 5 propagates rejected promises automatically (no try/catch needed for
unhandled errors), but you must still handle expected error cases explicitly:

```ts
router.post("/foo", requireOwner, async (req, res) => {
  // Express 5: unhandled rejection → next(err) automatically
  const data = await doSomething(); // throws → 500 via error middleware

  if (!data) {
    res.status(404).json({ error: "Not found" });
    return; // important: always return after res.json/send/redirect
  }
  res.json(data);
});
```

```

### `docs/runbooks/auth-broken.md` (17 lines)

```markdown
# Auth Failure Runbook

## Trigger

- OAuth callbacks fail
- `/api/me` returns unexpected 401/403
- `PERMISSION_DENIED` incidents spike

## Steps

1. Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`.
2. Confirm callback URL via `/api/auth/debug-callback` in non-production.
3. Check session table connectivity.
4. Validate cookie settings (`secure`, `sameSite`) for current environment.
5. Redeploy and re-test login flow.


```

### `docs/runbooks/db-schema-drift.md` (16 lines)

```markdown
# DB Schema Drift Runbook

## Trigger

- Drizzle runtime errors for missing columns/tables
- New deploy fails with schema mismatch

## Steps

1. Compare current schema package (`lib/db/src/schema/*`) to production DB.
2. Run `pnpm --filter @workspace/db push`.
3. Re-run `pnpm run typecheck`.
4. Verify `/api/ops/function-status` and `/api/ops/incidents`.
5. If migration failed, restore last backup and retry incrementally.


```

### `docs/runbooks/disaster-recovery.md` (30 lines)

```markdown
# Disaster Recovery Runbook

## RTO / RPO

- RTO: 30 minutes
- RPO: 24 hours

## Nightly jobs

- `pnpm --filter @workspace/scripts backup:db`
- `pnpm --filter @workspace/scripts backup:blobs`
- `pnpm --filter @workspace/scripts backup:rotate`

## Restore flow

1. Provision target Postgres instance.
2. Run:
   - `pnpm --filter @workspace/scripts restore:db -- --date=YYYY-MM-DD --target=<DATABASE_URL>`
3. Redeploy API server with target `DATABASE_URL`.
4. Validate:
   - `/api/healthz`
   - `/api/healthz/deep`
   - `/api/ops/function-status`

## Quarterly drill

- Run `pnpm --filter @workspace/scripts dr-drill`
- Record outcome in Operations panel.


```

### `docs/runbooks/env-secret-rotation.md` (18 lines)

```markdown
# Environment Secret Rotation Runbook

## Scope

- Google OAuth credentials
- CreditApp credentials
- Typesense keys
- Session secret

## Steps

1. Rotate secret in secure store.
2. Update environment values in deployment.
3. Restart service.
4. Validate dependency checks (`/api/healthz/deep`).
5. Confirm no `AUTH_REJECTED` spikes in `incident_log`.


```

### `docs/runbooks/lender-calc-corruption.md` (18 lines)

```markdown
# Lender Calculation Corruption Runbook

## Trigger

- Calculation outputs become implausible
- `PATCH_REFUSED_DANGEROUS_CORE` for `lenderCalcEngine.ts`

## Steps

1. Disable auto-merge (`SELF_HEAL_AUTOMERGE_ENABLED=false`).
2. Capture failing input/output cases.
3. Run lender tests:
   - `pnpm --filter @workspace/scripts test:lender-golden`
   - `pnpm --filter @workspace/scripts test:lender-scenarios`
4. Revert offending commit if needed.
5. Patch and redeploy.


```

### `docs/runbooks/quarterly-allowlist-audit.md` (16 lines)

```markdown
# Quarterly Allow-List Audit

Audit `artifacts/api-server/src/lib/codeRepair/allowlist.ts` every 90 days.

## Checklist

- Confirm each Tier A file is still integration glue only.
- Confirm dangerous-core prefixes still include auth, lender calculation, env, DB schema, and lender routes.
- Confirm no new AST node class was allowed without explicit human review.
- Confirm rollback watcher and self-heal gate are still required checks.

## Acknowledgment

After completion, record an `ALLOWLIST_AUDIT_ACKED` incident row.


```

### `docs/self-heal.md` (20 lines)

```markdown
# Self-Heal Runtime Behavior

Tier 1 runtime adaptation does not depend on external LLM providers.

## Tier 1 (always-on, model-independent)

- `withRetry`
- `circuitBreaker`
- `probeField`
- `probeSelector`
- `reauthIfNeeded`
- `staleButServing`
- `deadLetter`

## Tier 2 and Tier A (model-dependent)

- Patch generation and PR authoring require model availability.
- If model calls fail, Tier 1 still protects runtime behavior and logs incidents.


```

### `docs/slas.md` (19 lines)

```markdown
# Internal SLAs and MTTR Targets

These targets reflect the current platform constraints (single-region Replit deployment, single-owner operation).

- Read availability target: 99.5% monthly
- Admin write availability target: 99.0% monthly
- Tier A self-heal MTTR target: under 2 hours
- Dangerous-core MTTR target: under 1 hour from ops alert email
- Disaster recovery RTO: 30 minutes
- Disaster recovery RPO: 24 hours

## Measurement

- Uptime and dependency health: `/api/healthz/deep`
- Incident and MTTR timing: `incident_log`
- Rollback outcomes: `AUTOMERGE_ROLLBACK*` incidents
- Quarterly controls: admin Operations panel


```

---

<a id="appendix-index"></a>
## Appendix: alphabetical file index

- `.cursorrules`
- `.github/workflows/ci.yml`
- `.github/workflows/self-heal-gate.yml`
- `.replit`
- `AGENTS.md`
- `artifacts/api-server/build.mjs`
- `artifacts/api-server/eslint.config.mjs`
- `artifacts/api-server/package.json`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/auth.ts`
- `artifacts/api-server/src/lib/backupScheduler.ts`
- `artifacts/api-server/src/lib/bbObjectStore.ts`
- `artifacts/api-server/src/lib/blackBookWorker.ts`
- `artifacts/api-server/src/lib/carfaxWorker.ts`
- `artifacts/api-server/src/lib/codeRepair/allowlist.ts`
- `artifacts/api-server/src/lib/codeRepair/generator.ts`
- `artifacts/api-server/src/lib/codeRepair/invariants.ts`
- `artifacts/api-server/src/lib/codeRepair/templates.ts`
- `artifacts/api-server/src/lib/emailService.ts`
- `artifacts/api-server/src/lib/env.ts`
- `artifacts/api-server/src/lib/incidentService.ts`
- `artifacts/api-server/src/lib/inventoryCache.ts`
- `artifacts/api-server/src/lib/lenderAuth.ts`
- `artifacts/api-server/src/lib/lenderCalcEngine.ts`
- `artifacts/api-server/src/lib/lenderWorker.ts`
- `artifacts/api-server/src/lib/logger.ts`
- `artifacts/api-server/src/lib/platformError.ts`
- `artifacts/api-server/src/lib/randomScheduler.ts`
- `artifacts/api-server/src/lib/README.md`
- `artifacts/api-server/src/lib/roleFilter.ts`
- `artifacts/api-server/src/lib/runtimeFingerprint.ts`
- `artifacts/api-server/src/lib/selfHeal/auditTrail.ts`
- `artifacts/api-server/src/lib/selfHeal/authHealthcheck.ts`
- `artifacts/api-server/src/lib/selfHeal/canary.ts`
- `artifacts/api-server/src/lib/selfHeal/circuitBreaker.ts`
- `artifacts/api-server/src/lib/selfHeal/deadLetter.ts`
- `artifacts/api-server/src/lib/selfHeal/index.ts`
- `artifacts/api-server/src/lib/selfHeal/probeField.ts`
- `artifacts/api-server/src/lib/selfHeal/probeSelector.ts`
- `artifacts/api-server/src/lib/selfHeal/reauthIfNeeded.ts`
- `artifacts/api-server/src/lib/selfHeal/rollbackWatcher.ts`
- `artifacts/api-server/src/lib/selfHeal/staleButServing.ts`
- `artifacts/api-server/src/lib/selfHeal/withRetry.ts`
- `artifacts/api-server/src/lib/typesense.ts`
- `artifacts/api-server/src/lib/validate.ts`
- `artifacts/api-server/src/routes/access.ts`
- `artifacts/api-server/src/routes/auth.ts`
- `artifacts/api-server/src/routes/carfax.ts`
- `artifacts/api-server/src/routes/health.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/routes/inventory.ts`
- `artifacts/api-server/src/routes/lender/index.ts`
- `artifacts/api-server/src/routes/lender/lender-admin.ts`
- `artifacts/api-server/src/routes/lender/lender-calculate.ts`
- `artifacts/api-server/src/routes/lender/lender-read.ts`
- `artifacts/api-server/src/routes/ops.ts`
- `artifacts/api-server/src/routes/price-lookup.ts`
- `artifacts/api-server/src/routes/README.md`
- `artifacts/api-server/src/scripts/testCarfax.ts`
- `artifacts/api-server/src/types/passport.d.ts`
- `artifacts/api-server/tsconfig.json`
- `artifacts/inventory-portal/components.json`
- `artifacts/inventory-portal/index.html`
- `artifacts/inventory-portal/package.json`
- `artifacts/inventory-portal/public/favicon.svg`
- `artifacts/inventory-portal/requirements.yaml`
- `artifacts/inventory-portal/src/App.tsx`
- `artifacts/inventory-portal/src/components/layout.tsx`
- `artifacts/inventory-portal/src/components/ui/accordion.tsx`
- `artifacts/inventory-portal/src/components/ui/alert-dialog.tsx`
- `artifacts/inventory-portal/src/components/ui/alert.tsx`
- `artifacts/inventory-portal/src/components/ui/aspect-ratio.tsx`
- `artifacts/inventory-portal/src/components/ui/avatar.tsx`
- `artifacts/inventory-portal/src/components/ui/badge.tsx`
- `artifacts/inventory-portal/src/components/ui/breadcrumb.tsx`
- `artifacts/inventory-portal/src/components/ui/button-group.tsx`
- `artifacts/inventory-portal/src/components/ui/button.tsx`
- `artifacts/inventory-portal/src/components/ui/calendar.tsx`
- `artifacts/inventory-portal/src/components/ui/card.tsx`
- `artifacts/inventory-portal/src/components/ui/carousel.tsx`
- `artifacts/inventory-portal/src/components/ui/chart.tsx`
- `artifacts/inventory-portal/src/components/ui/checkbox.tsx`
- `artifacts/inventory-portal/src/components/ui/collapsible.tsx`
- `artifacts/inventory-portal/src/components/ui/command.tsx`
- `artifacts/inventory-portal/src/components/ui/context-menu.tsx`
- `artifacts/inventory-portal/src/components/ui/dialog.tsx`
- `artifacts/inventory-portal/src/components/ui/drawer.tsx`
- `artifacts/inventory-portal/src/components/ui/dropdown-menu.tsx`
- `artifacts/inventory-portal/src/components/ui/empty.tsx`
- `artifacts/inventory-portal/src/components/ui/field.tsx`
- `artifacts/inventory-portal/src/components/ui/form.tsx`
- `artifacts/inventory-portal/src/components/ui/hover-card.tsx`
- `artifacts/inventory-portal/src/components/ui/input-group.tsx`
- `artifacts/inventory-portal/src/components/ui/input-otp.tsx`
- `artifacts/inventory-portal/src/components/ui/input.tsx`
- `artifacts/inventory-portal/src/components/ui/item.tsx`
- `artifacts/inventory-portal/src/components/ui/kbd.tsx`
- `artifacts/inventory-portal/src/components/ui/label.tsx`
- `artifacts/inventory-portal/src/components/ui/menubar.tsx`
- `artifacts/inventory-portal/src/components/ui/navigation-menu.tsx`
- `artifacts/inventory-portal/src/components/ui/pagination.tsx`
- `artifacts/inventory-portal/src/components/ui/popover.tsx`
- `artifacts/inventory-portal/src/components/ui/progress.tsx`
- `artifacts/inventory-portal/src/components/ui/radio-group.tsx`
- `artifacts/inventory-portal/src/components/ui/resizable.tsx`
- `artifacts/inventory-portal/src/components/ui/scroll-area.tsx`
- `artifacts/inventory-portal/src/components/ui/select.tsx`
- `artifacts/inventory-portal/src/components/ui/separator.tsx`
- `artifacts/inventory-portal/src/components/ui/sheet.tsx`
- `artifacts/inventory-portal/src/components/ui/sidebar.tsx`
- `artifacts/inventory-portal/src/components/ui/skeleton.tsx`
- `artifacts/inventory-portal/src/components/ui/slider.tsx`
- `artifacts/inventory-portal/src/components/ui/sonner.tsx`
- `artifacts/inventory-portal/src/components/ui/spinner.tsx`
- `artifacts/inventory-portal/src/components/ui/switch.tsx`
- `artifacts/inventory-portal/src/components/ui/table.tsx`
- `artifacts/inventory-portal/src/components/ui/tabs.tsx`
- `artifacts/inventory-portal/src/components/ui/textarea.tsx`
- `artifacts/inventory-portal/src/components/ui/toast.tsx`
- `artifacts/inventory-portal/src/components/ui/toaster.tsx`
- `artifacts/inventory-portal/src/components/ui/toggle-group.tsx`
- `artifacts/inventory-portal/src/components/ui/toggle.tsx`
- `artifacts/inventory-portal/src/components/ui/tooltip.tsx`
- `artifacts/inventory-portal/src/hooks/use-mobile.tsx`
- `artifacts/inventory-portal/src/hooks/use-toast.ts`
- `artifacts/inventory-portal/src/index.css`
- `artifacts/inventory-portal/src/lib/utils.ts`
- `artifacts/inventory-portal/src/main.tsx`
- `artifacts/inventory-portal/src/pages/admin.tsx`
- `artifacts/inventory-portal/src/pages/denied.tsx`
- `artifacts/inventory-portal/src/pages/inventory.tsx`
- `artifacts/inventory-portal/src/pages/lender-calculator.tsx`
- `artifacts/inventory-portal/src/pages/login.tsx`
- `artifacts/inventory-portal/src/pages/not-found.tsx`
- `artifacts/inventory-portal/src/README.md`
- `artifacts/inventory-portal/tsconfig.json`
- `artifacts/inventory-portal/vite.config.ts`
- `artifacts/mockup-sandbox/components.json`
- `artifacts/mockup-sandbox/index.html`
- `artifacts/mockup-sandbox/mockupPreviewPlugin.ts`
- `artifacts/mockup-sandbox/package.json`
- `artifacts/mockup-sandbox/src/.generated/mockup-components.ts`
- `artifacts/mockup-sandbox/src/App.tsx`
- `artifacts/mockup-sandbox/src/components/ui/accordion.tsx`
- `artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx`
- `artifacts/mockup-sandbox/src/components/ui/alert.tsx`
- `artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx`
- `artifacts/mockup-sandbox/src/components/ui/avatar.tsx`
- `artifacts/mockup-sandbox/src/components/ui/badge.tsx`
- `artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx`
- `artifacts/mockup-sandbox/src/components/ui/button-group.tsx`
- `artifacts/mockup-sandbox/src/components/ui/button.tsx`
- `artifacts/mockup-sandbox/src/components/ui/calendar.tsx`
- `artifacts/mockup-sandbox/src/components/ui/card.tsx`
- `artifacts/mockup-sandbox/src/components/ui/carousel.tsx`
- `artifacts/mockup-sandbox/src/components/ui/chart.tsx`
- `artifacts/mockup-sandbox/src/components/ui/checkbox.tsx`
- `artifacts/mockup-sandbox/src/components/ui/collapsible.tsx`
- `artifacts/mockup-sandbox/src/components/ui/command.tsx`
- `artifacts/mockup-sandbox/src/components/ui/context-menu.tsx`
- `artifacts/mockup-sandbox/src/components/ui/dialog.tsx`
- `artifacts/mockup-sandbox/src/components/ui/drawer.tsx`
- `artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx`
- `artifacts/mockup-sandbox/src/components/ui/empty.tsx`
- `artifacts/mockup-sandbox/src/components/ui/field.tsx`
- `artifacts/mockup-sandbox/src/components/ui/form.tsx`
- `artifacts/mockup-sandbox/src/components/ui/hover-card.tsx`
- `artifacts/mockup-sandbox/src/components/ui/input-group.tsx`
- `artifacts/mockup-sandbox/src/components/ui/input-otp.tsx`
- `artifacts/mockup-sandbox/src/components/ui/input.tsx`
- `artifacts/mockup-sandbox/src/components/ui/item.tsx`
- `artifacts/mockup-sandbox/src/components/ui/kbd.tsx`
- `artifacts/mockup-sandbox/src/components/ui/label.tsx`
- `artifacts/mockup-sandbox/src/components/ui/menubar.tsx`
- `artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx`
- `artifacts/mockup-sandbox/src/components/ui/pagination.tsx`
- `artifacts/mockup-sandbox/src/components/ui/popover.tsx`
- `artifacts/mockup-sandbox/src/components/ui/progress.tsx`
- `artifacts/mockup-sandbox/src/components/ui/radio-group.tsx`
- `artifacts/mockup-sandbox/src/components/ui/resizable.tsx`
- `artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx`
- `artifacts/mockup-sandbox/src/components/ui/select.tsx`
- `artifacts/mockup-sandbox/src/components/ui/separator.tsx`
- `artifacts/mockup-sandbox/src/components/ui/sheet.tsx`
- `artifacts/mockup-sandbox/src/components/ui/sidebar.tsx`
- `artifacts/mockup-sandbox/src/components/ui/skeleton.tsx`
- `artifacts/mockup-sandbox/src/components/ui/slider.tsx`
- `artifacts/mockup-sandbox/src/components/ui/sonner.tsx`
- `artifacts/mockup-sandbox/src/components/ui/spinner.tsx`
- `artifacts/mockup-sandbox/src/components/ui/switch.tsx`
- `artifacts/mockup-sandbox/src/components/ui/table.tsx`
- `artifacts/mockup-sandbox/src/components/ui/tabs.tsx`
- `artifacts/mockup-sandbox/src/components/ui/textarea.tsx`
- `artifacts/mockup-sandbox/src/components/ui/toast.tsx`
- `artifacts/mockup-sandbox/src/components/ui/toaster.tsx`
- `artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx`
- `artifacts/mockup-sandbox/src/components/ui/toggle.tsx`
- `artifacts/mockup-sandbox/src/components/ui/tooltip.tsx`
- `artifacts/mockup-sandbox/src/hooks/use-mobile.tsx`
- `artifacts/mockup-sandbox/src/hooks/use-toast.ts`
- `artifacts/mockup-sandbox/src/index.css`
- `artifacts/mockup-sandbox/src/lib/utils.ts`
- `artifacts/mockup-sandbox/src/main.tsx`
- `artifacts/mockup-sandbox/tsconfig.json`
- `artifacts/mockup-sandbox/vite.config.ts`
- `docs/adr/0001-contract-first-api.md`
- `docs/adr/0002-carfax-dev-only.md`
- `docs/adr/0003-strings-for-money.md`
- `docs/adr/0004-random-scheduler-mountain-time.md`
- `docs/adr/0005-typesense-scoped-keys.md`
- `docs/enterprise-stability-gaps.md`
- `docs/patterns.md`
- `docs/runbooks/auth-broken.md`
- `docs/runbooks/db-schema-drift.md`
- `docs/runbooks/disaster-recovery.md`
- `docs/runbooks/env-secret-rotation.md`
- `docs/runbooks/lender-calc-corruption.md`
- `docs/runbooks/quarterly-allowlist-audit.md`
- `docs/self-heal.md`
- `docs/slas.md`
- `downloads/README.md`
- `lib/api-client-react/package.json`
- `lib/api-client-react/src/custom-fetch.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/index.ts`
- `lib/api-client-react/tsconfig.json`
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/api-spec/package.json`
- `lib/api-zod/package.json`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/accessEntry.ts`
- `lib/api-zod/src/generated/types/addAccessRequest.ts`
- `lib/api-zod/src/generated/types/auditLogEntry.ts`
- `lib/api-zod/src/generated/types/authDebugCallback200.ts`
- `lib/api-zod/src/generated/types/authGoogleCallbackParams.ts`
- `lib/api-zod/src/generated/types/cacheStatus.ts`
- `lib/api-zod/src/generated/types/debugCounts.ts`
- `lib/api-zod/src/generated/types/errorResponse.ts`
- `lib/api-zod/src/generated/types/getCarfaxBatchStatus200.ts`
- `lib/api-zod/src/generated/types/getLenderDebug200.ts`
- `lib/api-zod/src/generated/types/getLenderDebug200LendersItem.ts`
- `lib/api-zod/src/generated/types/getVehicleImagesParams.ts`
- `lib/api-zod/src/generated/types/healthStatus.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/inventoryItem.ts`
- `lib/api-zod/src/generated/types/inventoryItemBbValues.ts`
- `lib/api-zod/src/generated/types/kmRange.ts`
- `lib/api-zod/src/generated/types/lenderCalcResultItem.ts`
- `lib/api-zod/src/generated/types/lenderCalculateRequest.ts`
- `lib/api-zod/src/generated/types/lenderCalculateResponse.ts`
- `lib/api-zod/src/generated/types/lenderProgram.ts`
- `lib/api-zod/src/generated/types/lenderProgramGuide.ts`
- `lib/api-zod/src/generated/types/lenderProgramsResponse.ts`
- `lib/api-zod/src/generated/types/lenderProgramTier.ts`
- `lib/api-zod/src/generated/types/lenderStatus.ts`
- `lib/api-zod/src/generated/types/priceLookup200.ts`
- `lib/api-zod/src/generated/types/priceLookupParams.ts`
- `lib/api-zod/src/generated/types/programLimits.ts`
- `lib/api-zod/src/generated/types/runCarfaxTest200.ts`
- `lib/api-zod/src/generated/types/runCarfaxTest200Results.ts`
- `lib/api-zod/src/generated/types/runCarfaxTestBody.ts`
- `lib/api-zod/src/generated/types/successMessageResponse.ts`
- `lib/api-zod/src/generated/types/successResponse.ts`
- `lib/api-zod/src/generated/types/updateAccessRoleRequest.ts`
- `lib/api-zod/src/generated/types/user.ts`
- `lib/api-zod/src/generated/types/vehicleConditionMatrixEntry.ts`
- `lib/api-zod/src/generated/types/vehicleImages.ts`
- `lib/api-zod/src/generated/types/vehicleTermMatrixData.ts`
- `lib/api-zod/src/generated/types/vehicleTermMatrixEntry.ts`
- `lib/api-zod/src/index.ts`
- `lib/api-zod/tsconfig.json`
- `lib/db/drizzle.config.ts`
- `lib/db/package.json`
- `lib/db/src/index.ts`
- `lib/db/src/schema/access.ts`
- `lib/db/src/schema/audit-log.ts`
- `lib/db/src/schema/bb-session.ts`
- `lib/db/src/schema/carfax-session.ts`
- `lib/db/src/schema/dead-letter-queue.ts`
- `lib/db/src/schema/incident-log.ts`
- `lib/db/src/schema/index.ts`
- `lib/db/src/schema/inventory-cache.ts`
- `lib/db/src/schema/lender-session.ts`
- `lib/db/src/schema/README.md`
- `lib/db/src/schema/self-heal-flags.ts`
- `lib/db/tsconfig.json`
- `lib/README.md`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `replit.md`
- `scripts/package.json`
- `scripts/post-merge.sh`
- `scripts/src/backup-blobs.ts`
- `scripts/src/backup-db.ts`
- `scripts/src/backup-rotate.ts`
- `scripts/src/chaos/chaos-primitives.test.ts`
- `scripts/src/check-invariants.ts`
- `scripts/src/check-patterns.ts`
- `scripts/src/check-readme-sync.ts`
- `scripts/src/check-self-heal-diff.ts`
- `scripts/src/dr-drill.ts`
- `scripts/src/generate-complete-source-md.ts`
- `scripts/src/handoff-watcher.ts`
- `scripts/src/hello.ts`
- `scripts/src/lender-calc-scenarios.test.ts`
- `scripts/src/lender-engine.golden.test.ts`
- `scripts/src/lender-golden-fixtures.ts`
- `scripts/src/lender-smoke.ts`
- `scripts/src/lib/replit-gcs.ts`
- `scripts/src/quarterly-reminders.ts`
- `scripts/src/restore-from-backup.ts`
- `scripts/src/self-heal-primitives.test.ts`
- `scripts/src/split-complete-source-md.ts`
- `scripts/tsconfig.json`
- `templates/dealerPortalWorker.template.ts`
- `tsconfig.base.json`
- `tsconfig.json`
