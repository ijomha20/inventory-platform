import { check, pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const carfaxSessionTable = pgTable("carfax_session", {
  id: text("id").primaryKey().default("singleton"),
  cookies: text("cookies"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at"),
  lastOutcome: text("last_outcome"),
  lastErrorReason: text("last_error_reason"),
  lastErrorMessage: text("last_error_message"),
  lastErrorAt: timestamp("last_error_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
}, (table) => [
  check("carfax_session_singleton", sql`${table.id} = 'singleton'`),
]);

