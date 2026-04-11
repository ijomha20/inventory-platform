# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.
This is a private inventory management platform for vehicle dealership operations.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/                  # Deployable applications
│   ├── api-server/             # Express API server (port from $PORT)
│   └── inventory-portal/       # React + Vite portal frontend
├── lib/                        # Shared libraries
│   ├── api-spec/               # OpenAPI spec + Orval codegen config
│   ├── api-client-react/       # Generated React Query hooks
│   ├── api-zod/                # Generated Zod schemas from OpenAPI
│   └── db/                     # Drizzle ORM schema + DB connection
├── attached_assets/            # Apps Script source: InventorySync_v3.2.gs
├── scripts/                    # Utility scripts
└── pnpm-workspace.yaml
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express, schedules Carfax worker (nightly 2:15am)
- App setup: `src/app.ts` — CORS, session, Passport, rate limiting (60 req/min), trust proxy
- Routes: `src/routes/index.ts` mounts sub-routers
  - `health.ts` — GET /healthz
  - `auth.ts` — OAuth flow, GET /me (returns role), GET/POST auth routes
  - `inventory.ts` — GET /inventory (role-filtered), GET /cache-status, POST /refresh, GET /vehicle-images
  - `access.ts` — GET /access, POST /access, PATCH /access/:email, DELETE /access/:email, GET /audit-log
- Lib: `src/lib/inventoryCache.ts` — in-memory cache of Apps Script inventory, auto-refreshes hourly
- Lib: `src/lib/carfaxWorker.ts` — cloud Carfax lookup bot (puppeteer, nightly cron)
- Lib: `src/lib/auth.ts` — Passport Google OAuth strategy, isOwner() helper
- Depends on: `@workspace/db`, `@workspace/api-zod`, `express-rate-limit`, `puppeteer`

### `artifacts/inventory-portal` (`@workspace/inventory-portal`)

React + Vite single-page application. Google OAuth login required.

Pages:
- `/login` — Google Sign-In page
- `/` — Vehicle inventory table (desktop) + card view (mobile), with photo gallery, role-aware pricing
- `/admin` — Access management (owner only): user list with role selector, audit log tab
- `/denied` — Access denied page

Features:
- **Role-based UI**: Guests see no "Your Cost" column; Viewers see all data; Owner sees all + admin
- **Photo gallery**: Camera icon per vehicle opens full-screen gallery (keyboard navigation, thumbnails)
- **Mobile-first**: Below 768px switches from table to card layout
- **Live sync**: Polls /cache-status every 60s; auto-refreshes inventory when server cache updates
- **VIN copy**: Click VIN to copy to clipboard

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

Schema tables:
- `access_list` — email, added_at, added_by, role (viewer|guest; owner is env-var based)
- `audit_log` — id, action, target_email, changed_by, role_from, role_to, timestamp
- `session` — connect-pg-simple session store

- `drizzle.config.ts` — requires `DATABASE_URL` (provided automatically by Replit)
- DB push: `pnpm --filter @workspace/db run push` (interactive) or use direct SQL

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec (`openapi.yaml`) + Orval codegen config.

Endpoints:
- GET  /healthz
- GET  /me
- GET  /inventory
- GET  /cache-status
- GET  /vehicle-images?vin=XXX
- GET  /access, POST /access, PATCH /access/:email, DELETE /access/:email
- GET  /audit-log

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package.

## Environment Secrets Required

| Secret | Where to set | Purpose |
|---|---|---|
| `SESSION_SECRET` | Replit Secrets | Express session signing |
| `GOOGLE_CLIENT_ID` | Replit Secrets | OAuth |
| `GOOGLE_CLIENT_SECRET` | Replit Secrets | OAuth |
| `OWNER_EMAIL` | Replit Secrets | Marks email as owner (full admin access) |
| `REFRESH_SECRET` | Replit Secrets | Apps Script webhook auth |
| `INVENTORY_DATA_URL` | Replit Secrets | Apps Script Web App URL + `?action=inventory` |
| `CARFAX_EMAIL` | Replit Secrets | Carfax Canada login (optional) |
| `CARFAX_PASSWORD` | Replit Secrets | Carfax Canada password (optional) |
| `CARFAX_ENABLED` | Replit Secrets | Set to "true" to activate cloud Carfax worker |
| `APPS_SCRIPT_WEB_APP_URL` | Replit Secrets | Apps Script Web App URL (no query string) |

## Apps Script Setup (InventorySync_v3.2.gs)

File located at: `attached_assets/InventorySync_v3.2.gs`

One-time setup steps:
1. Open Google Sheets → Extensions → Apps Script → replace all code with `InventorySync_v3.2.gs`
2. Run "First-Time Setup" from the Inventory Sync menu
3. Fill in Settings tab: `SOURCE_SHEET_URL`, `NOTIFICATION_EMAILS`, `REPLIT_REFRESH_URL`, `REPLIT_REFRESH_SECRET`
4. Run "Setup Auto-Sync" from the menu (triggers hourly)
5. Deploy as Web App → Execute as Me → Access: Anyone
6. Copy the deployed Web App URL into Replit secrets:
   - `INVENTORY_DATA_URL` = `<web-app-url>?action=inventory`
   - `APPS_SCRIPT_WEB_APP_URL` = `<web-app-url>` (no query string)

## Key Design Decisions

- **One-sheet architecture**: Apps Script serves filtered inventory (col H filled = "Your Cost") directly via `?action=inventory` — no SharedInventory sheet needed
- **Server-side role enforcement**: Guests get price stripped server-side (not just hidden in UI)
- **Carfax cloud worker**: Runs headless Puppeteer on Replit server nightly; results written back to Apps Script via doPost
- **Image CDN**: Vehicle photos served from `https://zopsoftware-asset.b-cdn.net` + path from Typesense `image_urls` field (semicolon-delimited)
- **Archive tab**: Vehicles removed from Matrix feed are archived (not deleted) before removal from My List
- **Rate limiting**: 60 req/min per IP on all /api routes, skips /api/healthz
- **Object storage as shared state**: Dev and production use separate Postgres databases (Replit provisions them independently). Replit's GCS-backed object storage bucket is shared between environments. BB session cookies (`bb-session.json`) and computed BB values map (`bb-values.json`) are stored there so both environments see the same data. Dev does browser login + computes values; production reads from object storage.
- **BB nightly run**: Runs only in dev (production skips browser login gracefully). Dev writes fresh cookies + values to object storage at 2am. Production reads them on startup and at every hourly inventory refresh via `loadBbValuesFromStore()`.
- **BB trim matching**: When CBB returns multiple trim options for a VIN, the worker scores each option using: (1) vehicle description token matching against CBB series/style fields, (2) NHTSA VIN decode fields (trim, series, body class, drivetrain, displacement, cylinders, fuel type), and (3) cross-field token overlap. When no trim can be matched, the **median** value is used as fallback (not lowest). All returned trims are logged with their values for auditability.
