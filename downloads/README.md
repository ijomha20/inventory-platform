# Downloads

Reference snapshots and exports. These are **not** the live codebase; prefer `artifacts/`, `lib/`, and `scripts/` in the repo.

## Single-file full tree

- **`inventory-platform-complete-source.md`** — machine-generated bundle of all sources needed to rebuild the API, portal, mockup sandbox, shared packages, scripts, GitHub workflows, and docs (including `pnpm-lock.yaml`, Orval output, and every UI component). Content is **domain-grouped** with an alphabetical index appendix.

Regenerate after substantive changes:

```bash
pnpm --filter @workspace/scripts export:complete-md
```

Generator: [`scripts/src/generate-complete-source-md.ts`](../scripts/src/generate-complete-source-md.ts).

The single-file output is listed in `.gitignore` (too large for normal commits). Generate it locally when you need the full paste bundle.

## Ten-part split (same content, size-friendly)

For editors or AI contexts with context limits, split the full export into **10 contiguous parts** at file boundaries (never inside a fenced code block):

```bash
pnpm --filter @workspace/scripts export:complete-md
pnpm --filter @workspace/scripts export:complete-md:split
```

Splitter: [`scripts/src/split-complete-source-md.ts`](../scripts/src/split-complete-source-md.ts).

Outputs (committed when regenerated):

- `inventory-platform-complete-source-part-01-of-10.md` … `part-10-of-10.md`

Together, parts 1–10 contain the **same files** as the single bundle; part 1 includes the preamble (replication quickstart, included roots, table of contents). Parts 2–10 continue sequential file blocks only.

## Other files here

- `inventory-portal-full-codebase.md` — frontend-only export (legacy)
- `git-commit-history.txt` — commit log at time of export
