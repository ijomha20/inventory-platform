# Backend Libraries

All paths relative to `artifacts/api-server/src/lib/`.

## File Index

### `auth.ts`
- **Exports:** `isOwner(email)`, `getUserRole(email)`, `requireOwner`, `requireAccess`, `requireOwnerOrViewer`, `configurePassport()`, `UserRole` (type)
- **Purpose:** Google OAuth via Passport.js. Compares emails against `OWNER_EMAIL` env var. Provides shared Express middleware for role-based route gating.
- **Consumed by:** `app.ts` (passport init), all route files (auth middleware)

### `inventoryCache.ts`
- **Exports:** `InventoryItem` (type), `getCacheState()`, `refreshCache()`, `applyCarfaxResults()`, `applyBlackBookValues()`, `startBackgroundRefresh()`, `getFuzzyResolvedDoc(vin)`
- **Purpose:** Central inventory data store. Loads from DB on startup, refreshes hourly from Apps Script JSON feed, enriches with Typesense (prices/URLs/photos) and BB values.
- **Consumed by:** `routes/inventory.ts`, `routes/lender/`, all workers (BB, Carfax)
- **Data flow:** Apps Script feed → normalize → Typesense enrichment → merge BB/Carfax → persist to DB
- **Note:** `getFuzzyResolvedDoc(vin)` returns the Typesense doc resolved for a VIN (including fuzzy-match results); consumed by `routes/inventory.ts` `/vehicle-images` handler.

### `lenderCalcEngine.ts`
- **Exports:** `resolveCapProfile(input)`, `resolveNoOnlineSellingPrice(ctx)`, `NO_ONLINE_STRATEGY_BY_PROFILE`, type exports
- **Purpose:** Determines how LTV caps combine (advance/aftermarket/allIn) using a 3-bit key system. Resolves maximized selling price when no online listing exists.
- **Consumed by:** `routes/lender/lender-calculate.ts` (calculator), `scripts/src/lender-engine.golden.test.ts` (tests)

### `lenderWorker.ts`
- **Exports:** `getLenderSyncStatus()`, `getCachedLenderPrograms()`, `loadLenderProgramsFromCache()`, `runLenderSync()`, `scheduleLenderSync()`
- **Purpose:** Syncs lender program matrices from CreditApp GraphQL API. Normalizes creditors (Santander, Eden Park, ACC, iAF, Quantifi, Rifco, in-house) into a uniform `LenderProgram[]` structure. Stores to GCS blob.
- **Consumed by:** `routes/lender/` (reads cached programs), `index.ts` (schedules sync)
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

### `roleFilter.ts`
- **Exports:** `filterInventoryByRole(items, role)`
- **Purpose:** Strips role-gated fields from inventory items based on the calling user's role. Owner sees all fields; viewer hides `matrixPrice` and `cost`; guest hides those plus `bbAvgWholesale`, `bbValues`, and `price`.
- **Consumed by:** `routes/inventory.ts`

### `typesense.ts`
- **Exports:** `TYPESENSE_HOST`, `DealerCollection` (type), `DEALER_COLLECTIONS`, `DEALER_BY_HOSTNAME`, `IMAGE_CDN_BASE`, `typesenseSearch(dealer, params, timeoutMs?)`, `typesenseSearchUrl(collection, apiKey, params)`, `extractWebsiteUrl(doc, siteUrl)`, `extractDocVin(doc)`, `extractDocImagePaths(doc)`, `parseVehicleDescriptor(vehicle)`, `scoreFuzzyMatch(item, doc)`, `buildDocSummary(doc, collection, siteUrl)`, `LOCATION_TO_DEALER_NAME`, `TypesenseDocSummary` (type), `TypesenseSearchResponse<T>` (type), `ParsedVehicleDescriptor` (type)
- **Purpose:** Single source of truth for Typesense configuration, dealer collections, document extraction helpers, VIN normalization, fuzzy-match scoring, and typed Typesense API wrappers. All Typesense consumers import from here — never hardcode keys or collection IDs.
- **Consumed by:** `inventoryCache.ts` (batch enrichment, fuzzy fallback), `routes/price-lookup.ts` (live price lookup), `routes/inventory.ts` (vehicle images), `routes/ops.ts` (diagnostics probe)
- **Key patterns:**
  - `typesenseSearch` sends the API key in a **header** (not URL) — scoped keys contain `+`/`/`/`=` that corrupt URL encoding.
  - `probeField` pattern: `extractDocVin` tries 5 candidates; `extractOnlinePrice` tries `special_price`, `sale_price`, `price`, `internet_price`, `online_price`, `list_price` with `special_price_on` gating.
  - `scoreFuzzyMatch` gates on exact year + make/model substring, then scores trim tokens + km/price proximity. Minimum acceptance: 30 points.

### `env.ts`
- **Exports:** `env` (Zod-validated environment object), `isProduction`
- **Purpose:** Single source of truth for environment variables. Validates all required env vars at startup via Zod schemas. Exports `isProduction` flag for environment-dependent behavior.
- **Consumed by:** All files needing environment access

### `validate.ts`
- **Exports:** `validateBody(Schema)`, `validateQuery(Schema)`, `validateParams(Schema)`
- **Purpose:** Express middleware factories that validate request body/query/params against a Zod schema, returning 400 with structured errors on failure.
- **Consumed by:** `routes/access.ts`, `routes/inventory.ts`, `routes/lender/lender-calculate.ts`
- **Note:** `validateQuery` stores validated data on `req.validatedQuery` (typed via `Express.Request` extension in `types/passport.d.ts`) because Express 5 made `req.query` read-only.

### `runtimeFingerprint.ts`
- **Exports:** `getRuntimeFingerprint()`
- **Purpose:** Returns `{ calculatorVersion, gitSha }` for response tracing. Identifies which code version produced a calculation.
- **Consumed by:** `routes/lender/`

## Cross-Reference: Data Flow Between Files

```
lenderAuth.ts ──cookies──▶ lenderWorker.ts ──programs──▶ routes/lender/
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
