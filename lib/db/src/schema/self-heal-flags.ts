import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const selfHealFlagsTable = pgTable("self_heal_flags", {
  patchId: text("patch_id").primaryKey(),
  subsystem: text("subsystem").notNull(),
  flagState: text("flag_state").notNull(), // canary | promoted | rolled_back
  prUrl: text("pr_url"),
  incidentLogId: text("incident_log_id"),
  rollbackReason: text("rollback_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

