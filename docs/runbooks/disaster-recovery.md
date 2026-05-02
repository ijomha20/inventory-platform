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

