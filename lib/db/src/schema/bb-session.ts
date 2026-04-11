import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const bbSessionTable = pgTable("bb_session", {
  id:        text("id").primaryKey().default("singleton"),
  cookies:   text("cookies").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
