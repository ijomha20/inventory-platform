# Enterprise Stability Gaps (Accepted Constraints)

The current platform includes strong runtime self-healing and rollback controls, but some enterprise-grade capabilities remain out of scope due to deployment and platform constraints.

## Out of scope today

- Multi-region active-active failover
- Multi-provider model router for Cursor execution
- Contractual Anthropic enterprise SLA
- Dedicated 24/7 on-call rotation

## Why

- Current hosting model is single Replit deployment
- Cursor model selection is manual in IDE
- Vendor SLA negotiation is external to code
- Team structure is currently owner-operated

## Future path

- Migrate to multi-region hosting platform
- Add provider abstraction for non-IDE model tasks
- Negotiate vendor SLA once tier-2/auto-merge volume grows
- Formalize rotating on-call as team expands

