import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const accessListTable = pgTable("access_list", {
  email:     text("email").primaryKey(),
  addedAt:   timestamp("added_at").defaultNow().notNull(),
  addedBy:   text("added_by").notNull(),
});

export type AccessListEntry = typeof accessListTable.$inferSelect;
