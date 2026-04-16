import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accessListTable = pgTable("access_list", {
  email:   text("email").primaryKey(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  addedBy: text("added_by").notNull(),
  role:    text("role").notNull().default("viewer"),
}, (table) => [
  check("access_list_role_check", sql`${table.role} IN ('viewer', 'guest')`),
]);

export type AccessListEntry = typeof accessListTable.$inferSelect;
