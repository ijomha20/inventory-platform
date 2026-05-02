import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const bbSessionTable = pgTable("bb_session", {
  id:        text("id").primaryKey().default("singleton"),
  cookies:   text("cookies").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at"),
  lastOutcome: text("last_outcome"),
  lastErrorReason: text("last_error_reason"),
  lastErrorMessage: text("last_error_message"),
  lastErrorAt: timestamp("last_error_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
}, (table) => [
  check("bb_session_singleton", sql`${table.id} = 'singleton'`),
]);
