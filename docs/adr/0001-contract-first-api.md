# ADR 0001: Contract-First API via OpenAPI + Orval

## Status
Accepted

## Context
The platform has a React SPA that consumes a REST API. Keeping frontend types, backend validation, and API documentation in sync manually is error-prone.

## Decision
Use OpenAPI 3.0 as the single source of truth. Orval generates React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`) from the spec.

## Consequences
- Adding/changing an endpoint requires updating `openapi.yaml` first, then running codegen
- Frontend gets type-safe hooks automatically
- Server can validate requests with generated Zod schemas
- Spec drift is the main risk — CI should catch it
