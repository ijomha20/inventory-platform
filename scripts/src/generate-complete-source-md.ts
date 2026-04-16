/**
 * Writes downloads/inventory-platform-complete-source.md — a single markdown
 * bundle of every workspace source file needed to rebuild and run the platform
 * (API server, portal, mockup sandbox, shared libs, scripts, templates).
 *
 * Excludes: node_modules, dist, .git, caches, attached_assets, downloads/*,
 * Replit artifact dirs, local session JSON, and *.tsbuildinfo.
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
  if (ext === ".sh") return "bash";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
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

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, " UTC");
  const lines: string[] = [];
  lines.push("# Inventory Platform — Complete source bundle (machine-generated)");
  lines.push("");
  lines.push(`Generated: ${now}`);
  lines.push("");
  lines.push(
    "This file is produced by `pnpm --filter @workspace/scripts export:complete-md`. " +
      "It inlines **every tracked-style source path** under the monorepo roots listed below " +
      "(excluding `node_modules`, `dist`, local caches, `attached_assets/`, `downloads/` export history, " +
      "and CreditApp session JSON files). **Regenerate after code changes** so the bundle stays in sync.",
  );
  lines.push("");
  lines.push("## Replication quickstart");
  lines.push("");
  lines.push("1. Restore this tree from the file sections below (paths are section headers).");
  lines.push("2. `pnpm install` at the repo root (see root `package.json` + `pnpm-lock.yaml`).");
  lines.push("3. API codegen (when OpenAPI changes): `pnpm --filter @workspace/api-spec codegen`.");
  lines.push("4. `pnpm run build` then run packages per their `package.json` scripts (`dev` / `start`).");
  lines.push("");
  lines.push("## Included roots");
  lines.push("");
  lines.push(
    [
      "- Root files: `AGENTS.md`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, `.replit`, `replit.md`",
      "- `scripts/`",
      "- `lib/` (api-spec, api-zod **including generated**, api-client-react **including generated**, db)",
      "- `artifacts/api-server/` (source + `build.mjs`; not build output)",
      "- `artifacts/inventory-portal/`",
      "- `artifacts/mockup-sandbox/`",
      "- `templates/`",
      "- `downloads/README.md` only (other `downloads/` files are export artifacts)",
    ].join("\n"),
  );
  lines.push("");
  lines.push(`## File index (${unique.length} files)`);
  lines.push("");
  for (const rel of unique) lines.push(`- \`${rel}\``);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const rel of unique) {
    const body = readUtf8(rel);
    const lang = fenceLang(rel);
    const n = body.split(/\r\n|\r|\n/).length;
    lines.push(`## \`${rel}\` (${n} lines)`);
    lines.push("");
    lines.push("```" + lang);
    lines.push(body);
    lines.push("```");
    lines.push("");
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const outText = lines.join("\n");
  fs.writeFileSync(OUTPUT, outText, "utf8");
  const outLines = outText.split("\n").length;
  console.log(`Wrote ${OUTPUT_REL} (${unique.length} files, ${outLines} lines)`);
}

main();
