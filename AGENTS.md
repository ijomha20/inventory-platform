# Inventory Platform -- Agent Navigation Guide

> **Purpose:** This file is the top-level entry point for any AI agent working in this codebase.
> Read this first to locate the right domain, files, and symbols for any task.

## 30-Second Orientation (start here every session)

1. **Read this file** — locate your domain in the Domain Index below.
2. **Read the relevant README** — `artifacts/api-server/src/routes/README.md` for routes, `artifacts/api-server/src/lib/README.md` for libraries, `artifacts/inventory-portal/src/README.md` for the portal, `lib/db/src/schema/README.md` for DB tables.
3. **Read the target file's header comment** — every lib and route file opens with a doc block listing its exports and consumers.
4. **Check the Anti-Patterns section below** before writing any code — violations are caught by CI.
5. **Write code** using the established patterns. Use the Pattern Catalog at `docs/patterns.md` for canonical examples of each shared utility.

## Architecture Overview

```
Apps Script JSON feed
        │
        ▼
  inventoryCache.ts ──── Typesense (prices, photos, URLs)
        │
   ┌────┴────┐
   │ DB      │ In-memory cache
   │ snapshot│ (serves API)
   └─────────┘
        │
   ┌────┴──────────────────────────────────┐
   │           Express API (/api)          │
   │  health │ auth │ inventory │ access   │
   │  carfax │ lender │ price-lookup │ ops │
   └───────────────────────────────────────┘
        │                          ▲
        ▼                          │
  React Portal (SPA)        Background workers:
  inventory / admin /        - Black Book (valuations)
  calculator                 - Carfax (VHR links)
                             - Lender sync (CreditApp)
```

## Domain Index

| Domain | Description | Key Files | README |
|--------|-------------|-----------|--------|
| **Auth & Access** | Google OAuth, sessions, role gating (owner/viewer/guest) | `routes/auth.ts`, `routes/access.ts`, `lib/auth.ts` | [routes/README.md](artifacts/api-server/src/routes/README.md) |
| **Inventory** | Vehicle feed ingestion, caching, Typesense enrichment, BB/Carfax merge | `routes/inventory.ts`, `lib/inventoryCache.ts` | [lib/README.md](artifacts/api-server/src/lib/README.md) |
| **Lender Calculator** | Program sync from CreditApp, LTV/payment/product calculation engine | `routes/lender/`, `lib/lenderCalcEngine.ts`, `lib/lenderWorker.ts`, `lib/lenderAuth.ts` | [routes/README.md](artifacts/api-server/src/routes/README.md) |
| **Integrations** | Black Book valuations, Carfax VHR links, Typesense search index | `lib/blackBookWorker.ts`, `lib/carfaxWorker.ts`, `lib/bbObjectStore.ts` | [lib/README.md](artifacts/api-server/src/lib/README.md) |
| **Admin & Audit** | User management, role changes, audit log | `routes/access.ts`, `lib/emailService.ts` | [routes/README.md](artifacts/api-server/src/routes/README.md) |
| **Frontend Portal** | React SPA: inventory view, admin panel, lender calculator UI | `inventory-portal/src/pages/*`, `inventory-portal/src/App.tsx` | [portal/README.md](artifacts/inventory-portal/src/README.md) |

## Backend File Quick-Reference

All paths relative to `artifacts/api-server/src/`.

### Routes (`routes/`)

| File | Endpoints | Purpose |
|------|-----------|---------|
| `health.ts` | `GET /healthz` | Uptime check |
| `auth.ts` | `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/logout`, `GET /me` | Google OAuth flow + current user info |
| `access.ts` | `GET /access`, `POST /access`, `PATCH /access/:email`, `DELETE /access/:email`, `GET /audit-log` | User CRUD + audit log |
| `inventory.ts` | `GET /inventory`, `GET /cache-status`, `POST /refresh`, `POST /refresh-blackbook`, `GET /vehicle-images` | Inventory data, cache control, images |
| `carfax.ts` | `GET /carfax/batch-status`, `POST /carfax/run-batch`, `POST /carfax/test` | Carfax VHR management |
| `lender/index.ts` | — | Router barrel — mounts lender-read, lender-calculate, lender-admin |
| `lender/lender-read.ts` | `GET /lender-programs`, `GET /lender-status` | Cached lender program data + sync status |
| `lender/lender-calculate.ts` | `POST /lender-calculate` | Main calculator engine |
| `lender/lender-admin.ts` | `POST /refresh-lender`, `GET /lender-debug` | Manual sync trigger + diagnostics |
| `price-lookup.ts` | `GET /price-lookup?url=` | Resolve listing URL to live price via Typesense |
| `ops.ts` | `GET /ops/function-status` | Explicit operational pass/fail checks for BB, Carfax, website links, and lender program readiness |

### Libraries (`lib/`)

