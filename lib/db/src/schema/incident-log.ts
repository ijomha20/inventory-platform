import { index, pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const incidentLogTable = pgTable("incident_log", {
  id: serial("id").primaryKey(),
  subsystem: text("subsystem").notNull(),
  reason: text("reason").notNull(),
  recoverability: text("recoverability").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("incident_log_subsystem_created_idx").on(table.subsystem, table.createdAt),
  index("incident_log_reason_created_idx").on(table.reason, table.createdAt),
]);

