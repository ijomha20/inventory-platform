# Downloads

Reference snapshots and exports. These are **not** the live codebase; prefer `artifacts/`, `lib/`, and `scripts/` in the repo.

## Single-file full tree

- **`inventory-platform-complete-source.md`** — machine-generated bundle of all sources needed to rebuild the API, portal, mockup sandbox, shared packages, and scripts (including `pnpm-lock.yaml`, Orval output, and every `components/ui` file).

Regenerate after substantive changes:

```bash
pnpm --filter @workspace/scripts export:complete-md
```

Generator: `scripts/src/generate-complete-source-md.ts`.

## Other files here

- `inventory-platform-part-*.md` — older split exports
- `inventory-portal-full-codebase.md` — frontend-only export
- `git-commit-history.txt` — commit log at time of export
