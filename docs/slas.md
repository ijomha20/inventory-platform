# Internal SLAs and MTTR Targets

These targets reflect the current platform constraints (single-region Replit deployment, single-owner operation).

- Read availability target: 99.5% monthly
- Admin write availability target: 99.0% monthly
- Tier A self-heal MTTR target: under 2 hours
- Dangerous-core MTTR target: under 1 hour from ops alert email
- Disaster recovery RTO: 30 minutes
- Disaster recovery RPO: 24 hours

## Measurement

- Uptime and dependency health: `/api/healthz/deep`
- Incident and MTTR timing: `incident_log`
- Rollback outcomes: `AUTOMERGE_ROLLBACK*` incidents
- Quarterly controls: admin Operations panel

