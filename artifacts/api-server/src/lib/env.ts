/**
 * Centralized environment access. Import `env` and `isProduction` from here
 * instead of reading process.env directly. Full Zod validation is added in
 * Phase 2a; this skeleton ensures a single production flag immediately.
 */

export const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
