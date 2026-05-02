# Quarterly Allow-List Audit

Audit `artifacts/api-server/src/lib/codeRepair/allowlist.ts` every 90 days.

## Checklist

- Confirm each Tier A file is still integration glue only.
- Confirm dangerous-core prefixes still include auth, lender calculation, env, DB schema, and lender routes.
- Confirm no new AST node class was allowed without explicit human review.
- Confirm rollback watcher and self-heal gate are still required checks.

## Acknowledgment

After completion, record an `ALLOWLIST_AUDIT_ACKED` incident row.

