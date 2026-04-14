import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const lenderSessionTable = pgTable("lender_session", {
  id:        text("id").primaryKey().default("singleton"),
  cookies:   text("cookies").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at"),
});
