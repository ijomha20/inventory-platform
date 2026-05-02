# Platform Pattern Catalog

Canonical examples for every shared utility in the platform. New code must follow
these patterns. Deviations require an inline comment explaining why.

See also: `AGENTS.md` (Anti-Patterns), `.cursorrules` (Cursor generation rules).

---

## 1. Environment Variables

Always import from `lib/env.ts`. Never read `process.env` directly.

```ts
import { env, isProduction } from "../lib/env.js";

const secret = env.SESSION_SECRET;
if (isProduction) { /* production-only path */ }
```

---

## 2. Route Authentication Middleware

Pick the right middleware for the route's access level:

```ts
import { requireOwner, requireAccess, requireOwnerOrViewer } from "../lib/auth.js";

// Owner only (BB refresh, lender sync, admin actions)
router.post("/refresh-blackbook", requireOwner, handler);

// Any listed user — owner, viewer, guest (inventory, calculator view)
router.get("/inventory", requireAccess, handler);

// Owner or viewer only (not guests)
router.get("/vehicle-images", requireOwnerOrViewer, handler);
```

`requireOwnerOrViewer` also sets `req._role` which the handler can read without
another DB query.

---

## 3. Request Validation (Zod)

```ts
import { validateBody, validateQuery, validateParams } from "../lib/validate.js";
import { z } from "zod";

const QuerySchema = z.object({
  vin: z.string().min(17).max(17),
});

// GET /foo?vin=XXX
router.get("/foo", validateQuery(QuerySchema), (req, res) => {
  // Validated data is on req.validatedQuery (typed unknown, narrow with cast)
  const { vin } = req.validatedQuery as z.infer<typeof QuerySchema>;
  res.json({ vin });
});
```

---

## 4. Typesense Searches

```ts
import { DEALER_COLLECTIONS, typesenseSearch } from "../lib/typesense.js";

// Find all docs for a dealer
const dealer = DEALER_COLLECTIONS[0]; // or look up via DEALER_BY_HOSTNAME
const params = new URLSearchParams({
  q: "*",
  filter_by: `vin:=[${vin}]`,
  per_page: "1",
});
const res = await typesenseSearch(dealer, params, 5000 /* ms timeout */);
if (!res.ok) throw new Error(`Typesense ${res.status}`);
const body = await res.json() as { hits?: Array<{ document: Record<string, unknown> }> };
```

**Key rule:** The API key is sent in a header, not the URL. `typesenseSearch` handles
this automatically — never construct the URL manually with the key.

---

## 5. Inventory Role Filtering

```ts
import { filterInventoryByRole } from "../lib/roleFilter.js";
import { getUserRole } from "../lib/auth.js";

router.get("/inventory", requireAccess, async (req, res) => {
  const role = await getUserRole(req) ?? "guest";
  const raw   = getCacheState().data;
  const items = filterInventoryByRole(raw, role);
  res.json(items);
});
```

Never strip fields inline (no `delete item.cost` scattered in handlers).

---

## 6. Structured Logging

```ts
import { logger } from "../lib/logger.js";

// Info — normal operation
logger.info({ vin, bbValue }, "BB value applied");

// Warn — recoverable issue
logger.warn({ url, status }, "Typesense lookup failed");

// Error — unexpected failure
logger.error({ err }, "Cache refresh failed");
```

Never use `console.log` / `console.error` in application code.

---

## 7. Randomized Worker Scheduling

```ts
import { scheduleRandomDaily } from "../lib/randomScheduler.js";

scheduleRandomDaily({
  name: "my-worker",
  windowStart: { hour: 8, minute: 30 },
  windowEnd:   { hour: 19, minute: 0 },
  weekendStart: { hour: 10, minute: 0 },
  weekendEnd:   { hour: 16, minute: 0 },
  run: async () => { /* your worker logic */ },
});
```

---

## 8. GCS Object Store (BB values, sessions, lender programs)

```ts
import {
  loadBbValuesFromStore,
  saveBbValuesToStore,
  loadBbSessionFromStore,
  saveBbSessionToStore,
  loadLenderProgramsFromStore,
  saveLenderProgramsToStore,
} from "../lib/bbObjectStore.js";

// Load + merge + save pattern (prevents partial runs from wiping prod data)
const existing = await loadBbValuesFromStore();
const merged   = { ...existing, ...newValues };
await saveBbValuesToStore(merged);
```

---

## 9. File Header Template

Every new `lib/*.ts` or `routes/*.ts` must open with:

```ts
/**
 * <Module Name>
 *
 * <Purpose: 1-2 sentences>
 *
 * Exports:
 *   export1  — description
 *   export2  — description
 *
 * Consumers: routes/foo.ts, lib/bar.ts
 *
 * Required env: ENV_VAR_ONE, ENV_VAR_TWO
 * Optional env: OPTIONAL_VAR
 *
 * Sections:   (omit for short files)
 *   1. Section name
 *   2. Section name
 */
```

---

## 10. Express 5 Async Handler Pattern

Express 5 propagates rejected promises automatically (no try/catch needed for
unhandled errors), but you must still handle expected error cases explicitly:

```ts
router.post("/foo", requireOwner, async (req, res) => {
  // Express 5: unhandled rejection → next(err) automatically
  const data = await doSomething(); // throws → 500 via error middleware

  if (!data) {
    res.status(404).json({ error: "Not found" });
    return; // important: always return after res.json/send/redirect
  }
  res.json(data);
});
```
