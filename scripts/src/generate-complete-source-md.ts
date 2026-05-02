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
