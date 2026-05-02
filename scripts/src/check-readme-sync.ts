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
