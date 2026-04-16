import { check, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const inventoryCacheTable = pgTable("inventory_cache", {
  id:          integer("id").primaryKey(),
  data:        jsonb("data").notNull().default([]),
  lastUpdated: timestamp("last_updated").notNull(),
}, (table) => [
  check("inventory_cache_singleton", sql`${table.id} = 1`),
]);
