import { index, pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const deadLetterQueueTable = pgTable("dead_letter_queue", {
  id: serial("id").primaryKey(),
  subsystem: text("subsystem").notNull(),
  reason: text("reason").notNull(),
  payload: jsonb("payload").notNull(),
  enqueuedAt: timestamp("enqueued_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
}, (table) => [
  index("dead_letter_queue_subsystem_enqueued_idx").on(table.subsystem, table.enqueuedAt),
]);

