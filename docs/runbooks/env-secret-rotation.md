# Environment Secret Rotation Runbook

## Scope

- Google OAuth credentials
- CreditApp credentials
- Typesense keys
- Session secret

## Steps

1. Rotate secret in secure store.
2. Update environment values in deployment.
3. Restart service.
4. Validate dependency checks (`/api/healthz/deep`).
5. Confirm no `AUTH_REJECTED` spikes in `incident_log`.

