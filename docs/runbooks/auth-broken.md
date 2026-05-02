# Auth Failure Runbook

## Trigger

- OAuth callbacks fail
- `/api/me` returns unexpected 401/403
- `PERMISSION_DENIED` incidents spike

## Steps

1. Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`.
2. Confirm callback URL via `/api/auth/debug-callback` in non-production.
3. Check session table connectivity.
4. Validate cookie settings (`secure`, `sameSite`) for current environment.
5. Redeploy and re-test login flow.

