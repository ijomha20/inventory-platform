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
