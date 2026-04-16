# Database Schema

All tables defined via Drizzle ORM. Migrations are managed by Drizzle Kit (`drizzle.config.ts` in `lib/db/`).

## Tables

### `access_list` — `access.ts`
Stores approved users who can access the portal.

| Column | Type | Notes |
|--------|------|-------|
| `email` | text (PK) | User's email address |
| `added_at` | timestamp | Defaults to now |
| `added_by` | text | Email of the owner who added them |
| `role` | text | `"viewer"` or `"guest"` (default: `"viewer"`) |

- **Writers:** `routes/access.ts` (POST, PATCH, DELETE)
- **Readers:** `routes/auth.ts` (role lookup on `/me`), `routes/inventory.ts` (access check), `routes/lender.ts` (access check)

### `audit_log` — `audit-log.ts`
Records all access-list changes for accountability.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial (PK) | Auto-increment |
| `action` | text | `"add"`, `"remove"`, or `"role_change"` |
| `target_email` | text | The user being modified |
| `changed_by` | text | The owner who performed the action |
| `role_from` | text (nullable) | Previous role (for changes/removals) |
| `role_to` | text (nullable) | New role (for adds/changes) |
| `timestamp` | timestamp | Defaults to now |

- **Writers:** `routes/access.ts` (on every user modification)
- **Readers:** `routes/access.ts` (`GET /audit-log`)

### `inventory_cache` — `inventory-cache.ts`
Persists the full inventory JSON so the server can serve data immediately on restart.

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer (PK) | Always `1` (singleton row) |
| `data` | jsonb | Array of `InventoryItem` objects |
| `last_updated` | timestamp | When the cache was last refreshed |

- **Writers:** `lib/inventoryCache.ts` (`persistToDb` after refresh, Carfax apply, BB apply)
- **Readers:** `lib/inventoryCache.ts` (`loadFromDb` on startup)

### `bb_session` — `bb-session.ts`
Stores Black Book worker state for cross-restart persistence.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text (PK) | Always `"singleton"` |
| `cookies` | text | Serialized session cookies |
| `updated_at` | timestamp | Last cookie update |
| `last_run_at` | timestamp (nullable) | Last successful worker run |

- **Writers:** `lib/blackBookWorker.ts`
- **Readers:** `lib/blackBookWorker.ts` (schedule check), `lib/randomScheduler.ts` (has-run-today)

### `lender_session` — `lender-session.ts`
Stores lender sync worker state for cross-restart persistence.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text (PK) | Always `"singleton"` |
| `cookies` | text | Serialized session cookies |
| `updated_at` | timestamp | Last cookie update |
| `last_run_at` | timestamp (nullable) | Last successful sync run |

- **Writers:** `lib/lenderWorker.ts`
- **Readers:** `lib/lenderWorker.ts` (schedule check)
