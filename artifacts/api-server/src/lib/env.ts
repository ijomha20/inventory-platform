/**
 * Centralized environment access. Import from here instead of process.env.
 * Validated at import time — the server crashes immediately with a clear
 * message if a required variable is missing or malformed.
 */
import { z } from "zod";

const optStr = z.string().trim().optional().default("");

const envSchema = z.object({
  PORT:                          z.coerce.number().int().positive().default(3000),
  NODE_ENV:                      z.string().trim().default("development"),
  REPLIT_DEPLOYMENT:             z.enum(["0", "1"]).default("0"),
  REPLIT_DOMAINS:                optStr,

  SESSION_SECRET:                z.string().trim().optional(),
  OWNER_EMAIL:                   z.string().trim().toLowerCase().default(""),

  GOOGLE_CLIENT_ID:              optStr,
  GOOGLE_CLIENT_SECRET:          optStr,

  DATABASE_URL:                  z.string().trim().default(""),

  INVENTORY_DATA_URL:            optStr,
  REFRESH_SECRET:                optStr,

  DEFAULT_OBJECT_STORAGE_BUCKET_ID: optStr,
  PRIVATE_OBJECT_DIR:            optStr,

  CREDITAPP_EMAIL:               optStr,
  CREDITAPP_PASSWORD:            optStr,
  CREDITAPP_TOTP_SECRET:         optStr,
  BB_CBB_ENDPOINT:               optStr,
  BB_SELF_HEAL_INTERVAL_MIN:     z.coerce.number().int().positive().default(120),
  BB_SELF_HEAL_STALE_HOURS:      z.coerce.number().int().positive().default(12),
  BB_ALLOW_PROD_BROWSER_LOGIN:   z.string().trim().toLowerCase()
                                   .transform((v) => v === "true")
                                   .default("true"),

  LENDER_CREDITAPP_EMAIL:        optStr,
  LENDER_CREDITAPP_PASSWORD:     optStr,
  LENDER_CREDITAPP_TOTP_SECRET:  optStr,
  LENDER_CREDITAPP_2FA_CODE:     optStr,

  CARFAX_EMAIL:                  optStr,
  CARFAX_PASSWORD:               optStr,
  CARFAX_ENABLED:                z.string().trim().toLowerCase()
                                   .transform((v) => v === "true")
                                   .default("false"),

  TYPESENSE_HOST:                z.string().trim().default("v6eba1srpfohj89dp-1.a1.typesense.net"),
  TYPESENSE_KEY_PARKDALE:        optStr,
  TYPESENSE_KEY_MATRIX:          optStr,
  TYPESENSE_COLLECTION_PARKDALE: z.string().trim().default("37042ac7ece3a217b1a41d6f54ba6855"),
  TYPESENSE_COLLECTION_MATRIX:   z.string().trim().default("cebacbca97920d818d57c6f0526d7413"),

  APPS_SCRIPT_WEB_APP_URL:       optStr,

  RESEND_API_KEY:                optStr,
  GITHUB_TOKEN:                  optStr,
  GH_TOKEN:                      optStr,
  SELF_HEAL_ENABLED:             z.string().trim().toLowerCase().transform((v) => v === "true").default("true"),
  SELF_HEAL_DRY_RUN:             z.string().trim().toLowerCase().transform((v) => v === "true").default("true"),
  SELF_HEAL_AUTOMERGE_ENABLED:   z.string().trim().toLowerCase().transform((v) => v === "true").default("false"),
  SELF_HEAL_GATE_ACTIVE:         z.string().trim().toLowerCase().transform((v) => v === "true").default("false"),
  SELF_HEAL_AUTOMERGE_FLAG_PATH: optStr,
  SELF_HEAL_HANDOFF_ALERT_HOURS: z.coerce.number().int().positive().default(4),

  GIT_SHA:                       optStr,
  REPL_GIT_COMMIT:               optStr,
  VERCEL_GIT_COMMIT_SHA:         optStr,

  LOG_LEVEL:                     z.string().trim().default("info"),
}).superRefine((data, ctx) => {
  const isProd = data.REPLIT_DEPLOYMENT === "1" || data.NODE_ENV === "production";
  if (isProd && !data.SESSION_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SESSION_SECRET"],
      message: "SESSION_SECRET is required in production",
    });
  }
}).transform((data) => ({
  ...data,
  SESSION_SECRET: data.SESSION_SECRET || "dev-secret-change-me",
}));

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`Environment validation failed:\n${formatted}`);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export const isProduction = env.REPLIT_DEPLOYMENT === "1" || env.NODE_ENV === "production";
