import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id:          serial("id").primaryKey(),
  action:      text("action").notNull(),
  targetEmail: text("target_email").notNull(),
  changedBy:   text("changed_by").notNull(),
  roleFrom:    text("role_from"),
  roleTo:      text("role_to"),
  timestamp:   timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("audit_log_timestamp_idx").on(table.timestamp.desc()),
]);

export type AuditLogEntry = typeof auditLogTable.$inferSelect;
