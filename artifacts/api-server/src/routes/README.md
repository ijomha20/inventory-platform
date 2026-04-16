# API Routes

All routes are mounted under `/api` via `routes/index.ts`.
Auth middleware patterns: `requireOwner` (owner email only), `requireAccess` (owner or access-list), `requireOwnerOrViewer` (owner or viewer role).

## Route Files

### `health.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/healthz` | None | Returns `{ status: "ok" }` — uptime/ready check |

**Lib dependencies:** `@workspace/api-zod` (response validation)

---

### `auth.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/auth/google` | None | Initiates Google OAuth flow |
| GET | `/auth/google/callback` | None | OAuth callback — creates session |
| GET | `/auth/logout` | Session | Destroys session, redirects to `/` |
| GET | `/me` | Session | Returns current user profile + role |
| GET | `/auth/debug-callback` | None | Shows computed callback URL (diagnostic) |

**Lib dependencies:** `lib/auth.ts` (`isOwner`, `configurePassport`), `@workspace/db` (access list lookup)

**Role resolution:** Owner check → access_list lookup → 403 if not found

---

### `access.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/access` | Owner | List all access-list users |
| POST | `/access` | Owner | Add user (sends invitation email) |
| PATCH | `/access/:email` | Owner | Change user role (viewer ↔ guest) |
| DELETE | `/access/:email` | Owner | Remove user + destroy their sessions |
| GET | `/audit-log` | Owner | Last 200 audit entries |

**Lib dependencies:** `lib/auth.ts` (`isOwner`), `lib/emailService.ts` (`sendInvitationEmail`), `@workspace/db` (access_list + audit_log tables)

**Side effects:** Writes to `audit_log` on every add/remove/role_change

---

### `inventory.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/inventory` | Access list | Returns inventory, role-filtered (owner sees all, guest hides prices) |
| GET | `/cache-status` | Access list | Cache freshness + BB worker status |
| POST | `/refresh` | Webhook secret | External trigger for cache refresh (Apps Script) |
| POST | `/refresh-blackbook` | Owner | Manual Black Book worker trigger |
| GET | `/vehicle-images?vin=` | Access list | Photo gallery URLs from Typesense CDN |

**Lib dependencies:** `lib/inventoryCache.ts` (`getCacheState`, `refreshCache`), `lib/blackBookWorker.ts` (`getBlackBookStatus`, `runBlackBookWorker`), `lib/auth.ts`

**Role-based field filtering:**
- Owner: all fields
- Viewer: hides `matrixPrice`, `cost`
- Guest: hides above + `bbAvgWholesale`, `bbValues`, `price`

---

### `carfax.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/carfax/batch-status` | Owner | Current batch run status |
| POST | `/carfax/run-batch` | Owner | Trigger full Carfax batch |
| POST | `/carfax/test` | Owner | Test Carfax lookup for up to 10 VINs |

**Lib dependencies:** `lib/carfaxWorker.ts` (`getCarfaxBatchStatus`, `runCarfaxWorker`, `runCarfaxWorkerForVins`)

---

### `lender.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/lender-programs` | Owner/Viewer | Returns cached lender program data |
| GET | `/lender-status` | Owner/Viewer | Sync status + last run info |
| POST | `/refresh-lender` | Owner | Trigger manual CreditApp sync |
| POST | `/lender-calculate` | Owner/Viewer | **Main calculator engine** — evaluates inventory against lender rules |
| GET | `/lender-debug` | Owner | Diagnostic dump of cached program metadata |

**Lib dependencies:** `lib/lenderWorker.ts` (program cache), `lib/lenderCalcEngine.ts` (cap profiles), `lib/inventoryCache.ts` (vehicle data), `lib/runtimeFingerprint.ts` (version tagging)

**Calculator flow** (see JSDoc on individual functions in `lender.ts`):
1. Validate params → load cached programs → find lender/program/tier
2. Resolve cap profile (`lenderCalcEngine.ts`) → compute LTV ceilings
3. Loop inventory: parse year/km → lookup term matrix → lookup condition matrix → get BB wholesale value
4. Determine selling price path (Tier 1 online / Tier 2 reduced / PAC fallback)
5. Compute LTV rooms (`computeRooms`) → stack products (`stackProducts`)
6. Settle loop: adjust down payment until LTV + payment constraints satisfied
7. Calculate final payment via `pmt()`, compute profit
8. Sort results by profit descending, return with debug counts

---

### `price-lookup.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/price-lookup?url=` | Session | Resolves a dealer listing URL to its current price via Typesense |

**Lib dependencies:** None (self-contained Typesense query)

**Note:** This route is defined as a standalone module but is not currently wired into `routes/index.ts`.
