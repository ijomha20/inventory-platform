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

