import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

export const inventoryCacheTable = pgTable("inventory_cache", {
  id:          integer("id").primaryKey(),
  data:        jsonb("data").notNull().default([]),
  lastUpdated: timestamp("last_updated").notNull(),
});
