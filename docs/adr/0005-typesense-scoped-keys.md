# ADR 0005: Typesense Scoped Search Keys

## Status
Accepted

## Context
The frontend needs to search vehicle inventory via Typesense, but unrestricted API keys would let any client query deleted, hidden, or out-of-scope vehicles.

## Decision
Use Typesense scoped API keys with baked-in filter constraints (`status`, `visibility`, `deleted_at`). Each dealer collection in `DEALER_COLLECTIONS` has its own scoped key that the server uses for enrichment and the frontend uses for search.

## Consequences
- The frontend cannot query outside the intended dataset regardless of query parameters
- Adding a new filter constraint requires regenerating scoped keys
- Key rotation requires updating environment variables for each dealer collection
- Server-side enrichment in `inventoryCache.ts` uses the same scoped keys, ensuring consistency
