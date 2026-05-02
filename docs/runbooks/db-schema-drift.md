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

