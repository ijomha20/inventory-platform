# Backend Libraries

All paths relative to `artifacts/api-server/src/lib/`.

## File Index

### `auth.ts`
- **Exports:** `isOwner(email)`, `configurePassport()`
- **Purpose:** Google OAuth via Passport.js. Compares emails against `OWNER_EMAIL` env var.
- **Consumed by:** `app.ts` (passport init), all route files (owner checks)

### `inventoryCache.ts`
- **Exports:** `InventoryItem` (type), `getCacheState()`, `refreshCache()`, `applyCarfaxResults()`, `applyBlackBookValues()`, `startBackgroundRefresh()`
- **Purpose:** Central inventory data store. Loads from DB on startup, refreshes hourly from Apps Script JSON feed, enriches with Typesense (prices/URLs/photos) and BB values.
- **Consumed by:** `routes/inventory.ts`, `routes/lender.ts`, all workers (BB, Carfax)
- **Data flow:** Apps Script feed → normalize → Typesense enrichment → merge BB/Carfax → persist to DB

### `lenderCalcEngine.ts`
- **Exports:** `resolveCapProfile(input)`, `resolveNoOnlineSellingPrice(ctx)`, `NO_ONLINE_STRATEGY_BY_PROFILE`, type exports
- **Purpose:** Determines how LTV caps combine (advance/aftermarket/allIn) using a 3-bit key system. Resolves maximized selling price when no online listing exists.
- **Consumed by:** `routes/lender.ts` (calculator), `scripts/src/lender-engine.golden.test.ts` (tests)

### `lenderWorker.ts`
- **Exports:** `getLenderSyncStatus()`, `getCachedLenderPrograms()`, `loadLenderProgramsFromCache()`, `runLenderSync()`, `scheduleLenderSync()`
- **Purpose:** Syncs lender program matrices from CreditApp GraphQL API. Normalizes creditors (Santander, Eden Park, ACC, iAF, Quantifi, Rifco, in-house) into a uniform `LenderProgram[]` structure. Stores to GCS blob.
- **Consumed by:** `routes/lender.ts` (reads cached programs), `index.ts` (schedules sync)
- **Key mapping:** `CREDITOR_NAME_TO_CODE` maps CreditApp names → dealer codes (SAN, EPI, ACC, etc.)

### `lenderAuth.ts`
- **Exports:** `LENDER_ENABLED`, `getLenderAuthCookies()`, `callGraphQL()`, `graphqlHealthCheck()`
- **Purpose:** Authenticates to CreditApp admin portal, manages session cookies, provides GraphQL client.
- **Consumed by:** `lenderWorker.ts`
- **Required env:** `LENDER_CREDITAPP_EMAIL`, `LENDER_CREDITAPP_PASSWORD`

### `blackBookWorker.ts`
- **Exports:** `getBlackBookStatus()`, `runBlackBookWorker()`, `scheduleBlackBookWorker()`, `runBlackBookForVins(vins)`
- **Purpose:** Fetches Canadian Black Book wholesale valuations via CreditApp browser automation. Logs into admin.creditapp.ca, calls CBB API per VIN, matches best trim, stores results.
- **Consumed by:** `routes/inventory.ts` (manual trigger), `inventoryCache.ts` (new VIN detection), `index.ts` (scheduling)
- **Required env:** `CREDITAPP_EMAIL`, `CREDITAPP_PASSWORD`

### `carfaxWorker.ts`
- **Exports:** `CarfaxTestResult` (type), `getCarfaxBatchStatus()`, `runCarfaxWorker()`, `runCarfaxWorkerForVins(vins)`, `scheduleCarfaxWorker()`, `runCarfaxForNewVins(vins)`
- **Purpose:** Automates Carfax dealer portal (dealer.carfax.ca) via Puppeteer to resolve Vehicle History Report URLs per VIN.
- **Consumed by:** `routes/carfax.ts`, `inventoryCache.ts` (new VIN detection), `index.ts` (scheduling)
- **Required env:** `CARFAX_EMAIL`, `CARFAX_PASSWORD`, `CARFAX_ENABLED`
- **Note:** Only runs in dev environment (production containers lack persistent sessions)

### `bbObjectStore.ts`
- **Exports:** Load/save helpers for BB values, BB sessions, and lender programs (all via GCS). `parseBbEntry()`, lender program type definitions.
- **Purpose:** Shared GCS blob storage for cross-restart persistence of valuations, sessions, and program data.
- **Consumed by:** `blackBookWorker.ts`, `lenderWorker.ts`, `inventoryCache.ts`

### `emailService.ts`
- **Exports:** `sendInvitationEmail(toEmail, role, invitedBy)`
- **Purpose:** Sends HTML invitation emails via Resend when users are added to the access list.
- **Consumed by:** `routes/access.ts`
- **Optional env:** `RESEND_API_KEY`

### `logger.ts`
- **Exports:** `logger`
- **Purpose:** Pino structured logger with sensitive field redaction.
- **Consumed by:** All files

### `randomScheduler.ts`
- **Exports:** `toMountainDateStr()`, `scheduleRandomDaily(opts)`
- **Purpose:** Schedules daily tasks at random times within business hours (Mountain Time). Weekday window: 8:30 AM – 7 PM, weekend: 10 AM – 4 PM.
- **Consumed by:** `blackBookWorker.ts`, `carfaxWorker.ts`, `lenderWorker.ts`

### `runtimeFingerprint.ts`
- **Exports:** `getRuntimeFingerprint()`
- **Purpose:** Returns `{ calculatorVersion, gitSha }` for response tracing. Identifies which code version produced a calculation.
- **Consumed by:** `routes/lender.ts`

## Cross-Reference: Data Flow Between Files

```
lenderAuth.ts ──cookies──▶ lenderWorker.ts ──programs──▶ routes/lender.ts
                                                              │
                                                    lenderCalcEngine.ts
                                                    (cap profiles)
                                                              │
                                               inventoryCache.ts ◀── Apps Script feed
                                               (vehicle data)       ◀── Typesense
                                                    ▲       ▲
                                                    │       │
                                          bbObjectStore.ts  │
                                               ▲            │
                                               │            │
                                    blackBookWorker.ts   carfaxWorker.ts
```
