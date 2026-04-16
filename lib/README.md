# Shared Libraries (`lib/`)

These packages are consumed by both `artifacts/api-server` and `artifacts/inventory-portal` via pnpm workspace references (`@workspace/*`).

## Packages

### `lib/api-spec`
- **Contains:** `openapi.yaml` (the API contract), `orval.config.ts` (codegen config)
- **Purpose:** Single source of truth for all API endpoints, request/response shapes, and operation IDs.
- **When to read:** Adding or changing API endpoints. Edit `openapi.yaml`, then regenerate clients.

### `lib/api-zod`
- **Contains:** Generated Zod schemas in `src/generated/api.ts` + TypeScript types in `src/generated/types/`
- **Purpose:** Runtime validation schemas for API request/response bodies. Used server-side.
- **Generated from:** `openapi.yaml` via Orval

### `lib/api-client-react`
- **Contains:** Generated React Query hooks + TypeScript interfaces in `src/generated/`; custom fetch in `src/custom-fetch.ts`
- **Purpose:** Type-safe API client for the React portal. Provides `useGetMe()`, `useGetInventory()`, `useLenderCalculate()`, etc.
- **Generated from:** `openapi.yaml` via Orval
- **Key exports:** All `use*` hooks, `setBaseUrl()`, `setAuthTokenGetter()`, schema types

### `lib/db`
- **Contains:** Drizzle ORM schema definitions in `src/schema/`, connection pool in `src/index.ts`
- **Purpose:** PostgreSQL database access. Exports `db` (Drizzle instance), `pool` (pg pool), and all table definitions.
- **When to read:** Database schema changes, adding tables, writing queries.
- **See also:** [schema/README.md](db/src/schema/README.md) for table-level documentation.

## Codegen Pipeline

```
lib/api-spec/openapi.yaml
        │
        ▼  (orval)
   ┌────┴────────────────────┐
   │                         │
   ▼                         ▼
lib/api-zod              lib/api-client-react
(Zod schemas)            (React Query hooks)
(server validation)      (frontend API calls)
```

To regenerate after changing `openapi.yaml`, run the Orval codegen from `lib/api-spec`.

## Database Tables Overview

| Table | Schema File | Domain | Purpose |
|-------|-------------|--------|---------|
| `session` | Managed by `connect-pg-simple` | Auth | Express session storage |
| `access_list` | `db/src/schema/access.ts` | Access control | Approved user emails + roles |
| `audit_log` | `db/src/schema/audit-log.ts` | Admin | Tracks add/remove/role_change actions |
| `inventory_cache` | `db/src/schema/inventory-cache.ts` | Inventory | JSON blob of all vehicles for instant startup |
| `bb_session` | `db/src/schema/bb-session.ts` | Black Book | Worker session cookies + last run timestamp |
| `lender_session` | `db/src/schema/lender-session.ts` | Lender sync | Worker session cookies + last run timestamp |