| File | Purpose | Consumed By |
|------|---------|-------------|
| `auth.ts` | `isOwner()`, `getUserRole()`, `requireOwner`, `requireAccess`, `requireOwnerOrViewer`, `configurePassport()` — Google OAuth setup + shared auth middleware | `app.ts`, all routes |
| `inventoryCache.ts` | In-memory + DB inventory cache, Typesense enrichment, BB/Carfax merge | `routes/inventory.ts`, workers |
| `roleFilter.ts` | `filterInventoryByRole()` — strip fields by user role | `routes/inventory.ts` |
| `lenderCalcEngine.ts` | Cap profile resolver, no-online selling price logic | `routes/lender/lender-calculate.ts` |
| `lenderWorker.ts` | Syncs lender programs from CreditApp GraphQL, caches to GCS | `routes/lender/`, `index.ts` |
| `lenderAuth.ts` | CreditApp auth cookies, GraphQL client | `lenderWorker.ts` |
| `blackBookWorker.ts` | Canadian Black Book valuation via CreditApp browser automation | `routes/inventory.ts`, `index.ts` |
| `carfaxWorker.ts` | Carfax VHR link resolution via dealer portal automation | `routes/carfax.ts`, `index.ts` |
| `bbObjectStore.ts` | GCS blob I/O for BB values, lender programs, and session data | `blackBookWorker.ts`, `lenderWorker.ts`, `inventoryCache.ts` |
| `emailService.ts` | Sends invitation emails via Resend | `routes/access.ts` |
| `logger.ts` | Pino structured logger | All files |
| `randomScheduler.ts` | Randomized daily scheduling within business hours (MT) | All workers |
| `typesense.ts` | Typesense client config + `extractWebsiteUrl()` helper | `inventoryCache.ts`, `routes/price-lookup.ts` |
| `env.ts` | Zod-validated environment variables, `isProduction` flag | All files needing env access |
| `validate.ts` | `validateBody(Schema)`, `validateQuery(Schema)`, `validateParams(Schema)` — Zod validation middleware | `routes/access.ts`, `routes/inventory.ts`, `routes/lender/lender-calculate.ts` |
| `runtimeFingerprint.ts` | Calculator version + git SHA for response tracing | `routes/lender/` |

## Shared Libraries (`lib/`)

| Package | Purpose | When to Read |
|---------|---------|--------------|
| `lib/api-spec` | `openapi.yaml` — the API contract; `orval.config.ts` — codegen config | Changing/adding API endpoints |
| `lib/api-zod` | Generated Zod schemas for request/response validation | Understanding API shapes |
| `lib/api-client-react` | Generated React Query hooks + TypeScript interfaces (Orval output) | Frontend API integration |
| `lib/db` | Drizzle ORM schema + PostgreSQL connection pool | Database changes |

**Codegen pipeline:** `openapi.yaml` → Orval → `api-client-react` (hooks) + `api-zod` (schemas)

## Database Tables

| Table | Domain | Schema File |
|-------|--------|-------------|
| `session` | Auth | Managed by `connect-pg-simple` |
| `access_list` | Access control | `lib/db/src/schema/access.ts` |
| `audit_log` | Admin audit trail | `lib/db/src/schema/audit-log.ts` |
| `inventory_cache` | Inventory persistence | `lib/db/src/schema/inventory-cache.ts` |
| `bb_session` | Black Book worker state | `lib/db/src/schema/bb-session.ts` |
| `lender_session` | Lender sync worker state | `lib/db/src/schema/lender-session.ts` |

## Test Locations

| Test File | What It Tests |
|-----------|---------------|
| `scripts/src/lender-engine.golden.test.ts` | Cap profile resolution + no-online selling price logic |
| `scripts/src/lender-golden-fixtures.ts` | Golden test data for cap profiles (ACC, SAN, iAF, QLI) |
| `scripts/src/lender-calc-scenarios.test.ts` | Single-vehicle calculator scenarios (setup math, product stacking, LTV constraints) |
| `scripts/src/lender-smoke.ts` | Live API smoke test |

## Non-Code Directories

| Directory | Contents |
|-----------|----------|
| `downloads/` | Markdown export snapshots — not live code; regenerate `inventory-platform-complete-source.md` with `pnpm --filter @workspace/scripts export:complete-md` |
| `attached_assets/` | Captured CreditApp API payloads and reference documents — not live code |
| `artifacts/mockup-sandbox/` | Standalone UI mockup preview app — not the production portal |

## Common Multi-File Changes

| Change | Files to update |
|--------|----------------|
| Add/change an API endpoint | `openapi.yaml` → `pnpm codegen` → route file → portal hook usage |
| Add a user role | `UserRole` in `lib/auth.ts` → DB schema `access.ts` → `lib/roleFilter.ts` → frontend role checks |
| Add an environment variable | `lib/env.ts` schema → consumer file → `.env` / Replit secrets |
| Add a dealer/collection | `lib/typesense.ts` `DEALER_COLLECTIONS` → env vars for keys |

## Anti-Patterns (DO NOT)

- Do NOT define route-local auth middleware — use `lib/auth.ts` (`requireOwner`, `requireAccess`, `requireOwnerOrViewer`)
- Do NOT hardcode Typesense config — use `lib/typesense.ts`
- Do NOT read `process.env` directly — use `lib/env.ts`
- Do NOT write ad-hoc request validation — use `validateBody(Schema)` / `validateQuery(Schema)` / `validateParams(Schema)` from `lib/validate.ts`
- Do NOT define local `isProduction` — use `{ isProduction }` from `lib/env.ts`
- Do NOT use `require()` — use static `import` or `await import()` with a comment explaining why
- Do NOT use `(req as any)` — extend `Express.Request` in `types/passport.d.ts` instead
- Do NOT inline role-based field stripping — use `filterInventoryByRole()` from `lib/roleFilter.ts`
- Do NOT put pure math in route files — put it in `lib/lenderCalcEngine.ts` and import

> `isProduction` (from `lib/env.ts`) is true when `REPLIT_DEPLOYMENT === "1"` OR `NODE_ENV === "production"`. It controls: secure cookies, log format (pretty vs JSON), Carfax worker disable, session secret enforcement.
