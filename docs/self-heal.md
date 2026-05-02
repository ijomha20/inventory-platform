# Self-Heal Runtime Behavior

Tier 1 runtime adaptation does not depend on external LLM providers.

## Tier 1 (always-on, model-independent)

- `withRetry`
- `circuitBreaker`
- `probeField`
- `probeSelector`
- `reauthIfNeeded`
- `staleButServing`
- `deadLetter`

## Tier 2 and Tier A (model-dependent)

- Patch generation and PR authoring require model availability.
- If model calls fail, Tier 1 still protects runtime behavior and logs incidents.

