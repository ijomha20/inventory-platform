# Inventory Platform — Complete Source Code

Generated: 2026-04-16 06:20 UTC

---

## Table of Contents

1. [Root Configuration](#root-configuration)
2. [API Server (artifacts/api-server)](#api-server)
3. [Inventory Portal (artifacts/inventory-portal)](#inventory-portal)
4. [Mockup Sandbox (artifacts/mockup-sandbox)](#mockup-sandbox)
5. [API Client React (lib/api-client-react)](#api-client-react)
6. [API Spec (lib/api-spec)](#api-spec)
7. [API Zod (lib/api-zod)](#api-zod)
8. [Database (lib/db)](#database)
9. [Scripts](#scripts)
10. [Templates](#templates)

---

---

## Root Configuration


### `package.json` (16 lines)

```json
{
  "name": "workspace",
  "version": "0.0.0",
  "license": "MIT",
  "scripts": {
    "preinstall": "sh -c 'rm -f package-lock.json yarn.lock; case \"$npm_config_user_agent\" in pnpm/*) ;; *) echo \"Use pnpm instead\" >&2; exit 1 ;; esac'",
    "build": "pnpm run typecheck && pnpm -r --if-present run build",
    "typecheck:libs": "tsc --build",
    "typecheck": "pnpm run typecheck:libs && pnpm -r --filter \"./artifacts/**\" --filter \"./scripts\" --if-present run typecheck"
  },
  "private": true,
  "devDependencies": {
    "typescript": "~5.9.2",
    "prettier": "^3.8.1"
  }
}

```


### `tsconfig.json` (16 lines)

```json
{
  "extends": "./tsconfig.base.json",
  "compileOnSave": false,
  "files": [],
  "references": [
    {
      "path": "./lib/db"
    },
    {
      "path": "./lib/api-client-react"
    },
    {
      "path": "./lib/api-zod"
    }
  ]
}

```


### `tsconfig.base.json` (25 lines)

```json
{
  "compilerOptions": {
    "isolatedModules": true,
    "lib": ["es2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmitOnError": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": false,
    "noImplicitReturns": true,
    "noUnusedLocals": false,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "strictNullChecks": true,
    "strictFunctionTypes": false,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true,
    "skipLibCheck": true,
    "target": "es2022",
    "types": [],
    "customConditions": ["workspace"]
  }
}

```


### `.replit` (43 lines)

```typescript
modules = ["nodejs-24", "postgresql-16"]

[[artifacts]]
id = "artifacts/api-server"

[[artifacts]]
id = "artifacts/mockup-sandbox"

[deployment]
router = "application"
deploymentTarget = "autoscale"

[deployment.postBuild]
args = ["pnpm", "store", "prune"]
env = { "CI" = "true" }

[workflows]
runButton = "Project"

[agent]
stack = "PNPM_WORKSPACE"
expertMode = true

[postMerge]
path = "scripts/post-merge.sh"
timeoutMs = 20000

[userenv]

[userenv.shared]

[nix]
channel = "stable-25_05"

[[ports]]
localPort = 3000
externalPort = 80

[[ports]]
localPort = 3002

[[ports]]
localPort = 3004

```


---

## API Server


### `artifacts/api-server/package.json` (48 lines)

```json
{
  "name": "@workspace/api-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "export NODE_ENV=development && pnpm run build && pnpm run start",
    "build": "node ./build.mjs",
    "start": "node --enable-source-maps ./dist/index.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@google-cloud/storage": "^7.19.0",
    "@workspace/api-zod": "workspace:*",
    "@workspace/db": "workspace:*",
    "connect-pg-simple": "^10.0.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2",
    "drizzle-orm": "catalog:",
    "express": "^5",
    "express-rate-limit": "^8.3.2",
    "express-session": "^1.19.0",
    "google-auth-library": "^10.6.2",
    "otplib": "^13.4.0",
    "passport": "^0.7.0",
    "passport-google-oauth20": "^2.0.0",
    "pino": "^9",
    "pino-http": "^10",
    "puppeteer": "^24.40.0",
    "puppeteer-extra": "^3.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "resend": "^6.10.0"
  },
  "devDependencies": {
    "@types/connect-pg-simple": "^7.0.3",
    "@types/cookie-parser": "^1.4.10",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/express-session": "^1.18.2",
    "@types/node": "catalog:",
    "@types/passport": "^1.0.17",
    "@types/passport-google-oauth20": "^2.0.17",
    "esbuild": "^0.27.3",
    "esbuild-plugin-pino": "^2.3.3",
    "pino-pretty": "^13",
    "thread-stream": "3.1.0"
  }
}

```


### `artifacts/api-server/tsconfig.json` (17 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [
    {
      "path": "../../lib/db"
    },
    {
      "path": "../../lib/api-zod"
    }
  ]
}

```


### `artifacts/api-server/build.mjs` (129 lines)

```javascript
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "connect-pg-simple",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "puppeteer-extra",
      "puppeteer-extra-plugin-stealth",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

```


### `artifacts/api-server/src/index.ts` (52 lines)

```typescript
import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundRefresh } from "./lib/inventoryCache";
import { scheduleCarfaxWorker } from "./lib/carfaxWorker";
import { scheduleBlackBookWorker } from "./lib/blackBookWorker";
import { scheduleLenderSync } from "./lib/lenderWorker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Carfax worker only runs in the dev environment — not on the production deployment.
// Production containers start fresh with no session file, causing guaranteed login failures.
const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";

// Load inventory from DB first (instant), then start background refresh cycle.
// await ensures the DB snapshot is in memory before we accept any requests.
startBackgroundRefresh().then(() => {
  if (isProduction) {
    logger.info("Production deployment — Carfax worker disabled");
  } else {
    scheduleCarfaxWorker();
  }

  // Black Book worker runs in both environments — manual trigger must work from production
  scheduleBlackBookWorker();

  // Lender sync worker — caches lender program matrices from CreditApp GraphQL
  scheduleLenderSync();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}).catch((err) => {
  logger.error({ err }, "Failed to initialise inventory cache — starting anyway");
  if (!isProduction) scheduleCarfaxWorker();
  scheduleBlackBookWorker();
  scheduleLenderSync();
  app.listen(port, () => logger.info({ port }, "Server listening (cache init failed)"));
});

```


### `artifacts/api-server/src/app.ts` (71 lines)

```typescript
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import passport from "passport";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { configurePassport } from "./lib/auth.js";

const app: Express = express();
const PgSession = connectPg(session);

// Trust Replit's proxy layer so express-rate-limit can identify clients correctly
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  })
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: false }),
    secret: (() => {
      const s = process.env["SESSION_SECRET"];
      if (!s && process.env["REPLIT_DEPLOYMENT"] === "1") {
        throw new Error("SESSION_SECRET is required in production");
      }
      return s || "dev-secret-change-me";
    })(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env["NODE_ENV"] === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting — 60 requests per minute per IP, applied to all API routes
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
  skip: (req) => req.path === "/api/healthz",
});

app.use("/api", apiLimiter);
app.use("/api", router);

export default app;

```


### `artifacts/api-server/src/types/passport.d.ts` (11 lines)

```typescript
declare global {
  namespace Express {
    interface User {
      email:   string;
      name:    string;
      picture: string;
    }
  }
}

export {};

```


### `artifacts/api-server/src/lib/logger.ts` (20 lines)

```typescript
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

```


### `artifacts/api-server/src/lib/runtimeFingerprint.ts` (35 lines)

```typescript
import { execSync } from "node:child_process";

const CALCULATOR_VERSION = "calculator-cap-profile-v2";

function readGitSha(): string {
  const env =
    process.env["GIT_SHA"]
    ?? process.env["REPL_GIT_COMMIT"]
    ?? process.env["VERCEL_GIT_COMMIT_SHA"];
  if (env && env.trim().length > 0 && env.trim() !== "unknown") {
    return env.trim();
  }

  // Replit / local dev often omit env SHAs; resolve from .git so responses prove which code is running
  try {
    const sha = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2500,
      cwd: process.cwd(),
    }).trim();
    if (sha.length >= 7) return sha;
  } catch {
    // git not installed or not a checkout
  }

  return "unknown";
}

export function getRuntimeFingerprint() {
  return {
    calculatorVersion: CALCULATOR_VERSION,
    gitSha: readGitSha(),
  };
}

```


### `artifacts/api-server/src/lib/auth.ts` (44 lines)

```typescript
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { logger } from "./logger.js";

const OWNER_EMAIL = (process.env["OWNER_EMAIL"] ?? "").toLowerCase().trim();
const CLIENT_ID     = process.env["GOOGLE_CLIENT_ID"]     ?? "";
const CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"] ?? "";

// Derive callback URL from REPLIT_DOMAINS (works in both dev and prod)
function getCallbackUrl(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (domain) return `https://${domain}/api/auth/google/callback`;
  return "http://localhost:8080/api/auth/google/callback";
}

export function isOwner(email: string): boolean {
  return !!OWNER_EMAIL && email.toLowerCase() === OWNER_EMAIL;
}

export function configurePassport() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    logger.warn("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth disabled");
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID:     CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        callbackURL:  getCallbackUrl(),
      },
      (_accessToken, _refreshToken, profile, done) => {
        const email   = profile.emails?.[0]?.value ?? "";
        const name    = profile.displayName ?? "";
        const picture = profile.photos?.[0]?.value ?? "";
        done(null, { email, name, picture });
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user as Express.User));
}

```


### `artifacts/api-server/src/lib/emailService.ts` (51 lines)

```typescript
import { Resend } from "resend";
import { logger } from "./logger.js";

const RESEND_API_KEY = process.env["RESEND_API_KEY"]?.trim() ?? "";
const APP_URL = (() => {
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  return domain ? `https://${domain}` : "https://script-reviewer.replit.app";
})();

export async function sendInvitationEmail(
  toEmail: string,
  role: string,
  invitedBy: string,
): Promise<void> {
  if (!RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — skipping invitation email");
    return;
  }

  const resend = new Resend(RESEND_API_KEY);
  const roleName = role === "guest" ? "Guest (prices hidden)" : "Viewer";

  try {
    await resend.emails.send({
      from:    "Inventory Portal <onboarding@resend.dev>",
      to:      toEmail,
      subject: "You've been invited to the Inventory Portal",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;">
          <h2 style="margin:0 0 8px;font-size:20px;color:#111;">You have been invited</h2>
          <p style="margin:0 0 20px;font-size:15px;color:#444;">
            <strong>${invitedBy}</strong> has given you <strong>${roleName}</strong> access
            to the Vehicle Inventory Portal.
          </p>
          <a href="${APP_URL}"
            style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;
                   text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
            Open Inventory Portal
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#888;">
            Sign in with the Google account associated with <strong>${toEmail}</strong>.
            If you don't have a Google account with this email, contact ${invitedBy}.
          </p>
        </div>
      `,
    });
    logger.info({ toEmail, role }, "Invitation email sent");
  } catch (err) {
    logger.error({ err, toEmail }, "Failed to send invitation email");
  }
}

```


### `artifacts/api-server/src/lib/randomScheduler.ts` (163 lines)

```typescript
import { logger } from "./logger.js";

const MOUNTAIN_TZ = "America/Edmonton";

interface DayWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const WEEKDAY_WINDOW: DayWindow = { startHour: 8, startMinute: 30, endHour: 19, endMinute: 0 };
const WEEKEND_WINDOW: DayWindow = { startHour: 10, startMinute: 0, endHour: 16, endMinute: 0 };

interface MountainTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

function getMountainComponents(d: Date = new Date()): MountainTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MOUNTAIN_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);

  const get = (type: string) => {
    const val = parts.find(p => p.type === type)?.value ?? "0";
    return parseInt(val, 10);
  };

  const weekdayStr = parts.find(p => p.type === "weekday")?.value ?? "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
    second: get("second"),
    dayOfWeek: dowMap[weekdayStr] ?? 0,
  };
}

export function toMountainDateStr(d: Date = new Date()): string {
  const mt = getMountainComponents(d);
  return `${mt.year}-${String(mt.month).padStart(2, "0")}-${String(mt.day).padStart(2, "0")}`;
}

function getWindowForDow(dow: number): DayWindow {
  return (dow === 0 || dow === 6) ? WEEKEND_WINDOW : WEEKDAY_WINDOW;
}

function mtMinutesSinceMidnight(mt: MountainTime): number {
  return mt.hour * 60 + mt.minute;
}

function windowStartMinutes(w: DayWindow): number {
  return w.startHour * 60 + w.startMinute;
}

function windowEndMinutes(w: DayWindow): number {
  return w.endHour * 60 + w.endMinute;
}

function randomInRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

export interface ScheduleOptions {
  name: string;
  hasRunToday: () => Promise<boolean> | boolean;
  execute: (reason: string) => void;
}

export function scheduleRandomDaily(opts: ScheduleOptions): void {
  const { name, hasRunToday, execute } = opts;

  const scheduleForDay = async () => {
    const alreadyRan = await hasRunToday();
    const mt = getMountainComponents();
    const w = getWindowForDow(mt.dayOfWeek);
    const nowMinutes = mtMinutesSinceMidnight(mt);
    const wStartMin = windowStartMinutes(w);
    const wEndMin = windowEndMinutes(w);

    if (alreadyRan) {
      logger.info({ name }, `${name}: already ran today — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    if (nowMinutes >= wEndMin) {
      logger.info({ name }, `${name}: past today's window — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    const effectiveStartMin = Math.max(wStartMin, nowMinutes + 1);
    if (effectiveStartMin >= wEndMin) {
      logger.info({ name }, `${name}: window too narrow — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    const chosenMinute = randomInRange(effectiveStartMin, wEndMin);
    const delayMs = minutesToMs(chosenMinute - nowMinutes);

    const chosenHour = Math.floor(chosenMinute / 60);
    const chosenMin = chosenMinute % 60;
    const period = chosenHour >= 12 ? "PM" : "AM";
    const displayHour = chosenHour > 12 ? chosenHour - 12 : chosenHour === 0 ? 12 : chosenHour;
    const timeStr = `${displayHour}:${String(chosenMin).padStart(2, "0")} ${period}`;

    logger.info({ name, scheduledFor: timeStr, delayMs }, `${name}: scheduled for ${timeStr} MT today`);

    setTimeout(async () => {
      const stillNeeded = !(await hasRunToday());
      if (!stillNeeded) {
        logger.info({ name }, `${name}: already ran (manual trigger?) — skipping scheduled fire`);
        scheduleNextDay(getMountainComponents());
        return;
      }
      logger.info({ name }, `${name}: randomized schedule firing now`);
      execute("randomized schedule");
      scheduleNextDay(getMountainComponents());
    }, delayMs);
  };

  const scheduleNextDay = (mt: MountainTime) => {
    const nextDow = (mt.dayOfWeek + 1) % 7;
    const nextW = getWindowForDow(nextDow);
    const nextWStartMin = windowStartMinutes(nextW);

    const minutesUntilMidnight = (24 * 60) - mtMinutesSinceMidnight(mt);
    const delayMs = minutesToMs(minutesUntilMidnight + nextWStartMin);
    const safeDelayMs = Math.max(delayMs, 60_000);

    const tomorrow = new Date(Date.now() + safeDelayMs);
    const nextDate = toMountainDateStr(tomorrow);
    logger.info({ name, nextDate, delayMs: safeDelayMs }, `${name}: will re-evaluate on ${nextDate}`);

    setTimeout(() => scheduleForDay(), safeDelayMs);
  };

  setTimeout(() => scheduleForDay(), 5_000);
}

```


### `artifacts/api-server/src/lib/bbObjectStore.ts` (216 lines)

```typescript
/**
 * bbObjectStore.ts
 *
 * Thin wrapper around Replit's GCS-backed object storage for two JSON blobs
 * that must be shared between the dev and production environments:
 *
 *   bb-session.json  — CreditApp session cookies (written by dev, read by both)
 *   bb-values.json   — VIN → bbAvgWholesale map (written by dev, read by both)
 *
 * Object storage is per-workspace (not per-environment), so the same bucket
 * is accessible from both dev and production deployments.
 */

import { Storage } from "@google-cloud/storage";
import { logger } from "./logger.js";

const SIDECAR = "http://127.0.0.1:1106";

const gcs = new Storage({
  credentials: {
    audience:            "replit",
    subject_token_type:  "access_token",
    token_url:           `${SIDECAR}/token`,
    type:                "external_account",
    credential_source: {
      url:    `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

function bucket() {
  const id = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!id) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return gcs.bucket(id);
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    const [contents] = await bucket().file(name).download();
    return JSON.parse(contents.toString("utf8")) as T;
  } catch (err: any) {
    if (err.code === 404 || err.message?.includes("No such object")) return null;
    logger.warn({ err: err.message, name }, "bbObjectStore: read failed");
    return null;
  }
}

async function writeJson(name: string, data: unknown): Promise<void> {
  try {
    await bucket().file(name).save(JSON.stringify(data), {
      contentType: "application/json",
    });
  } catch (err: any) {
    logger.warn({ err: err.message, name }, "bbObjectStore: write failed");
  }
}

// ---------------------------------------------------------------------------
// Session cookies (CreditApp auth — written by dev browser login)
// ---------------------------------------------------------------------------

export interface BbSessionBlob {
  cookies:   any[];
  updatedAt: string;
}

export async function loadSessionFromStore(): Promise<BbSessionBlob | null> {
  return readJson<BbSessionBlob>("bb-session.json");
}

export async function saveSessionToStore(cookies: any[]): Promise<void> {
  await writeJson("bb-session.json", {
    cookies,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// BB values map (VIN → bbAvgWholesale string — written by dev worker)
// ---------------------------------------------------------------------------

export interface BbValueEntry {
  avg:     string;
  xclean:  number;
  clean:   number;
  average: number;
  rough:   number;
}

export interface BbValuesBlob {
  values:    Record<string, string | BbValueEntry>;
  updatedAt: string;
}

export function parseBbEntry(raw: string | BbValueEntry): BbValueEntry | null {
  if (typeof raw === "object" && raw !== null && "avg" in raw) return raw as BbValueEntry;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    if (!isNaN(n) && cleaned.length > 0) return { avg: raw, xclean: 0, clean: 0, average: n, rough: 0 };
  }
  return null;
}

export async function loadBbValuesFromStore(): Promise<BbValuesBlob | null> {
  return readJson<BbValuesBlob>("bb-values.json");
}

export async function saveBbValuesToStore(values: Record<string, BbValueEntry>): Promise<void> {
  const existing = await loadBbValuesFromStore();
  const merged = existing?.values ? { ...existing.values } : {};
  for (const [vin, entry] of Object.entries(values)) {
    merged[vin.toUpperCase()] = entry;
  }
  await writeJson("bb-values.json", {
    values: merged,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Lender session cookies (CreditApp lender account — separate from BB)
// ---------------------------------------------------------------------------

export async function loadLenderSessionFromStore(): Promise<BbSessionBlob | null> {
  return readJson<BbSessionBlob>("lender-session.json");
}

export async function saveLenderSessionToStore(cookies: any[]): Promise<void> {
  await writeJson("lender-session.json", {
    cookies,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Lender programs cache (program matrices from CreditApp GraphQL)
// ---------------------------------------------------------------------------

export interface LenderProgramTier {
  tierName:         string;
  minRate:          number;
  maxRate:          number;
  maxPayment:       number;
  maxAdvanceLTV:    number;
  maxAftermarketLTV: number;
  maxAllInLTV:      number;
  creditorFee:      number;
  dealerReserve:    number;
}

export interface VehicleTermMatrixEntry {
  year: number;
  data: { term: number; kmFrom: number; kmTo: number }[];
}

export interface VehicleConditionMatrixEntry {
  year: number;
  extraClean: { kmFrom: number; kmTo: number };
  clean:      { kmFrom: number; kmTo: number };
  average:    { kmFrom: number; kmTo: number };
  rough:      { kmFrom: number; kmTo: number };
}

export interface LenderProgramGuide {
  programId:              string;
  programTitle:           string;
  programType:            string;
  tiers:                  LenderProgramTier[];
  vehicleTermMatrix:      VehicleTermMatrixEntry[];
  vehicleConditionMatrix: VehicleConditionMatrixEntry[];
  maxTerm?:               number;
  maxWarrantyPrice?:      number;
  maxGapPrice?:           number;
  maxAdminFee?:           number;
  /** CreditApp routing: when AH_INSURANCE, GAP sells in AH field; cap may be maxAhInsuranceFeeCalculation */
  gapInsuranceTarget?:    string | null;
  feeCalculationsRaw?: {
    maxExtendedWarrantyFeeCalculation?: string;
    maxGapInsuranceFeeCalculation?:     string;
    maxDealerAdminFeeCalculation?:       string;
    maxAhInsuranceFeeCalculation?:      string;
    resolvedGapCapSource?:             string;
  };
  capModelResolved?: "allInOnly" | "split" | "backendOnly" | "unknown";
  backendLtvCalculation?: string;
  allInLtvCalculation?: string;
  backendRemainingCalculation?: string;
  allInRemainingCalculation?: string;
  aftermarketBase?: "bbWholesale" | "salePrice" | "unknown";
  allInOnlyRules?: boolean;
  adminFeeInclusion?: "backend" | "allIn" | "excluded" | "unknown";
}

export interface LenderProgram {
  lenderCode:   string;
  lenderName:   string;
  creditorId:   string;
  programs:     LenderProgramGuide[];
}

export interface LenderProgramsBlob {
  programs:   LenderProgram[];
  updatedAt:  string;
}

export async function loadLenderProgramsFromStore(): Promise<LenderProgramsBlob | null> {
  return readJson<LenderProgramsBlob>("lender-programs.json");
}

export async function saveLenderProgramsToStore(data: LenderProgramsBlob): Promise<void> {
  await writeJson("lender-programs.json", data);
}

```


### `artifacts/api-server/src/lib/inventoryCache.ts` (470 lines)

```typescript
import { db, inventoryCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export interface InventoryItem {
  location:       string;
  vehicle:        string;
  vin:            string;
  price:          string;
  km:             string;
  carfax:         string;
  website:        string;
  onlinePrice:    string;
  matrixPrice:    string;   // Column F — matrix list price (owner only)
  cost:           string;   // Column G — business acquisition cost (owner only)
  hasPhotos:      boolean;
  bbAvgWholesale?: string;  // KM-adjusted average wholesale from Canadian Black Book (owner only)
  bbValues?: {
    xclean: number;
    clean:  number;
    avg:    number;
    rough:  number;
  };
}

interface CacheState {
  data:         InventoryItem[];
  lastUpdated:  Date | null;
  isRefreshing: boolean;
}

const state: CacheState = {
  data:         [],
  lastUpdated:  null,
  isRefreshing: false,
};

export function getCacheState(): CacheState {
  return state;
}

// ---------------------------------------------------------------------------
// Database persistence — load on startup, save after every successful fetch
// ---------------------------------------------------------------------------

async function loadFromDb(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(inventoryCacheTable)
      .where(eq(inventoryCacheTable.id, 1));

    if (rows.length > 0) {
      const row = rows[0];
      const items = row.data as InventoryItem[];
      if (Array.isArray(items) && items.length > 0) {
        state.data        = items;
        state.lastUpdated = row.lastUpdated;
        logger.info({ count: state.data.length }, "Inventory loaded from database — serving immediately");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Could not load inventory from database — will fetch fresh from source");
  }

  try {
    const { loadBbValuesFromStore, parseBbEntry } = await import("./bbObjectStore.js");
    const blob = await loadBbValuesFromStore();
    if (blob?.values) {
      let patched = 0;
      for (const item of state.data) {
        const raw = blob.values[item.vin.toUpperCase()];
        if (!raw) continue;
        const entry = parseBbEntry(raw);
        if (entry) {
          if (!item.bbAvgWholesale) { item.bbAvgWholesale = entry.avg; patched++; }
          if (!item.bbValues && (entry.xclean || entry.clean || entry.average || entry.rough)) {
            item.bbValues = { xclean: entry.xclean, clean: entry.clean, avg: entry.average, rough: entry.rough };
            patched++;
          }
        }
      }
      if (patched > 0) {
        logger.info({ patched }, "Inventory: BB values patched from shared object storage at startup");
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "Inventory: could not load BB values from object storage at startup (non-fatal)");
  }
}

async function persistToDb(): Promise<void> {
  if (!state.lastUpdated) return;
  try {
    await db
      .insert(inventoryCacheTable)
      .values({ id: 1, data: state.data, lastUpdated: state.lastUpdated })
      .onConflictDoUpdate({
        target: inventoryCacheTable.id,
        set: { data: state.data, lastUpdated: state.lastUpdated },
      });
    logger.info({ count: state.data.length }, "Inventory persisted to database");
  } catch (err) {
    logger.warn({ err }, "Could not persist inventory to database (non-fatal)");
  }
}

// ---------------------------------------------------------------------------
// Typesense — batch enrichment (prices + website URLs)
// ---------------------------------------------------------------------------

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

const TYPESENSE_COLLECTIONS = [
  {
    collection: "37042ac7ece3a217b1a41d6f54ba6855", // Parkdale (checked first — preferred)
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.parkdalemotors.ca",
  },
  {
    collection: "cebacbca97920d818d57c6f0526d7413", // Matrix
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.matrixmotorsyeg.ca",
  },
];

// Keep the old alias so the price function below still compiles
const PRICE_COLLECTIONS = TYPESENSE_COLLECTIONS;

function extractWebsiteUrl(doc: any, siteUrl: string): string | null {
  if (doc.page_url) {
    const path = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
    return `${siteUrl}/${path}/`;
  }
  const id   = doc.id || doc.post_id || doc.vehicle_id || "";
  let   slug = doc.slug || doc.url_slug || "";
  if (!slug && doc.year && doc.make && doc.model) {
    slug = [doc.year, doc.make, doc.model, doc.trim || ""]
      .filter((p: any) => String(p).trim() !== "")
      .join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  if (!id || !slug) return null;
  return `${siteUrl}/inventory/${slug}/${id}/`;
}

interface TypesenseMaps {
  prices:  Map<string, string>; // VIN → online price string
  website: Map<string, string>; // VIN → listing URL
  photos:  Set<string>;         // VINs that have image_urls
}

/**
 * Fetch ALL currently listed vehicles from Typesense in one bulk pass and
 * return both a price map and a website URL map.  Downloading the full
 * catalogue (~100–300 vehicles) is faster than per-VIN filtering.
 */
async function fetchFromTypesense(): Promise<TypesenseMaps> {
  const prices  = new Map<string, string>();
  const website = new Map<string, string>();
  const photos  = new Set<string>();

  for (const col of TYPESENSE_COLLECTIONS) {
    try {
      let page = 1;
      while (true) {
        const url =
          `https://${TYPESENSE_HOST}/collections/${col.collection}/documents/search` +
          `?q=*&per_page=250&page=${page}&x-typesense-api-key=${col.apiKey}`;

        const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) break;

        const body: any = await resp.json();
        const hits: any[] = body.hits ?? [];
        if (hits.length === 0) break;

        for (const hit of hits) {
          const doc = hit.document ?? {};
          const vin = (doc.vin ?? "").toString().trim().toUpperCase();
          if (!vin) continue;

          // Price — first collection that has this VIN wins
          if (!prices.has(vin)) {
            const specialOn    = Number(doc.special_price_on) === 1;
            const specialPrice = parseFloat(doc.special_price);
            const regularPrice = parseFloat(doc.price);
            const raw          = specialOn && specialPrice > 0 ? specialPrice : regularPrice;
            if (!isNaN(raw) && raw > 0) prices.set(vin, String(Math.round(raw)));
          }

          // Website URL — first collection that resolves one wins
          if (!website.has(vin)) {
            const resolved = extractWebsiteUrl(doc, col.siteUrl);
            if (resolved) website.set(vin, resolved);
          }

          // Photos — mark VIN if image_urls is non-empty
          if (doc.image_urls && doc.image_urls.toString().trim()) {
            photos.add(vin);
          }
        }

        if (hits.length < 250) break;
        page++;
      }
    } catch (err) {
      logger.warn({ err, collection: col.collection }, "Typesense fetch failed for collection");
    }
  }

  return { prices, website, photos };
}

// Keep old name as alias for any future callers
async function fetchOnlinePricesFromTypesense(): Promise<Map<string, string>> {
  return (await fetchFromTypesense()).prices;
}

// ---------------------------------------------------------------------------
// Cache refresh
// ---------------------------------------------------------------------------

export async function refreshCache(): Promise<void> {
  if (state.isRefreshing) return;
  state.isRefreshing = true;

  try {
    const dataUrl = process.env["INVENTORY_DATA_URL"]?.trim();
    if (!dataUrl) {
      logger.warn("INVENTORY_DATA_URL is not set — cache not populated");
      return;
    }

    const response = await fetch(dataUrl, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);

    const raw: any = await response.json();

    if (!Array.isArray(raw)) {
      logger.error({ type: typeof raw }, "Apps Script returned non-array — keeping stale cache");
      return;
    }
    if (raw.length === 0) {
      logger.warn("Apps Script returned empty array — keeping stale cache");
      return;
    }

    const existingBb = new Map<string, string>();
    const existingBbDetail = new Map<string, { xclean: number; clean: number; avg: number; rough: number }>();
    for (const old of state.data) {
      if (old.bbAvgWholesale) existingBb.set(old.vin.toUpperCase(), old.bbAvgWholesale);
      if (old.bbValues) existingBbDetail.set(old.vin.toUpperCase(), old.bbValues);
    }
    try {
      const { loadBbValuesFromStore, parseBbEntry } = await import("./bbObjectStore.js");
      const blob = await loadBbValuesFromStore();
      if (blob?.values) {
        for (const [vin, raw] of Object.entries(blob.values)) {
          if (!raw) continue;
          const entry = parseBbEntry(raw);
          if (entry) {
            existingBb.set(vin.toUpperCase(), entry.avg);
            if (entry.xclean || entry.clean || entry.average || entry.rough) {
              existingBbDetail.set(vin.toUpperCase(), { xclean: entry.xclean, clean: entry.clean, avg: entry.average, rough: entry.rough });
            }
          }
        }
        logger.info({ count: Object.keys(blob.values).length }, "Inventory: BB values loaded from shared object storage");
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Inventory: could not load BB values from object storage (non-fatal)");
    }

    // Normalise each item — guard against differing field names / missing keys
    const items: InventoryItem[] = [];
    for (const r of raw) {
      if (!r || typeof r !== "object") {
        logger.warn({ r }, "Skipping malformed inventory item");
        continue;
      }
      const vin = String(r.vin ?? "").trim().toUpperCase();
      items.push({
        location:       String(r.location    ?? "").trim(),
        vehicle:        String(r.vehicle     ?? "").trim(),
        vin,
        price:          String(r.price       ?? "").trim(),
        km:             String(r.km          ?? "").trim(),
        carfax:         String(r.carfax      ?? "").trim(),
        website:        String(r.website     ?? "").trim(),
        onlinePrice:    String(r.onlinePrice ?? "").trim(),
        matrixPrice:    String(r.matrixPrice ?? "").trim(), // Column F
        cost:           String(r.cost        ?? "").trim(), // Column G
        hasPhotos:      false,
        bbAvgWholesale: existingBb.get(vin),
        bbValues:       existingBbDetail.get(vin),
      });
    }

    // -----------------------------------------------------------------------
    // Enrich with Typesense data (prices + website URLs) in a single pass
    // -----------------------------------------------------------------------
    const needEnrichment = items.some(
      (item) =>
        !item.onlinePrice || item.onlinePrice === "NOT FOUND" ||
        !item.website     || item.website     === "NOT FOUND",
    );

    if (needEnrichment) {
      const { prices, website, photos } = await fetchFromTypesense();

      for (const item of items) {
        if (!item.onlinePrice || item.onlinePrice === "NOT FOUND") {
          const fetched = prices.get(item.vin.toUpperCase());
          if (fetched) item.onlinePrice = fetched;
        }
        if (!item.website || item.website === "NOT FOUND") {
          const fetched = website.get(item.vin.toUpperCase());
          if (fetched) item.website = fetched;
        }
        item.hasPhotos = photos.has(item.vin.toUpperCase());
      }

      logger.info(
        { prices: prices.size, websiteUrls: website.size, total: items.length },
        "Typesense enrichment complete",
      );
    }

    const previousVins = new Set(state.data.map(i => i.vin.toUpperCase()).filter(v => v.length > 0));

    state.data        = items;
    state.lastUpdated = new Date();
    logger.info({ count: items.length }, "Inventory cache refreshed");

    // Persist the fresh data to the database so future restarts load instantly
    await persistToDb();

    if (previousVins.size > 0) {
      const newVins = [...new Set(
        items
          .map(i => i.vin.toUpperCase())
          .filter(v => v.length >= 10 && !previousVins.has(v)),
      )];

      if (newVins.length > 0) {
        logger.info({ count: newVins.length, vins: newVins }, "New VINs detected during inventory refresh");
        triggerNewVinLookups(newVins);
      }
    }
  } catch (err) {
    logger.error({ err }, "Inventory cache refresh failed — serving stale data");
  } finally {
    state.isRefreshing = false;
  }
}

// ---------------------------------------------------------------------------
// Carfax — apply targeted lookup results to cache
// ---------------------------------------------------------------------------

export async function applyCarfaxResults(results: Map<string, string>): Promise<void> {
  if (results.size === 0) return;
  if (!state.lastUpdated) {
    logger.warn("Carfax results received but inventory cache not yet loaded — skipping");
    return;
  }
  let updated = 0;
  for (const item of state.data) {
    const vinKey = item.vin.toUpperCase();
    const val = results.get(vinKey);
    if (val !== undefined) {
      item.carfax = val;
      updated++;
    }
  }
  if (updated > 0) {
    await persistToDb();
    logger.info({ updated, total: state.data.length }, "Carfax results applied to inventory cache");
  }
}

// ---------------------------------------------------------------------------
// New-VIN detection — trigger targeted BB and Carfax lookups
// ---------------------------------------------------------------------------

function triggerNewVinLookups(newVins: string[]): void {
  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";

  import("./blackBookWorker.js").then(({ runBlackBookForVins }) => {
    runBlackBookForVins(newVins).catch(err =>
      logger.error({ err }, "Targeted BB lookup for new VINs failed"),
    );
  }).catch(err => logger.error({ err }, "Failed to import blackBookWorker for targeted run"));

  if (!isProduction) {
    import("./carfaxWorker.js").then(({ runCarfaxForNewVins }) => {
      runCarfaxForNewVins(newVins).catch(err =>
        logger.error({ err }, "Targeted Carfax lookup for new VINs failed"),
      );
    }).catch(err => logger.error({ err }, "Failed to import carfaxWorker for targeted run"));
  } else {
    logger.info("Production deployment — skipping targeted Carfax lookup for new VINs");
  }
}

// ---------------------------------------------------------------------------
// Black Book — apply values from worker run
// ---------------------------------------------------------------------------

export async function applyBlackBookValues(
  bbMap: Map<string, string>,
  bbDetailMap?: Map<string, { xclean: number; clean: number; avg: number; rough: number }>,
): Promise<void> {
  if (bbMap.size === 0) return;
  if (!state.lastUpdated) {
    logger.warn("BB values received but inventory cache not yet loaded — skipping persist");
    return;
  }
  let updated = 0;
  for (const item of state.data) {
    const vinKey = item.vin.toUpperCase();
    const val = bbMap.get(vinKey);
    if (val !== undefined) {
      item.bbAvgWholesale = val;
      const detail = bbDetailMap?.get(vinKey);
      if (detail) item.bbValues = detail;
      updated++;
    }
  }
  if (updated > 0) {
    await persistToDb();
    logger.info({ updated, total: state.data.length }, "Black Book values applied to inventory");
  }
}

export async function startBackgroundRefresh(intervalMs = 60 * 60 * 1000): Promise<void> {
  // Step 1: load the last-known inventory from the database immediately.
  // Users see data right away — no waiting for Apps Script on startup.
  await loadFromDb();

  // Step 2: kick off a fresh fetch in the background.
  // If it succeeds, the in-memory cache and DB are both updated.
  // If it fails, we already have the DB snapshot serving users.
  async function fetchWithRetry(attempt = 1): Promise<void> {
    try {
      await refreshCache();
      if (state.data.length === 0 && attempt <= 3) {
        const delay = attempt * 30_000;
        logger.warn({ attempt, delayMs: delay }, "Cache still empty after refresh — retrying");
        setTimeout(() => fetchWithRetry(attempt + 1), delay);
      }
    } catch (err) {
      logger.error({ err, attempt }, "Inventory cache fetch failed");
      if (attempt <= 3) {
        const delay = attempt * 30_000;
        logger.info({ delayMs: delay }, "Scheduling retry");
        setTimeout(() => fetchWithRetry(attempt + 1), delay);
      }
    }
  }

  fetchWithRetry();

  // Step 3: hourly refresh keeps the data current
  setInterval(() => {
    refreshCache().catch((err) =>
      logger.error({ err }, "Background inventory cache refresh failed"),
    );
  }, intervalMs);
}

```


### `artifacts/api-server/src/lib/blackBookWorker.ts` (977 lines)

```typescript
/**
 * Black Book Worker
 *
 * Runs daily at a random time during business hours (Mountain Time).
 * Manual trigger via POST /api/refresh-blackbook (owner only).
 *
 * Flow:
 *  1. Login to admin.creditapp.ca via Auth0 (Puppeteer + stealth)
 *  2. Extract appSession + CA_CSRF_TOKEN cookies → close browser
 *  3. Health-check POST /api/cbb/find before processing any VINs
 *  4. For each VIN in inventory: POST /api/cbb/find with VIN + KM
 *  5. Validate response fields are present
 *  6. Match best trim via vehicle string scoring (conservative fallback)
 *  7. Apply adjusted_whole_avg values to inventory cache
 *  8. On any failure: self-heal with exponential backoff — no notifications
 *
 * REQUIRED SECRETS: CREDITAPP_EMAIL, CREDITAPP_PASSWORD
 * OPTIONAL SECRET:  BB_CBB_ENDPOINT (defaults to confirmed URL)
 */

import { logger }                         from "./logger.js";
import * as fs                            from "fs";
import * as path                          from "path";
import { getCacheState, applyBlackBookValues } from "./inventoryCache.js";
import {
  loadSessionFromStore,
  saveSessionToStore,
  saveBbValuesToStore,
} from "./bbObjectStore.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREDITAPP_EMAIL    = process.env["CREDITAPP_EMAIL"]?.trim()    ?? "";
const CREDITAPP_PASSWORD = process.env["CREDITAPP_PASSWORD"]?.trim() ?? "";
const BB_ENABLED         = !!(CREDITAPP_EMAIL && CREDITAPP_PASSWORD);

const CBB_ENDPOINT    = process.env["BB_CBB_ENDPOINT"]?.trim() ?? "https://admin.creditapp.ca/api/cbb/find";
const CREDITAPP_HOME  = "https://admin.creditapp.ca";
const LOGIN_URL       = "https://admin.creditapp.ca/api/auth/login";
const SESSION_FILE    = path.join(process.cwd(), ".creditapp-session.json");

// VIN used for the health check before batch (Toyota Corolla — confirmed working)
const HEALTH_CHECK_VIN = "2T1BU4EE6DC038563";
const HEALTH_CHECK_KM  = 145000;

const AUTH0_EMAIL_SELECTORS = ["#username", 'input[name="username"]', 'input[type="email"]'];
const AUTH0_PASS_SELECTORS  = ["#password", 'input[name="password"]', 'input[type="password"]'];

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

interface BbStatus {
  running:   boolean;
  startedAt: string | null;
  lastRun:   string | null;
  lastCount: number;
}

const status: BbStatus = { running: false, startedAt: null, lastRun: null, lastCount: 0 };

export function getBlackBookStatus(): BbStatus {
  return { ...status };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseKm(kmStr: string): number {
  const n = parseInt(kmStr.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// Session persistence — file + database (shared between dev and prod)
// ---------------------------------------------------------------------------

function loadCookiesFromFile(): any[] {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw     = fs.readFileSync(SESSION_FILE, "utf8");
      const cookies = JSON.parse(raw);
      logger.info({ count: cookies.length }, "BB worker: loaded session cookies from file");
      return cookies;
    }
  } catch (_) {}
  return [];
}

function saveCookiesToFile(cookies: any[]): void {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2), "utf8");
  } catch (_) {}
}

async function loadCookiesFromDb(): Promise<any[]> {
  try {
    const { db, bbSessionTable } = await import("@workspace/db");
    const { eq }                 = await import("drizzle-orm");
    const rows = await db.select().from(bbSessionTable).where(eq(bbSessionTable.id, "singleton"));
    if (rows.length === 0) {
      logger.warn("BB worker: bb_session row not found in database (no data seeded yet)");
      return [];
    }
    if (!rows[0].cookies) {
      logger.warn("BB worker: bb_session cookies field is null/empty");
      return [];
    }
    const cookies = JSON.parse(rows[0].cookies);
    logger.info({ count: cookies.length }, "BB worker: loaded session cookies from database");
    return cookies;
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not load session from database");
  }
  return [];
}

async function saveCookiesToDb(cookies: any[]): Promise<void> {
  try {
    const { db, bbSessionTable } = await import("@workspace/db");
    await db
      .insert(bbSessionTable)
      .values({ id: "singleton", cookies: JSON.stringify(cookies), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: bbSessionTable.id,
        set:    { cookies: JSON.stringify(cookies), updatedAt: new Date() },
      });
    logger.info({ count: cookies.length }, "BB worker: session cookies saved to database");
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not save session to database");
  }
}

function extractAuthCookies(cookies: any[]): { appSession: string; csrfToken: string } | null {
  const appSession = cookies.find((c: any) => c.name === "appSession");
  const csrfToken  = cookies.find((c: any) => c.name === "CA_CSRF_TOKEN");
  if (!appSession || !csrfToken) return null;
  return { appSession: appSession.value, csrfToken: csrfToken.value };
}

/**
 * Get valid auth cookies — tries object storage first (shared between dev + prod),
 * then DB, then file, then (dev only) full browser login.
 *
 * Object storage (GCS-backed) is the primary shared store.
 * In production, browser login is skipped entirely — dev's nightly run keeps
 * cookies fresh in the shared object storage bucket.
 */
async function getAuthCookies(): Promise<{ appSession: string; csrfToken: string }> {
  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";

  // 1. Object storage (shared between dev + prod — primary source)
  try {
    const blob = await loadSessionFromStore();
    if (blob?.cookies?.length) {
      const auth = extractAuthCookies(blob.cookies);
      if (auth) {
        const ok = await healthCheck(auth.appSession, auth.csrfToken);
        if (ok) {
          logger.info("BB worker: object-storage session valid — skipping browser login");
          return auth;
        }
        logger.info({ isProduction }, "BB worker: object-storage session expired");
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "BB worker: could not load session from object storage");
  }

  // 2. Database cookies (fallback — only visible to the env that wrote them)
  const dbCookies = await loadCookiesFromDb();
  if (dbCookies.length > 0) {
    const auth = extractAuthCookies(dbCookies);
    if (auth) {
      const ok = await healthCheck(auth.appSession, auth.csrfToken);
      if (ok) {
        logger.info("BB worker: database session valid — promoting to object storage");
        await saveSessionToStore(dbCookies);
        return auth;
      }
      logger.info("BB worker: database session expired");
    }
  }

  // 3. File cookies (dev convenience)
  const fileCookies = loadCookiesFromFile();
  if (fileCookies.length > 0) {
    const auth = extractAuthCookies(fileCookies);
    if (auth) {
      const ok = await healthCheck(auth.appSession, auth.csrfToken);
      if (ok) {
        logger.info("BB worker: file session valid — promoting to object storage + database");
        await saveSessionToStore(fileCookies);
        await saveCookiesToDb(fileCookies);
        return auth;
      }
      logger.info("BB worker: file session expired");
    }
  }

  // 4. Production: no browser login — cookies must come from dev's nightly run
  if (isProduction) {
    throw new Error(
      "BB worker: session cookies expired in production — dev's nightly 2am run will refresh them. " +
      "Values remain from the last successful run.",
    );
  }

  // 5. Dev only: full browser login to refresh cookies
  logger.info("BB worker: launching browser for fresh login (dev)");
  let browser: any = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await addAntiDetection(page);

    const loggedIn = await loginWithAuth0(page);
    if (!loggedIn) throw new Error("Login to CreditApp failed");

    const cookies = await page.cookies();
    const auth    = extractAuthCookies(cookies);
    if (!auth) throw new Error("Required auth cookies not found after login");

    // Persist to object storage (shared), DB, and local file
    await saveSessionToStore(cookies);
    await saveCookiesToDb(cookies);
    saveCookiesToFile(cookies);

    return auth;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function launchBrowser(): Promise<any> {
  let puppeteer: any;
  try {
    puppeteer = (await import("puppeteer-extra")).default;
    const Stealth = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(Stealth());
    logger.info("BB worker: using puppeteer-extra + stealth");
  } catch (_) {
    puppeteer = (await import("puppeteer")).default;
    logger.warn("BB worker: stealth not available — using plain puppeteer");
  }

  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process");
    const found = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) { executablePath = found; logger.info({ executablePath }, "BB worker: using system Chromium"); }
  } catch (_) {}

  return puppeteer.launch({
    headless: "new" as any,
    executablePath,
    timeout: 90_000,
    protocolTimeout: 90_000,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-gpu", "--no-zygote", "--disable-blink-features=AutomationControlled",
      "--no-first-run", "--no-default-browser-check", "--disable-infobars",
      "--window-size=1280,900",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function addAntiDetection(page: any): Promise<void> {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8" });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
}

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

async function findSelector(page: any, selectors: string[], timeout = 8000): Promise<any> {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout });
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

async function humanType(page: any, element: any, text: string): Promise<void> {
  await element.click();
  await sleep(rand(80, 200));
  for (const ch of text) {
    await element.type(ch, { delay: 0 });
    await sleep(rand(60, 150));
  }
  await sleep(rand(200, 400));
}

// ---------------------------------------------------------------------------
// 2FA dismissal
// ---------------------------------------------------------------------------

async function dismiss2FA(page: any): Promise<void> {
  await sleep(2000);
  const dismissed = await page.evaluate(() => {
    const phrases = ["remind me later", "skip", "not now", "maybe later", "do it later"];
    const els = Array.from(document.querySelectorAll("button, a, [role='button']"));
    for (const el of els) {
      const t = ((el as HTMLElement).textContent ?? "").toLowerCase().trim();
      if (phrases.some((p) => t.includes(p))) {
        (el as HTMLElement).click();
        return (el as HTMLElement).textContent?.trim() ?? "unknown";
      }
    }
    return null;
  });
  if (dismissed) logger.info({ dismissed }, "BB worker: 2FA prompt dismissed");
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function isLoggedIn(page: any): Promise<boolean> {
  try {
    await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(2000);
    const url     = page.url() as string;
    const content = (await page.content() as string).toLowerCase();
    const onAuth  = url.includes("auth0.com") || url.includes("/login");
    const hasDash = content.includes("application") || content.includes("dashboard") || content.includes("deal");
    return !onAuth && hasDash;
  } catch {
    return false;
  }
}

async function loginWithAuth0(page: any): Promise<boolean> {
  logger.info("BB worker: navigating to CreditApp login");
  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  } catch (err: any) {
    logger.error({ err: err.message }, "BB worker: login page navigation failed");
    return false;
  }
  await sleep(2000);

  const emailInput = await findSelector(page, AUTH0_EMAIL_SELECTORS, 12_000);
  if (!emailInput) { logger.error("BB worker: email input not found"); return false; }
  await humanType(page, emailInput, CREDITAPP_EMAIL);

  // Some Auth0 configs need a "Continue" click before the password field appears
  const maybeBtn = await findSelector(page, ['button[type="submit"]'], 2000);
  if (maybeBtn) { await maybeBtn.click(); await sleep(2000); }

  const passInput = await findSelector(page, AUTH0_PASS_SELECTORS, 8_000);
  if (!passInput) { logger.error("BB worker: password input not found"); return false; }
  await humanType(page, passInput, CREDITAPP_PASSWORD);

  const submitBtn = await findSelector(page, ['button[type="submit"]', 'button[name="action"]'], 5000);
  if (submitBtn) { await submitBtn.click(); }

  await sleep(4000);
  try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }); } catch (_) {}
  await sleep(2000);

  await dismiss2FA(page);
  await sleep(1500);

  const ok = await isLoggedIn(page);
  logger.info({ ok }, "BB worker: login result");
  return ok;
}

async function ensureLoggedIn(page: any): Promise<boolean> {
  const saved = loadSavedCookies();
  if (saved.length > 0) {
    logger.info("BB worker: trying saved session cookies");
    await page.setCookie(...saved);
    if (await isLoggedIn(page)) {
      logger.info("BB worker: saved session valid");
      return true;
    }
    logger.info("BB worker: saved session expired — re-logging in");
  }
  return loginWithAuth0(page);
}

// ---------------------------------------------------------------------------
// Direct API call — no browser needed after login
// ---------------------------------------------------------------------------

async function callCbbEndpoint(appSession: string, csrfToken: string, vin: string, km: number): Promise<any[]> {
  const resp = await fetch(CBB_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type":           "application/json",
      "accept":                 "*/*",
      "origin":                 "https://admin.creditapp.ca",
      "referer":                "https://admin.creditapp.ca/",
      "x-creditapp-csrf-token": csrfToken,
      "cookie":                 `appSession=${appSession}; CA_CSRF_TOKEN=${csrfToken}`,
      "user-agent":             "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ vin, province: "AB", kilometers: km, frequency: "DEFAULT", kmsperyear: 0 }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`CBB endpoint returned HTTP ${resp.status}`);

  const data = await resp.json();
  if (!Array.isArray(data)) throw new Error(`CBB endpoint returned non-array: ${typeof data}`);
  return data;
}

// ---------------------------------------------------------------------------
// Health check — validates endpoint before processing any VINs
// ---------------------------------------------------------------------------

async function healthCheck(appSession: string, csrfToken: string): Promise<boolean> {
  try {
    const data = await callCbbEndpoint(appSession, csrfToken, HEALTH_CHECK_VIN, HEALTH_CHECK_KM);
    if (!Array.isArray(data) || data.length === 0) {
      logger.warn({ data }, "BB worker: health check — empty or non-array response");
      return false;
    }
    const ok = "adjusted_whole_avg" in data[0] && "uvc" in data[0];
    if (!ok) logger.warn({ keys: Object.keys(data[0]) }, "BB worker: health check — unexpected response structure");
    return ok;
  } catch (err: any) {
    logger.warn({ err: err.message ?? String(err), cause: err.cause?.message }, "BB worker: health check failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// NHTSA — free VIN decode for trim matching
// ---------------------------------------------------------------------------

interface NhtsaInfo {
  trim:         string;
  series:       string;
  bodyClass:    string;
  driveType:    string;
  displacement: string;
  cylinders:    string;
  fuelType:     string;
}

const EMPTY_NHTSA: NhtsaInfo = { trim: "", series: "", bodyClass: "", driveType: "", displacement: "", cylinders: "", fuelType: "" };

const nhtsaCache = new Map<string, NhtsaInfo>();

async function decodeVinNhtsa(vin: string): Promise<NhtsaInfo> {
  const key = vin.toUpperCase();
  const cached = nhtsaCache.get(key);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!resp.ok) return { ...EMPTY_NHTSA };
    const body: any = await resp.json();
    const results: any[] = body?.Results ?? [];
    const get = (variable: string) =>
      (results.find((r) => r.Variable === variable)?.Value ?? "").toString().trim();
    const info: NhtsaInfo = {
      trim:         get("Trim"),
      series:       get("Series"),
      bodyClass:    get("Body Class"),
      driveType:    get("Drive Type"),
      displacement: get("Displacement (L)"),
      cylinders:    get("Engine Number of Cylinders"),
      fuelType:     get("Fuel Type - Primary"),
    };
    nhtsaCache.set(key, info);
    return info;
  } catch {
    return { ...EMPTY_NHTSA };
  }
}

// ---------------------------------------------------------------------------
// Trim matching
// ---------------------------------------------------------------------------

const NOISE_WORDS = new Set([
  "the","and","or","of","in","for","with","a","an","to",
  "2wd","4wd","awd","fwd","rwd","4x4",
  "white","black","silver","grey","gray","red","blue","green",
  "burgundy","brown","gold","beige","orange","yellow","purple",
]);

const MULTI_WORD_MODELS = new Set([
  "grand caravan", "grand cherokee", "grand marquis", "grand prix",
  "grand vitara", "town car", "monte carlo", "land cruiser",
  "rav4", "cr-v", "cx-5", "cx-9", "hr-v", "br-v",
  "e-pace", "f-pace", "f-type", "range rover",
  "model 3", "model s", "model x", "model y",
  "wrangler unlimited", "sierra 1500", "sierra 2500", "sierra 3500",
  "ram 1500", "ram 2500", "ram 3500",
]);

function tokenize(s: string): string[] {
  const tokens: string[] = [];
  const parts = s.toLowerCase().split(/[\s,\-()]+/).filter(Boolean);
  for (const p of parts) {
    if (p.includes("/") && p.length <= 5) {
      tokens.push(p);
    } else if (p.includes("/")) {
      tokens.push(...p.split("/").filter(t => t.length >= 2));
    } else if (p.length >= 2) {
      tokens.push(p);
    }
  }
  return tokens;
}

function trimTokens(vehicleStr: string, make: string, model: string): string[] {
  const all = tokenize(vehicleStr);
  const makeTokens  = tokenize(make || "");
  const modelTokens = tokenize(model || "");
  const skip = new Set([...makeTokens, ...modelTokens]);
  return all.filter(t => !skip.has(t) && !NOISE_WORDS.has(t) && !/^\d{4}$/.test(t) && !/^\d+$/.test(t));
}

function extractMakeModel(vehicleStr: string): { make: string; model: string } {
  const parts = vehicleStr.trim().split(/\s+/);
  const startIdx = (parts.length >= 3 && /^\d{4}$/.test(parts[0])) ? 1 : 0;
  if (startIdx >= parts.length) return { make: "", model: "" };
  const make = parts[startIdx] || "";
  const remaining = parts.slice(startIdx + 1).join(" ").toLowerCase();
  for (const mm of MULTI_WORD_MODELS) {
    if (remaining.startsWith(mm)) {
      return { make, model: mm.toUpperCase().replace(/ /g, " ") };
    }
  }
  return { make, model: parts[startIdx + 1] || "" };
}

function matchBestTrim(vehicleStr: string, nhtsa: NhtsaInfo, options: any[], vin: string): any | null {
  if (!options || options.length === 0) return null;

  if (options.length > 1) {
    logger.info(
      {
        vin,
        vehicle: vehicleStr,
        optionCount: options.length,
        trims: options.map(o => ({
          series: o.series ?? "?",
          style: o.style ?? "?",
          avg: o.adjusted_whole_avg,
        })),
      },
      "BB worker: CBB returned multiple trims — scoring",
    );
  }

  if (options.length === 1) return options[0];

  const { make, model } = extractMakeModel(vehicleStr);
  const vTrimTokens = trimTokens(vehicleStr, make, model);
  const tLower  = nhtsa.trim.toLowerCase();
  const sLower  = nhtsa.series.toLowerCase();
  const nhtsaDrive = nhtsa.driveType.toLowerCase();

  const scored = options.map((opt) => {
    const series    = (opt.series ?? "").toLowerCase().trim();
    const style     = (opt.style ?? "").toLowerCase().trim();
    const seriesTokens = tokenize(series);
    const styleTokens  = tokenize(style);
    let score = 0;

    if (series) {
      if (vTrimTokens.includes(series)) score += 30;
      else if (vTrimTokens.some(t => t === series || series === t)) score += 30;

      for (const st of seriesTokens) {
        if (vTrimTokens.includes(st)) score += 20;
      }

      if (tLower && tLower === series) score += 25;
      else if (tLower && (tLower.includes(series) || series.includes(tLower))) score += 15;

      if (sLower && sLower === series) score += 20;
      else if (sLower && (sLower.includes(series) || series.includes(sLower))) score += 10;
    }

    if (style) {
      for (const st of styleTokens) {
        if (vTrimTokens.includes(st)) score += 10;
        if (tLower && tLower.includes(st)) score += 5;
      }
    }

    const is4wd = /4wd|4x4|4-wheel|awd/i.test(nhtsaDrive) ||
                  vTrimTokens.some(t => ["4wd","4x4","awd"].includes(t));
    const opt4wd = /4wd|4x4|awd|4-wheel/i.test(`${series} ${style}`);
    const opt2wd = /2wd|rwd|fwd/i.test(`${series} ${style}`);
    if (is4wd && opt4wd) score += 5;
    if (is4wd && opt2wd) score -= 5;
    if (!is4wd && opt4wd) score -= 3;

    if (nhtsa.bodyClass) {
      const bc = nhtsa.bodyClass.toLowerCase();
      if (style.includes("crew") && (bc.includes("crew") || vehicleStr.toLowerCase().includes("crew"))) score += 5;
      if (style.includes("supercrew") && vehicleStr.toLowerCase().includes("supercrew")) score += 8;
      if (style.includes("supercab") && vehicleStr.toLowerCase().includes("supercab")) score += 8;
      if (style.includes("regular") && vehicleStr.toLowerCase().includes("regular")) score += 5;
    }

    return { opt, score };
  });

  scored.sort((a, b) => b.score - a.score);

  logger.info(
    {
      vin,
      vTrimTokens,
      nhtsaTrim: tLower || "(none)",
      nhtsaSeries: sLower || "(none)",
      scores: scored.map(s => ({ series: s.opt.series, score: s.score, avg: s.opt.adjusted_whole_avg })),
    },
    "BB worker: trim scoring results",
  );

  if (scored[0].score > 0) {
    logger.info(
      { vin, series: scored[0].opt.series, style: scored[0].opt.style, score: scored[0].score, avg: scored[0].opt.adjusted_whole_avg },
      "BB worker: trim matched by scoring",
    );
    return scored[0].opt;
  }

  const sorted = [...options].sort(
    (a, b) => (a.adjusted_whole_avg ?? 0) - (b.adjusted_whole_avg ?? 0),
  );
  const midIdx   = Math.floor(sorted.length / 2);
  const fallback = sorted[midIdx];
  logger.info(
    {
      vin,
      series: fallback.series,
      avg: fallback.adjusted_whole_avg,
      note: "fallback-median",
      range: `${sorted[0].adjusted_whole_avg}–${sorted[sorted.length - 1].adjusted_whole_avg}`,
    },
    "BB worker: no trim match — using median value",
  );
  return fallback;
}

// ---------------------------------------------------------------------------
// Main batch
// ---------------------------------------------------------------------------

async function runBlackBookBatch(): Promise<void> {
  const { data: items } = getCacheState();
  if (items.length === 0) throw new Error("Inventory cache is empty — cannot run BB batch");

  // --- Get valid auth cookies (DB → file → browser login) ---
  const { appSession, csrfToken } = await getAuthCookies();
  logger.info("BB worker: auth ready — proceeding with API calls");

  // --- Process each VIN ---
  const bbMap = new Map<string, string>();
  const bbDetailMap = new Map<string, { xclean: number; clean: number; avg: number; rough: number }>();
  let succeeded = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const item of items) {
    const { vin, vehicle, km } = item;
    if (!vin || vin.length < 10) continue;

    try {
      const kmInt = parseKm(km);

      const nhtsa = await decodeVinNhtsa(vin);

      const options = await callCbbEndpoint(appSession, csrfToken, vin, kmInt);

      if (options.length === 0) {
        logger.info({ vin }, "BB worker: no options returned (VIN not in CBB)");
        skipped++;
        continue;
      }

      if (!("adjusted_whole_avg" in options[0])) {
        logger.warn({ vin, keys: Object.keys(options[0]) }, "BB worker: unexpected option structure — skipping VIN");
        skipped++;
        continue;
      }

      const best = matchBestTrim(vehicle, nhtsa, options, vin);
      if (!best) { skipped++; continue; }

      const vinKey = vin.toUpperCase();
      bbMap.set(vinKey, String(Math.round(best.adjusted_whole_avg)));

      // Second call with 0 KM to get unadjusted wholesale grades
      await sleep(rand(1000, 2000));
      try {
        const unadjOptions = await callCbbEndpoint(appSession, csrfToken, vin, 0);
        const unadjBest = matchBestTrim(vehicle, nhtsa, unadjOptions, vin);
        if (unadjBest) {
          bbDetailMap.set(vinKey, {
            xclean: Math.round(unadjBest.adjusted_whole_xclean ?? 0),
            clean:  Math.round(unadjBest.adjusted_whole_clean ?? 0),
            avg:    Math.round(unadjBest.adjusted_whole_avg ?? 0),
            rough:  Math.round(unadjBest.adjusted_whole_rough ?? 0),
          });
        }
      } catch (err) {
        logger.warn({ vin, err: String(err) }, "BB worker: unadjusted lookup failed (non-fatal)");
      }

      succeeded++;

      logger.info({ vin, series: best.series, avg: best.adjusted_whole_avg }, "BB worker: VIN processed");

      await sleep(rand(1500, 3000));
    } catch (err) {
      logger.warn({ vin, err: String(err) }, "BB worker: VIN lookup failed — skipping");
      failed++;
    }
  }

  logger.info({ succeeded, skipped, failed, total: items.length }, "BB worker: batch complete");

  if (bbMap.size > 0) {
    await applyBlackBookValues(bbMap, bbDetailMap);

    const valuesRecord: Record<string, any> = {};
    for (const [vin, val] of bbMap) {
      const detail = bbDetailMap.get(vin);
      valuesRecord[vin] = detail
        ? { avg: val, xclean: detail.xclean, clean: detail.clean, average: detail.avg, rough: detail.rough }
        : val;
    }
    await saveBbValuesToStore(valuesRecord);
    logger.info({ count: bbMap.size }, "BB worker: BB values saved to shared object storage");
  }
}

// ---------------------------------------------------------------------------
// Self-healing retry — infinite, no notifications
// ---------------------------------------------------------------------------

const PERMANENT_ERROR_PREFIX = "BB worker: session cookies expired in production";

async function runWithRetry(attempt = 1): Promise<void> {
  try {
    await runBlackBookBatch();
  } catch (err) {
    const msg = String(err);
    // Permanent errors: no cookies available in production — do not retry
    if (msg.includes(PERMANENT_ERROR_PREFIX)) {
      logger.warn({ err: msg }, "BB worker: no valid session — aborting (will recover after next dev nightly run)");
      return;
    }
    const waitMin = Math.min(attempt * 5, 30);
    logger.warn({ err: msg, attempt, waitMin }, "BB worker: run failed — self-healing, will retry");
    await sleep(waitMin * 60_000);
    return runWithRetry(attempt + 1);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runBlackBookWorker(): Promise<void> {
  if (!BB_ENABLED) {
    logger.info("BB worker: CREDITAPP_EMAIL or CREDITAPP_PASSWORD not set — skipping");
    return;
  }
  if (status.running) {
    logger.warn("BB worker: already running — skipping duplicate trigger");
    return;
  }

  status.running   = true;
  status.startedAt = new Date().toISOString();

  try {
    await runWithRetry();
    status.lastRun   = new Date().toISOString();
    status.lastCount = getCacheState().data.filter((i) => !!i.bbAvgWholesale).length;
    await recordRunDateToDb();
  } finally {
    status.running   = false;
    status.startedAt = null;
  }
}

// ---------------------------------------------------------------------------
// Persistent run tracking — stored in DB so restarts and dev/prod don't
// double-fire the same day's run
// ---------------------------------------------------------------------------

async function getLastRunDateFromDb(): Promise<string> {
  try {
    const { db, bbSessionTable } = await import("@workspace/db");
    const { eq }                 = await import("drizzle-orm");
    const { toMountainDateStr }  = await import("./randomScheduler.js");
    const rows = await db.select({ lastRunAt: bbSessionTable.lastRunAt })
      .from(bbSessionTable)
      .where(eq(bbSessionTable.id, "singleton"));
    if (rows.length > 0 && rows[0].lastRunAt) {
      return toMountainDateStr(rows[0].lastRunAt);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not read last run date from DB");
  }
  return "";
}

async function recordRunDateToDb(): Promise<void> {
  try {
    const { db, bbSessionTable } = await import("@workspace/db");
    await db
      .insert(bbSessionTable)
      .values({ id: "singleton", cookies: "[]", lastRunAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: bbSessionTable.id,
        set:    { lastRunAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not record run date to DB");
  }
}

// ---------------------------------------------------------------------------
// Scheduler — randomized business-hours with DB-persisted run guard
// ---------------------------------------------------------------------------

export function scheduleBlackBookWorker(): void {
  const { scheduleRandomDaily, toMountainDateStr } = require("./randomScheduler.js") as typeof import("./randomScheduler.js");

  scheduleRandomDaily({
    name: "BB worker",
    hasRunToday: async () => {
      const today = toMountainDateStr();
      const lastRan = await getLastRunDateFromDb();
      return lastRan === today;
    },
    execute: (reason: string) => {
      runBlackBookWorker().catch((err) => logger.error({ err }, "BB worker: scheduled run error"));
    },
  });

  logger.info("BB worker scheduled — randomized daily within business hours (Mountain Time)");
}

// ---------------------------------------------------------------------------
// Targeted processing — run BB for a specific list of VINs (new-unit detection)
// ---------------------------------------------------------------------------

export async function runBlackBookForVins(targetVins: string[]): Promise<void> {
  if (!BB_ENABLED) {
    logger.info("BB worker (targeted): CREDITAPP_EMAIL or CREDITAPP_PASSWORD not set — skipping");
    return;
  }
  if (status.running) {
    logger.warn("BB worker (targeted): batch already running — skipping");
    return;
  }

  const { data: items } = getCacheState();
  const targetSet = new Set(targetVins.map(v => v.toUpperCase()));
  const targetItems = items.filter(i => targetSet.has(i.vin.toUpperCase()));

  if (targetItems.length === 0) {
    logger.info({ vins: targetVins }, "BB worker (targeted): no matching items in cache — skipping");
    return;
  }

  status.running   = true;
  status.startedAt = new Date().toISOString();
  logger.info({ count: targetItems.length }, "BB worker (targeted): processing new VINs");

  try {
    const { appSession, csrfToken } = await getAuthCookies();

    const bbMap = new Map<string, string>();
    const bbDetailMap = new Map<string, { xclean: number; clean: number; avg: number; rough: number }>();
    let succeeded = 0, skipped = 0, failed = 0;

    for (const item of targetItems) {
      const { vin, vehicle, km } = item;
      if (!vin || vin.length < 10) continue;

      try {
        const kmInt = parseKm(km);
        const nhtsa = await decodeVinNhtsa(vin);
        const options = await callCbbEndpoint(appSession, csrfToken, vin, kmInt);

        if (options.length === 0) { skipped++; continue; }
        if (!("adjusted_whole_avg" in options[0])) { skipped++; continue; }

        const best = matchBestTrim(vehicle, nhtsa, options, vin);
        if (!best) { skipped++; continue; }

        const vinKey = vin.toUpperCase();
        bbMap.set(vinKey, String(Math.round(best.adjusted_whole_avg)));

        await sleep(rand(1000, 2000));
        try {
          const unadjOptions = await callCbbEndpoint(appSession, csrfToken, vin, 0);
          const unadjBest = matchBestTrim(vehicle, nhtsa, unadjOptions, vin);
          if (unadjBest) {
            bbDetailMap.set(vinKey, {
              xclean: Math.round(unadjBest.adjusted_whole_xclean ?? 0),
              clean:  Math.round(unadjBest.adjusted_whole_clean ?? 0),
              avg:    Math.round(unadjBest.adjusted_whole_avg ?? 0),
              rough:  Math.round(unadjBest.adjusted_whole_rough ?? 0),
            });
          }
        } catch (err) {
          logger.warn({ vin, err: String(err) }, "BB worker (targeted): unadjusted lookup failed (non-fatal)");
        }

        succeeded++;
        logger.info({ vin, series: best.series, avg: best.adjusted_whole_avg }, "BB worker (targeted): VIN processed");
        await sleep(rand(1500, 3000));
      } catch (err) {
        logger.warn({ vin, err: String(err) }, "BB worker (targeted): VIN lookup failed — skipping");
        failed++;
      }
    }

    logger.info({ succeeded, skipped, failed, total: targetItems.length }, "BB worker (targeted): batch complete");

    if (bbMap.size > 0) {
      await applyBlackBookValues(bbMap, bbDetailMap);
      const valuesRecord: Record<string, any> = {};
      for (const [vin, val] of bbMap) {
        const detail = bbDetailMap.get(vin);
        valuesRecord[vin] = detail
          ? { avg: val, xclean: detail.xclean, clean: detail.clean, average: detail.avg, rough: detail.rough }
          : val;
      }
      await saveBbValuesToStore(valuesRecord);
      logger.info({ count: bbMap.size }, "BB worker (targeted): BB values saved to shared object storage");
    }
  } catch (err) {
    logger.error({ err }, "BB worker (targeted): run failed");
  } finally {
    status.running   = false;
    status.startedAt = null;
  }
}

```


### `artifacts/api-server/src/lib/carfaxWorker.ts` (990 lines)

```typescript
/**
 * Carfax Cloud Worker
 *
 * Runs daily at a random time during business hours (Mountain Time).
 * Modelled on the proven desktop script — uses the dealer portal VIN search
 * at dealer.carfax.ca/MyReports, hides automation detection, and saves the
 * login session to disk so login only happens once.
 *
 * REQUIRED ENVIRONMENT VARIABLES:
 *   APPS_SCRIPT_WEB_APP_URL  — deployed Apps Script web app URL
 *   CARFAX_EMAIL             — Carfax Canada dealer login email
 *   CARFAX_PASSWORD          — Carfax Canada dealer login password
 *   CARFAX_ENABLED           — set to "true" to activate
 */

import { logger } from "./logger.js";
import * as fs   from "fs";
import * as path from "path";

const APPS_SCRIPT_URL = process.env["APPS_SCRIPT_WEB_APP_URL"]?.trim() ?? "";
const CARFAX_EMAIL    = process.env["CARFAX_EMAIL"]?.trim()    ?? "";
const CARFAX_PASSWORD = process.env["CARFAX_PASSWORD"]?.trim() ?? "";
const CARFAX_ENABLED  = process.env["CARFAX_ENABLED"]?.trim().toLowerCase() === "true";

// Dealer portal URLs — same as the desktop script
const CARFAX_HOME      = "https://dealer.carfax.ca/";
const CARFAX_LOGIN_URL = "https://dealer.carfax.ca/login";
const CARFAX_VHR_URL   = "https://dealer.carfax.ca/MyReports";

// Session cookies saved to disk so login persists between server restarts
const SESSION_FILE = path.join(process.cwd(), ".carfax-session.json");

// Selectors — mirrors the desktop script exactly
const VIN_SEARCH_SELECTORS = [
  "input.searchVehicle",
  "input.searchbox.searchVehicle",
  'input[placeholder*="VIN"]',
  "input[type=\"search\"]",
];

const REPORT_LINK_SELECTORS = [
  "a.reportLink",
  'a[href*="cfm/display_cfm"]',
  'a[href*="vhr"]',
  'a[href*="/cfm/"]',
];

const GLOBAL_ARCHIVE_SELECTORS = [
  "label#global-archive",
  "input#globalreports",
];

// Auth0 login selectors (dealer.carfax.ca uses Auth0)
const AUTH0_EMAIL_SELECTORS    = ["#username", 'input[name="username"]', 'input[type="email"]'];
const AUTH0_PASSWORD_SELECTORS = ["#password", 'input[name="password"]', 'input[type="password"]'];

export interface CarfaxTestResult {
  vin:    string;
  status: "found" | "not_found" | "error" | "captcha";
  url?:   string;
  error?: string;
}

interface PendingVin {
  rowIndex: number;
  vin:      string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function humanDelay(base: number): Promise<void> {
  return sleep(base + rand(0, 1000));
}

// ---------------------------------------------------------------------------
// Apps Script communication
// ---------------------------------------------------------------------------

async function fetchPendingVins(): Promise<PendingVin[]> {
  if (!APPS_SCRIPT_URL) {
    logger.warn("APPS_SCRIPT_WEB_APP_URL not configured");
    return [];
  }
  let retries = 3;
  while (retries > 0) {
    try {
      const resp = await fetch(APPS_SCRIPT_URL, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as PendingVin[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      retries--;
      if (retries === 0) {
        logger.error({ err }, "Carfax worker: failed to fetch pending VINs after 3 attempts");
        return [];
      }
      logger.warn({ err, retriesLeft: retries }, "Carfax worker: fetch failed, retrying in 2s");
      await sleep(2_000);
    }
  }
  return [];
}

async function writeCarfaxResult(rowIndex: number, value: string, batchComplete = false): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  let retries = 3;
  while (retries > 0) {
    try {
      await fetch(APPS_SCRIPT_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rowIndex, value, batchComplete }),
        signal:  AbortSignal.timeout(15_000),
      });
      return;
    } catch (err) {
      retries--;
      if (retries === 0) {
        logger.error({ err, rowIndex, value }, "Carfax worker: failed to write result after 3 attempts");
      } else {
        await sleep(1_000);
      }
    }
  }
}

async function sendAlert(message: string): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "notify", message }),
    });
  } catch (_) { /* silent */ }
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

function loadSavedCookies(): any[] {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, "utf8");
      const cookies = JSON.parse(raw);
      logger.info({ count: cookies.length, file: SESSION_FILE }, "Carfax worker: loaded saved session cookies");
      return cookies;
    }
  } catch (_) { /* ignore corrupt file */ }
  return [];
}

function saveCookies(cookies: any[]): void {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2), "utf8");
    logger.info({ count: cookies.length }, "Carfax worker: session cookies saved to disk");
  } catch (err) {
    logger.warn({ err }, "Carfax worker: could not save session cookies");
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function launchBrowser(): Promise<any> {
  let puppeteer: any;
  try {
    // puppeteer-extra + stealth plugin — handles ~20 detection vectors automatically
    puppeteer = (await import("puppeteer-extra")).default;
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(StealthPlugin());
    logger.info("Carfax worker: using puppeteer-extra with stealth plugin");
  } catch (_) {
    // Fallback to plain puppeteer if extra not available
    logger.warn("Carfax worker: puppeteer-extra not available, falling back to plain puppeteer");
    try {
      puppeteer = (await import("puppeteer")).default;
    } catch (__) {
      throw new Error("puppeteer not installed");
    }
  }

  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process");
    const found = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) {
      executablePath = found;
      logger.info({ executablePath }, "Carfax worker: using system Chromium");
    }
  } catch (_) { /* use bundled */ }

  const browser = await puppeteer.launch({
    headless: "new" as any,
    executablePath,
    timeout: 90_000,           // give Chromium 90s to start (default 30s causes crashes under load)
    protocolTimeout: 90_000,   // same for CDP protocol handshake
    defaultViewport: { width: 1280, height: 900 },
    args: [
      // Required for Replit/Linux container environments
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      // Anti-detection
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--disable-extensions-except=",
      "--disable-plugins-discovery",
      "--window-size=1280,900",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  return browser;
}

async function addAntiDetectionScripts(page: any): Promise<void> {
  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  await page.setUserAgent(USER_AGENT);

  // Realistic HTTP headers — every request looks like real Chrome on Windows
  await page.setExtraHTTPHeaders({
    "Accept-Language":           "en-CA,en-US;q=0.9,en;q=0.8,fr;q=0.7",
    "Accept-Encoding":           "gzip, deflate, br",
    "Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Sec-Fetch-Site":            "none",
    "Sec-Fetch-Mode":            "navigate",
    "Sec-Fetch-User":            "?1",
    "Sec-Fetch-Dest":            "document",
    "Sec-Ch-Ua":                 '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile":          "?0",
    "Sec-Ch-Ua-Platform":        '"Windows"',
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control":             "max-age=0",
  });

  await page.setCacheEnabled(true);

  // Runs before any page script — covers all fingerprinting vectors
  await page.evaluateOnNewDocument(() => {
    // 1. navigator.webdriver — primary automation flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // 2. window.chrome — real Chrome has a rich object with callable methods
    (window as any).chrome = {
      runtime: {
        connect:       () => {},
        sendMessage:   () => {},
        onMessage:     { addListener: () => {}, removeListener: () => {} },
      },
      loadTimes: () => {},
      csi:       () => {},
      app:       {},
    };

    // 3. navigator.userAgentData — Chrome 90+ API; missing = instant bot flag
    Object.defineProperty(navigator, "userAgentData", {
      get: () => ({
        brands: [
          { brand: "Google Chrome", version: "124" },
          { brand: "Chromium",      version: "124" },
          { brand: "Not-A.Brand",   version: "99"  },
        ],
        mobile:   false,
        platform: "Windows",
        getHighEntropyValues: async (_hints: string[]) => ({
          brands: [
            { brand: "Google Chrome", version: "124" },
            { brand: "Chromium",      version: "124" },
            { brand: "Not-A.Brand",   version: "99"  },
          ],
          mobile:          false,
          platform:        "Windows",
          platformVersion: "10.0.0",
          architecture:    "x86",
          bitness:         "64",
          model:           "",
          uaFullVersion:   "124.0.6367.60",
          fullVersionList: [
            { brand: "Google Chrome", version: "124.0.6367.60" },
            { brand: "Chromium",      version: "124.0.6367.60" },
            { brand: "Not-A.Brand",   version: "99.0.0.0"      },
          ],
        }),
      }),
    });

    // 4. navigator.plugins — headless has 0; real Chrome has several
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer",              description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client",     filename: "internal-nacl-plugin",             description: "" },
        ];
        return Object.assign(plugins, {
          item:      (i: number) => plugins[i],
          namedItem: (n: string) => plugins.find(p => p.name === n) || null,
          refresh:   () => {},
          length:    plugins.length,
        });
      },
    });

    // 5. navigator.mimeTypes
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => {
        const types = [
          { type: "application/pdf",               description: "Portable Document Format", suffixes: "pdf" },
          { type: "application/x-google-chrome-pdf", description: "Portable Document Format", suffixes: "pdf" },
        ];
        return Object.assign(types, {
          item:      (i: number) => types[i],
          namedItem: (n: string) => types.find(t => t.type === n) || null,
          length:    types.length,
        });
      },
    });

    // 6. navigator.languages
    Object.defineProperty(navigator, "languages", { get: () => ["en-CA", "en-US", "en", "fr-CA"] });
    Object.defineProperty(navigator, "language",  { get: () => "en-CA" });

    // 7. Hardware profile — server CPUs/memory differ from a desktop
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory",        { get: () => 8 });

    // 8. Network connection — headless exposes server connection
    Object.defineProperty(navigator, "connection", {
      get: () => ({
        effectiveType:    "4g",
        rtt:              50 + Math.floor(Math.random() * 50),
        downlink:         5 + Math.random() * 5,
        saveData:         false,
        addEventListener:    () => {},
        removeEventListener: () => {},
        dispatchEvent:       () => true,
      }),
    });

    // 9. Screen dimensions — all consistent at 1280×900 to match viewport
    Object.defineProperty(screen, "width",       { get: () => 1280 });
    Object.defineProperty(screen, "height",      { get: () => 900  });
    Object.defineProperty(screen, "availWidth",  { get: () => 1280 });
    Object.defineProperty(screen, "availHeight", { get: () => 860  });
    Object.defineProperty(screen, "colorDepth",  { get: () => 24   });
    Object.defineProperty(screen, "pixelDepth",  { get: () => 24   });
    Object.defineProperty(window, "outerWidth",  { get: () => 1280 });
    Object.defineProperty(window, "outerHeight", { get: () => 900  });

    // 10. Canvas fingerprint noise — each run produces a unique fingerprint
    const _origToDataURL   = HTMLCanvasElement.prototype.toDataURL;
    const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const noise = () => Math.floor(Math.random() * 3) - 1; // -1, 0, or +1

    HTMLCanvasElement.prototype.toDataURL = function(...args: any[]) {
      const ctx = this.getContext("2d");
      if (ctx) {
        const img = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i]   += noise();
          img.data[i+1] += noise();
          img.data[i+2] += noise();
        }
        ctx.putImageData(img, 0, 0);
      }
      return _origToDataURL.apply(this, args);
    };

    CanvasRenderingContext2D.prototype.getImageData = function(...args: any[]) {
      const img = _origGetImageData.apply(this, args);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i]   += noise();
        img.data[i+1] += noise();
        img.data[i+2] += noise();
      }
      return img;
    };

    // 11. Permissions API
    const _origQuery = window.navigator.permissions?.query.bind(navigator.permissions);
    if (_origQuery) {
      (navigator.permissions as any).query = (parameters: any) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: "denied" } as PermissionStatus)
          : _origQuery(parameters);
    }
  });
}

async function findSelector(page: any, selectors: string[], timeout = 5000): Promise<any> {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout });
      if (el) return el;
    } catch (_) { /* try next */ }
  }
  return null;
}

// Human-like mouse movement and click
async function humanClick(page: any, element: any): Promise<void> {
  const box = await element.boundingBox();
  if (!box) { await element.click(); return; }
  const tx = box.x + rand(Math.floor(box.width * 0.2),  Math.floor(box.width * 0.8));
  const ty = box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8));
  const sx = rand(100, 900);
  const sy = rand(100, 600);
  const steps = rand(12, 22);
  for (let i = 0; i <= steps; i++) {
    const t    = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await page.mouse.move(
      sx + (tx - sx) * ease + rand(-3, 3),
      sy + (ty - sy) * ease + rand(-3, 3),
    );
    await sleep(rand(8, 22));
  }
  await sleep(rand(60, 180));
  await page.mouse.click(tx, ty);
}

async function humanType(page: any, element: any, text: string): Promise<void> {
  await element.click();
  await sleep(rand(80, 200));
  for (let i = 0; i < text.length; i++) {
    await element.type(text[i], { delay: 0 });
    let d = rand(60, 160);
    if (i > 0 && i % rand(4, 7) === 0) d += rand(150, 400);
    await sleep(d);
  }
  await sleep(rand(200, 500));
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function isLoggedIn(page: any): Promise<boolean> {
  try {
    await page.goto(CARFAX_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (navErr: any) {
    logger.warn({ err: navErr.message }, "Carfax worker: isLoggedIn navigation timed out — treating as not logged in");
    return false;
  }
  await humanDelay(1500);
  const content = (await page.content()).toLowerCase();
  return (
    content.includes("sign out")   ||
    content.includes("log out")    ||
    content.includes("my account") ||
    content.includes("my carfax")  ||
    content.includes("my vhrs")
  );
}

async function loginWithAuth0(page: any): Promise<boolean> {
  logger.info("Carfax worker: navigating to Auth0 login page");
  try {
    await page.goto(CARFAX_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (navErr: any) {
    logger.error({ err: navErr.message }, "Carfax worker: login page navigation timed out — cannot log in");
    return false;
  }
  await humanDelay(1500);

  const emailInput = await findSelector(page, AUTH0_EMAIL_SELECTORS, 10_000);
  if (!emailInput) {
    logger.error("Carfax worker: could not find email/username input on login page");
    return false;
  }
  await humanClick(page, emailInput);
  await humanType(page, emailInput, CARFAX_EMAIL);

  const passInput = await findSelector(page, AUTH0_PASSWORD_SELECTORS, 5_000);
  if (!passInput) {
    logger.error("Carfax worker: could not find password input on login page");
    return false;
  }
  await humanClick(page, passInput);
  await humanType(page, passInput, CARFAX_PASSWORD);

  const submitBtn = await findSelector(page, ['button[type="submit"]'], 5_000);
  if (submitBtn) {
    await humanClick(page, submitBtn);
    await humanDelay(3000);
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
    await humanDelay(2000);
  }

  const confirmed = await isLoggedIn(page);
  if (confirmed) {
    const cookies = await page.cookies();
    saveCookies(cookies);
    logger.info("Carfax worker: login successful — session saved");
  } else {
    logger.error("Carfax worker: login failed — still not authenticated after submit");
  }
  return confirmed;
}

// Try saved cookies first, fall back to full login
async function ensureLoggedIn(browser: any, page: any): Promise<boolean> {
  const savedCookies = loadSavedCookies();
  if (savedCookies.length > 0) {
    logger.info("Carfax worker: restoring saved session cookies");
    await page.setCookie(...savedCookies);
    const loggedIn = await isLoggedIn(page);
    if (loggedIn) {
      logger.info("Carfax worker: session restored — already logged in");
      return true;
    }
    logger.info("Carfax worker: saved session expired — performing fresh login");
  }
  return loginWithAuth0(page);
}

// ---------------------------------------------------------------------------
// VIN lookup — uses dealer portal search, same as desktop script
// ---------------------------------------------------------------------------

function isValidReportHref(href: string | null): boolean {
  if (!href) return false;
  const h = href.trim();
  // Reject placeholders, fragments-only, javascript links, empty
  if (!h || h === "#" || h.startsWith("javascript:") || h === "about:blank") return false;
  return true;
}

async function getRawHref(el: any): Promise<string | null> {
  // Use getAttribute for raw HTML value — mirrors original Playwright getAttribute behaviour
  // Avoids Puppeteer's getProperty('href') which resolves relative/fragment URLs into full URLs
  try {
    return await el.evaluate((a: Element) => a.getAttribute("href"));
  } catch (_) { return null; }
}

async function findReportLink(page: any): Promise<string | null> {
  for (const sel of REPORT_LINK_SELECTORS) {
    try {
      // visible:true mirrors Playwright's default — skips hidden template/placeholder elements
      const el = await page.$(sel + ":not([style*='display: none']):not([style*='display:none'])");
      if (el) {
        const visible = await el.evaluate((e: Element) => {
          const s = window.getComputedStyle(e);
          return s.display !== "none" && s.visibility !== "hidden" && (e as HTMLElement).offsetParent !== null;
        }).catch(() => false);
        if (!visible) continue;

        const href = await getRawHref(el);
        if (isValidReportHref(href)) {
          let resolved = href!;
          if (resolved.startsWith("/")) resolved = "https://dealer.carfax.ca" + resolved;
          return resolved;
        }
      }
    } catch (_) { /* try next */ }
  }
  // Fallback: scan all visible links for known report URL patterns
  try {
    const links = await page.$$("a[href]");
    for (const link of links) {
      const href = await getRawHref(link);
      if (!isValidReportHref(href)) continue;
      const h = href!;
      if (
        h.includes("cfm/display_cfm") ||
        h.includes("cfm/vhr") ||
        h.includes("vehicle-history") ||
        h.includes("vhr.carfax.ca") ||
        h.includes("carfax.ca/cfm")
      ) {
        return h.startsWith("/") ? "https://dealer.carfax.ca" + h : h;
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function lookupVinOnDealerPortal(
  page:    any,
  vin:     string,
): Promise<{ status: "found" | "not_found" | "session_expired" | "error"; url?: string }> {
  try {
    logger.info({ vin }, "Carfax worker: navigating to dealer VHR page");
    await page.goto(CARFAX_VHR_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await humanDelay(2000);

    // Check if session expired mid-run
    const currentUrl: string = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("signin")) {
      logger.warn({ vin }, "Carfax worker: redirected to login mid-batch — session expired");
      return { status: "session_expired" };
    }

    const searchInput = await findSelector(page, VIN_SEARCH_SELECTORS, 8_000);
    if (!searchInput) {
      logger.error({ vin }, "Carfax worker: could not find VIN search input on dealer portal");
      return { status: "error" };
    }

    // Clear and type VIN — triple-click selects all existing text, then type replaces it
    await searchInput.click({ clickCount: 3 });
    await sleep(rand(80, 180));
    await humanType(page, searchInput, vin);

    // Human scroll after typing — mirrors original desktop script exactly.
    // Gives the AJAX search time to fire and load results before we check.
    await page.mouse.wheel({ deltaY: rand(60, 220) * (Math.random() > 0.3 ? 1 : -1) });
    await sleep(rand(300, 700));
    if (Math.random() > 0.6) {
      await page.mouse.wheel({ deltaY: -rand(20, 80) });
      await sleep(rand(200, 400));
    }

    // Wait for a VISIBLE reportLink — visible:true skips hidden DOM placeholders
    let found = false;
    try {
      await page.waitForSelector("a.reportLink", { visible: true, timeout: 10_000 });
      found = true;
    } catch (_) { found = false; }

    if (found) {
      const link = await findReportLink(page);
      if (link) {
        logger.info({ vin, url: link }, "Carfax worker: found in My VHRs ✓");
        return { status: "found", url: link };
      }
    }

    // Try Global Archive
    logger.info({ vin }, "Carfax worker: not in My VHRs — trying Global Archive");
    const archiveToggle = await findSelector(page, GLOBAL_ARCHIVE_SELECTORS, 3_000);
    if (!archiveToggle) {
      logger.info({ vin }, "Carfax worker: no Global Archive toggle found — not found");
      return { status: "not_found" };
    }

    await humanClick(page, archiveToggle);
    let found2 = false;
    try {
      await page.waitForSelector("a.reportLink", { visible: true, timeout: 6_000 });
      found2 = true;
    } catch (_) { found2 = false; }

    if (found2) {
      const link2 = await findReportLink(page);
      if (link2) {
        logger.info({ vin, url: link2 }, "Carfax worker: found in Global Archive ✓");
        return { status: "found", url: link2 };
      }
    }

    logger.info({ vin }, "Carfax worker: VIN not found in Carfax");
    return { status: "not_found" };
  } catch (err: any) {
    logger.error({ vin, err }, "Carfax worker: VIN lookup error");
    return { status: "error" };
  }
}

// ---------------------------------------------------------------------------
// Public: run against real pending VINs from Apps Script
// ---------------------------------------------------------------------------
let batchRunning = false;
let batchStartedAt: Date | null = null;

export function getCarfaxBatchStatus(): { running: boolean; startedAt: string | null } {
  return { running: batchRunning, startedAt: batchStartedAt?.toISOString() ?? null };
}

export async function runCarfaxWorker(opts: { force?: boolean } = {}): Promise<void> {
  if (batchRunning) {
    logger.warn("Carfax worker: batch already in progress — skipping duplicate trigger");
    return;
  }

  logger.info("Carfax worker: starting run");

  if (!opts.force && !CARFAX_ENABLED) {
    logger.info("Carfax worker: DISABLED (set CARFAX_ENABLED=true to activate)");
    return;
  }
  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    logger.warn("Carfax worker: CARFAX_EMAIL or CARFAX_PASSWORD not set — skipping");
    await sendAlert("Carfax worker could not run: credentials not set in Replit secrets.");
    return;
  }

  batchRunning   = true;
  batchStartedAt = new Date();

  const rawPending = await fetchPendingVins();
  if (rawPending.length === 0) {
    logger.info("Carfax worker: no pending VINs — nothing to do");
    batchRunning = false; batchStartedAt = null;
    return;
  }

  const { getCacheState } = await import("./inventoryCache.js");
  const cache = getCacheState();
  const pendingVins = rawPending.filter(({ vin }) => {
    const item = cache.data.find(i => i.vin.toUpperCase() === vin.toUpperCase());
    if (item) {
      const url = item.carfax?.trim();
      if (url && url.startsWith("http")) {
        logger.info({ vin }, "Carfax worker: skipping VIN — already has Carfax URL in cache");
        return false;
      }
    }
    return true;
  });

  if (pendingVins.length === 0) {
    logger.info({ originalCount: rawPending.length }, "Carfax worker: all pending VINs already have URLs — nothing to do");
    batchRunning = false; batchStartedAt = null;
    return;
  }
  logger.info({ count: pendingVins.length, skipped: rawPending.length - pendingVins.length }, "Carfax worker: fetched pending VINs (after skip-if-has-URL filter)");

  let browser: any = null;
  let processed = 0, succeeded = 0, notFound = 0, failed = 0;

  try {
    // Retry browser launch up to 3 times — Chromium occasionally times out under container load
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        browser = await launchBrowser();
        break;
      } catch (launchErr: any) {
        logger.warn({ attempt, err: String(launchErr) }, "Carfax worker: browser launch attempt failed");
        if (attempt === 3) throw launchErr;
        await sleep(10_000 * attempt); // 10s, 20s back-off
      }
    }
    const page = await browser.newPage();
    await addAntiDetectionScripts(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      await sendAlert("Carfax worker login failed. Check credentials.");
      return;
    }

    for (const { rowIndex, vin } of pendingVins) {
      logger.info({ vin, rowIndex, processed: processed + 1, total: pendingVins.length }, "Carfax worker: processing VIN");

      const result = await lookupVinOnDealerPortal(page, vin);

      if (result.status === "session_expired") {
        // Re-login and retry once
        logger.info("Carfax worker: re-logging in after session expiry");
        const relogged = await loginWithAuth0(page);
        if (!relogged) { failed++; continue; }
        const retry = await lookupVinOnDealerPortal(page, vin);
        if (retry.status === "found" && retry.url) {
          await writeCarfaxResult(rowIndex, retry.url);
          succeeded++;
        } else if (retry.status === "not_found") {
          await writeCarfaxResult(rowIndex, "NOT FOUND");
          notFound++;
        } else {
          failed++;
        }
      } else if (result.status === "found" && result.url) {
        await writeCarfaxResult(rowIndex, result.url);
        succeeded++;
      } else if (result.status === "not_found") {
        await writeCarfaxResult(rowIndex, "NOT FOUND");
        notFound++;
      } else {
        failed++;
      }

      processed++;
      await humanDelay(rand(4_000, 9_000));
    }

    if (processed > 0) await writeCarfaxResult(0, "", true);

  } catch (err) {
    logger.error({ err }, "Carfax worker: unexpected crash");
    await sendAlert("Carfax worker crashed: " + String(err));
  } finally {
    if (browser) await browser.close();
    batchRunning   = false;
    batchStartedAt = null;
  }

  logger.info({ processed, succeeded, notFound, failed }, "Carfax worker: run complete");
}

// ---------------------------------------------------------------------------
// Public: test with specific VINs — no Apps Script writes
// ---------------------------------------------------------------------------
export async function runCarfaxWorkerForVins(vins: string[]): Promise<CarfaxTestResult[]> {
  const results: CarfaxTestResult[] = [];
  logger.info({ vins }, "Carfax test run: starting");

  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    return vins.map((vin) => ({ vin, status: "error" as const, error: "Missing CARFAX_EMAIL / CARFAX_PASSWORD" }));
  }

  let browser: any = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await addAntiDetectionScripts(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      return vins.map((vin) => ({ vin, status: "error" as const, error: "Login failed" }));
    }

    for (const vin of vins) {
      logger.info({ vin }, "Carfax test run: looking up VIN");
      const result = await lookupVinOnDealerPortal(page, vin);

      if (result.status === "found" && result.url) {
        results.push({ vin, status: "found", url: result.url });
      } else if (result.status === "not_found") {
        results.push({ vin, status: "not_found" });
      } else if (result.status === "session_expired") {
        results.push({ vin, status: "error", error: "Session expired during test" });
      } else {
        results.push({ vin, status: "error", error: "Lookup error" });
      }

      await humanDelay(rand(2_000, 4_000));
    }
  } catch (err: any) {
    logger.error({ err }, "Carfax test run: crash");
    const remaining = vins.filter((v) => !results.find((r) => r.vin === v));
    for (const vin of remaining) results.push({ vin, status: "error", error: err.message });
  } finally {
    if (browser) await browser.close();
  }

  logger.info({ results }, "Carfax test run: complete");
  return results;
}

// ---------------------------------------------------------------------------
// Scheduler — randomized business-hours with in-memory run guard
// ---------------------------------------------------------------------------
export function scheduleCarfaxWorker(): void {
  let lastRunDate = "";

  const { scheduleRandomDaily, toMountainDateStr } = require("./randomScheduler.js") as typeof import("./randomScheduler.js");

  scheduleRandomDaily({
    name: "Carfax worker",
    hasRunToday: () => {
      const today = toMountainDateStr();
      return lastRunDate === today;
    },
    execute: (reason: string) => {
      const today = toMountainDateStr();
      lastRunDate = today;
      logger.info({ reason }, "Carfax worker: triggering run");
      runCarfaxWorker().catch((err) => logger.error({ err }, "Carfax worker: run error"));
    },
  });

  logger.info("Carfax cloud worker scheduled — randomized daily within business hours (Mountain Time)");
}

// ---------------------------------------------------------------------------
// Targeted Carfax lookup for specific new VINs (skips VINs with existing URLs)
// ---------------------------------------------------------------------------
export async function runCarfaxForNewVins(vins: string[]): Promise<void> {
  if (!CARFAX_ENABLED) {
    logger.info("Carfax worker (targeted): CARFAX_ENABLED is not true — skipping");
    return;
  }
  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    logger.warn("Carfax worker (targeted): credentials not set — skipping");
    return;
  }
  if (batchRunning) {
    logger.warn("Carfax worker (targeted): batch already in progress — skipping");
    return;
  }

  const { getCacheState } = await import("./inventoryCache.js");
  const cache = getCacheState();
  const filteredVins = vins.filter(vin => {
    const item = cache.data.find(i => i.vin.toUpperCase() === vin.toUpperCase());
    if (!item) return true;
    const url = item.carfax?.trim();
    if (url && url.startsWith("http")) {
      logger.info({ vin }, "Carfax worker (targeted): skipping VIN — already has Carfax URL");
      return false;
    }
    return true;
  });

  if (filteredVins.length === 0) {
    logger.info("Carfax worker (targeted): all VINs already have Carfax URLs — nothing to do");
    return;
  }

  logger.info({ count: filteredVins.length, vins: filteredVins }, "Carfax worker (targeted): processing new VINs");

  batchRunning   = true;
  batchStartedAt = new Date();
  let browser: any = null;
  let processed = 0, succeeded = 0, notFound = 0, failed = 0;
  const carfaxResults = new Map<string, string>();

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        browser = await launchBrowser();
        break;
      } catch (launchErr: any) {
        logger.warn({ attempt, err: String(launchErr) }, "Carfax worker (targeted): browser launch attempt failed");
        if (attempt === 3) throw launchErr;
        await sleep(10_000 * attempt);
      }
    }
    const page = await browser.newPage();
    await addAntiDetectionScripts(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      logger.warn("Carfax worker (targeted): login failed — aborting");
      return;
    }

    for (const vin of filteredVins) {
      logger.info({ vin, processed: processed + 1, total: filteredVins.length }, "Carfax worker (targeted): processing VIN");

      let finalResult: { status: string; url?: string } | null = null;
      const result = await lookupVinOnDealerPortal(page, vin);

      if (result.status === "session_expired") {
        logger.info("Carfax worker (targeted): re-logging in after session expiry");
        const relogged = await loginWithAuth0(page);
        if (!relogged) { failed++; processed++; continue; }
        finalResult = await lookupVinOnDealerPortal(page, vin);
      } else {
        finalResult = result;
      }

      if (finalResult.status === "found" && finalResult.url) {
        carfaxResults.set(vin.toUpperCase(), finalResult.url);
        succeeded++;
      } else if (finalResult.status === "not_found") {
        carfaxResults.set(vin.toUpperCase(), "NOT FOUND");
        notFound++;
      } else {
        failed++;
      }

      processed++;
      await humanDelay(rand(4_000, 9_000));
    }

    if (carfaxResults.size > 0) {
      const { applyCarfaxResults } = await import("./inventoryCache.js");
      await applyCarfaxResults(carfaxResults);
    }
  } catch (err) {
    logger.error({ err }, "Carfax worker (targeted): unexpected crash");
  } finally {
    if (browser) await browser.close();
    batchRunning   = false;
    batchStartedAt = null;
  }

  logger.info({ processed, succeeded, notFound, failed }, "Carfax worker (targeted): run complete");
}

```


### `artifacts/api-server/src/lib/lenderAuth.ts` (897 lines)

```typescript
import { logger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

function base32Decode(encoded: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = encoded.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret: string, period = 30, digits = 6): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % (10 ** digits);
  return code.toString().padStart(digits, "0");
}
import {
  loadLenderSessionFromStore,
  saveLenderSessionToStore,
} from "./bbObjectStore.js";

const LENDER_EMAIL    = process.env["LENDER_CREDITAPP_EMAIL"]?.trim()    ?? "";
const LENDER_PASSWORD = process.env["LENDER_CREDITAPP_PASSWORD"]?.trim() ?? "";
const LENDER_TOTP_SECRET = process.env["LENDER_CREDITAPP_TOTP_SECRET"]?.trim() ?? "";
const LENDER_2FA_CODE_ENV = process.env["LENDER_CREDITAPP_2FA_CODE"]?.trim() ?? "";

async function getLatestRecoveryCode(): Promise<string> {
  try {
    const fetch = (await import("node-fetch")).default;
    const OBJ_BASE = "http://127.0.0.1:1106";
    const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    const key = `${dir}/lender-recovery-code.json`;
    const res = await fetch(`${OBJ_BASE}/buckets/${bucket}/objects/${encodeURIComponent(key)}`);
    if (res.ok) {
      const data = (await res.json()) as { code?: string };
      if (data.code) {
        logger.info({ capturedCodeLen: data.code.length }, "Lender auth: using stored recovery code from object storage");
        return data.code;
      }
    }
  } catch (_) {}
  return LENDER_2FA_CODE_ENV;
}
export const LENDER_ENABLED = !!(LENDER_EMAIL && LENDER_PASSWORD);

const CREDITAPP_HOME = "https://admin.creditapp.ca";
const LOGIN_URL      = "https://admin.creditapp.ca/api/auth/login";
const GRAPHQL_URL    = "https://admin.creditapp.ca/api/graphql";
const SESSION_FILE   = path.join(process.cwd(), ".lender-session.json");

const AUTH0_EMAIL_SELECTORS = ["#username", 'input[name="username"]', 'input[type="email"]'];
const AUTH0_PASS_SELECTORS  = ["#password", 'input[name="password"]', 'input[type="password"]'];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function extractAuthCookies(cookies: any[]): { appSession: string; csrfToken: string } | null {
  const appSession = cookies.find((c: any) => c.name === "appSession");
  const csrfToken  = cookies.find((c: any) => c.name === "CA_CSRF_TOKEN");
  if (!appSession || !csrfToken) return null;
  return { appSession: appSession.value, csrfToken: csrfToken.value };
}

function loadCookiesFromFile(): any[] {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, "utf8");
      const cookies = JSON.parse(raw);
      logger.info({ count: cookies.length }, "Lender auth: loaded session cookies from file");
      return cookies;
    }
  } catch (_) {}
  return [];
}

function saveCookiesToFile(cookies: any[]): void {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2), "utf8");
  } catch (_) {}
}

async function loadCookiesFromDb(): Promise<any[]> {
  try {
    const { db, lenderSessionTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(lenderSessionTable).where(eq(lenderSessionTable.id, "singleton"));
    if (rows.length === 0) return [];
    if (!rows[0].cookies) return [];
    const cookies = JSON.parse(rows[0].cookies);
    logger.info({ count: cookies.length }, "Lender auth: loaded session cookies from database");
    return cookies;
  } catch (err) {
    logger.warn({ err: String(err) }, "Lender auth: could not load session from database");
  }
  return [];
}

async function saveCookiesToDb(cookies: any[]): Promise<void> {
  try {
    const { db, lenderSessionTable } = await import("@workspace/db");
    await db
      .insert(lenderSessionTable)
      .values({ id: "singleton", cookies: JSON.stringify(cookies), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: lenderSessionTable.id,
        set: { cookies: JSON.stringify(cookies), updatedAt: new Date() },
      });
    logger.info({ count: cookies.length }, "Lender auth: session cookies saved to database");
  } catch (err) {
    logger.warn({ err: String(err) }, "Lender auth: could not save session to database");
  }
}

export async function graphqlHealthCheck(appSession: string, csrfToken: string): Promise<boolean> {
  try {
    const resp = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type":           "application/json",
        "accept":                 "*/*",
        "origin":                 "https://admin.creditapp.ca",
        "referer":                "https://admin.creditapp.ca/",
        "x-creditapp-csrf-token": csrfToken,
        "cookie":                 `appSession=${appSession}; CA_CSRF_TOKEN=${csrfToken}`,
        "user-agent":             "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        query: "{ __typename }",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Lender auth: health check HTTP not ok");
      return false;
    }
    const body: any = await resp.json();
    const ok = !!body?.data?.__typename;
    if (ok) {
      logger.info("Lender auth: GraphQL health check passed");
    } else {
      logger.warn({ body: JSON.stringify(body).substring(0, 300) }, "Lender auth: health check no __typename");
    }
    return ok;
  } catch (err: any) {
    logger.warn({ err: err.message }, "Lender auth: GraphQL health check failed");
    return false;
  }
}

export async function callGraphQL(
  appSession: string,
  csrfToken: string,
  operationName: string,
  query: string,
  variables: Record<string, any> = {},
): Promise<any> {
  const resp = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type":           "application/json",
      "accept":                 "*/*",
      "origin":                 "https://admin.creditapp.ca",
      "referer":                "https://admin.creditapp.ca/",
      "x-creditapp-csrf-token": csrfToken,
      "cookie":                 `appSession=${appSession}; CA_CSRF_TOKEN=${csrfToken}`,
      "user-agent":             "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(operationName ? { operationName, variables, query } : { variables, query }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    let bodyText = "";
    try { bodyText = await resp.text(); } catch (_) {}
    logger.error({ status: resp.status, bodySnippet: bodyText.substring(0, 500), operationName }, "GraphQL HTTP error");
    throw new Error(`GraphQL HTTP ${resp.status}`);
  }
  const body = await resp.json();
  if (body.errors?.length) {
    logger.error({ errors: body.errors, operationName }, "GraphQL response errors");
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

async function launchBrowser(): Promise<any> {
  let puppeteer: any;
  try {
    puppeteer = (await import("puppeteer-extra")).default;
    const Stealth = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(Stealth());
    logger.info("Lender auth: using puppeteer-extra + stealth");
  } catch (_) {
    puppeteer = (await import("puppeteer")).default;
    logger.warn("Lender auth: stealth not available — using plain puppeteer");
  }

  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process");
    const found = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) { executablePath = found; logger.info({ executablePath }, "Lender auth: using system Chromium"); }
  } catch (_) {}

  return puppeteer.launch({
    headless: "new" as any,
    executablePath,
    timeout: 90_000,
    protocolTimeout: 90_000,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-gpu", "--no-zygote", "--disable-blink-features=AutomationControlled",
      "--no-first-run", "--no-default-browser-check", "--disable-infobars",
      "--window-size=1280,900",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function addAntiDetection(page: any): Promise<void> {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8" });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
}

async function findSelector(page: any, selectors: string[], timeout = 8000): Promise<any> {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout });
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

async function humanType(page: any, element: any, text: string): Promise<void> {
  try {
    await element.click();
  } catch (_) {
    try {
      await element.evaluate((el: HTMLElement) => { el.focus(); el.click(); });
    } catch (_) {
      await element.focus();
    }
  }
  await sleep(rand(80, 200));
  for (const ch of text) {
    await element.type(ch, { delay: 0 });
    await sleep(rand(60, 150));
  }
  await sleep(rand(200, 400));
}

async function clickLinkByText(page: any, phrases: string[]): Promise<string | null> {
  return page.evaluate((phrases: string[]) => {
    const els = Array.from(document.querySelectorAll("a, button, [role='button'], span[tabindex]"));
    for (const el of els) {
      const t = ((el as HTMLElement).textContent ?? "").toLowerCase().trim();
      if (phrases.some((p) => t.includes(p))) {
        (el as HTMLElement).click();
        return t;
      }
    }
    return null;
  }, phrases);
}

async function getPageText(page: any): Promise<string> {
  return page.evaluate(() => (document.body?.textContent ?? "").toLowerCase());
}

let enrolledTotpSecret: string | null = null;

async function navigateToOtpPage(page: any, startUrl: string): Promise<void> {
  const OTP_METHODS = [
    "one-time password", "otp", "authenticator", "google authenticator",
    "authentication app", "authenticator app", "one time password",
  ];
  const SWITCH_LINKS = [
    "try another method", "try another way", "use another method",
    "other methods", "choose another method",
  ];

  let url = startUrl;

  if (url.includes("mfa-otp-challenge")) {
    logger.info("Lender auth: already on OTP challenge page");
    return;
  }

  if (url.includes("mfa-sms-enrollment") || url.includes("mfa-sms-challenge")) {
    logger.info("Lender auth: on SMS page — clicking 'try another method'");
    const switched = await clickLinkByText(page, SWITCH_LINKS);
    if (switched) {
      logger.info({ clicked: switched }, "Lender auth: clicked switch link");
      await sleep(3000);
      url = page.url() as string;
    }
  }

  if (url.includes("mfa-enroll-options") || url.includes("mfa-login-options")) {
    logger.info("Lender auth: on method selection page — selecting OTP/authenticator");
    const pageText = await getPageText(page);
    logger.info({ pageTextSnippet: pageText.substring(0, 400) }, "Lender auth: method options page content");

    const otpClicked = await clickLinkByText(page, OTP_METHODS);
    if (otpClicked) {
      logger.info({ clicked: otpClicked }, "Lender auth: selected OTP method");
      await sleep(3000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}
    } else {
      const allLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("a, button, [role='button'], li, div[class*='option']"))
          .map((el: Element) => ({
            tag: el.tagName, text: (el as HTMLElement).innerText?.trim().substring(0, 80),
            href: (el as HTMLAnchorElement).href || "",
          }))
          .filter((l: any) => l.text && l.text.length > 0);
      });
      logger.info({ links: allLinks.slice(0, 15) }, "Lender auth: clickable elements on options page");
    }
    url = page.url() as string;
    logger.info({ url }, "Lender auth: page after selecting OTP method");
  }

  if (url.includes("mfa-otp-enrollment")) {
    logger.info("Lender auth: on OTP enrollment page — extracting secret from QR/page");

    let extractedSecret: string | null = null;

    extractedSecret = await page.evaluate(() => {
      const imgs = document.querySelectorAll("img");
      for (const img of imgs) {
        const src = (img as HTMLImageElement).src || "";
        if (src.includes("otpauth") || src.includes("secret=")) {
          const decoded = decodeURIComponent(src);
          const m = decoded.match(/secret=([A-Z2-7]+)/i);
          if (m) return m[1].toUpperCase();
        }
      }
      return null;
    });

    if (extractedSecret) {
      logger.info({ secretLen: extractedSecret.length, method: "qr-img-src" }, "Lender auth: extracted TOTP secret");
      enrolledTotpSecret = extractedSecret;
    } else {
      logger.info("Lender auth: QR src extraction failed — trying 'trouble scanning?' link");
      const cantScan = await clickLinkByText(page, [
        "can't scan", "trouble scanning", "enter key manually",
        "manual entry", "enter code manually", "having trouble",
        "can not scan", "setup key", "enter this code",
      ]);
      if (cantScan) {
        logger.info({ clicked: cantScan }, "Lender auth: clicked 'trouble scanning' link");
        await sleep(2000);
      }

      extractedSecret = await page.evaluate(() => {
        const allText = document.body?.innerText || "";
        const base32Match = allText.match(/[A-Z2-7]{16,}/);
        if (base32Match) return base32Match[0];

        const codeElements = document.querySelectorAll("code, pre, .secret, [data-secret], kbd, samp, tt");
        for (const el of codeElements) {
          const txt = (el as HTMLElement).innerText?.trim();
          if (txt && /^[A-Z2-7]{16,}$/.test(txt)) return txt;
        }
        return null;
      });

      if (extractedSecret) {
        logger.info({ secretLen: extractedSecret.length, method: "trouble-scanning" }, "Lender auth: extracted TOTP secret");
        enrolledTotpSecret = extractedSecret;
      } else {
        const pageHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || "");
        logger.warn({ pageHtmlSnippet: pageHtml.substring(0, 800) }, "Lender auth: could not extract TOTP secret");
      }
    }
  }
}

async function handle2FA(page: any): Promise<void> {
  await sleep(2000);

  const currentUrl = page.url() as string;
  if (currentUrl.includes("/u/login/password")) {
    logger.info("Lender auth: still on password page — not a 2FA prompt, skipping");
    return;
  }

  const pageText = await getPageText(page);
  if (pageText.includes("enter your password") || pageText.includes("wrong password")) {
    logger.info("Lender auth: password page detected — skipping 2FA handler");
    return;
  }

  const has2FA = pageText.includes("verify your identity") || pageText.includes("one-time password") ||
                 pageText.includes("authenticator") || pageText.includes("enter the code") ||
                 pageText.includes("verification") || pageText.includes("security code") ||
                 pageText.includes("multi-factor") || pageText.includes("2fa") ||
                 pageText.includes("secure your account") ||
                 currentUrl.includes("mfa-otp-challenge") || currentUrl.includes("mfa-sms-challenge") ||
                 currentUrl.includes("mfa-sms-enrollment") || currentUrl.includes("mfa-otp-enrollment");

  if (!has2FA) {
    logger.info("Lender auth: no 2FA prompt detected — skipping");
    return;
  }

  logger.info({ url: currentUrl, pageTextSnippet: pageText.substring(0, 300) }, "Lender auth: 2FA prompt detected");

  await navigateToOtpPage(page, currentUrl);

  const activeSecret = enrolledTotpSecret || LENDER_TOTP_SECRET;
  if (activeSecret) {
    const secretSource = enrolledTotpSecret ? "enrollment-extracted" : "env-var";
    const totpCode = generateTOTP(activeSecret);
    logger.info({ codeLength: totpCode.length, secretSource }, "Lender auth: TOTP code generated");

    const allInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map((el: HTMLInputElement) => ({
        name: el.name, type: el.type, id: el.id, placeholder: el.placeholder,
        inputMode: el.inputMode, readOnly: el.readOnly, disabled: el.disabled,
        valueLen: el.value.length, visible: el.offsetParent !== null,
        classes: el.className.substring(0, 60),
      }));
    });
    logger.info({ allInputs }, "Lender auth: all inputs on page before OTP entry");

    let otpInput = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      for (const el of inputs) {
        if (el.name === "code" && !el.readOnly && !el.disabled && el.offsetParent !== null) return true;
      }
      return false;
    }) ? await page.$('input[name="code"]') : null;

    if (!otpInput) {
      otpInput = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        for (const el of inputs) {
          if (el.inputMode === "numeric" && !el.readOnly && !el.disabled && el.offsetParent !== null && el.value.length === 0) return true;
        }
        return false;
      }) ? await page.$('input[inputmode="numeric"]') : null;
    }

    if (!otpInput) {
      otpInput = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const textInputs = inputs.filter(el =>
          (el.type === "text" || el.type === "tel" || el.type === "number") &&
          !el.readOnly && !el.disabled && el.offsetParent !== null && el.value.length === 0
        );
        return textInputs.length > 0;
      }) ? await page.evaluateHandle(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        return inputs.find(el =>
          (el.type === "text" || el.type === "tel" || el.type === "number") &&
          !el.readOnly && !el.disabled && el.offsetParent !== null && el.value.length === 0
        );
      }) : null;
    }

    if (!otpInput) {
      otpInput = await findSelector(page, [
        'input[name="code"]',
        'input[inputmode="numeric"]',
      ], 10_000);
    }

    if (otpInput) {
      const inputAttrs = await otpInput.evaluate((el: HTMLInputElement) => ({
        name: el.name, type: el.type, id: el.id, valueLen: el.value.length,
        placeholder: el.placeholder, inputMode: el.inputMode,
      }));
      logger.info({ inputAttrs }, "Lender auth: selected OTP input element");

      await otpInput.click({ clickCount: 3 }).catch(() => otpInput.focus());
      await sleep(300);
      await page.keyboard.press("Backspace");
      await sleep(200);

      for (const ch of totpCode) {
        await page.keyboard.press(ch);
        await sleep(rand(40, 80));
      }
      await sleep(500);

      const typedLen = await otpInput.evaluate((el: HTMLInputElement) => el.value.length);
      logger.info({ typedLen, expected: 6 }, "Lender auth: TOTP code typed");

      if (typedLen !== 6) {
        logger.warn("Lender auth: keyboard.press result unexpected — using nativeSet + dispatchEvent");
        await otpInput.evaluate((el: HTMLInputElement, code: string) => {
          const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          nativeSet.call(el, code);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, totpCode);
        await sleep(500);
        const retryLen = await otpInput.evaluate((el: HTMLInputElement) => el.value.length);
        logger.info({ retryLen }, "Lender auth: TOTP code set (nativeSet fallback)");
      }

      const submitted = await otpInput.evaluate((el: HTMLInputElement) => {
        const form = el.closest("form");
        if (form) {
          const btn = form.querySelector('button[type="submit"], button[name="action"]') as HTMLButtonElement | null;
          if (btn) { btn.click(); return "form-button"; }
          form.submit();
          return "form-submit";
        }
        return null;
      });

      if (submitted) {
        logger.info({ method: submitted }, "Lender auth: TOTP code submitted via same-form method");
      } else {
        const submitBtn = await findSelector(page, ['button[type="submit"]', 'button[name="action"]'], 5_000);
        if (submitBtn) {
          try { await submitBtn.click(); } catch (_) {
            await submitBtn.evaluate((el: HTMLElement) => el.click());
          }
          logger.info("Lender auth: TOTP code submitted via global button");
        } else {
          await page.keyboard.press("Enter");
          logger.info("Lender auth: TOTP code submitted via Enter");
        }
      }

      await sleep(3000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }); } catch (_) {}
      const postTotpUrl = page.url() as string;
      logger.info({ url: postTotpUrl }, "Lender auth: page after TOTP submit");

      if (postTotpUrl.includes("mfa-otp-enrollment")) {
        const errText = await page.evaluate(() => {
          const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"]');
          return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
        });
        logger.warn({ errText }, "Lender auth: still on OTP enrollment — code may have been rejected");
      }

      if (postTotpUrl.includes("recovery-code") || postTotpUrl.includes("new-code")) {
        const recoveryText = await getPageText(page);
        logger.info({ pageTextSnippet: recoveryText.substring(0, 300) }, "Lender auth: recovery code page detected");

        const checkbox = await page.$('input[type="checkbox"]');
        if (checkbox) {
          await checkbox.click();
          logger.info("Lender auth: checked recovery code confirmation checkbox");
          await sleep(1000);
        }

        const formSubmitted = await page.evaluate(() => {
          const forms = document.querySelectorAll("form");
          for (const form of forms) {
            const btn = form.querySelector('button[type="submit"], button[name="action"]') as HTMLButtonElement | null;
            if (btn && !btn.disabled) { btn.click(); return btn.textContent?.trim() || "submit"; }
          }
          return null;
        });
        if (formSubmitted) {
          logger.info({ clicked: formSubmitted }, "Lender auth: submitted recovery code form");
        } else {
          const continueBtn = await clickLinkByText(page, ["continue", "done", "next", "i have saved it", "i've saved"]);
          if (continueBtn) logger.info({ clicked: continueBtn }, "Lender auth: clicked continue on recovery code page");
        }
        await sleep(3000);
        try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}

        const afterRecoveryUrl = page.url() as string;
        logger.info({ url: afterRecoveryUrl }, "Lender auth: page after recovery code");

        if (afterRecoveryUrl.includes("recovery-code")) {
          logger.info("Lender auth: still on recovery code page — trying all buttons");
          await page.evaluate(() => {
            const btns = document.querySelectorAll("button");
            for (const btn of btns) {
              if (!btn.disabled && btn.offsetParent !== null) { btn.click(); break; }
            }
          });
          await sleep(3000);
          try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}
          logger.info({ url: page.url() }, "Lender auth: page after recovery code retry");
        }
      }

      const afterUrl = page.url() as string;
      if (afterUrl.includes("mfa-sms-enrollment")) {
        logger.info("Lender auth: redirected to SMS enrollment after OTP — attempting to skip");
        const skipBtn = await clickLinkByText(page, [
          "skip", "not now", "maybe later", "do it later", "remind me later",
        ]);
        if (skipBtn) {
          logger.info({ clicked: skipBtn }, "Lender auth: skipped SMS enrollment");
          await sleep(3000);
          try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}
        }
        logger.info({ url: page.url() }, "Lender auth: page after SMS enrollment skip attempt");
      }
    } else {
      logger.error("Lender auth: could not find OTP input field");
    }
  } else {
    logger.warn("Lender auth: no TOTP secret — cannot handle 2FA automatically");
  }
}

async function isLoggedIn(page: any): Promise<boolean> {
  try {
    await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(2000);
    const url     = page.url() as string;
    const content = (await page.content() as string).toLowerCase();
    const onAuth  = url.includes("auth0.com") || url.includes("/login");
    const hasDash = content.includes("application") || content.includes("dashboard") || content.includes("deal");
    return !onAuth && hasDash;
  } catch {
    return false;
  }
}

async function loginWithAuth0(page: any): Promise<boolean> {
  logger.info("Lender auth: navigating to CreditApp login");
  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  } catch (err: any) {
    logger.error({ err: err.message }, "Lender auth: login page navigation failed");
    return false;
  }
  await sleep(2000);

  const loginUrl = page.url() as string;
  logger.info({ url: loginUrl }, "Lender auth: login page loaded");

  const emailInput = await findSelector(page, AUTH0_EMAIL_SELECTORS, 12_000);
  if (!emailInput) { logger.error("Lender auth: email input not found"); return false; }
  logger.info("Lender auth: email input found — typing email");
  await humanType(page, emailInput, LENDER_EMAIL);

  const maybeBtn = await findSelector(page, ['button[type="submit"]'], 2000);
  if (maybeBtn) {
    logger.info("Lender auth: clicking continue/submit after email");
    try { await maybeBtn.click(); } catch (_) {
      await maybeBtn.evaluate((el: HTMLElement) => el.click());
    }
    await sleep(3000);
  }

  const passUrl = page.url() as string;
  logger.info({ url: passUrl }, "Lender auth: page after email submit");

  const passInput = await findSelector(page, AUTH0_PASS_SELECTORS, 12_000);
  if (!passInput) { logger.error("Lender auth: password input not found"); return false; }

  const passAttrs = await passInput.evaluate((el: HTMLInputElement) => ({
    tag: el.tagName, id: el.id, name: el.name, type: el.type, placeholder: el.placeholder,
  }));
  logger.info({ passAttrs }, "Lender auth: password input found");

  await passInput.click().catch(() => passInput.focus());
  await sleep(500);

  for (const ch of LENDER_PASSWORD) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
    await sleep(rand(40, 80));
  }
  await sleep(1000);

  const typedLen = await passInput.evaluate((el: HTMLInputElement) => el.value.length);
  logger.info({ typedLen, expected: LENDER_PASSWORD.length }, "Lender auth: password typed");

  if (typedLen !== LENDER_PASSWORD.length) {
    logger.warn("Lender auth: keyboard.press didn't fill — falling back to element.type()");
    await passInput.evaluate((el: HTMLInputElement) => {
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      nativeSet.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(200);
    await passInput.type(LENDER_PASSWORD, { delay: 50 });
    await sleep(500);
  }

  await sleep(500);
  logger.info("Lender auth: submitting password via Enter key");
  await page.keyboard.press("Enter");

  logger.info("Lender auth: waiting for post-password navigation");
  await sleep(4000);
  try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }); } catch (_) {}
  await sleep(2000);

  const postPasswordUrl = page.url() as string;
  const postPasswordText = await getPageText(page);
  logger.info({ url: postPasswordUrl, textSnippet: postPasswordText.substring(0, 500) }, "Lender auth: page state after password submit");

  const stillOnPassword = postPasswordUrl.includes("/u/login/password") || postPasswordText.includes("enter your password");
  if (stillOnPassword) {
    const errorText = await page.evaluate(() => {
      const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"], .ulp-input-error');
      return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
    });
    logger.error({ errorText }, "Lender auth: still on password page — checking for error messages");

    logger.info("Lender auth: retrying password — select all + retype");
    const passRetry = await findSelector(page, AUTH0_PASS_SELECTORS, 5_000);
    if (passRetry) {
      await passRetry.click({ clickCount: 3 }).catch(() => passRetry.focus());
      await sleep(300);
      await passRetry.type(LENDER_PASSWORD, { delay: 40 });
      await sleep(500);
      await page.keyboard.press("Enter");
      await sleep(5000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }); } catch (_) {}
      await sleep(2000);
      const retryUrl = page.url() as string;
      logger.info({ url: retryUrl }, "Lender auth: URL after password retry");
      if (retryUrl.includes("/u/login/password")) {
        const retryErrors = await page.evaluate(() => {
          const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"], .ulp-input-error');
          return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
        });
        logger.error({ retryErrors }, "Lender auth: still on password page after retry — login failed");
        return false;
      }
    }
  }

  await handle2FA(page);
  await sleep(3000);

  const postUrl = page.url() as string;
  const postContent = (await page.content() as string).substring(0, 500);
  logger.info({ url: postUrl, contentSnippet: postContent.substring(0, 200) }, "Lender auth: page state after 2FA");

  const onAuthDomain = postUrl.includes("auth0.com") || postUrl.includes("auth.admin.creditapp.ca") || postUrl.includes("/login");
  if (onAuthDomain) {
    logger.info("Lender auth: still on auth page after 2FA — navigating to CreditApp home");
    try {
      await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (_) {}
    await sleep(3000);
    const redirectedUrl = page.url() as string;
    logger.info({ url: redirectedUrl }, "Lender auth: URL after navigating to CreditApp home");

    if (redirectedUrl.includes("mfa-otp-challenge") || redirectedUrl.includes("mfa-sms-challenge") ||
        redirectedUrl.includes("mfa-otp-enrollment") || redirectedUrl.includes("mfa-sms-enrollment")) {
      logger.info("Lender auth: redirected to MFA page after nav — handling second 2FA round");
      await handle2FA(page);
      await sleep(3000);

      const post2ndUrl = page.url() as string;
      logger.info({ url: post2ndUrl }, "Lender auth: URL after second 2FA round");

      if (post2ndUrl.includes("auth.admin.creditapp.ca")) {
        logger.info("Lender auth: still on auth domain after second 2FA — navigating to CreditApp home again");
        try {
          await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
        } catch (_) {}
        await sleep(3000);
        logger.info({ url: page.url() }, "Lender auth: URL after second CreditApp nav");
      }
    }
  }

  const ok = await isLoggedIn(page);
  logger.info({ ok }, "Lender auth: login result");
  return ok;
}

export async function getLenderAuthCookies(): Promise<{ appSession: string; csrfToken: string }> {
  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";

  try {
    const blob = await loadLenderSessionFromStore();
    if (blob?.cookies?.length) {
      const auth = extractAuthCookies(blob.cookies);
      if (auth) {
        const ok = await graphqlHealthCheck(auth.appSession, auth.csrfToken);
        if (ok) {
          logger.info("Lender auth: object-storage session valid");
          return auth;
        }
        logger.info({ isProduction }, "Lender auth: object-storage session expired");
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "Lender auth: could not load session from object storage");
  }

  const dbCookies = await loadCookiesFromDb();
  if (dbCookies.length > 0) {
    const auth = extractAuthCookies(dbCookies);
    if (auth) {
      const ok = await graphqlHealthCheck(auth.appSession, auth.csrfToken);
      if (ok) {
        logger.info("Lender auth: database session valid — promoting to object storage");
        await saveLenderSessionToStore(dbCookies);
        return auth;
      }
    }
  }

  const fileCookies = loadCookiesFromFile();
  if (fileCookies.length > 0) {
    const auth = extractAuthCookies(fileCookies);
    if (auth) {
      const ok = await graphqlHealthCheck(auth.appSession, auth.csrfToken);
      if (ok) {
        logger.info("Lender auth: file session valid — promoting to object storage + database");
        await saveLenderSessionToStore(fileCookies);
        await saveCookiesToDb(fileCookies);
        return auth;
      }
    }
  }

  if (isProduction) {
    throw new Error(
      "Lender auth: session cookies expired in production — dev's nightly run will refresh them.",
    );
  }

  logger.info("Lender auth: launching browser for fresh login (dev)");
  let browser: any = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await addAntiDetection(page);

    const loggedIn = await loginWithAuth0(page);
    if (!loggedIn) throw new Error("Login to CreditApp (lender account) failed");

    let currentUrl = page.url();
    logger.info({ currentUrl }, "Lender auth: URL after login flow");

    if (currentUrl.includes("auth.admin.creditapp.ca") || !currentUrl.includes("admin.creditapp.ca")) {
      logger.info("Lender auth: navigating to admin.creditapp.ca to collect app cookies");
      await page.goto("https://admin.creditapp.ca", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(3000);
      currentUrl = page.url();
      logger.info({ currentUrl }, "Lender auth: URL after navigating to CreditApp app domain");
    }

    const cookies = await page.cookies("https://admin.creditapp.ca");
    const cookieNames = cookies.map((c: any) => c.name);
    logger.info({ currentUrl, cookieCount: cookies.length, cookieNames }, "Lender auth: cookies after login");
    const auth = extractAuthCookies(cookies);
    if (!auth) {
      const authDomainCookies = await page.cookies("https://auth.admin.creditapp.ca");
      const authCookieNames = authDomainCookies.map((c: any) => c.name);
      logger.error({ cookieNames, authCookieNames, currentUrl }, "Lender auth: missing appSession or CA_CSRF_TOKEN");
      throw new Error("Required auth cookies not found after lender login");
    }

    await saveLenderSessionToStore(cookies);
    await saveCookiesToDb(cookies);
    saveCookiesToFile(cookies);

    return auth;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}

```


### `artifacts/api-server/src/lib/lenderWorker.ts` (487 lines)

```typescript
import { logger } from "./logger.js";
import {
  loadLenderProgramsFromStore,
  saveLenderProgramsToStore,
  type LenderProgram,
  type LenderProgramGuide,
  type LenderProgramTier,
  type LenderProgramsBlob,
  type VehicleTermMatrixEntry,
  type VehicleConditionMatrixEntry,
} from "./bbObjectStore.js";
import { getLenderAuthCookies, callGraphQL, LENDER_ENABLED } from "./lenderAuth.js";

const CREDITOR_NAME_TO_CODE: Record<string, { code: string; name: string }> = {
  SANTANDER:  { code: "SAN", name: "Santander" },
  EDEN_PARK:  { code: "EPI", name: "Eden Park" },
  ACC:        { code: "ACC", name: "ACC" },
  IAF:        { code: "iAF", name: "iA Auto Finance" },
  QUANTIFI:   { code: "QLI", name: "Quantifi" },
  RIFCO:      { code: "RFC", name: "Rifco" },
};

const IN_HOUSE_PROGRAM_MAP: Record<string, { code: string; name: string }> = {
  "Cavalcade":              { code: "CAV", name: "Cavalcade" },
  "Cavalcade Tier Program": { code: "CAV", name: "Cavalcade" },
  "Powersports":            { code: "THF", name: "The House Finance Corp" },
  "Auto Program":           { code: "THF", name: "The House Finance Corp" },
};

interface LenderStatus {
  running:   boolean;
  startedAt: string | null;
  lastRun:   string | null;
  lastCount: number;
  error?:    string;
}

const status: LenderStatus = { running: false, startedAt: null, lastRun: null, lastCount: 0 };

export function getLenderSyncStatus(): LenderStatus {
  return { ...status };
}

let cachedPrograms: LenderProgramsBlob | null = null;

export function getCachedLenderPrograms(): LenderProgramsBlob | null {
  return cachedPrograms;
}

export async function loadLenderProgramsFromCache(): Promise<LenderProgramsBlob | null> {
  if (cachedPrograms) return cachedPrograms;
  try {
    const blob = await loadLenderProgramsFromStore();
    if (blob) {
      cachedPrograms = blob;
      logger.info({ count: blob.programs.length, updatedAt: blob.updatedAt }, "Lender programs loaded from object storage");
    }
    return blob;
  } catch (err: any) {
    logger.warn({ err: err.message }, "Could not load lender programs from object storage");
    return null;
  }
}

const CREDITORS_PROGRAMS_QUERY = `{
  creditors {
    id
    name
    status
    programs {
      id
      type
      title
      tiers {
        id
        name
        maxPayment { amount currency }
        interestRate { from to }
        maxAdvanceLTV
        maxAftermarketLTV
        maxAllInLTV
        creditorFee { amount currency }
        dealerReserve { amount currency }
      }
      vehicleTermMatrix {
        year
        data {
          term
          milage { from to }
        }
      }
      vehicleConditionMatrix {
        year
        extraClean { milage { from to } }
        clean { milage { from to } }
        average { milage { from to } }
        rough { milage { from to } }
      }
      backendLtvCalculation
      allInLtvCalculation
      maxExtendedWarrantyFeeCalculation
      maxGapInsuranceFeeCalculation
      maxAhInsuranceFeeCalculation
      maxDealerAdminFeeCalculation
      backendRemainingCalculation
      allInRemainingCalculation
    }
  }
}`;

function mapCreditorToLenderPrograms(creditor: any): LenderProgram[] {
  const creditorName: string = creditor.name ?? "";
  const creditorId: string = creditor.id;

  if (creditorName === "IN_HOUSE") {
    const grouped = new Map<string, { code: string; name: string; guides: LenderProgramGuide[] }>();

    for (const prog of creditor.programs ?? []) {
      const match = IN_HOUSE_PROGRAM_MAP[prog.title];
      if (!match) continue;
      if (!grouped.has(match.code)) {
        grouped.set(match.code, { code: match.code, name: match.name, guides: [] });
      }
      grouped.get(match.code)!.guides.push(mapProgramGuide(prog));
    }

    return [...grouped.values()].map(g => ({
      lenderCode: g.code,
      lenderName: g.name,
      creditorId,
      programs: g.guides,
    }));
  }

  const mapping = CREDITOR_NAME_TO_CODE[creditorName];
  if (!mapping) {
    logger.info({ creditorName, creditorId }, "Lender sync: unknown creditor — skipping");
    return [];
  }

  const guides: LenderProgramGuide[] = (creditor.programs ?? []).map(mapProgramGuide);
  if (mapping.code === "SAN") {
    for (const g of guides) {
      // Santander uses all-in constraint in practice; do not force synthetic split aftermarket caps.
      g.capModelResolved = "allInOnly";
    }
  }

  return [{
    lenderCode: mapping.code,
    lenderName: mapping.name,
    creditorId,
    programs: guides,
  }];
}

function mapMilageRange(m: any): { kmFrom: number; kmTo: number } {
  return { kmFrom: m?.milage?.from ?? 0, kmTo: m?.milage?.to ?? 0 };
}

function mapProgramGuide(prog: any): LenderProgramGuide {
  const tiers: LenderProgramTier[] = (prog.tiers ?? []).map((t: any) => ({
    tierName:          t.name ?? "Unknown",
    minRate:           t.interestRate?.from ?? 0,
    maxRate:           t.interestRate?.to ?? 0,
    maxPayment:        t.maxPayment?.amount ?? 0,
    maxAdvanceLTV:     t.maxAdvanceLTV ?? 0,
    maxAftermarketLTV: t.maxAftermarketLTV ?? 0,
    maxAllInLTV:       t.maxAllInLTV ?? 0,
    creditorFee:       t.creditorFee?.amount ?? 0,
    dealerReserve:     t.dealerReserve?.amount ?? 0,
  }));

  const vehicleTermMatrix: VehicleTermMatrixEntry[] = (prog.vehicleTermMatrix ?? []).map((entry: any) => ({
    year: entry.year,
    data: (entry.data ?? []).map((d: any) => ({
      term:   d.term,
      kmFrom: d.milage?.from ?? 0,
      kmTo:   d.milage?.to ?? 0,
    })),
  }));

  const vehicleConditionMatrix: VehicleConditionMatrixEntry[] = (prog.vehicleConditionMatrix ?? []).map((entry: any) => ({
    year:       entry.year,
    extraClean: mapMilageRange(entry.extraClean),
    clean:      mapMilageRange(entry.clean),
    average:    mapMilageRange(entry.average),
    rough:      mapMilageRange(entry.rough),
  }));

  const maxTerm = vehicleTermMatrix.length > 0
    ? Math.max(...vehicleTermMatrix.flatMap(e => e.data.map(d => d.term)))
    : undefined;

  function parseCalcNumber(val: unknown): number | undefined {
    if (val == null) return undefined;
    const s = String(val).trim();
    if (s === "") return undefined;
    const n = Number(s);
    return isFinite(n) ? n : undefined;
  }

  function parseCalcString(val: unknown): string | undefined {
    if (typeof val !== "string") return undefined;
    const s = val.trim();
    return s.length > 0 ? s : undefined;
  }

  function inferAftermarketBase(backendRemaining?: string): "bbWholesale" | "salePrice" | "unknown" {
    if (!backendRemaining) return "unknown";
    const hasWholesale = backendRemaining.includes("wholesaleValueBasedOnProgram");
    const hasSalePrice = backendRemaining.includes("salePrice");
    if (hasWholesale && !hasSalePrice) return "bbWholesale";
    if (hasSalePrice && !hasWholesale) return "salePrice";
    return "unknown";
  }

  function inferAdminFeeInclusion(
    backendLtv?: string, allInLtv?: string
  ): "backend" | "allIn" | "excluded" | "unknown" {
    const inBackend = backendLtv?.includes("dealerAdminFee") ?? false;
    const inAllIn   = allInLtv?.includes("dealerAdminFee") ?? false;
    if (inBackend) return "backend";
    if (inAllIn)   return "allIn";
    if (backendLtv || allInLtv) return "excluded";
    return "unknown";
  }

  function inferCapModelResolved(
    backendRemaining?: string,
    allInRemaining?: string,
    backendLtv?: string,
    allInLtv?: string,
  ): "allInOnly" | "split" | "backendOnly" | "unknown" {
    const backendExpr = `${backendRemaining ?? ""} ${backendLtv ?? ""}`.toLowerCase();
    const allInExpr = `${allInRemaining ?? ""} ${allInLtv ?? ""}`.toLowerCase();
    const productRegex = /(extendedwarrantyfee|gapinsurancefee|ahinsurancefee|dealeradminfee)/i;

    const hasBackendRemaining = !!backendRemaining;
    const hasAllInRemaining = !!allInRemaining;
    const backendMentionsProducts = productRegex.test(backendExpr);
    const allInMentionsProducts = productRegex.test(allInExpr);

    if (!hasBackendRemaining && hasAllInRemaining) return "allInOnly";
    if (hasBackendRemaining && !hasAllInRemaining) return "backendOnly";
    if (hasBackendRemaining && hasAllInRemaining) {
      if (!backendMentionsProducts && allInMentionsProducts) return "allInOnly";
      return "split";
    }
    return "unknown";
  }

  const backendLtvCalculation = parseCalcString(prog.backendLtvCalculation);
  const allInLtvCalculation = parseCalcString(prog.allInLtvCalculation);
  const backendRemainingCalculation = parseCalcString(prog.backendRemainingCalculation);
  const allInRemainingCalculation = parseCalcString(prog.allInRemainingCalculation);
  const aftermarketBase = inferAftermarketBase(backendRemainingCalculation);
  const adminFeeInclusion = inferAdminFeeInclusion(backendLtvCalculation, allInLtvCalculation);
  const capModelResolved = inferCapModelResolved(
    backendRemainingCalculation,
    allInRemainingCalculation,
    backendLtvCalculation,
    allInLtvCalculation,
  );

  const parsedMaxWarranty = parseCalcNumber(prog.maxExtendedWarrantyFeeCalculation);
  const parsedMaxGap      = parseCalcNumber(prog.maxGapInsuranceFeeCalculation);
  const parsedMaxAh       = parseCalcNumber(prog.maxAhInsuranceFeeCalculation);
  const parsedMaxAdmin    = parseCalcNumber(prog.maxDealerAdminFeeCalculation);

  // autoWorksheetPreferences.gapInsuranceTarget is not available in the
  // creditors-level GraphQL query (field doesn't exist in the schema).
  // Keep the AH_INSURANCE routing logic below for future use if a
  // per-program query becomes available.
  const gapTarget: string | null = null;

  let resolvedMaxWarranty = parsedMaxWarranty != null && parsedMaxWarranty > 0
    ? parsedMaxWarranty
    : undefined;

  // GAP cap source tracked for debug visibility.
  let gapCapSource = "none";
  let resolvedMaxGap: number | undefined;
  if (gapTarget === "AH_INSURANCE") {
    if (parsedMaxAh != null && parsedMaxAh > 0) {
      resolvedMaxGap = parsedMaxAh;
      gapCapSource = "maxAhInsuranceFeeCalculation";
    } else if (parsedMaxGap != null && parsedMaxGap > 0) {
      resolvedMaxGap = parsedMaxGap;
      gapCapSource = "maxGapInsuranceFeeCalculation";
    } else if (resolvedMaxWarranty != null) {
      // CreditApp sometimes stores AH-routed GAP cap in the warranty calc field.
      resolvedMaxGap = resolvedMaxWarranty;
      resolvedMaxWarranty = undefined;
      gapCapSource = "warrantyFallbackForAhTarget";
    } else {
      resolvedMaxGap = undefined;
      gapCapSource = "none";
    }
  } else {
    resolvedMaxGap = parsedMaxGap != null && parsedMaxGap > 0 ? parsedMaxGap : undefined;
    gapCapSource = resolvedMaxGap != null ? "maxGapInsuranceFeeCalculation" : "none";
  }

  const feeCalculationsRaw = {
    maxExtendedWarrantyFeeCalculation: typeof prog.maxExtendedWarrantyFeeCalculation === "string"
      ? prog.maxExtendedWarrantyFeeCalculation
      : undefined,
    maxGapInsuranceFeeCalculation: typeof prog.maxGapInsuranceFeeCalculation === "string"
      ? prog.maxGapInsuranceFeeCalculation
      : undefined,
    maxDealerAdminFeeCalculation: typeof prog.maxDealerAdminFeeCalculation === "string"
      ? prog.maxDealerAdminFeeCalculation
      : undefined,
    maxAhInsuranceFeeCalculation: typeof prog.maxAhInsuranceFeeCalculation === "string"
      ? prog.maxAhInsuranceFeeCalculation
      : undefined,
    resolvedGapCapSource: gapCapSource,
  };

  logger.info({
    program: prog.title,
    rawWarrantyCalc: prog.maxExtendedWarrantyFeeCalculation ?? null,
    rawGapCalc:      prog.maxGapInsuranceFeeCalculation ?? null,
    rawAhCalc:       prog.maxAhInsuranceFeeCalculation ?? null,
    rawAdminCalc:    prog.maxDealerAdminFeeCalculation ?? null,
    gapInsuranceTarget: gapTarget,
    parsedMaxWarranty,
    parsedMaxGapFromField: parsedMaxGap,
    resolvedMaxGap,
    resolvedMaxWarranty,
    gapCapSource,
    parsedMaxAh,
    parsedMaxAdmin,
    adminFeeInclusion,
    aftermarketBase,
    capModelResolved,
  }, "Lender sync: program fee caps");

  return {
    programId:              prog.id,
    programTitle:           prog.title ?? "Unknown",
    programType:            prog.type ?? "FINANCE",
    tiers,
    vehicleTermMatrix,
    vehicleConditionMatrix,
    maxTerm,
    maxWarrantyPrice: resolvedMaxWarranty,
    maxGapPrice:      resolvedMaxGap,
    maxAdminFee:      parsedMaxAdmin != null && parsedMaxAdmin > 0 ? parsedMaxAdmin : undefined,
    gapInsuranceTarget: gapTarget,
    feeCalculationsRaw,
    capModelResolved,
    backendLtvCalculation,
    allInLtvCalculation,
    backendRemainingCalculation,
    allInRemainingCalculation,
    aftermarketBase,
    allInOnlyRules: !!allInRemainingCalculation && !backendRemainingCalculation,
    adminFeeInclusion,
  };
}

async function syncLenderPrograms(): Promise<void> {
  const { appSession, csrfToken } = await getLenderAuthCookies();
  logger.info("Lender sync: auth ready — fetching creditor programs");

  const data = await callGraphQL(appSession, csrfToken, "", CREDITORS_PROGRAMS_QUERY);
  const creditors = data?.creditors ?? [];

  if (creditors.length === 0) {
    throw new Error("Lender sync: creditors query returned empty");
  }

  logger.info({ creditorCount: creditors.length }, "Lender sync: fetched creditors from CreditApp");

  const programs: LenderProgram[] = [];
  for (const cred of creditors) {
    if (cred.status !== "ACTIVE") continue;
    const mapped = mapCreditorToLenderPrograms(cred);
    programs.push(...mapped);
  }

  if (programs.length === 0) {
    throw new Error("Lender sync: no active lender programs found");
  }

  const totalTiers = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.tiers.length, 0), 0);
  const totalTermMatrices = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.vehicleTermMatrix.length, 0), 0);
  const totalCondMatrices = programs.reduce((s, p) => s + p.programs.reduce((s2, g) => s2 + g.vehicleConditionMatrix.length, 0), 0);

  const blob: LenderProgramsBlob = {
    programs,
    updatedAt: new Date().toISOString(),
  };

  await saveLenderProgramsToStore(blob);
  cachedPrograms = blob;

  logger.info(
    { lenderCount: programs.length, totalTiers, totalTermMatrices, totalCondMatrices },
    "Lender sync: programs saved to object storage",
  );
}

export async function runLenderSync(): Promise<void> {
  if (!LENDER_ENABLED) {
    logger.info("Lender sync: LENDER_CREDITAPP_EMAIL or LENDER_CREDITAPP_PASSWORD not set — skipping");
    return;
  }
  if (status.running) {
    logger.warn("Lender sync: already running — skipping");
    return;
  }

  status.running   = true;
  status.startedAt = new Date().toISOString();
  status.error     = undefined;

  try {
    await syncLenderPrograms();
    status.lastRun   = new Date().toISOString();
    status.lastCount = cachedPrograms?.programs.length ?? 0;
    await recordRunDateToDb();
  } catch (err: any) {
    status.error = err.message;
    logger.error({ err: err.message }, "Lender sync: run failed");
    throw err;
  } finally {
    status.running   = false;
    status.startedAt = null;
  }
}

async function getLastRunDateFromDb(): Promise<string> {
  try {
    const { db, lenderSessionTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { toMountainDateStr } = await import("./randomScheduler.js");
    const rows = await db.select({ lastRunAt: lenderSessionTable.lastRunAt })
      .from(lenderSessionTable)
      .where(eq(lenderSessionTable.id, "singleton"));
    if (rows.length > 0 && rows[0].lastRunAt) {
      return toMountainDateStr(rows[0].lastRunAt);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Lender sync: could not read last run date from DB");
  }
  return "";
}

async function recordRunDateToDb(): Promise<void> {
  try {
    const { db, lenderSessionTable } = await import("@workspace/db");
    await db
      .insert(lenderSessionTable)
      .values({ id: "singleton", cookies: "[]", lastRunAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: lenderSessionTable.id,
        set: { lastRunAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err: String(err) }, "Lender sync: could not record run date to DB");
  }
}

export function scheduleLenderSync(): void {
  const { scheduleRandomDaily, toMountainDateStr } = require("./randomScheduler.js") as typeof import("./randomScheduler.js");

  loadLenderProgramsFromCache().catch(err =>
    logger.warn({ err: String(err) }, "Lender sync: could not preload programs from object storage"),
  );

  scheduleRandomDaily({
    name: "Lender sync",
    hasRunToday: async () => {
      const today = toMountainDateStr();
      const lastRan = await getLastRunDateFromDb();
      return lastRan === today;
    },
    execute: (reason: string) => {
      runLenderSync().catch(err => logger.error({ err }, "Lender sync: scheduled run error"));
    },
  });

  logger.info("Lender sync scheduled — randomized daily within business hours (Mountain Time)");
}

```


### `artifacts/api-server/src/lib/lenderCalcEngine.ts` (105 lines)

```typescript
export type CapModelResolved = "allInOnly" | "split" | "backendOnly" | "unknown";
export type CapProfileKey = "000" | "001" | "010" | "011" | "100" | "101" | "110" | "111";

export interface CapProfile {
  hasAdvanceCap: boolean;
  hasAftermarketCap: boolean;
  hasAllInCap: boolean;
  allInOnly: boolean;
  key: CapProfileKey;
}

export interface CapProfileInput {
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  capModelResolved?: CapModelResolved;
}

export interface NoOnlineSellContext {
  pacCost: number;
  downPayment: number;
  netTrade: number;
  creditorFee: number;
  maxAdvance: number;
  maxAllInPreTax: number;
  profile: CapProfile;
}

export interface NoOnlineSellResolution {
  price: number;
  source: "maximized" | "pac";
  rejection?: "ltvAdvance" | "ltvAllIn";
  strategy: string;
}

export const NO_ONLINE_STRATEGY_BY_PROFILE: Record<CapProfileKey, string> = {
  "000": "pacFallback",
  "001": "maximizeFromAllIn",
  "010": "pacFallback",
  "011": "maximizeFromAllIn",
  "100": "maximizeFromAdvance",
  "101": "maximizeFromAdvanceAndAllIn",
  "110": "maximizeFromAdvance",
  "111": "maximizeFromAdvanceAndAllIn",
};

export function resolveCapProfile(input: CapProfileInput): CapProfile {
  const hasAdvanceCap = input.maxAdvanceLTV > 0;
  const hasAllInCap = input.maxAllInLTV > 0;
  let hasAftermarketCap = input.maxAftermarketLTV > 0;

  // If formula classification says all-in only, suppress aftermarket split cap even if a numeric tier value exists.
  if (input.capModelResolved === "allInOnly") {
    hasAftermarketCap = false;
  }

  const key = `${hasAdvanceCap ? 1 : 0}${hasAftermarketCap ? 1 : 0}${hasAllInCap ? 1 : 0}` as CapProfileKey;

  return {
    hasAdvanceCap,
    hasAftermarketCap,
    hasAllInCap,
    allInOnly: !hasAdvanceCap && !hasAftermarketCap && hasAllInCap,
    key,
  };
}

export function resolveNoOnlineSellingPrice(ctx: NoOnlineSellContext): NoOnlineSellResolution {
  const strategy = NO_ONLINE_STRATEGY_BY_PROFILE[ctx.profile.key];

  const ceilings: { value: number; reason: "ltvAdvance" | "ltvAllIn" }[] = [];
  if (ctx.profile.hasAdvanceCap) {
    ceilings.push({
      value: Math.round(ctx.maxAdvance + ctx.downPayment + ctx.netTrade),
      reason: "ltvAdvance",
    });
  }
  if (ctx.profile.hasAllInCap) {
    ceilings.push({
      value: Math.round(ctx.maxAllInPreTax - ctx.creditorFee + ctx.downPayment + ctx.netTrade),
      reason: "ltvAllIn",
    });
  }

  if (ceilings.length === 0) {
    return { price: ctx.pacCost, source: "pac", strategy };
  }

  const effective = ceilings.reduce((min, c) => c.value < min.value ? c : min, ceilings[0]);

  if (effective.value < ctx.pacCost) {
    return {
      price: effective.value,
      source: "maximized",
      rejection: effective.reason,
      strategy,
    };
  }

  return {
    price: effective.value,
    source: "maximized",
    strategy,
  };
}

```


### `artifacts/api-server/src/routes/index.ts` (18 lines)

```typescript
import { Router, type IRouter } from "express";
import healthRouter    from "./health.js";
import authRouter      from "./auth.js";
import inventoryRouter from "./inventory.js";
import accessRouter    from "./access.js";
import carfaxRouter    from "./carfax.js";
import lenderRouter    from "./lender.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(inventoryRouter);
router.use(accessRouter);
router.use(carfaxRouter);
router.use(lenderRouter);

export default router;

```


### `artifacts/api-server/src/routes/health.ts` (11 lines)

```typescript
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;

```


### `artifacts/api-server/src/routes/auth.ts` (75 lines)

```typescript
import { Router } from "express";
import passport from "passport";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";

const router = Router();

// Temp: shows exact callback URL registered with Google (helps diagnose OAuth mismatches)
router.get("/auth/debug-callback", (_req, res) => {
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  const callbackURL = domain
    ? `https://${domain}/api/auth/google/callback`
    : "http://localhost:8080/api/auth/google/callback";
  res.json({ callbackURL, REPLIT_DOMAINS: process.env["REPLIT_DOMAINS"] ?? "(not set)" });
});

// Kick off Google OAuth
router.get("/auth/google", passport.authenticate("google", { scope: ["email", "profile"] }));

// OAuth callback
router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/?auth_error=1" }),
  (_req, res) => {
    res.redirect("/");
  }
);

// Logout
router.get("/auth/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

// Current user — includes role
router.get("/me", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user  = req.user as { email: string; name: string; picture: string };
  const email = user.email.toLowerCase();
  const owner = isOwner(email);

  let role = "viewer";
  if (owner) {
    role = "owner";
  } else {
    const [entry] = await db
      .select()
      .from(accessListTable)
      .where(eq(accessListTable.email, email))
      .limit(1);
    if (entry) role = entry.role;
    else {
      // Not in access list — deny
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  res.json({
    email:   user.email,
    name:    user.name,
    picture: user.picture,
    isOwner: owner,
    role,
  });
});

export default router;

```


### `artifacts/api-server/src/routes/access.ts` (143 lines)

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable, auditLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { sendInvitationEmail } from "../lib/emailService.js";

const router = Router();

function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as { email: string };
  if (!isOwner(user.email)) {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

async function writeAudit(
  action: string,
  targetEmail: string,
  changedBy: string,
  roleFrom?: string | null,
  roleTo?: string | null,
) {
  try {
    await db.insert(auditLogTable).values({
      action,
      targetEmail,
      changedBy,
      roleFrom:  roleFrom  ?? null,
      roleTo:    roleTo    ?? null,
    });
  } catch (_err) {
    // Audit failures are non-fatal
  }
}

// GET /access — list all approved users (owner only)
router.get("/access", requireOwner, async (_req, res) => {
  const list = await db.select().from(accessListTable).orderBy(accessListTable.addedAt);
  res.json(list);
});

// POST /access — add a user (owner only)
router.post("/access", requireOwner, async (req, res) => {
  const rawEmail = (req.body?.email ?? "").toString().trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes("@")) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  const role  = ["viewer", "guest"].includes(req.body?.role) ? req.body.role : "viewer";
  const owner = (req.user as { email: string }).email;

  const [entry] = await db
    .insert(accessListTable)
    .values({ email: rawEmail, addedBy: owner, role })
    .onConflictDoNothing()
    .returning();

  await writeAudit("add", rawEmail, owner, null, role);

  // Send invitation email (non-blocking — failure doesn't affect response)
  if (entry) {
    sendInvitationEmail(rawEmail, role, owner).catch(() => {});
  }

  res.json(entry ?? { email: rawEmail, addedBy: owner, addedAt: new Date().toISOString(), role });
});

// PATCH /access/:email — update a user's role (owner only)
router.patch("/access/:email", requireOwner, async (req, res) => {
  const email   = decodeURIComponent(req.params.email ?? "").toLowerCase();
  const newRole = (req.body?.role ?? "").toString().trim().toLowerCase();

  if (!["viewer", "guest"].includes(newRole)) {
    res.status(400).json({ error: "Role must be 'viewer' or 'guest'" });
    return;
  }

  const [existing] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [updated] = await db
    .update(accessListTable)
    .set({ role: newRole })
    .where(eq(accessListTable.email, email))
    .returning();

  const owner = (req.user as { email: string }).email;
  await writeAudit("role_change", email, owner, existing.role, newRole);

  res.json(updated);
});

// DELETE /access/:email — remove a user (owner only)
router.delete("/access/:email", requireOwner, async (req, res) => {
  const email = decodeURIComponent(req.params.email ?? "").toLowerCase();
  const owner = (req.user as { email: string }).email;

  const [existing] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);

  await db.delete(accessListTable).where(eq(accessListTable.email, email));
  await writeAudit("remove", email, owner, existing?.role ?? null, null);

  try {
    const { pool } = await import("@workspace/db");
    await pool.query(
      `DELETE FROM "session" WHERE sess::text ILIKE $1`,
      [`%${email}%`],
    );
  } catch (_err) {}

  res.json({ ok: true });
});

// GET /audit-log — audit log of all access changes (owner only)
router.get("/audit-log", requireOwner, async (_req, res) => {
  const entries = await db
    .select()
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.timestamp))
    .limit(200);
  res.json(entries);
});

export default router;

```


### `artifacts/api-server/src/routes/inventory.ts` (200 lines)

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, refreshCache } from "../lib/inventoryCache.js";
import { runBlackBookWorker, getBlackBookStatus } from "../lib/blackBookWorker.js";

const router = Router();

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";
const IMAGE_CDN_BASE = "https://zopsoftware-asset.b-cdn.net";

const DEALER_COLLECTIONS = [
  {
    name:       "Matrix",
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.matrixmotorsyeg.ca",
  },
  {
    name:       "Parkdale",
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.parkdalemotors.ca",
  },
];

function extractWebsiteUrl(doc: any, siteUrl: string): string | null {
  if (doc.page_url) {
    const path = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
    return `${siteUrl}/${path}/`;
  }
  const id   = doc.id || doc.post_id || doc.vehicle_id || "";
  let   slug = doc.slug || doc.url_slug || "";
  if (!slug && doc.year && doc.make && doc.model) {
    slug = [doc.year, doc.make, doc.model, doc.trim || ""]
      .filter((p: any) => String(p).trim() !== "")
      .join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  if (!id || !slug) return null;
  return `${siteUrl}/inventory/${slug}/${id}/`;
}

// Determine the calling user's role ('owner' | 'viewer' | 'guest')
async function getUserRole(req: any): Promise<string> {
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) return "owner";
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  return entry?.role ?? "viewer";
}

async function requireAccess(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) { next(); return; }
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  if (entry) { next(); return; }
  res.status(403).json({ error: "Access denied" });
}

// GET /inventory — instant response from server-side cache, role-filtered
router.get("/inventory", requireAccess, async (req, res) => {
  const role = await getUserRole(req);
  const { data } = getCacheState();

  const items = data.map((item) => {
    if (role === "owner") return item;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { matrixPrice, cost, ...rest } = item;

    if (role === "viewer") return rest;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { bbAvgWholesale, bbValues, ...guestRest } = rest;
    if (role === "guest") return { ...guestRest, price: "" };

    return guestRest;
  });

  res.set("Cache-Control", "no-store");
  res.json(items);
});

// GET /cache-status — lightweight poll so the portal can detect updates
router.get("/cache-status", requireAccess, (_req, res) => {
  const { lastUpdated, isRefreshing, data } = getCacheState();
  const bb = getBlackBookStatus();
  res.set("Cache-Control", "no-store");
  res.json({
    lastUpdated:    lastUpdated?.toISOString() ?? null,
    isRefreshing,
    count:          data.length,
    bbRunning:      bb.running,
    bbLastRun:      bb.lastRun,
    bbCount:        bb.lastCount,
  });
});

// POST /refresh-blackbook — owner only, triggers manual Black Book refresh
router.post("/refresh-blackbook", requireAccess, async (req, res) => {
  const role = await getUserRole(req);
  if (role !== "owner") {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  const { running } = getBlackBookStatus();
  if (running) {
    res.json({ ok: true, message: "Already running", running: true });
    return;
  }
  runBlackBookWorker().catch((err) =>
    logger.error({ err }, "Manual BB refresh error"),
  );
  res.json({ ok: true, message: "Black Book refresh started", running: true });
});

// POST /refresh — webhook from Apps Script to trigger an immediate cache refresh
router.post("/refresh", (req, res) => {
  const secret   = req.headers["x-refresh-secret"];
  const expected = process.env["REFRESH_SECRET"]?.trim();

  if (!expected || secret !== expected) {
    logger.warn({ ip: (req as any).ip }, "Unauthorized /refresh attempt");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  refreshCache().catch((err) =>
    logger.error({ err }, "Webhook-triggered refresh failed"),
  );

  res.json({ ok: true, message: "Cache refresh triggered" });
});

// GET /vehicle-images?vin=XXX — fetch photo gallery from Typesense CDN
router.get("/vehicle-images", requireAccess, async (req, res) => {
  const vin = (req.query["vin"] as string ?? "").trim().toUpperCase();
  if (!vin || vin.length < 10) {
    res.json({ vin, urls: [] });
    return;
  }

  const urls: string[] = [];
  let websiteUrl: string | null = null;

  for (const dealer of DEALER_COLLECTIONS) {
    try {
      const endpoint =
        `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search` +
        `?q=${encodeURIComponent(vin)}&query_by=vin&num_typos=0&per_page=1` +
        `&x-typesense-api-key=${dealer.apiKey}`;

      const resp = await fetch(endpoint);
      if (!resp.ok) continue;

      const body: any = await resp.json();
      if (!body.hits?.length) continue;

      const doc    = body.hits[0].document;
      const docVin = (doc.vin ?? "").toString().trim().toUpperCase();
      if (docVin !== vin) continue;

      const rawUrls: string = doc.image_urls ?? "";
      if (!rawUrls) continue;

      rawUrls.split(";").forEach((path: string) => {
        const trimmed = path.trim();
        if (trimmed) urls.push(IMAGE_CDN_BASE + trimmed);
      });

      // Extract website listing URL from the same document
      websiteUrl = extractWebsiteUrl(doc, dealer.siteUrl);

      break; // Stop after first successful collection
    } catch (_err) {
      // Silently continue to next collection
    }
  }

  res.set("Cache-Control", "public, max-age=300"); // Cache images for 5 min
  res.json({ vin, urls, websiteUrl });
});

export default router;

```


### `artifacts/api-server/src/routes/carfax.ts` (63 lines)

```typescript
import { Router } from "express";
import { isOwner } from "../lib/auth.js";
import { runCarfaxWorkerForVins, runCarfaxWorker, getCarfaxBatchStatus } from "../lib/carfaxWorker.js";
import { logger } from "../lib/logger.js";

const router = Router();

function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as { email: string };
  if (!isOwner(user.email)) {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

router.get("/carfax/batch-status", requireOwner, (_req, res) => {
  res.json(getCarfaxBatchStatus());
});

router.post("/carfax/run-batch", requireOwner, (req: any, res: any) => {
  const status = getCarfaxBatchStatus();
  if (status.running) {
    res.status(409).json({ ok: false, error: "A batch is already running", startedAt: status.startedAt });
    return;
  }
  logger.info({ requestedBy: (req.user as any)?.email }, "Manual Carfax batch triggered via API");
  runCarfaxWorker({ force: true }).catch((err) =>
    logger.error({ err }, "Manual Carfax batch failed")
  );
  res.json({ ok: true, message: "Carfax batch started. Check server logs for progress." });
});

router.post("/carfax/test", requireOwner, async (req: any, res: any) => {
  const { vins } = req.body as { vins?: string[] };

  if (!Array.isArray(vins) || vins.length === 0) {
    res.status(400).json({ error: "Provide an array of VINs in the request body: { vins: [...] }" });
    return;
  }

  if (vins.length > 10) {
    res.status(400).json({ error: "Maximum 10 VINs per test run" });
    return;
  }

  const cleanVins = vins.map((v) => String(v).trim().toUpperCase()).filter(Boolean);
  logger.info({ vins: cleanVins, requestedBy: (req.user as any)?.email }, "Carfax test run requested via API");

  try {
    const results = await runCarfaxWorkerForVins(cleanVins);
    res.json({ ok: true, results });
  } catch (err: any) {
    logger.error({ err }, "Carfax test endpoint error");
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;

```


### `artifacts/api-server/src/routes/lender.ts` (793 lines)

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, type InventoryItem } from "../lib/inventoryCache.js";
import {
  getLenderSyncStatus,
  getCachedLenderPrograms,
  runLenderSync,
} from "../lib/lenderWorker.js";
import type { VehicleTermMatrixEntry, VehicleConditionMatrixEntry } from "../lib/bbObjectStore.js";
import {
  resolveCapProfile,
  resolveNoOnlineSellingPrice,
  NO_ONLINE_STRATEGY_BY_PROFILE,
} from "../lib/lenderCalcEngine.js";
import { getRuntimeFingerprint } from "../lib/runtimeFingerprint.js";

const router = Router();

async function getUserRole(req: any): Promise<string> {
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) return "owner";
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  return entry?.role ?? "viewer";
}

async function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = await getUserRole(req);
  if (role !== "owner") {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

async function requireOwnerOrViewer(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = await getUserRole(req);
  if (role !== "owner" && role !== "viewer") {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  (req as any)._role = role;
  next();
}

router.get("/lender-programs", requireOwnerOrViewer, async (req, res) => {
  const programs = getCachedLenderPrograms();
  if (!programs) {
    res.json({ programs: [], updatedAt: null, role: (req as any)._role });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json({ ...programs, role: (req as any)._role });
});

router.get("/lender-status", requireOwnerOrViewer, async (req, res) => {
  const s = getLenderSyncStatus();
  const programs = getCachedLenderPrograms();
  res.set("Cache-Control", "no-store");
  res.json({
    running:      s.running,
    startedAt:    s.startedAt,
    lastRun:      s.lastRun,
    lenderCount:  s.lastCount,
    error:        s.error ?? null,
    programsAge:  programs?.updatedAt ?? null,
    role:         (req as any)._role,
  });
});

router.post("/refresh-lender", requireOwner, async (_req, res) => {
  const s = getLenderSyncStatus();
  if (s.running) {
    res.json({ ok: false, message: "Already running", running: true });
    return;
  }
  const { LENDER_ENABLED } = await import("../lib/lenderAuth.js");
  if (!LENDER_ENABLED) {
    res.json({ ok: false, message: "Lender credentials not configured", running: false });
    return;
  }
  runLenderSync().catch((err) =>
    logger.error({ err }, "Manual lender sync error"),
  );
  res.json({ ok: true, message: "Lender sync started", running: true });
});

interface CalcParams {
  lenderCode:    string;
  programId:     string;
  tierName:      string;
  approvedRate:  number;
  maxPaymentOverride?: number;
  downPayment?:  number;
  tradeValue?:   number;
  tradeLien?:    number;
  taxRate?:      number;
  adminFee?:     number;
  termStretchMonths?:      number;
  /** When true, keep vehicles that fail LTV/payment and report required extra cash down */
  showAllWithDownPayment?: boolean;
}

/** Accepts boolean or common string/number serializations from proxies and clients */
function truthyOptionalFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "on";
  }
  return false;
}

/** +6/+12 mo only; coerces strings so JSON/proxies cannot break [0,6,12].includes */
function normalizeTermStretchMonths(v: unknown): 0 | 6 | 12 {
  const n = typeof v === "string" ? parseInt(v.trim(), 10) : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n === 6 || n === 12) return n;
  return 0;
}

/** Hard cap on total finance term (months) when applying an exception stretch */
const MAX_FINANCE_TERM_MONTHS = 84;

/** Largest stretch in {12,6,0} such that baseTerm + stretch <= maxTotal (default 84) */
function largestStretchNotExceeding(baseTerm: number, maxTotal: number = MAX_FINANCE_TERM_MONTHS): 0 | 6 | 12 {
  if (baseTerm >= maxTotal) return 0;
  const order: (0 | 6 | 12)[] = [12, 6, 0];
  for (const s of order) {
    if (baseTerm + s <= maxTotal) return s;
  }
  return 0;
}

/**
 * Term exception rules:
 * - If the matrix already qualifies at 84 months, do not stretch (even if +6/+12 is selected).
 * - Otherwise stretch is limited so base + stretch never exceeds 84 (e.g. 78 can only use +6 to reach 84; +12 becomes +6).
 */
function resolveEffectiveTermStretch(
  baseTerm: number,
  requested: 0 | 6 | 12,
): {
  effectiveStretch: 0 | 6 | 12;
  termMonths: number;
  stretched: boolean;
  cappedReason?: "matrix_already_84_no_stretch" | "78_only_plus6_to_84" | "capped_at_84_max";
} {
  if (baseTerm >= MAX_FINANCE_TERM_MONTHS) {
    return {
      effectiveStretch: 0,
      termMonths:       baseTerm,
      stretched:        false,
      cappedReason:     baseTerm === MAX_FINANCE_TERM_MONTHS ? "matrix_already_84_no_stretch" : undefined,
    };
  }
  const maxStretch = largestStretchNotExceeding(baseTerm, MAX_FINANCE_TERM_MONTHS);
  const effectiveStretch = (Math.min(requested, maxStretch) as 0 | 6 | 12);
  const termMonths = baseTerm + effectiveStretch;

  let cappedReason: "matrix_already_84_no_stretch" | "78_only_plus6_to_84" | "capped_at_84_max" | undefined;
  if (requested > effectiveStretch) {
    if (baseTerm === 78 && requested === 12 && effectiveStretch === 6) {
      cappedReason = "78_only_plus6_to_84";
    } else {
      cappedReason = "capped_at_84_max";
    }
  }

  return {
    effectiveStretch,
    termMonths,
    stretched: effectiveStretch > 0,
    cappedReason,
  };
}

function pmt(rate: number, nper: number, pv: number): number {
  if (rate === 0) return pv / nper;
  const r = rate / 12;
  return (pv * r * Math.pow(1 + r, nper)) / (Math.pow(1 + r, nper) - 1);
}

function parseVehicleYear(vehicle: string): number | null {
  const match = vehicle.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}

function lookupTerm(
  matrix: VehicleTermMatrixEntry[],
  year: number,
  km: number,
): number | null {
  const entry = matrix.find(e => e.year === year);
  if (!entry) return null;
  const match = entry.data.find(d => km >= d.kmFrom && km <= d.kmTo);
  return match ? match.term : null;
}

type ConditionBucket = "extraClean" | "clean" | "average" | "rough";
const conditionToBBField: Record<ConditionBucket, keyof NonNullable<InventoryItem["bbValues"]>> = {
  extraClean: "xclean",
  clean:      "clean",
  average:    "avg",
  rough:      "rough",
};

function lookupCondition(
  matrix: VehicleConditionMatrixEntry[],
  year: number,
  km: number,
): ConditionBucket | null {
  const entry = matrix.find(e => e.year === year);
  if (!entry) return null;
  const buckets: ConditionBucket[] = ["extraClean", "clean", "average", "rough"];
  for (const bucket of buckets) {
    const range = entry[bucket];
    if (km >= range.kmFrom && km <= range.kmTo) return bucket;
  }
  return null;
}

router.post("/lender-calculate", requireOwnerOrViewer, async (req, res) => {
  const params = req.body as CalcParams;

  if (!params.lenderCode || !params.tierName || !params.programId) {
    res.status(400).json({ error: "lenderCode, programId, and tierName are required" });
    return;
  }
  if (params.approvedRate == null) {
    res.status(400).json({ error: "approvedRate is required" });
    return;
  }

  const rate = Number(params.approvedRate);
  if (!isFinite(rate) || rate < 0 || rate > 100) {
    res.status(400).json({ error: "approvedRate must be between 0 and 100" });
    return;
  }

  const programs = getCachedLenderPrograms();
  if (!programs || programs.programs.length === 0) {
    res.status(404).json({ error: "No lender programs cached — run a sync first" });
    return;
  }

  const lender = programs.programs.find(p => p.lenderCode === params.lenderCode);
  if (!lender) {
    res.status(404).json({ error: `Lender ${params.lenderCode} not found in cached programs` });
    return;
  }

  const guide = lender.programs.find(g => g.programId === params.programId);
  if (!guide) {
    res.status(404).json({ error: `Program not found for ${params.lenderCode}` });
    return;
  }

  const tier = guide.tiers.find(t => t.tierName === params.tierName);
  if (!tier) {
    res.status(404).json({ error: `Tier "${params.tierName}" not found in program "${guide.programTitle}"` });
    return;
  }

  const { data: inventory } = getCacheState();
  const rateDecimal    = rate / 100;
  const tierMaxPmt     = tier.maxPayment > 0 ? tier.maxPayment : Infinity;
  const maxPmt         = params.maxPaymentOverride ? Math.min(Number(params.maxPaymentOverride), tierMaxPmt) : tierMaxPmt;
  const downPayment    = params.downPayment ?? 0;
  const tradeValue     = params.tradeValue ?? 0;
  const tradeLien      = params.tradeLien ?? 0;
  const taxRate        = (params.taxRate ?? 5) / 100;
  const netTrade       = tradeValue - tradeLien;
  const requestedAdmin = params.adminFee ?? 0;
  const creditorFee    = tier.creditorFee ?? 0;
  const dealerReserve  = tier.dealerReserve ?? 0;

  const MARKUP            = 2.5;
  const MIN_WARRANTY_COST = 600;
  const MIN_GAP_COST      = 550;
  const MAX_GAP_MARKUP    = 1500;
  const MAX_GAP_PRICE     = Math.round(MAX_GAP_MARKUP / (1 - 1 / MARKUP));

  const capProfile = resolveCapProfile({
    maxAdvanceLTV: tier.maxAdvanceLTV,
    maxAftermarketLTV: tier.maxAftermarketLTV,
    maxAllInLTV: tier.maxAllInLTV,
    capModelResolved: guide.capModelResolved ?? "unknown",
  });
  const hasAdvanceCap = capProfile.hasAdvanceCap;
  const hasAftermarketCap = capProfile.hasAftermarketCap;
  const hasAllInCap = capProfile.hasAllInCap;
  const allInOnly = capProfile.allInOnly;

  const maxAdvanceLTV     = hasAdvanceCap    ? tier.maxAdvanceLTV / 100    : Infinity;
  const maxAftermarketLTV = hasAftermarketCap ? tier.maxAftermarketLTV / 100 : Infinity;
  const maxAllInLTV       = hasAllInCap       ? tier.maxAllInLTV / 100       : Infinity;
  const allInTaxMultiplier = 1 + taxRate;

  const adminInclusion = guide.adminFeeInclusion ?? "unknown";

  // CreditApp fee calculation fields: positive numbers are real caps, 0 means "no cap set".
  // When aftermarketBase is "salePrice", the fee cap fields return deal-context defaults
  // (not real program caps). The aftermarket LTV% budget is the true constraint and is
  // computed dynamically per vehicle below. Discard unreliable static caps in that case.
  const aftermarketBudgetIsDynamic =
    (guide.aftermarketBase === "salePrice") && hasAftermarketCap;

  let capWarranty = (guide.maxWarrantyPrice != null && guide.maxWarrantyPrice > 0 && !aftermarketBudgetIsDynamic)
    ? guide.maxWarrantyPrice : undefined;
  let capGap = (guide.maxGapPrice != null && guide.maxGapPrice > 0 && !aftermarketBudgetIsDynamic)
    ? guide.maxGapPrice : undefined;
  // AH routing fallback: when GAP target is AH and gap field resolves to 0/not-set,
  // treat warranty cap as GAP cap to avoid known mis-mapping.
  if (
    guide.gapInsuranceTarget === "AH_INSURANCE" &&
    capGap == null &&
    capWarranty != null &&
    (guide.maxGapPrice == null || guide.maxGapPrice <= 0)
  ) {
    capGap = capWarranty;
    capWarranty = undefined;
  }
  const capAdmin    = (guide.maxAdminFee != null && guide.maxAdminFee > 0)            ? guide.maxAdminFee      : undefined;
  const desiredAdmin = requestedAdmin > 0
    ? Math.round(requestedAdmin)
    : (capAdmin ?? 0);
  const gapAllowed  = capGap == null || capGap > 0;

  const termStretch = normalizeTermStretchMonths(params.termStretchMonths);
  const showAllDP = truthyOptionalFlag((params as CalcParams & { showAllWithDownPayment?: unknown }).showAllWithDownPayment);

  interface Result {
    vin: string; vehicle: string; location: string; term: number;
    matrixTerm: number;
    termStretchApplied: 0 | 6 | 12;
    conditionUsed: string; bbWholesale: number; sellingPrice: number;
    priceSource: string; adminFeeUsed: number; warrantyPrice: number;
    warrantyCost: number; gapPrice: number; gapCost: number;
    totalFinanced: number; monthlyPayment: number; profit: number;
    profitTarget: number;
    qualificationTier: 1 | 2;
    hasPhotos: boolean; website: string;
    termStretched: boolean;
    termStretchCappedReason?: string;
    requiredDownPayment?: number;
  }

  /** Stack products into available room: doc fee first, then warranty, then GAP. */
  function stackProducts(allInRoom: number, aftermarketRoom: number, sellPrice: number) {
    let room = isFinite(allInRoom) ? allInRoom : Infinity;
    if (isFinite(aftermarketRoom)) room = Math.min(room, aftermarketRoom);
    if (!isFinite(room) || room < 0) room = 0;

    let admin = 0, war = 0, wCost = 0, gap = 0, gCost = 0;
    let warGapRoom = room;

    if (adminInclusion === "excluded") {
      const adminFromCap = capAdmin != null ? Math.min(desiredAdmin, capAdmin) : desiredAdmin;
      const allInAdminRoom = isFinite(allInRoom) ? Math.max(0, Math.floor(allInRoom)) : adminFromCap;
      admin = Math.min(adminFromCap, allInAdminRoom);
      if (isFinite(allInRoom)) {
        warGapRoom = Math.min(warGapRoom, Math.max(0, allInRoom - admin));
      }
    } else {
      const adminFromCap = capAdmin != null ? Math.min(desiredAdmin, capAdmin) : desiredAdmin;
      admin = Math.min(adminFromCap, Math.floor(room));
      room -= admin;
      if (room < 0) room = 0;
      warGapRoom = room;
    }

    if (warGapRoom >= Math.round(MIN_WARRANTY_COST * MARKUP)) {
      war = capWarranty != null ? Math.min(warGapRoom, capWarranty) : warGapRoom;
      war = Math.max(war, Math.round(MIN_WARRANTY_COST * MARKUP));
      if (war > warGapRoom) war = 0;
    }
    wCost = war > 0 ? Math.round(war / MARKUP) : 0;
    warGapRoom -= war;

    if (gapAllowed && warGapRoom >= Math.round(MIN_GAP_COST * MARKUP)) {
      const gapCeiling = Math.min(MAX_GAP_PRICE, capGap ?? MAX_GAP_PRICE);
      gap = Math.min(warGapRoom, gapCeiling);
      gap = Math.max(gap, Math.round(MIN_GAP_COST * MARKUP));
      if (gap > warGapRoom) gap = 0;
    }
    gCost = gap > 0 ? Math.round(gap / MARKUP) : 0;

    war = Math.round(war);
    gap = Math.round(gap);

    const profit = (war - wCost) + (gap - gCost) + admin + dealerReserve - creditorFee;
    return { admin, war, wCost, gap, gCost, profit };
  }

  const results: Result[] = [];
  const debugCounts = { total: 0, noYear: 0, noKm: 0, noTerm: 0, noCondition: 0, noBB: 0, noBBVal: 0, noPrice: 0, ltvAdvance: 0, ltvMinAftermarket: 0, ltvAllIn: 0, negFinanced: 0, dealValue: 0, maxPmtFilter: 0, passed: 0 };

  inventory: for (const item of inventory) {
    debugCounts.total++;
    const vehicleYear = parseVehicleYear(item.vehicle);
    if (!vehicleYear) { debugCounts.noYear++; continue inventory; }

    const km = parseInt(item.km?.replace(/[^0-9]/g, "") || "0", 10);
    if (!km || km <= 0) { debugCounts.noKm++; continue inventory; }

    const baseTerm = lookupTerm(guide.vehicleTermMatrix, vehicleYear, km);
    if (!baseTerm) { debugCounts.noTerm++; continue inventory; }
    const termResolved = resolveEffectiveTermStretch(baseTerm, termStretch);
    const termMonths = termResolved.termMonths;
    const termStretched = termResolved.stretched;
    const termStretchApplied = termResolved.effectiveStretch;
    const termStretchCappedReason = termResolved.cappedReason;

    const condition = lookupCondition(guide.vehicleConditionMatrix, vehicleYear, km);
    if (!condition) { debugCounts.noCondition++; continue inventory; }

    if (!item.bbValues) { debugCounts.noBB++; continue inventory; }
    const bbField = conditionToBBField[condition];
    const bbWholesale = item.bbValues[bbField];
    if (!bbWholesale || bbWholesale <= 0) { debugCounts.noBBVal++; continue inventory; }

    const rawOnline = parseFloat(item.onlinePrice?.replace(/[^0-9.]/g, "") || "0");
    const pacCost   = parseFloat(item.cost?.replace(/[^0-9.]/g, "") || "0");
    if (pacCost <= 0) { debugCounts.noPrice++; continue inventory; }

    const maxAdvance = hasAdvanceCap ? bbWholesale * maxAdvanceLTV : Infinity;
    const maxAllInWithTax = hasAllInCap ? bbWholesale * maxAllInLTV : Infinity;
    const maxAllInPreTax = isFinite(maxAllInWithTax) ? (maxAllInWithTax / allInTaxMultiplier) : Infinity;

    // ============================================================
    //  Two-tier qualification logic
    //
    //  PATH A (online price): Tier 1 = sell at online price, max products.
    //         Tier 2 = reduce price to LTV ceiling, recover profit via products.
    //         Profit target = onlinePrice - pacCost.
    //
    //  PATH B (no online price): sell at PAC, stack products.
    //         Profit target = 0 (break even).
    //
    //  Hard constraint: sellingPrice >= pacCost always.
    // ============================================================

    let sellingPrice = 0;
    let priceSource  = "";
    let effectiveAdmin = 0;
    let warPrice = 0;
    let warCost  = 0;
    let gapPr    = 0;
    let gCost    = 0;
    let reqDP    = 0;
    let profitTarget = 0;
    let qualificationTier: 1 | 2 = 1;

    /** Compute product room given a lender exposure value */
    function computeRooms(lenderExposure: number, sellPrice: number) {
      const allIn = isFinite(maxAllInPreTax) ? maxAllInPreTax - lenderExposure - creditorFee : Infinity;
      const aftermarketBase = guide.aftermarketBase === "salePrice" ? sellPrice : bbWholesale;
      const aftermarket = hasAftermarketCap ? aftermarketBase * maxAftermarketLTV : Infinity;
      return { allInRoom: allIn, aftermarketRoom: aftermarket };
    }

    if (rawOnline > 0) {
      // --- PATH A: online price exists ---
      if (rawOnline < pacCost) { debugCounts.noPrice++; continue inventory; }
      profitTarget = rawOnline - pacCost;

      const lenderExposure = rawOnline - downPayment - netTrade;
      const tier1FitsAdvance = !isFinite(maxAdvance) || lenderExposure <= maxAdvance;

      if (tier1FitsAdvance) {
        // === TIER 1: sell at online price, stack products into available room ===
        sellingPrice = rawOnline;
        priceSource  = "online";
        qualificationTier = 1;

        const { allInRoom, aftermarketRoom } = computeRooms(lenderExposure, sellingPrice);
        if (isFinite(allInRoom) && allInRoom < 0) {
          // All-in LTV exceeded even without products — needs DP
          if (!showAllDP) { debugCounts.ltvAllIn++; continue inventory; }
          reqDP = Math.ceil(-allInRoom);
        }

        if (reqDP === 0) {
          const products = stackProducts(allInRoom, aftermarketRoom, sellingPrice);
          effectiveAdmin = products.admin;
          warPrice = products.war; warCost = products.wCost;
          gapPr = products.gap;    gCost = products.gCost;
        }
      } else {
        // === TIER 2: reduce selling price to advance LTV ceiling ===
        const advanceCeiling = maxAdvance + downPayment + netTrade;
        sellingPrice = Math.min(rawOnline, Math.floor(advanceCeiling));
        qualificationTier = 2;

        if (sellingPrice < pacCost) {
          // Can't even reach PAC at $0 down — needs DP
          if (!showAllDP) { debugCounts.ltvAdvance++; continue inventory; }
          sellingPrice = pacCost;
          reqDP = Math.ceil(pacCost - advanceCeiling);
          if (reqDP < 0) reqDP = 0;
          priceSource = "pac";
        } else {
          priceSource = "reduced";
        }

        if (reqDP === 0) {
          const t2Exposure = sellingPrice - downPayment - netTrade;
          const { allInRoom, aftermarketRoom } = computeRooms(t2Exposure, sellingPrice);
          if (isFinite(allInRoom) && allInRoom < 0) {
            if (!showAllDP) { debugCounts.ltvAllIn++; continue inventory; }
            reqDP = Math.ceil(-allInRoom);
          } else {
            const products = stackProducts(allInRoom, aftermarketRoom, sellingPrice);
            effectiveAdmin = products.admin;
            warPrice = products.war; warCost = products.wCost;
            gapPr = products.gap;    gCost = products.gCost;

            const frontEnd = sellingPrice - pacCost;
            const totalProfit = frontEnd + products.profit;
            if (totalProfit < profitTarget) {
              // Tier 2 products can't recover the target margin — still include but mark as Tier 2
            }
          }
        }
      }
    } else {
      // --- PATH B: no online price — sell at PAC, stack products ---
      sellingPrice = pacCost;
      priceSource  = "pac";
      profitTarget = 0;
      qualificationTier = 2;

      const lenderExposure = sellingPrice - downPayment - netTrade;

      if (isFinite(maxAdvance) && lenderExposure > maxAdvance) {
        if (!showAllDP) { debugCounts.ltvAdvance++; continue inventory; }
        reqDP = Math.ceil(lenderExposure - maxAdvance);
      }

      if (reqDP === 0) {
        const { allInRoom, aftermarketRoom } = computeRooms(lenderExposure, sellingPrice);
        if (isFinite(allInRoom) && allInRoom < 0) {
          if (!showAllDP) { debugCounts.ltvAllIn++; continue inventory; }
          reqDP = Math.ceil(-allInRoom);
        } else {
          const products = stackProducts(allInRoom, aftermarketRoom, sellingPrice);
          effectiveAdmin = products.admin;
          warPrice = products.war; warCost = products.wCost;
          gapPr = products.gap;    gCost = products.gCost;
        }
      }
    }

    // Hard constraint: selling price must cover PAC
    if (sellingPrice < pacCost) { debugCounts.noPrice++; continue inventory; }

    // When DP is required, strip products — DP covers the base deal only
    if (reqDP > 0) {
      effectiveAdmin = 0;
      warPrice = 0; warCost = 0;
      gapPr = 0;    gCost = 0;
    }

    let aftermarketRevenue = warPrice + gapPr;
    let reqAcc = reqDP;

    let finalExposure!: number;
    let allInSubtotal!: number;
    let taxes!: number;
    let totalFinanced!: number;
    let monthlyPayment!: number;

    settle: for (let pass = 0; pass < 24; pass++) {
      finalExposure = sellingPrice - (downPayment + reqAcc) - netTrade;
      allInSubtotal = finalExposure + aftermarketRevenue + effectiveAdmin + creditorFee;

      if (allInSubtotal <= 0) {
        debugCounts.negFinanced++;
        continue inventory;
      }

      if (isFinite(maxAllInPreTax) && allInSubtotal > maxAllInPreTax) {
        if (!showAllDP) { debugCounts.ltvAllIn++; continue inventory; }
        reqAcc += Math.ceil(allInSubtotal - maxAllInPreTax);
        continue settle;
      }

      taxes = allInSubtotal * taxRate;
      totalFinanced = allInSubtotal + taxes;
      monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);

      if (maxPmt < Infinity && monthlyPayment > maxPmt) {
        if (!showAllDP) {
          debugCounts.maxPmtFilter++;
          continue inventory;
        }
        if (aftermarketRevenue > 0 || effectiveAdmin > 0) {
          effectiveAdmin = 0;
          warPrice = 0; warCost = 0;
          gapPr = 0;    gCost = 0;
          aftermarketRevenue = 0;
          reqAcc = reqDP;
          continue settle;
        }
        const monthlyRate = rateDecimal / 12;
        const targetPV =
          rateDecimal === 0
            ? maxPmt * termMonths
            : maxPmt * ((Math.pow(1 + monthlyRate, termMonths) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, termMonths)));
        const excessPV = totalFinanced - targetPV;
        if (excessPV > 0) {
          reqAcc += Math.ceil(excessPV / (1 + taxRate));
          continue settle;
        }
      }
      break settle;
    }

    reqDP = reqAcc;

    finalExposure = sellingPrice - (downPayment + reqDP) - netTrade;
    allInSubtotal = finalExposure + aftermarketRevenue + effectiveAdmin + creditorFee;
    taxes = allInSubtotal * taxRate;
    totalFinanced = allInSubtotal + taxes;
    monthlyPayment = pmt(rateDecimal, termMonths, totalFinanced);

    debugCounts.passed++;

    const frontEndGross  = sellingPrice - pacCost;
    const warrantyProfit = warPrice - warCost;
    const gapProfit      = gapPr - gCost;
    const profit = frontEndGross + warrantyProfit + gapProfit + effectiveAdmin + dealerReserve - creditorFee;

    results.push({
      vin:             item.vin,
      vehicle:         item.vehicle,
      location:        item.location,
      term:            termMonths,
      matrixTerm:      baseTerm,
      termStretchApplied,
      conditionUsed:   condition,
      bbWholesale,
      sellingPrice:    Math.round(sellingPrice),
      priceSource,
      adminFeeUsed:    Math.round(effectiveAdmin),
      warrantyPrice:   warPrice,
      warrantyCost:    warCost,
      gapPrice:        gapPr,
      gapCost:         gCost,
      totalFinanced:   Math.round(totalFinanced),
      monthlyPayment:  Math.round(monthlyPayment * 100) / 100,
      profit:          Math.round(profit),
      profitTarget:    Math.round(profitTarget),
      qualificationTier,
      hasPhotos:       item.hasPhotos,
      website:         item.website,
      termStretched,
      termStretchCappedReason: termStretchCappedReason,
      requiredDownPayment: reqDP > 0 ? Math.round(reqDP) : undefined,
    });
  }

  results.sort((a, b) => b.profit - a.profit);

  const runtime = getRuntimeFingerprint();

  logger.info({
    debugCounts,
    lender: params.lenderCode,
    program: guide.programTitle,
    tier: params.tierName,
    termStretchMonths: termStretch,
    showAllWithDownPayment: showAllDP,
    allInOnly,
    hasAdvanceCap,
    hasAftermarketCap,
    aftermarketBudgetIsDynamic,
    adminInclusion,
    capAdmin,
    capWarranty,
    capGap,
    capModelResolved: guide.capModelResolved ?? "unknown",
    capProfileKey: capProfile.key,
    noOnlineStrategy: NO_ONLINE_STRATEGY_BY_PROFILE[capProfile.key],
    ...runtime,
  }, "Lender calculate debug");

  res.set("Cache-Control", "no-store");
  res.json({
    lender:     params.lenderCode,
    program:    guide.programTitle,
    tier:       params.tierName,
    termStretchMonths: termStretch,
    showAllWithDownPayment: showAllDP,
    ...runtime,
    tierConfig: tier,
    programLimits: {
      maxWarrantyPrice: capWarranty ?? null,
      maxGapPrice:      capGap ?? null,
      maxAdminFee:      capAdmin ?? null,
      maxGapMarkup:     MAX_GAP_MARKUP,
      gapAllowed,
      allInOnly,
      hasAdvanceCap,
      hasAftermarketCap,
      aftermarketBudgetIsDynamic,
      aftermarketBase:    guide.aftermarketBase ?? "unknown",
      adminFeeInclusion:  adminInclusion,
      capModelResolved:   guide.capModelResolved ?? "unknown",
      capProfileKey:      capProfile.key,
      noOnlineStrategy:   NO_ONLINE_STRATEGY_BY_PROFILE[capProfile.key],
    },
    debugCounts,
    resultCount: results.length,
    results,
  });
});

// Diagnostic endpoint — dumps cached program metadata for debugging
router.get("/lender-debug", requireOwner, async (_req, res) => {
  const runtime = getRuntimeFingerprint();
  const programs = getCachedLenderPrograms();
  if (!programs) {
    res.json({ error: "No cached programs", programs: [], ...runtime });
    return;
  }
  const summary = programs.programs.map(lender => ({
    lenderCode: lender.lenderCode,
    lenderName: lender.lenderName,
    programs: lender.programs.map(g => ({
      programId: g.programId,
      programTitle: g.programTitle,
      tiersCount: g.tiers.length,
      tiers: g.tiers.map(t => ({
        capProfileKey: resolveCapProfile({
          maxAdvanceLTV: t.maxAdvanceLTV,
          maxAftermarketLTV: t.maxAftermarketLTV,
          maxAllInLTV: t.maxAllInLTV,
          capModelResolved: g.capModelResolved ?? "unknown",
        }).key,
        noOnlineStrategy: NO_ONLINE_STRATEGY_BY_PROFILE[resolveCapProfile({
          maxAdvanceLTV: t.maxAdvanceLTV,
          maxAftermarketLTV: t.maxAftermarketLTV,
          maxAllInLTV: t.maxAllInLTV,
          capModelResolved: g.capModelResolved ?? "unknown",
        }).key],
        tierName: t.tierName,
        maxAdvanceLTV: t.maxAdvanceLTV,
        maxAftermarketLTV: t.maxAftermarketLTV,
        maxAllInLTV: t.maxAllInLTV,
        creditorFee: t.creditorFee,
        dealerReserve: t.dealerReserve,
      })),
      maxWarrantyPrice: g.maxWarrantyPrice ?? null,
      maxGapPrice: g.maxGapPrice ?? null,
      maxAdminFee: g.maxAdminFee ?? null,
      gapInsuranceTarget: g.gapInsuranceTarget ?? null,
      feeCalculationsRaw: g.feeCalculationsRaw ?? null,
      aftermarketBase: g.aftermarketBase ?? "unknown",
      allInOnlyRules: g.allInOnlyRules ?? false,
      capModelResolved: g.capModelResolved ?? "unknown",
      adminFeeInclusion: g.adminFeeInclusion ?? "unknown",
      backendLtvCalculation: g.backendLtvCalculation ?? null,
      allInLtvCalculation: g.allInLtvCalculation ?? null,
      backendRemainingCalculation: g.backendRemainingCalculation ?? null,
      allInRemainingCalculation: g.allInRemainingCalculation ?? null,
      configuredOk: g.tiers.length > 0 && (
        g.tiers.some(t => t.maxAdvanceLTV > 0 || t.maxAftermarketLTV > 0 || t.maxAllInLTV > 0)
      ),
    })),
  }));
  res.json({ updatedAt: programs.updatedAt, lenders: summary, ...runtime });
});

export default router;

```


### `artifacts/api-server/src/routes/price-lookup.ts` (105 lines)

```typescript
import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

// Dealer configs: hostname → { collection, apiKey }
const DEALERS: Record<string, { collection: string; apiKey: string }> = {
  "matrixmotorsyeg.ca": {
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey: "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
  "parkdalemotors.ca": {
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey: "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
};

function formatPrice(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// GET /api/price-lookup?url=<encoded_url>
router.get("/price-lookup", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Never cache — prices change and we must always serve a fresh Typesense result
  res.set("Cache-Control", "no-store");

  const url = (req.query.url as string ?? "").trim();
  if (!url || !url.startsWith("http")) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    const parsed = new URL(url);

    // Match dealer by hostname (strip www.)
    const hostname = parsed.hostname.replace(/^www\./, "");
    const dealer = DEALERS[hostname];

    if (!dealer) {
      // Unknown dealer — fall back to null (no scraping attempt)
      res.json({ price: null });
      return;
    }

    // Extract numeric document ID from URL path: e.g. /inventory/2017-subaru-wrx/1535/
    const idMatch = parsed.pathname.match(/\/(\d+)\/?$/);
    if (!idMatch) {
      res.json({ price: null });
      return;
    }
    const docId = idMatch[1];

    // Query Typesense via search endpoint (search key doesn't allow direct document fetch)
    const params = new URLSearchParams({
      q: "*",
      filter_by: `id:=[${docId}]`,
      per_page: "1",
      "x-typesense-api-key": dealer.apiKey,
    });
    const tsUrl = `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search?${params}`;
    const tsRes = await fetch(tsUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!tsRes.ok) {
      logger.warn({ status: tsRes.status, url, docId }, "Typesense lookup failed");
      res.json({ price: null });
      return;
    }

    const body = await tsRes.json() as { hits?: Array<{ document: Record<string, unknown> }> };
    if (!body.hits || body.hits.length === 0) {
      res.json({ price: null });
      return;
    }
    const doc = body.hits[0].document;

    // Use special_price if active, otherwise regular price
    const specialOn = Number(doc.special_price_on) === 1;
    const specialPrice = Number(doc.special_price);
    const regularPrice = Number(doc.price);

    const rawPrice = specialOn && specialPrice > 0 ? specialPrice : regularPrice;

    if (!rawPrice || rawPrice <= 0) {
      res.json({ price: null });
      return;
    }

    res.json({ price: formatPrice(rawPrice) });
  } catch (err) {
    logger.warn({ err, url }, "price-lookup error");
    res.json({ price: null });
  }
});

export default router;

```


### `artifacts/api-server/src/scripts/testCarfax.ts` (35 lines)

```typescript
/**
 * Quick Carfax test — run directly with:
 *   npx tsx src/scripts/testCarfax.ts 2C4RC1ZG7RR152266 5YFB4MDE3PP000858
 */
import { runCarfaxWorkerForVins } from "../lib/carfaxWorker.js";

const vins = process.argv.slice(2);

if (vins.length === 0) {
  console.error("Usage: npx tsx src/scripts/testCarfax.ts <VIN1> <VIN2> ...");
  process.exit(1);
}

console.log(`\nRunning Carfax test on ${vins.length} VIN(s): ${vins.join(", ")}\n`);

runCarfaxWorkerForVins(vins).then((results) => {
  console.log("\n========== RESULTS ==========");
  for (const r of results) {
    if (r.status === "found") {
      console.log(`✓ ${r.vin} — FOUND`);
      console.log(`  URL: ${r.url}`);
    } else if (r.status === "not_found") {
      console.log(`✗ ${r.vin} — NOT FOUND in Carfax`);
    } else if (r.status === "captcha") {
      console.log(`! ${r.vin} — CAPTCHA blocked`);
    } else {
      console.log(`✗ ${r.vin} — ERROR: ${r.error}`);
    }
  }
  console.log("=============================\n");
  process.exit(0);
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

```


---

## Inventory Portal


### `artifacts/inventory-portal/package.json` (77 lines)

```json
{
  "name": "@workspace/inventory-portal",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --config vite.config.ts --host 0.0.0.0",
    "build": "vite build --config vite.config.ts",
    "serve": "vite preview --config vite.config.ts --host 0.0.0.0",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@radix-ui/react-aspect-ratio": "^1.1.3",
    "@radix-ui/react-avatar": "^1.1.4",
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-collapsible": "^1.1.4",
    "@radix-ui/react-context-menu": "^2.2.7",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-hover-card": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-menubar": "^1.1.7",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-progress": "^1.1.3",
    "@radix-ui/react-radio-group": "^1.2.4",
    "@radix-ui/react-scroll-area": "^1.2.4",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.3",
    "@radix-ui/react-toggle-group": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@replit/vite-plugin-cartographer": "catalog:",
    "@replit/vite-plugin-dev-banner": "catalog:",
    "@replit/vite-plugin-runtime-error-modal": "catalog:",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "@workspace/api-client-react": "workspace:*",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "cmdk": "^1.1.1",
    "date-fns": "^3.6.0",
    "embla-carousel-react": "^8.6.0",
    "framer-motion": "catalog:",
    "input-otp": "^1.4.2",
    "lucide-react": "catalog:",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-day-picker": "^9.11.1",
    "react-dom": "catalog:",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "react-resizable-panels": "^2.1.7",
    "recharts": "^2.15.2",
    "sonner": "^2.0.7",
    "tailwind-merge": "catalog:",
    "tailwindcss": "catalog:",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "vite": "catalog:",
    "wouter": "^3.3.5",
    "zod": "catalog:"
  }
}

```


### `artifacts/inventory-portal/tsconfig.json` (22 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "dist", "**/*.test.ts"],
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["esnext", "dom", "dom.iterable"],
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "types": ["node", "vite/client"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "references": [
    {
      "path": "../../lib/api-client-react"
    }
  ]
}

```


### `artifacts/inventory-portal/vite.config.ts` (86 lines)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

const basePath = process.env.BASE_PATH || "/";

/**
 * Replit / local split dev: browser talks to Vite (this port), Express usually runs on another port.
 * Forward same-origin `/api/*` to the API so `fetch("/api/...")` works without CORS or wrong host.
 * Override if your API listens elsewhere: `INVENTORY_DEV_API_ORIGIN=http://127.0.0.1:PORT`
 */
const devApiProxyTarget =
  process.env["INVENTORY_DEV_API_ORIGIN"]?.trim()
  || process.env["VITE_DEV_API_ORIGIN"]?.trim()
  || "http://127.0.0.1:3000";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    // Replit + some browsers cache dev responses aggressively; avoid "stale UI" confusion
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

```


### `artifacts/inventory-portal/index.html` (16 lines)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
    <title>Inventory Portal</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```


### `artifacts/inventory-portal/src/main.tsx` (5 lines)

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

```


### `artifacts/inventory-portal/src/App.tsx` (86 lines)

```tsx
import React from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe } from "@workspace/api-client-react";

import { Layout } from "@/components/layout";
import { FullScreenSpinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import AccessDenied from "@/pages/denied";
import Inventory from "@/pages/inventory";
import Admin from "@/pages/admin";
import LenderCalculator from "@/pages/lender-calculator";

const queryClient = new QueryClient();

// Auth Guard component to protect routes
function RequireAuth({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { isLoading, error } = useGetMe({ query: { retry: false } });

  React.useEffect(() => {
    if (!error) return;
    const status = (error as any)?.response?.status;
    if (status === 401) setLocation("/login");
    else if (status === 403) setLocation("/denied");
  }, [error, setLocation]);

  if (isLoading) return <FullScreenSpinner />;
  if (error)     return null;

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/denied" component={AccessDenied} />
      
      {/* Protected Routes */}
      <Route path="/">
        <RequireAuth>
          <Layout>
            <Inventory />
          </Layout>
        </RequireAuth>
      </Route>
      
      <Route path="/admin">
        <RequireAuth>
          <Layout>
            <Admin />
          </Layout>
        </RequireAuth>
      </Route>

      <Route path="/calculator">
        <RequireAuth>
          <Layout wide>
            <LenderCalculator />
          </Layout>
        </RequireAuth>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

```


### `artifacts/inventory-portal/src/index.css` (121 lines)

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
@import "tailwindcss";
@import "tw-animate-css";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-card-border: hsl(var(--border));

  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));

  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));

  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));

  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));

  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));

  --color-surface:        hsl(var(--surface));
  --color-surface-raised: hsl(var(--surface-raised));
  --color-hover:          hsl(var(--hover));

  --font-sans: 'Inter', sans-serif;
  --font-display: 'Outfit', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
}

:root {
  /* Clean light theme */
  --background:    0 0% 97%;
  --foreground:    220 13% 13%;

  --card:          0 0% 100%;
  --card-foreground: 220 13% 13%;

  --popover:       0 0% 100%;
  --popover-foreground: 220 13% 13%;

  --primary:       221 83% 53%;
  --primary-foreground: 0 0% 100%;

  --secondary:     220 14% 96%;
  --secondary-foreground: 220 13% 13%;

  --muted:         220 14% 96%;
  --muted-foreground: 220 9% 46%;

  --accent:        221 83% 53%;
  --accent-foreground: 0 0% 100%;

  --destructive:   0 72% 51%;
  --destructive-foreground: 0 0% 100%;

  --border:        220 13% 91%;
  --input:         220 13% 91%;
  --ring:          221 83% 53%;

  --radius: 0.5rem;

  --surface:       0 0% 100%;
  --surface-raised: 220 14% 97%;
  --hover:         220 14% 96%;
}

@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply font-sans antialiased bg-background text-foreground min-h-screen selection:bg-primary/20 selection:text-foreground;
  }

  h1, h2, h3, h4, h5, h6 {
    @apply font-display tracking-tight;
  }
}

/* Custom Scrollbar for a premium feel */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  @apply bg-background;
}

::-webkit-scrollbar-thumb {
  @apply bg-border rounded-full border-2 border-solid border-background;
}

::-webkit-scrollbar-thumb:hover {
  @apply bg-muted-foreground;
}

/* Glass panel utility */
.glass-panel {
  @apply bg-card/60 backdrop-blur-xl border border-white/5 shadow-2xl shadow-black/40;
}

```


### `artifacts/inventory-portal/src/lib/utils.ts` (6 lines)

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

```


### `artifacts/inventory-portal/src/hooks/use-mobile.tsx` (19 lines)

```tsx
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

```


### `artifacts/inventory-portal/src/hooks/use-toast.ts` (191 lines)

```typescript
import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id)
        })
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

export { useToast, toast }

```


### `artifacts/inventory-portal/src/components/layout.tsx` (77 lines)

```tsx
import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Car, LogOut, Settings, Calculator } from "lucide-react";

export function Layout({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  const { data: user } = useGetMe({ query: { retry: false } });

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-40 w-full bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">

            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <Car className="w-4 h-4 text-white" />
              </div>
              <Link href="/" className="font-semibold text-gray-900 hover:text-blue-600 transition-colors text-base">
                Inventory Portal
              </Link>
            </div>

            {user && (
              <div className="flex items-center gap-3">
                {(user.isOwner || user.role === "viewer") && (
                  <Link
                    href="/calculator"
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
                  >
                    <Calculator className="w-4 h-4" />
                    <span className="hidden sm:inline">Inventory Selector</span>
                  </Link>
                )}
                {user.isOwner && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
                  >
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline">Manage Access</span>
                  </Link>
                )}

                <div className="h-5 w-px bg-gray-200 hidden sm:block" />

                <div className="flex items-center gap-2.5">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-sm font-medium text-gray-800 leading-none">{user.name}</span>
                    <span className="text-xs text-gray-400 mt-0.5">{user.email}</span>
                  </div>
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-600">{user.name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <a
                    href="/api/auth/logout"
                    title="Sign Out"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={`flex-1 w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 ${wide ? "max-w-[1880px]" : "max-w-7xl"}`}>
        {children}
      </main>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/login.tsx` (36 lines)

```tsx
import { Car, Lock } from "lucide-react";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-5">
          <Car className="w-6 h-6 text-white" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">Inventory Portal</h1>
        <p className="text-sm text-gray-500 mb-7">
          Access is restricted to authorized personnel. Sign in with your Google account to continue.
        </p>

        <a
          href="/api/auth/google"
          className="w-full inline-flex items-center justify-center gap-3 px-5 py-2.5 border border-gray-200 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </a>

        <p className="mt-6 flex items-center gap-1.5 text-xs text-gray-400">
          <Lock className="w-3 h-3" />
          Secure authentication via Google
        </p>
      </div>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/denied.tsx` (35 lines)

```tsx
import { ShieldAlert } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";

export default function AccessDenied() {
  const { data: user } = useGetMe({ query: { retry: false } });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-5">
          <ShieldAlert className="w-6 h-6 text-red-500" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-sm text-gray-500 mb-5">
          You don't have permission to view this portal. Contact the owner to request access.
        </p>

        {user && (
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 text-left">
            <p className="text-xs text-gray-400 mb-0.5">Signed in as</p>
            <p className="text-sm font-medium text-gray-800">{user.email}</p>
          </div>
        )}

        <a
          href="/api/auth/logout"
          className="w-full inline-flex items-center justify-center px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          Sign out and try another account
        </a>
      </div>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/not-found.tsx` (21 lines)

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/admin.tsx` (326 lines)

```tsx
import { useState } from "react";
import {
  useGetAccessList,
  useAddAccessEntry,
  useRemoveAccessEntry,
  useUpdateAccessRole,
  useGetAuditLog,
  getGetAccessListQueryKey,
  getGetAuditLogQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Trash2, Plus, Shield, Mail, Calendar, User as UserIcon,
  Loader2, ClipboardList, Eye, UserCheck, ChevronDown,
} from "lucide-react";
import { FullScreenSpinner } from "@/components/ui/spinner";
import { useLocation } from "wouter";

type Tab = "users" | "audit";

const ROLE_LABELS: Record<string, string> = {
  viewer: "Viewer",
  guest:  "Guest",
  owner:  "Owner",
};

const ROLE_COLORS: Record<string, string> = {
  viewer: "bg-blue-50 text-blue-700 border-blue-200",
  guest:  "bg-gray-50 text-gray-600 border-gray-200",
  owner:  "bg-purple-50 text-purple-700 border-purple-200",
};

function RoleSelector({ email, currentRole, onUpdate }: {
  email: string;
  currentRole: string;
  onUpdate: (role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = ["viewer", "guest"];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${ROLE_COLORS[currentRole] ?? ROLE_COLORS.viewer}`}>
        {ROLE_LABELS[currentRole] ?? currentRole}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-20 w-28 bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden">
            {options.map((role) => (
              <button key={role}
                onClick={() => { setOpen(false); if (role !== currentRole) onUpdate(role); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors font-medium ${role === currentRole ? "text-blue-600 bg-blue-50" : "text-gray-700"}`}>
                {ROLE_LABELS[role]}
                {role === "viewer" && <p className="text-gray-400 font-normal text-xs">Full access</p>}
                {role === "guest"  && <p className="text-gray-400 font-normal text-xs">Price hidden</p>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  add:         "Added",
  remove:      "Removed",
  role_change: "Role changed",
};

const ACTION_COLORS: Record<string, string> = {
  add:         "bg-green-100 text-green-700",
  remove:      "bg-red-100 text-red-700",
  role_change: "bg-blue-100 text-blue-700",
};

export default function Admin() {
  const queryClient    = useQueryClient();
  const [, setLocation] = useLocation();
  const [newEmail, setNewEmail] = useState("");
  const [newRole,  setNewRole]  = useState<"viewer" | "guest">("viewer");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("users");

  const { data: accessList, isLoading, error } = useGetAccessList({ query: { retry: false } });
  const { data: auditLog,   isLoading: auditLoading } = useGetAuditLog({
    query: { enabled: activeTab === "audit", retry: false },
  });

  const addMutation        = useAddAccessEntry();
  const removeMutation     = useRemoveAccessEntry();
  const updateRoleMutation = useUpdateAccessRole();

  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401 || status === 403) { setLocation("/"); return null; }
  }

  if (isLoading) return <FullScreenSpinner />;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetAccessListQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAuditLogQueryKey() });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.includes("@")) { setErrorMsg("Please enter a valid email address."); return; }
    setErrorMsg("");
    addMutation.mutate(
      { data: { email: newEmail.toLowerCase().trim(), role: newRole } },
      { onSuccess: () => { setNewEmail(""); invalidateAll(); }, onError: (err: any) => setErrorMsg(err.response?.data?.error || "Failed to add user.") }
    );
  };

  const handleRemove = (email: string) => {
    if (!confirm(`Remove access for ${email}?`)) return;
    removeMutation.mutate({ email }, { onSuccess: invalidateAll });
  };

  const handleRoleChange = (email: string, role: string) => {
    updateRoleMutation.mutate(
      { email, data: { role } },
      { onSuccess: invalidateAll }
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      <div>
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-600" />
          Access Management
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Control which Google accounts can view the inventory portal.</p>
      </div>

      {/* Add user form */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Grant Access</h2>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Enter Google email address"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
              disabled={addMutation.isPending}
            />
          </div>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "viewer" | "guest")}
            className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
            disabled={addMutation.isPending}>
            <option value="viewer">Viewer — full access</option>
            <option value="guest">Guest — price hidden</option>
          </select>
          <button type="submit"
            disabled={addMutation.isPending || !newEmail}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add User
          </button>
        </form>
        {errorMsg && <p className="text-red-500 text-xs mt-2 font-medium">{errorMsg}</p>}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          {([
            { id: "users" as Tab, label: "Users",     icon: <UserCheck className="w-4 h-4" /> },
            { id: "audit" as Tab, label: "Audit Log",  icon: <ClipboardList className="w-4 h-4" /> },
          ] as const).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Users tab */}
        {activeTab === "users" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Added</th>
                  <th className="px-5 py-3">Added By</th>
                  <th className="px-5 py-3 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accessList?.map((entry) => (
                  <tr key={entry.email} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                          {entry.email.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-800">{entry.email}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <RoleSelector
                        email={entry.email}
                        currentRole={entry.role}
                        onUpdate={(role) => handleRoleChange(entry.email, role)}
                      />
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(entry.addedAt), "MMM d, yyyy")}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <UserIcon className="w-3.5 h-3.5" />
                        {entry.addedBy}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleRemove(entry.email)}
                        disabled={removeMutation.isPending && (removeMutation.variables as any)?.email === entry.email}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center"
                        title="Remove Access">
                        {removeMutation.isPending && (removeMutation.variables as any)?.email === entry.email
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
                {(!accessList || accessList.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                      No approved users yet. Add one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Audit log tab */}
        {activeTab === "audit" && (
          <div className="overflow-x-auto">
            {auditLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3">When</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Change</th>
                    <th className="px-5 py-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLog?.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {format(new Date(entry.timestamp), "MMM d, yyyy HH:mm")}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[entry.action] ?? "bg-gray-100 text-gray-600"}`}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-800 text-xs">{entry.targetEmail}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {entry.action === "role_change"
                          ? <span>{ROLE_LABELS[entry.roleFrom ?? ""] ?? entry.roleFrom} &rarr; {ROLE_LABELS[entry.roleTo ?? ""] ?? entry.roleTo}</span>
                          : entry.action === "add" && entry.roleTo
                            ? <span>as {ROLE_LABELS[entry.roleTo] ?? entry.roleTo}</span>
                            : "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{entry.changedBy}</td>
                    </tr>
                  ))}
                  {(!auditLog || auditLog.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                        No audit log entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Role legend */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Role Permissions</p>
        <div className="grid grid-cols-2 gap-1.5 text-xs text-blue-800">
          <div><span className="font-medium">Viewer</span> — sees all data including Your Cost</div>
          <div><span className="font-medium">Guest</span> — sees vehicle info but Your Cost is hidden</div>
        </div>
      </div>

    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/inventory.tsx` (748 lines)

```tsx
import { useState, useCallback, useEffect, useRef } from "react";
import {
  useGetInventory,
  useGetCacheStatus,
  useGetVehicleImages,
  useGetMe,
} from "@workspace/api-client-react";
import {
  Search, ExternalLink, FileText, AlertCircle, ChevronUp, ChevronDown,
  ChevronsUpDown, Copy, Check, RefreshCw, Camera, X, ChevronLeft,
  ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

type SortKey = "location" | "vehicle" | "vin" | "price" | "km";
type SortDir = "asc" | "desc";

interface Filters {
  yearMin:   string;
  yearMax:   string;
  kmMax:     string;
  priceMin:  string;
  priceMax:  string;
}

const EMPTY_FILTERS: Filters = { yearMin: "", yearMax: "", kmMax: "", priceMin: "", priceMax: "" };

function parseNum(s: string): number {
  return parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
}

function extractYear(vehicle: string): number {
  const y = parseInt(vehicle.trim().split(/\s+/)[0] ?? "0", 10);
  return y > 1900 && y < 2100 ? y : 0;
}

function formatPrice(raw: string | undefined): string {
  if (!raw || raw === "NOT FOUND") return "—";
  const n = parseNum(raw);
  if (!n) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30 inline ml-1" />;
  return dir === "asc"
    ? <ChevronUp   className="w-3.5 h-3.5 text-blue-600 inline ml-1" />
    : <ChevronDown className="w-3.5 h-3.5 text-blue-600 inline ml-1" />;
}

function CopyVin({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(vin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [vin]);
  return (
    <button onClick={handleCopy} title="Click to copy VIN"
      className="group flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 transition-colors">
      <span className="font-mono text-xs">{vin}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy  className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 shrink-0 transition-opacity" />}
    </button>
  );
}

// Photo gallery modal
function PhotoGallery({ vin, onClose }: { vin: string; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const { data, isLoading } = useGetVehicleImages({ vin });
  const urls = data?.urls ?? [];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")      onClose();
      if (e.key === "ArrowRight")  setIdx((i) => Math.min(i + 1, urls.length - 1));
      if (e.key === "ArrowLeft")   setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [urls.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-4xl w-full bg-white rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 bg-white/90 rounded-full shadow hover:bg-gray-100">
          <X className="w-5 h-5 text-gray-700" />
        </button>
        {isLoading ? (
          <div className="flex items-center justify-center h-64"><RefreshCw className="w-8 h-8 text-gray-400 animate-spin" /></div>
        ) : urls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Camera className="w-10 h-10 mb-2" /><p className="text-sm">No photos available</p>
          </div>
        ) : (
          <>
            <div className="relative bg-black flex items-center justify-center" style={{ height: "420px" }}>
              <img src={urls[idx]} alt={`Photo ${idx + 1}`} className="max-h-full max-w-full object-contain" />
              {urls.length > 1 && (
                <>
                  <button onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx === 0}
                    className="absolute left-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </button>
                  <button onClick={() => setIdx((i) => Math.min(i + 1, urls.length - 1))} disabled={idx === urls.length - 1}
                    className="absolute right-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </button>
                </>
              )}
            </div>
            {urls.length > 1 && (
              <div className="flex gap-1.5 p-3 overflow-x-auto bg-gray-50">
                {urls.map((url, i) => (
                  <button key={i} onClick={() => setIdx(i)}
                    className={`shrink-0 w-16 h-12 rounded overflow-hidden border-2 transition-colors ${i === idx ? "border-blue-500" : "border-transparent hover:border-gray-300"}`}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="px-4 py-2 text-center text-xs text-gray-400 border-t">
              {idx + 1} / {urls.length} photos — VIN: {vin}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PhotoThumb({ vin, hasPhotos }: { vin: string; hasPhotos?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title={hasPhotos ? "View photos" : "No photos available"}
        className={`p-1.5 rounded transition-colors ${
          hasPhotos
            ? "text-blue-500 hover:text-blue-700 hover:bg-blue-50"
            : "text-gray-300 cursor-default"
        }`}>
        <Camera className="w-4 h-4" />
      </button>
      {open && <PhotoGallery vin={vin} onClose={() => setOpen(false)} />}
    </>
  );
}

function BbExpandedRow({ bbValues }: { bbValues?: { xclean: number; clean: number; avg: number; rough: number } }) {
  if (!bbValues || (!bbValues.xclean && !bbValues.clean && !bbValues.avg && !bbValues.rough)) return null;
  const fmt = (v: number) => v ? `$${v.toLocaleString("en-US")}` : "—";
  const grades = [
    { label: "X-Clean", value: bbValues.xclean, color: "text-emerald-700" },
    { label: "Clean", value: bbValues.clean, color: "text-blue-700" },
    { label: "Average", value: bbValues.avg, color: "text-purple-700" },
    { label: "Rough", value: bbValues.rough, color: "text-orange-700" },
  ];
  return (
    <div className="bg-purple-50 border-b border-purple-100 px-4 py-2.5 flex items-center gap-8 animate-in slide-in-from-top-1 duration-150">
      <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide shrink-0">CBB Wholesale</span>
      <div className="flex items-center gap-6">
        {grades.map((g) => (
          <div key={g.label} className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">{g.label}</span>
            <span className={`text-sm font-semibold ${g.color}`}>{fmt(g.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BbCardDetail({
  bbValues,
  bbAvgWholesale,
}: {
  bbValues?: { xclean: number; clean: number; avg: number; rough: number };
  bbAvgWholesale?: string;
}) {
  const hasGrades = bbValues && (bbValues.xclean || bbValues.clean || bbValues.avg || bbValues.rough);
  const hasAdj    = !!bbAvgWholesale && bbAvgWholesale !== "NOT FOUND";
  if (!hasGrades && !hasAdj) return null;

  const fmt = (v: number) => v ? `$${v.toLocaleString("en-US")}` : "—";

  return (
    <div className="mt-2 rounded-lg border border-purple-200 overflow-hidden text-xs">
      {/* Header */}
      <div className="bg-purple-100 px-3 py-1.5">
        <span className="font-semibold text-purple-800 text-[11px] uppercase tracking-wide">CBB Wholesale</span>
      </div>

      {/* 2-column grade grid: left = X-Clean / Clean, right = Average / Rough */}
      {hasGrades && (
        <div className="grid grid-cols-2 divide-x divide-purple-100 bg-white">
          {/* Left column */}
          <div className="divide-y divide-purple-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">X-Clean</span>
              <span className="font-semibold text-emerald-700">{fmt(bbValues!.xclean)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Clean</span>
              <span className="font-semibold text-blue-700">{fmt(bbValues!.clean)}</span>
            </div>
          </div>
          {/* Right column */}
          <div className="divide-y divide-purple-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Average</span>
              <span className="font-semibold text-purple-700">{fmt(bbValues!.avg)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Rough</span>
              <span className="font-semibold text-orange-700">{fmt(bbValues!.rough)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Full-width KM-adjusted bar */}
      {hasAdj && (
        <div className="flex items-center justify-between px-3 py-2 bg-purple-700">
          <span className="text-purple-200 font-medium">KM Adjusted</span>
          <span className="font-bold text-white">{formatPrice(bbAvgWholesale)}</span>
        </div>
      )}
    </div>
  );
}

function VehicleCard({ item, showPacCost, showOwnerCols, showBb }: { item: any; showPacCost: boolean; showOwnerCols: boolean; showBb: boolean }) {
  const kmDisplay = item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : null;
  const hasBb = showBb && (item.bbAvgWholesale || item.bbValues);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header: location + icons */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{item.location}</span>
        <div className="flex items-center gap-2">
          <PhotoThumb vin={item.vin} hasPhotos={!!item.hasPhotos} />
          {item.carfax && item.carfax !== "NOT FOUND" && (
            <a href={item.carfax} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
              <FileText className="w-4 h-4" />
            </a>
          )}
          {item.website && item.website !== "NOT FOUND" && (
            <a href={item.website} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="Listing">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {/* Line 1: vehicle name */}
        <p className="font-semibold text-gray-900 text-sm leading-snug">{item.vehicle}</p>

        {/* Line 2: VIN  •  KM */}
        <div className="flex items-center gap-2">
          <CopyVin vin={item.vin} />
          {kmDisplay && (
            <>
              <span className="text-gray-300 text-xs">•</span>
              <span className="text-xs text-gray-500 font-medium">{kmDisplay}</span>
            </>
          )}
        </div>

        {/* Owner-only row: Matrix Price + Cost */}
        {showOwnerCols && (
          <div className="flex gap-4 text-xs">
            <div>
              <p className="text-gray-400 mb-0.5">Matrix Price</p>
              <p className="font-medium text-gray-700">{formatPrice(item.matrixPrice)}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Cost</p>
              <p className="font-semibold text-red-700">{formatPrice(item.cost)}</p>
            </div>
          </div>
        )}

        {/* Line 3: PAC Cost + Online Price (always shown; PAC Cost hidden for guests/customer view) */}
        <div className="flex gap-4 text-xs">
          {showPacCost && (
            <div>
              <p className="text-gray-400 mb-0.5">PAC Cost</p>
              <p className="font-semibold text-gray-900">{formatPrice(item.price)}</p>
            </div>
          )}
          <div>
            <p className="text-gray-400 mb-0.5">Online Price</p>
            <p className="font-medium text-gray-700">{formatPrice(item.onlinePrice)}</p>
          </div>
        </div>

        {/* CBB Wholesale box */}
        {hasBb && (
          <BbCardDetail bbValues={item.bbValues} bbAvgWholesale={item.bbAvgWholesale} />
        )}
      </div>
    </div>
  );
}

// ─── Range input pair ────────────────────────────────────────────────────────
function RangeInputs({
  label, minVal, maxVal, minPlaceholder, maxPlaceholder,
  onMinChange, onMaxChange, prefix = "",
}: {
  label: string; minVal: string; maxVal: string;
  minPlaceholder: string; maxPlaceholder: string;
  onMinChange: (v: string) => void; onMaxChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={minVal} onChange={(e) => onMinChange(e.target.value)}
            placeholder={minPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
        <span className="text-gray-300 text-sm">—</span>
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={maxVal} onChange={(e) => onMaxChange(e.target.value)}
            placeholder={maxPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
      </div>
    </div>
  );
}

// ─── Active filter chip ──────────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-200">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 transition-colors"><X className="w-3 h-3" /></button>
    </span>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function Inventory() {
  const [search,      setSearch]      = useState("");
  const [sortKey,     setSortKey]     = useState<SortKey>("vehicle");
  const [sortDir,     setSortDir]     = useState<SortDir>("asc");
  const [showFilters, setShowFilters] = useState(false);
  const [filters,     setFilters]     = useState<Filters>(EMPTY_FILTERS);
  const [, setLocation]               = useLocation();
  const lastKnownUpdate               = useRef<string | null>(null);

  const { data: me } = useGetMe({ query: { retry: false } });
  const isGuest = me?.role === "guest";
  const isOwner = me?.isOwner === true;

  type ViewMode = "owner" | "user" | "customer";
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("viewMode");
    if (saved === "owner" || saved === "user" || saved === "customer") return saved;
    return "user";
  });
  useEffect(() => {
    const saved = localStorage.getItem("viewMode");
    if (isOwner && !saved) setViewMode("owner");
  }, [isOwner]);
  useEffect(() => { localStorage.setItem("viewMode", viewMode); }, [viewMode]);
  const showOwnerCols = isOwner && viewMode === "owner";
  const showPacCost   = !isGuest && viewMode !== "customer";
  const showBb        = viewMode !== "customer";

  const [expandedBbVin, setExpandedBbVin] = useState<string | null>(null);
  const [bbClicked, setBbClicked] = useState(false);
  const bbCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: inventory, isLoading, error, refetch: refetchInventory } = useGetInventory({ query: { retry: false } });

  const { data: cacheStatus } = useGetCacheStatus({ query: { refetchInterval: 60_000, retry: false } });

  const bbRunning = (cacheStatus as any)?.bbRunning === true || bbClicked;

  const triggerBbRefresh = useCallback(async () => {
    if (bbRunning) return;
    setBbClicked(true);
    if (bbCooldownRef.current) clearTimeout(bbCooldownRef.current);
    bbCooldownRef.current = setTimeout(() => setBbClicked(false), 90_000);
    try {
      const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      await fetch(`${base}/api/refresh-blackbook`, { method: "POST", credentials: "include" });
    } catch (_) {}
  }, [bbRunning]);

  useEffect(() => {
    if (!cacheStatus?.lastUpdated) return;
    if (lastKnownUpdate.current === null) { lastKnownUpdate.current = cacheStatus.lastUpdated; return; }
    if (cacheStatus.lastUpdated !== lastKnownUpdate.current) {
      lastKnownUpdate.current = cacheStatus.lastUpdated;
      refetchInventory();
    }
  }, [cacheStatus?.lastUpdated, refetchInventory]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401) { setLocation("/login"); return null; }
    if (status === 403) { setLocation("/denied"); return null; }
    return (
      <div className="p-8 text-center rounded-lg border border-red-200 bg-red-50 mt-10 max-w-xl mx-auto">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
        <h2 className="text-base font-semibold text-gray-900 mb-1">Error loading inventory</h2>
        <p className="text-sm text-gray-500">Please refresh the page or contact support.</p>
      </div>
    );
  }

  if (isLoading) return <FullScreenSpinner />;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter = (key: keyof Filters) => (val: string) =>
    setFilters((f) => ({ ...f, [key]: val }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasFilters = Object.values(filters).some(Boolean);

  // Deduplicate by VIN — keep lowest price
  const parseNumericPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || Infinity;
  type Item = NonNullable<typeof inventory>[number];
  const dedupedMap = new Map<string, Item>();
  for (const item of (inventory ?? [])) {
    const existing = dedupedMap.get(item.vin);
    if (!existing || parseNumericPrice(item.price) < parseNumericPrice(existing.price))
      dedupedMap.set(item.vin, item);
  }
  const deduped = Array.from(dedupedMap.values());

  // Derive year min/max from data for placeholders
  const years = deduped.map((i) => extractYear(i.vehicle)).filter(Boolean);
  const dataYearMin = years.length ? Math.min(...years) : 2000;
  const dataYearMax = years.length ? Math.max(...years) : new Date().getFullYear();
  const kms   = deduped.map((i) => parseNum(i.km)).filter(Boolean);
  const dataKmMax = kms.length ? Math.max(...kms) : 300000;
  const prices = deduped.map((i) => parseNum(i.price)).filter(Boolean);
  const dataPriceMax = prices.length ? Math.max(...prices) : 100000;

  // Apply all filters + search
  const filtered = deduped.filter((item) => {
    // Text search
    if (search) {
      const term = search.toLowerCase();
      if (!item.vehicle.toLowerCase().includes(term) &&
          !item.vin.toLowerCase().includes(term) &&
          !item.location.toLowerCase().includes(term)) return false;
    }
    // Year
    const year = extractYear(item.vehicle);
    if (filters.yearMin && year && year < parseInt(filters.yearMin)) return false;
    if (filters.yearMax && year && year > parseInt(filters.yearMax)) return false;
    // KM
    const km = parseNum(item.km);
    if (filters.kmMax && km && km > parseNum(filters.kmMax)) return false;
    // Price (only for non-guests)
    if (!isGuest) {
      const price = parseNum(item.price);
      if (filters.priceMin && price && price < parseNum(filters.priceMin)) return false;
      if (filters.priceMax && price && price > parseNum(filters.priceMax)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] ?? "").toLowerCase();
    const bv = (b[sortKey] ?? "").toLowerCase();
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Active filter chips
  const activeChips: { label: string; clear: () => void }[] = [
    ...(filters.yearMin || filters.yearMax ? [{
      label: `Year: ${filters.yearMin || dataYearMin}–${filters.yearMax || dataYearMax}`,
      clear: () => setFilters((f) => ({ ...f, yearMin: "", yearMax: "" })),
    }] : []),
    ...(filters.kmMax ? [{
      label: `KM ≤ ${parseInt(filters.kmMax).toLocaleString("en-US")}`,
      clear: () => setFilter("kmMax")(""),
    }] : []),
    ...(!isGuest && (filters.priceMin || filters.priceMax) ? [{
      label: `PAC Cost: $${filters.priceMin || "0"}–$${filters.priceMax || "∞"}`,
      clear: () => setFilters((f) => ({ ...f, priceMin: "", priceMax: "" })),
    }] : []),
  ];

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-20 text-center rounded-lg border border-gray-200 bg-white">
      <Search className="w-8 h-8 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-700 mb-1">No vehicles found</p>
      <p className="text-sm text-gray-400">Try adjusting your search or filters.</p>
      {(search || hasFilters) && (
        <button onClick={() => { setSearch(""); clearFilters(); }}
          className="mt-4 px-4 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          Clear all
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header + search + filter toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Vehicle Inventory</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {sorted.length} {sorted.length === 1 ? "vehicle" : "vehicles"}
              {sorted.length !== deduped.length ? ` of ${deduped.length} total` : ""}
            </p>
            {cacheStatus?.lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                {cacheStatus.isRefreshing
                  ? <><RefreshCw className="w-3 h-3 animate-spin" /> Updating…</>
                  : <>Updated {timeAgo(cacheStatus.lastUpdated)}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input type="text"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                placeholder="Search vehicle, VIN, location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowFilters((s) => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showFilters || hasFilters
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}>
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {hasFilters && <span className="bg-white text-blue-600 text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{activeChips.length}</span>}
            </button>
            {!isGuest && (
              <div className="flex items-center gap-2">
                <div className="flex rounded overflow-hidden border border-gray-200 shrink-0">
                  {isOwner && (
                    <button onClick={() => setViewMode("owner")}
                      className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "owner" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                      Own
                    </button>
                  )}
                  <button onClick={() => setViewMode("user")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "user" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    User
                  </button>
                  <button onClick={() => setViewMode("customer")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "customer" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    Cust
                  </button>
                </div>
                {showOwnerCols && (
                  <button
                    onClick={triggerBbRefresh}
                    disabled={bbRunning}
                    title={bbRunning ? "Book value refresh in progress…" : "Refresh Canadian Black Book values"}
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border transition-colors shrink-0 ${
                      bbRunning
                        ? "bg-purple-50 text-purple-400 border-purple-200 cursor-not-allowed"
                        : "bg-white text-purple-600 border-purple-200 hover:bg-purple-50"
                    }`}>
                    <RefreshCw className={`w-3 h-3 ${bbRunning ? "animate-spin" : ""}`} />
                    Book Avg
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <div className={`grid gap-4 ${isGuest ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
              <RangeInputs label="Year" minVal={filters.yearMin} maxVal={filters.yearMax}
                minPlaceholder={String(dataYearMin)} maxPlaceholder={String(dataYearMax)}
                onMinChange={setFilter("yearMin")} onMaxChange={setFilter("yearMax")} />
              <RangeInputs label="Max KM" minVal="" maxVal={filters.kmMax}
                minPlaceholder="0" maxPlaceholder={Math.round(dataKmMax / 1000) * 1000 + ""}
                onMinChange={() => {}} onMaxChange={setFilter("kmMax")} />
              {showPacCost && (
                <RangeInputs label="PAC Cost" minVal={filters.priceMin} maxVal={filters.priceMax}
                  minPlaceholder="0" maxPlaceholder={Math.round(dataPriceMax / 1000) * 1000 + ""}
                  onMinChange={setFilter("priceMin")} onMaxChange={setFilter("priceMax")} prefix="$" />
              )}
            </div>
            {hasFilters && (
              <button onClick={clearFilters}
                className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors">
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <FilterChip key={chip.label} label={chip.label} onRemove={chip.clear} />
            ))}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      {isMobile ? (
        sorted.length === 0 ? emptyState : (
          <div className="space-y-3">
            {sorted.map((item, i) => (
              <VehicleCard key={`${item.vin}-${i}`} item={item} showPacCost={showPacCost} showOwnerCols={showOwnerCols} showBb={showBb} />
            ))}
          </div>
        )
      ) : (
        /* Desktop table */
        sorted.length === 0 ? emptyState : (
          <div className="rounded-lg border border-gray-200 overflow-x-auto bg-white shadow-sm">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              {[
                { key: "location" as SortKey, label: "Location",   cls: "w-24 shrink-0" },
                { key: "vehicle"  as SortKey, label: "Vehicle",    cls: "flex-1 min-w-[280px]" },
                { key: "vin"      as SortKey, label: "VIN",        cls: "w-40 shrink-0" },
                { key: "km"       as SortKey, label: "KM",         cls: "w-24 shrink-0" },
              ].map((col) => (
                <div key={col.label} className={col.cls}>
                  <button onClick={() => handleSort(col.key)}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    {col.label}<SortIcon active={sortKey === col.key} dir={sortDir} />
                  </button>
                </div>
              ))}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Matrix Price</div>}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Cost</div>}
              {showBb && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-purple-500">Book Avg</div>}
              {showPacCost && (
                <div className="w-24 shrink-0">
                  <button onClick={() => handleSort("price")}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    PAC Cost<SortIcon active={sortKey === "price"} dir={sortDir} />
                  </button>
                </div>
              )}
              <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Online Price</div>
              <div className="w-8 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">CFX</div>
              <div className="w-8 shrink-0" />
              <div className="w-8 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Link</div>
            </div>
            <div>
              {sorted.map((item, i) => (
                <div key={`${item.vin}-${i}`}>
                  <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i < sorted.length - 1 && expandedBbVin !== item.vin ? "border-b border-gray-100" : ""}`}>
                    <div className="w-24 shrink-0 text-sm text-gray-700 truncate font-medium">{item.location || "—"}</div>
                    <div className="flex-1 min-w-[280px] text-sm text-gray-900 font-medium truncate">{item.vehicle}</div>
                    <div className="w-40 shrink-0"><CopyVin vin={item.vin} /></div>
                    <div className="w-24 shrink-0 text-sm text-gray-600">
                      {item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : "—"}
                    </div>
                    {showOwnerCols && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.matrixPrice ?? "")}</div>}
                    {showOwnerCols && <div className="w-24 shrink-0 text-sm font-medium text-red-700">{formatPrice(item.cost ?? "")}</div>}
                    {showBb && (
                      (item as any).bbValues ? (
                        <button className="w-24 shrink-0 text-sm font-medium text-purple-700 cursor-pointer hover:underline text-left"
                          onClick={() => setExpandedBbVin(expandedBbVin === item.vin ? null : item.vin)}>
                          {formatPrice((item as any).bbAvgWholesale ?? "")}
                        </button>
                      ) : (
                        <div className="w-24 shrink-0 text-sm font-medium text-purple-700">
                          {formatPrice((item as any).bbAvgWholesale ?? "")}
                        </div>
                      )
                    )}
                    {showPacCost && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.price)}</div>}
                    <div className="w-28 shrink-0 text-sm text-gray-700">{formatPrice(item.onlinePrice)}</div>
                    <div className="w-8 shrink-0 flex justify-center">
                      {item.carfax && item.carfax !== "NOT FOUND"
                        ? <a href={item.carfax} target="_blank" rel="noopener noreferrer"
                            className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
                            <FileText className="w-4 h-4" />
                          </a>
                        : <span className="text-gray-200 text-sm">—</span>}
                    </div>
                    <div className="w-8 shrink-0 flex justify-center"><PhotoThumb vin={item.vin} hasPhotos={!!item.hasPhotos} /></div>
                    <div className="w-8 shrink-0 flex justify-center">
                      {item.website && item.website !== "NOT FOUND"
                        ? <a href={item.website} target="_blank" rel="noopener noreferrer"
                            className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="View Listing">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        : <span className="text-gray-200 text-sm">—</span>}
                    </div>
                  </div>
                  {expandedBbVin === item.vin && <BbExpandedRow bbValues={(item as any).bbValues} />}
                  {(i < sorted.length - 1 || expandedBbVin === item.vin) && expandedBbVin === item.vin && <div className="border-b border-gray-100" />}
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

```


### `artifacts/inventory-portal/src/pages/lender-calculator.tsx` (537 lines)

```tsx
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  useGetMe,
  useGetLenderPrograms,
  useGetLenderStatus,
  useRefreshLender,
  useLenderCalculate,
} from "@workspace/api-client-react";
import type {
  LenderProgram,
  LenderProgramGuide,
  LenderProgramTier,
  LenderCalcResultItem,
  LenderCalculateResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Calculator, Car, AlertCircle, Eye, ChevronDown, ChevronUp } from "lucide-react";

function formatCurrency(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function formatPayment(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const COND_SHORT: Record<string, string> = { extraClean: "XC", clean: "C", average: "A", rough: "R" };

const PRICE_SOURCE_LABEL: Record<string, string> = { online: "On", reduced: "Red", maximized: "Max", pac: "PAC" };

function ResultRow({ item, rank, showDP }: { item: any; rank: number; showDP: boolean }) {
  const needsDP = (item.requiredDownPayment ?? 0) > 0;
  const stretched = item.termStretched === true;
  const applied = Number(item.termStretchApplied ?? 0);
  const tier = Number(item.qualificationTier ?? 1);
  let rowBg = "odd:bg-white even:bg-slate-50/40";
  if (needsDP) rowBg = "bg-gray-100/60";
  else if (tier === 2) rowBg = "bg-blue-50/50";
  else if (stretched && applied === 12) rowBg = "bg-orange-50";
  else if (stretched && applied === 6) rowBg = "bg-amber-50";

  const profitMet = item.profit >= (item.profitTarget ?? 0);

  return (
    <tr className={`border-b border-gray-100 last:border-0 ${rowBg} hover:bg-blue-50/50`}>
      <td className="px-1.5 py-1.5 text-[11px] text-gray-400 font-semibold text-center">{rank}</td>
      <td className="px-2 py-1.5 text-xs font-semibold text-gray-900">
        <div className="truncate" title={item.vehicle}>
          {tier === 2 && <span className="text-[9px] font-bold text-blue-600 mr-1">T2</span>}
          {item.vehicle}
        </div>
      </td>
      <td className="px-1.5 py-1.5 text-xs text-gray-600 whitespace-nowrap">{item.location}</td>
      <td
        className="px-1.5 py-1.5 text-xs text-center text-gray-600 whitespace-nowrap"
        title={
          item.matrixTerm != null
            ? `Matrix ${item.matrixTerm}mo · applied +${applied} → ${item.term}mo${item.termStretchCappedReason ? ` (${item.termStretchCappedReason})` : ""}`
            : undefined
        }
      >
        {item.term}mo
        {item.termStretchCappedReason ? <span className="text-[9px] text-amber-700 ml-0.5 align-super">†</span> : null}
      </td>
      <td className="px-1.5 py-1.5 text-xs text-center text-gray-600 whitespace-nowrap">{COND_SHORT[item.conditionUsed] ?? item.conditionUsed}</td>
      <td className="px-1.5 py-1.5 text-xs text-right font-medium text-gray-600">{formatCurrency(item.bbWholesale)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-medium text-gray-700">
        {item.sellingPrice > 0 ? formatCurrency(item.sellingPrice) : "—"}
        {item.priceSource && (
          <span className="text-[10px] text-gray-400 ml-0.5">
            ({PRICE_SOURCE_LABEL[item.priceSource] ?? item.priceSource})
          </span>
        )}
      </td>
      <td className="px-1.5 py-1.5 text-xs text-right font-medium text-indigo-700">{formatCurrency(item.adminFeeUsed)}</td>
      <td className="px-2 py-1.5 text-xs text-right text-gray-700">
        {formatCurrency(item.warrantyPrice)}
        <span className="text-[10px] text-gray-400 ml-0.5">/{formatCurrency(item.warrantyCost)}</span>
      </td>
      <td className="px-2 py-1.5 text-xs text-right text-gray-700">
        {formatCurrency(item.gapPrice)}
        <span className="text-[10px] text-gray-400 ml-0.5">/{formatCurrency(item.gapCost)}</span>
      </td>
      <td className="px-2 py-1.5 text-xs text-right font-medium text-gray-700">{formatCurrency(item.totalFinanced)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-semibold text-green-700">{formatPayment(item.monthlyPayment)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-semibold text-emerald-700"
        title={`Target: ${formatCurrency(item.profitTarget ?? 0)}`}>
        {formatCurrency(item.profit)}
        {!profitMet && <span className="text-[9px] text-red-500 ml-0.5 align-super">!</span>}
      </td>
      {showDP && (
        <td className="px-2 py-1.5 text-xs text-right font-semibold text-red-600">
          {needsDP ? formatCurrency(item.requiredDownPayment) : "—"}
        </td>
      )}
    </tr>
  );
}

export default function LenderCalculator() {
  const { data: programsData, isLoading: loadingPrograms, refetch: refetchPrograms } = useGetLenderPrograms({
    query: { retry: false, refetchOnWindowFocus: false },
  });
  const { data: statusData, refetch: refetchStatus } = useGetLenderStatus({
    query: { retry: false, refetchInterval: 10_000 },
  });
  const { data: meData } = useGetMe({ query: { retry: false } });
  const refreshMutation = useRefreshLender();
  const calcMutation = useLenderCalculate();

  const [selectedLender, setSelectedLender] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("");
  const [selectedTier, setSelectedTier] = useState("");
  const [approvedRate, setApprovedRate] = useState("14.99");
  const [maxPaymentOverride, setMaxPaymentOverride] = useState("");
  const [downPayment, setDownPayment] = useState("0");
  const [tradeValue, setTradeValue] = useState("0");
  const [tradeLien, setTradeLien] = useState("0");
  const [taxRate, setTaxRate] = useState("5");
  const [adminFee, setAdminFee] = useState("0");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [termStretch, setTermStretch] = useState(0);
  const [showAllDP, setShowAllDP] = useState(false);

  const isUserOwner = !!meData?.isOwner;

  const programs: LenderProgram[] = programsData?.programs ?? [];

  const selectedLenderObj = useMemo(
    () => programs.find(p => p.lenderCode === selectedLender),
    [programs, selectedLender],
  );

  const selectedGuide: LenderProgramGuide | undefined = useMemo(
    () => selectedLenderObj?.programs.find(g => g.programId === selectedProgram),
    [selectedLenderObj, selectedProgram],
  );

  const selectedTierObj: LenderProgramTier | undefined = useMemo(
    () => selectedGuide?.tiers.find(t => t.tierName === selectedTier),
    [selectedGuide, selectedTier],
  );

  const calcResults: LenderCalculateResponse | null = calcMutation.data ?? null;

  useEffect(() => {
    if (selectedLenderObj && selectedLenderObj.programs.length === 1 && !selectedProgram) {
      setSelectedProgram(selectedLenderObj.programs[0].programId);
    }
  }, [selectedLenderObj, selectedProgram]);

  useEffect(() => {
    if (selectedTierObj) {
      setApprovedRate(String(selectedTierObj.minRate));
    }
  }, [selectedTierObj]);

  const hasCalculated = useRef(false);
  const handleCalculateRef = useRef<() => void>(() => {});

  const handleRefresh = () => {
    refreshMutation.mutate(undefined as any, {
      onSuccess: () => {
        setTimeout(() => { refetchStatus(); refetchPrograms(); }, 2000);
      },
    });
  };

  const handleCalculate = useCallback(() => {
    if (!selectedLender || !selectedProgram || !selectedTier) return;
    const payload: any = {
      lenderCode: selectedLender,
      programId: selectedProgram,
      tierName: selectedTier,
      approvedRate: parseFloat(approvedRate) || 0,
      downPayment: parseFloat(downPayment) || 0,
      tradeValue: parseFloat(tradeValue) || 0,
      tradeLien: parseFloat(tradeLien) || 0,
      taxRate: parseFloat(taxRate) || 5,
      adminFee: parseFloat(adminFee) || 0,
      termStretchMonths: Number(termStretch) as 0 | 6 | 12,
      showAllWithDownPayment: showAllDP,
    };
    const pmtOverride = parseFloat(maxPaymentOverride);
    if (pmtOverride > 0) payload.maxPaymentOverride = pmtOverride;
    hasCalculated.current = true;
    calcMutation.mutate({ data: payload });
  }, [selectedLender, selectedProgram, selectedTier, approvedRate, downPayment, tradeValue, tradeLien, taxRate, adminFee, termStretch, showAllDP, maxPaymentOverride, calcMutation]);

  handleCalculateRef.current = handleCalculate;

  useEffect(() => {
    if (!hasCalculated.current) return;
    handleCalculateRef.current();
  }, [termStretch, showAllDP]);

  const handleLenderChange = (code: string) => {
    setSelectedLender(code);
    setSelectedProgram("");
    setSelectedTier("");
  };

  const handleProgramChange = (programId: string) => {
    setSelectedProgram(programId);
    setSelectedTier("");
  };

  const totalPrograms = useMemo(
    () => programs.reduce((sum, p) => sum + p.programs.length, 0),
    [programs],
  );

  const selectClass = "h-9 text-sm font-medium bg-white border-gray-300 shadow-sm";
  const dropdownClass = "max-h-80 bg-white border border-gray-200 shadow-lg";
  const optionClass = "text-sm py-2.5 px-3 cursor-pointer hover:bg-gray-100 focus:bg-gray-100";

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Selector</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {programs.length} lender{programs.length !== 1 ? "s" : ""}, {totalPrograms} program{totalPrograms !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {statusData && (
            <div className="text-xs text-gray-400">
              {statusData.running ? (
                <span className="text-amber-600 font-medium flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Syncing...
                </span>
              ) : statusData.programsAge ? (
                <span>Updated {new Date(statusData.programsAge).toLocaleDateString()}</span>
              ) : (
                <span className="text-red-500">No data yet</span>
              )}
            </div>
          )}
          {isUserOwner && (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshMutation.isPending || statusData?.running}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${statusData?.running ? "animate-spin" : ""}`} />
              Sync Programs
            </Button>
          )}
        </div>
      </div>

      {programs.length === 0 && !loadingPrograms && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">No lender programs cached</p>
                <p className="text-sm text-amber-700 mt-1">
                  {isUserOwner
                    ? 'Click "Sync Programs" to fetch the latest lender program matrices from CreditApp.'
                    : "No lender programs available. Ask an admin to sync programs."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {programs.length > 0 && (
        <>
          {/* Inputs — horizontal across top */}
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3">
                {/* Lender */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Lender</Label>
                  <Select value={selectedLender} onValueChange={handleLenderChange}>
                    <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className={dropdownClass}>
                      {programs.map(p => (
                        <SelectItem key={p.lenderCode} value={p.lenderCode} className={optionClass}>
                          {p.lenderName} ({p.lenderCode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Program */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Program</Label>
                  {selectedLenderObj && selectedLenderObj.programs.length === 1 && selectedProgram ? (
                    <div className="h-9 flex items-center px-3 bg-gray-50 border border-gray-200 rounded-md text-sm font-medium text-gray-700 truncate">
                      {selectedLenderObj.programs[0].programTitle}
                    </div>
                  ) : (
                    <Select value={selectedProgram} onValueChange={handleProgramChange} disabled={!selectedLenderObj}>
                      <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent className={dropdownClass}>
                        {(selectedLenderObj?.programs ?? []).map(g => (
                          <SelectItem key={g.programId} value={g.programId} className={optionClass}>
                            {g.programTitle} ({g.tiers.length} tier{g.tiers.length !== 1 ? "s" : ""})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Tier */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Tier</Label>
                  <Select value={selectedTier} onValueChange={setSelectedTier} disabled={!selectedGuide}>
                    <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className={dropdownClass}>
                      {(selectedGuide?.tiers ?? []).map(t => (
                        <SelectItem key={t.tierName} value={t.tierName} className={optionClass}>
                          {t.tierName} ({t.minRate}–{t.maxRate}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Approved Rate */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Rate (%)</Label>
                  <Input type="number" step="0.01" value={approvedRate} onChange={e => setApprovedRate(e.target.value)} className="h-9" />
                </div>

                {/* Max Payment */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Max Payment</Label>
                  <Input
                    type="number" step="10"
                    placeholder={selectedTierObj ? `${selectedTierObj.maxPayment > 0 ? formatCurrency(selectedTierObj.maxPayment) : "None"}` : "Optional"}
                    value={maxPaymentOverride} onChange={e => setMaxPaymentOverride(e.target.value)} className="h-9"
                  />
                </div>

                {/* Down Payment */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Down Payment</Label>
                  <Input type="number" value={downPayment} onChange={e => setDownPayment(e.target.value)} className="h-9" />
                </div>
              </div>

              {/* Second row: trade, advanced toggle, View Inventory button */}
              <div className="flex items-end gap-4 mt-3">
                <div className="grid grid-cols-2 gap-3 w-64 flex-shrink-0">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Trade Value</Label>
                    <Input type="number" value={tradeValue} onChange={e => setTradeValue(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Trade Lien</Label>
                    <Input type="number" value={tradeLien} onChange={e => setTradeLien(e.target.value)} className="h-9" />
                  </div>
                </div>

                {showAdvanced && (
                  <div className="grid grid-cols-2 gap-3 w-56 flex-shrink-0">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Tax (%)</Label>
                      <Input type="number" step="0.5" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Admin Fee</Label>
                      <Input type="number" value={adminFee} onChange={e => setAdminFee(e.target.value)} className="h-9" />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors pb-2 whitespace-nowrap"
                >
                  {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showAdvanced ? "Less" : "More"}
                </button>

                <div className="flex items-center gap-4 pb-1 ml-2">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="font-medium whitespace-nowrap">Term Exception:</span>
                    {[0, 6, 12].map(v => (
                      <label key={v} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio" name="termStretch" value={v}
                          checked={termStretch === v}
                          onChange={() => setTermStretch(v)}
                          className="w-3 h-3"
                        />
                        <span>{v === 0 ? "None" : `+${v}mo`}</span>
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox" checked={showAllDP}
                      onChange={e => setShowAllDP(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span className="font-medium">Show all + req. DP</span>
                  </label>
                </div>

                <div className="ml-auto flex-shrink-0">
                  <Button
                    onClick={handleCalculate}
                    disabled={!selectedLender || !selectedProgram || !selectedTier || calcMutation.isPending}
                    className="h-9"
                  >
                    {calcMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Eye className="w-4 h-4 mr-2" />
                    )}
                    View Inventory
                  </Button>
                </div>
              </div>

              {/* Tier info badge */}
              {selectedTierObj && (
                <div className="flex items-center gap-3 mt-2 text-xs text-blue-700">
                  <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200">
                    {selectedGuide?.programTitle} — {selectedTierObj.tierName}
                  </Badge>
                  <span>Rate: {selectedTierObj.minRate}–{selectedTierObj.maxRate}%</span>
                  <span>Max Pmt: {selectedTierObj.maxPayment > 0 ? formatCurrency(selectedTierObj.maxPayment) : "None"}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error */}
          {calcMutation.isError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Calculation Error</p>
                    <p className="text-sm text-red-700 mt-1">{String((calcMutation.error as any)?.message || "Unknown error")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results — full width below */}
          {calcResults && (
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Car className="w-4 h-4" />
                    Results
                    <Badge variant="secondary" className="text-xs ml-1">{calcResults.resultCount} vehicles</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-xs">{calcResults.lender} / {calcResults.program} / {calcResults.tier}</Badge>
                    <Badge variant="outline" className="text-xs">Rate: {approvedRate}%</Badge>
                    {maxPaymentOverride && Number(maxPaymentOverride) > 0 && (
                      <Badge variant="outline" className="text-xs">Pmt Cap: {formatCurrency(Number(maxPaymentOverride))}</Badge>
                    )}
                  </div>
                </div>

                {calcResults.resultCount === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Car className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">No vehicles qualify</p>
                    <p className="text-xs mt-1">Try adjusting the max payment or rate</p>
                  </div>
                ) : (
                  <div className="rounded-md border border-gray-200 overflow-x-auto">
                    <table className="text-left w-full">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr className="border-b border-gray-200 text-[10px] text-gray-600 uppercase tracking-wide">
                          <th className="w-8 px-1.5 py-2 text-center">#</th>
                          <th className="px-2 py-2" style={{ minWidth: "220px" }}>Vehicle</th>
                          <th className="px-1.5 py-2 whitespace-nowrap">Loc</th>
                          <th className="px-1.5 py-2 text-center whitespace-nowrap">Term</th>
                          <th className="px-1.5 py-2 text-center whitespace-nowrap">Cond</th>
                          <th className="px-1.5 py-2 text-right whitespace-nowrap">BB Val</th>
                          <th className="px-2 py-2 text-right" style={{ minWidth: "100px" }}>Sell Price</th>
                          <th className="px-1.5 py-2 text-right whitespace-nowrap">Admin</th>
                          <th className="px-2 py-2 text-right" style={{ minWidth: "100px" }}>Warranty</th>
                          <th className="px-2 py-2 text-right" style={{ minWidth: "90px" }}>GAP</th>
                          <th className="px-2 py-2 text-right" style={{ minWidth: "90px" }}>Financed</th>
                          <th className="px-2 py-2 text-right whitespace-nowrap">Pmt</th>
                          <th className="px-2 py-2 text-right whitespace-nowrap">Profit</th>
                          {showAllDP && <th className="px-2 py-2 text-right whitespace-nowrap">Req. DP</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {calcResults.results.map((item: any, idx: number) => (
                          <ResultRow key={item.vin} item={item} rank={idx + 1} showDP={showAllDP} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!calcResults && !calcMutation.isError && (
            <Card className="border-dashed border-gray-300">
              <CardContent className="py-16">
                <div className="text-center text-gray-400">
                  <Calculator className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">Select a lender, program, and tier, then click View Inventory</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

```


### UI Components (shadcn/ui)

The following 50 shadcn/ui components are standard library components:


### `artifacts/inventory-portal/src/components/ui/accordion.tsx` (55 lines)

```tsx
import * as React from "react"
import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

const Accordion = AccordionPrimitive.Root

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn("border-b", className)}
    {...props}
  />
))
AccordionItem.displayName = "AccordionItem"

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-center justify-between py-4 text-sm font-medium transition-all hover:underline text-left [&[data-state=open]>svg]:rotate-180",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
))
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
    {...props}
  >
    <div className={cn("pb-4 pt-0", className)}>{children}</div>
  </AccordionPrimitive.Content>
))
AccordionContent.displayName = AccordionPrimitive.Content.displayName

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }

```


### `artifacts/inventory-portal/src/components/ui/alert-dialog.tsx` (139 lines)

```tsx
import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    />
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants(), className)}
    {...props}
  />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(
      buttonVariants({ variant: "outline" }),
      "mt-2 sm:mt-0",
      className
    )}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}

```


### `artifacts/inventory-portal/src/components/ui/alert.tsx` (59 lines)

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }

```


### `artifacts/inventory-portal/src/components/ui/aspect-ratio.tsx` (5 lines)

```tsx
import * as AspectRatioPrimitive from "@radix-ui/react-aspect-ratio"

const AspectRatio = AspectRatioPrimitive.Root

export { AspectRatio }

```


### `artifacts/inventory-portal/src/components/ui/avatar.tsx` (50 lines)

```tsx
"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }

```


### `artifacts/inventory-portal/src/components/ui/badge.tsx` (43 lines)

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // @replit
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate ",
  {
    variants: {
      variant: {
        default:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary:
          // @replit no hover because we use hover-elevate
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",
          // @replit shadow-xs" - use badge outline variable
        outline: "text-foreground border [border-color:var(--badge-outline)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

```


### `artifacts/inventory-portal/src/components/ui/breadcrumb.tsx` (115 lines)

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

const Breadcrumb = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"nav"> & {
    separator?: React.ReactNode
  }
>(({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />)
Breadcrumb.displayName = "Breadcrumb"

const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<"ol">
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
      className
    )}
    {...props}
  />
))
BreadcrumbList.displayName = "BreadcrumbList"

const BreadcrumbItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentPropsWithoutRef<"li">
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("inline-flex items-center gap-1.5", className)}
    {...props}
  />
))
BreadcrumbItem.displayName = "BreadcrumbItem"

const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<"a"> & {
    asChild?: boolean
  }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      ref={ref}
      className={cn("transition-colors hover:text-foreground", className)}
      {...props}
    />
  )
})
BreadcrumbLink.displayName = "BreadcrumbLink"

const BreadcrumbPage = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span">
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    role="link"
    aria-disabled="true"
    aria-current="page"
    className={cn("font-normal text-foreground", className)}
    {...props}
  />
))
BreadcrumbPage.displayName = "BreadcrumbPage"

const BreadcrumbSeparator = ({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) => (
  <li
    role="presentation"
    aria-hidden="true"
    className={cn("[&>svg]:w-3.5 [&>svg]:h-3.5", className)}
    {...props}
  >
    {children ?? <ChevronRight />}
  </li>
)
BreadcrumbSeparator.displayName = "BreadcrumbSeparator"

const BreadcrumbEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    role="presentation"
    aria-hidden="true"
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More</span>
  </span>
)
BreadcrumbEllipsis.displayName = "BreadcrumbElipssis"

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}

```


### `artifacts/inventory-portal/src/components/ui/button-group.tsx` (83 lines)

```tsx
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

const buttonGroupVariants = cva(
  "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
        vertical:
          "flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  }
)

function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}

function ButtonGroupText({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      className={cn(
        "bg-muted shadow-xs flex items-center gap-2 rounded-md border px-4 text-sm font-medium [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        "bg-input relative !m-0 self-stretch data-[orientation=vertical]:h-auto",
        className
      )}
      {...props}
    />
  )
}

export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
}

```


### `artifacts/inventory-portal/src/components/ui/button.tsx` (65 lines)

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
           // @replit: no hover, and add primary border
           "bg-primary text-primary-foreground border border-primary-border",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

```


### `artifacts/inventory-portal/src/components/ui/calendar.tsx` (213 lines)

```tsx
"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3 [--cell-size:2rem] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-[--cell-size] w-full items-center justify-center px-[--cell-size]",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-[--cell-size] w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "bg-popover absolute inset-0 opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "select-none font-medium",
          captionLayout === "label"
            ? "text-sm"
            : "[&>svg]:text-muted-foreground flex h-8 items-center gap-1 rounded-md pl-2 pr-1 text-sm [&>svg]:size-3.5",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground flex-1 select-none rounded-md text-[0.8rem] font-normal",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-[--cell-size] select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-muted-foreground select-none text-[0.8rem]",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full select-none p-0 text-center [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md",
          defaultClassNames.day
        ),
        range_start: cn(
          "bg-accent rounded-l-md",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("bg-accent rounded-r-md", defaultClassNames.range_end),
        today: cn(
          "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-[--cell-size] items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 flex aspect-square h-auto w-full min-w-[--cell-size] flex-col gap-1 font-normal leading-none data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }

```


### `artifacts/inventory-portal/src/components/ui/card.tsx` (76 lines)

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-xl border bg-card text-card-foreground shadow",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }

```


### `artifacts/inventory-portal/src/components/ui/carousel.tsx` (260 lines)

```tsx
import * as React from "react"
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react"
import { ArrowLeft, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

type CarouselProps = {
  opts?: CarouselOptions
  plugins?: CarouselPlugin
  orientation?: "horizontal" | "vertical"
  setApi?: (api: CarouselApi) => void
}

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0]
  api: ReturnType<typeof useEmblaCarousel>[1]
  scrollPrev: () => void
  scrollNext: () => void
  canScrollPrev: boolean
  canScrollNext: boolean
} & CarouselProps

const CarouselContext = React.createContext<CarouselContextProps | null>(null)

function useCarousel() {
  const context = React.useContext(CarouselContext)

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />")
  }

  return context
}

const Carousel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & CarouselProps
>(
  (
    {
      orientation = "horizontal",
      opts,
      setApi,
      plugins,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const [carouselRef, api] = useEmblaCarousel(
      {
        ...opts,
        axis: orientation === "horizontal" ? "x" : "y",
      },
      plugins
    )
    const [canScrollPrev, setCanScrollPrev] = React.useState(false)
    const [canScrollNext, setCanScrollNext] = React.useState(false)

    const onSelect = React.useCallback((api: CarouselApi) => {
      if (!api) {
        return
      }

      setCanScrollPrev(api.canScrollPrev())
      setCanScrollNext(api.canScrollNext())
    }, [])

    const scrollPrev = React.useCallback(() => {
      api?.scrollPrev()
    }, [api])

    const scrollNext = React.useCallback(() => {
      api?.scrollNext()
    }, [api])

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          scrollPrev()
        } else if (event.key === "ArrowRight") {
          event.preventDefault()
          scrollNext()
        }
      },
      [scrollPrev, scrollNext]
    )

    React.useEffect(() => {
      if (!api || !setApi) {
        return
      }

      setApi(api)
    }, [api, setApi])

    React.useEffect(() => {
      if (!api) {
        return
      }

      onSelect(api)
      api.on("reInit", onSelect)
      api.on("select", onSelect)

      return () => {
        api?.off("select", onSelect)
      }
    }, [api, onSelect])

    return (
      <CarouselContext.Provider
        value={{
          carouselRef,
          api: api,
          opts,
          orientation:
            orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
          scrollPrev,
          scrollNext,
          canScrollPrev,
          canScrollNext,
        }}
      >
        <div
          ref={ref}
          onKeyDownCapture={handleKeyDown}
          className={cn("relative", className)}
          role="region"
          aria-roledescription="carousel"
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    )
  }
)
Carousel.displayName = "Carousel"

const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { carouselRef, orientation } = useCarousel()

  return (
    <div ref={carouselRef} className="overflow-hidden">
      <div
        ref={ref}
        className={cn(
          "flex",
          orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col",
          className
        )}
        {...props}
      />
    </div>
  )
})
CarouselContent.displayName = "CarouselContent"

const CarouselItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { orientation } = useCarousel()

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      className={cn(
        "min-w-0 shrink-0 grow-0 basis-full",
        orientation === "horizontal" ? "pl-4" : "pt-4",
        className
      )}
      {...props}
    />
  )
})
CarouselItem.displayName = "CarouselItem"

const CarouselPrevious = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, variant = "outline", size = "icon", ...props }, ref) => {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel()

  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        "absolute  h-8 w-8 rounded-full",
        orientation === "horizontal"
          ? "-left-12 top-1/2 -translate-y-1/2"
          : "-top-12 left-1/2 -translate-x-1/2 rotate-90",
        className
      )}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="sr-only">Previous slide</span>
    </Button>
  )
})
CarouselPrevious.displayName = "CarouselPrevious"

const CarouselNext = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, variant = "outline", size = "icon", ...props }, ref) => {
  const { orientation, scrollNext, canScrollNext } = useCarousel()

  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        "absolute h-8 w-8 rounded-full",
        orientation === "horizontal"
          ? "-right-12 top-1/2 -translate-y-1/2"
          : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90",
        className
      )}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}
    >
      <ArrowRight className="h-4 w-4" />
      <span className="sr-only">Next slide</span>
    </Button>
  )
})
CarouselNext.displayName = "CarouselNext"

export {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
}

```


### `artifacts/inventory-portal/src/components/ui/chart.tsx` (367 lines)

```tsx
import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }

  return context
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig
    children: React.ComponentProps<
      typeof RechartsPrimitive.ResponsiveContainer
    >["children"]
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = "Chart"

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, config]) => config.theme || config.color
  )

  if (!colorConfig.length) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
      itemConfig.color
    return color ? `  --color-${key}: ${color};` : null
  })
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
    React.ComponentProps<"div"> & {
      hideLabel?: boolean
      hideIndicator?: boolean
      indicator?: "line" | "dot" | "dashed"
      nameKey?: string
      labelKey?: string
    }
>(
  (
    {
      active,
      payload,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey,
    },
    ref
  ) => {
    const { config } = useChart()

    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) {
        return null
      }

      const [item] = payload
      const key = `${labelKey || item?.dataKey || item?.name || "value"}`
      const itemConfig = getPayloadConfigFromPayload(config, item, key)
      const value =
        !labelKey && typeof label === "string"
          ? config[label as keyof typeof config]?.label || label
          : itemConfig?.label

      if (labelFormatter) {
        return (
          <div className={cn("font-medium", labelClassName)}>
            {labelFormatter(value, payload)}
          </div>
        )
      }

      if (!value) {
        return null
      }

      return <div className={cn("font-medium", labelClassName)}>{value}</div>
    }, [
      label,
      labelFormatter,
      payload,
      hideLabel,
      labelClassName,
      config,
      labelKey,
    ])

    if (!active || !payload?.length) {
      return null
    }

    const nestLabel = payload.length === 1 && indicator !== "dot"

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
          className
        )}
      >
        {!nestLabel ? tooltipLabel : null}
        <div className="grid gap-1.5">
          {payload
            .filter((item) => item.type !== "none")
            .map((item, index) => {
              const key = `${nameKey || item.name || item.dataKey || "value"}`
              const itemConfig = getPayloadConfigFromPayload(config, item, key)
              const indicatorColor = color || item.payload.fill || item.color

              return (
                <div
                  key={item.dataKey}
                  className={cn(
                    "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                    indicator === "dot" && "items-center"
                  )}
                >
                  {formatter && item?.value !== undefined && item.name ? (
                    formatter(item.value, item.name, item, index, item.payload)
                  ) : (
                    <>
                      {itemConfig?.icon ? (
                        <itemConfig.icon />
                      ) : (
                        !hideIndicator && (
                          <div
                            className={cn(
                              "shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]",
                              {
                                "h-2.5 w-2.5": indicator === "dot",
                                "w-1": indicator === "line",
                                "w-0 border-[1.5px] border-dashed bg-transparent":
                                  indicator === "dashed",
                                "my-0.5": nestLabel && indicator === "dashed",
                              }
                            )}
                            style={
                              {
                                "--color-bg": indicatorColor,
                                "--color-border": indicatorColor,
                              } as React.CSSProperties
                            }
                          />
                        )
                      )}
                      <div
                        className={cn(
                          "flex flex-1 justify-between leading-none",
                          nestLabel ? "items-end" : "items-center"
                        )}
                      >
                        <div className="grid gap-1.5">
                          {nestLabel ? tooltipLabel : null}
                          <span className="text-muted-foreground">
                            {itemConfig?.label || item.name}
                          </span>
                        </div>
                        {item.value && (
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {item.value.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
        </div>
      </div>
    )
  }
)
ChartTooltipContent.displayName = "ChartTooltip"

const ChartLegend = RechartsPrimitive.Legend

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> &
    Pick<RechartsPrimitive.LegendProps, "payload" | "verticalAlign"> & {
      hideIcon?: boolean
      nameKey?: string
    }
>(
  (
    { className, hideIcon = false, payload, verticalAlign = "bottom", nameKey },
    ref
  ) => {
    const { config } = useChart()

    if (!payload?.length) {
      return null
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center justify-center gap-4",
          verticalAlign === "top" ? "pb-3" : "pt-3",
          className
        )}
      >
        {payload
          .filter((item) => item.type !== "none")
          .map((item) => {
            const key = `${nameKey || item.dataKey || "value"}`
            const itemConfig = getPayloadConfigFromPayload(config, item, key)

            return (
              <div
                key={item.value}
                className={cn(
                  "flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
                )}
              >
                {itemConfig?.icon && !hideIcon ? (
                  <itemConfig.icon />
                ) : (
                  <div
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{
                      backgroundColor: item.color,
                    }}
                  />
                )}
                {itemConfig?.label}
              </div>
            )
          })}
      </div>
    )
  }
)
ChartLegendContent.displayName = "ChartLegend"

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
) {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const payloadPayload =
    "payload" in payload &&
    typeof payload.payload === "object" &&
    payload.payload !== null
      ? payload.payload
      : undefined

  let configLabelKey: string = key

  if (
    key in payload &&
    typeof payload[key as keyof typeof payload] === "string"
  ) {
    configLabelKey = payload[key as keyof typeof payload] as string
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[
      key as keyof typeof payloadPayload
    ] as string
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config]
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
}

```


### `artifacts/inventory-portal/src/components/ui/checkbox.tsx` (28 lines)

```tsx
import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("grid place-content-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }

```


### `artifacts/inventory-portal/src/components/ui/collapsible.tsx` (11 lines)

```tsx
"use client"

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }

```


### `artifacts/inventory-portal/src/components/ui/command.tsx` (153 lines)

```tsx
"use client"

import * as React from "react"
import { type DialogProps } from "@radix-ui/react-dialog"
import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent } from "@/components/ui/dialog"

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
      className
    )}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

const CommandDialog = ({ children, ...props }: DialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  </div>
))

CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
))

CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm"
    {...props}
  />
))

CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className
    )}
    {...props}
  />
))

CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
))
CommandSeparator.displayName = CommandPrimitive.Separator.displayName

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      className
    )}
    {...props}
  />
))

CommandItem.displayName = CommandPrimitive.Item.displayName

const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
CommandShortcut.displayName = "CommandShortcut"

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}

```


### `artifacts/inventory-portal/src/components/ui/context-menu.tsx` (198 lines)

```tsx
import * as React from "react"
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const ContextMenu = ContextMenuPrimitive.Root

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

const ContextMenuGroup = ContextMenuPrimitive.Group

const ContextMenuPortal = ContextMenuPrimitive.Portal

const ContextMenuSub = ContextMenuPrimitive.Sub

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </ContextMenuPrimitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-context-menu-content-transform-origin]",
      className
    )}
    {...props}
  />
))
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 max-h-[--radix-context-menu-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-context-menu-content-transform-origin]",
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
))
ContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Circle className="h-4 w-4 fill-current" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
))
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold text-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
ContextMenuShortcut.displayName = "ContextMenuShortcut"

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}

```


### `artifacts/inventory-portal/src/components/ui/dialog.tsx` (120 lines)

```tsx
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}

```


### `artifacts/inventory-portal/src/components/ui/drawer.tsx` (116 lines)

```tsx
import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"

const Drawer = ({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root
    shouldScaleBackground={shouldScaleBackground}
    {...props}
  />
)
Drawer.displayName = "Drawer"

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/80", className)}
    {...props}
  />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background",
        className
      )}
      {...props}
    >
      <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
))
DrawerContent.displayName = "DrawerContent"

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)}
    {...props}
  />
)
DrawerHeader.displayName = "DrawerHeader"

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
)
DrawerFooter.displayName = "DrawerFooter"

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}

```


### `artifacts/inventory-portal/src/components/ui/dropdown-menu.tsx` (201 lines)

```tsx
"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}

```


### `artifacts/inventory-portal/src/components/ui/empty.tsx` (104 lines)

```tsx
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 text-balance rounded-lg border-dashed p-6 text-center md:p-12",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className
      )}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("text-lg font-medium tracking-tight", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-balance text-sm",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}

```


### `artifacts/inventory-portal/src/components/ui/field.tsx` (244 lines)

```tsx
"use client"

import { useMemo } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "flex flex-col gap-6",
        "has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-3 font-medium",
        "data-[variant=legend]:text-base",
        "data-[variant=label]:text-sm",
        className
      )}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva(
  "group/field data-[invalid=true]:text-destructive flex w-full gap-3",
  {
    variants: {
      orientation: {
        vertical: ["flex-col [&>*]:w-full [&>.sr-only]:w-auto"],
        horizontal: [
          "flex-row items-center",
          "[&>[data-slot=field-label]]:flex-auto",
          "has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px has-[>[data-slot=field-content]]:items-start",
        ],
        responsive: [
          "@md/field-group:flex-row @md/field-group:items-center @md/field-group:[&>*]:w-auto flex-col [&>*]:w-full [&>.sr-only]:w-auto",
          "@md/field-group:[&>[data-slot=field-label]]:flex-auto",
          "@md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        ],
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "group/field-content flex flex-1 flex-col gap-1.5 leading-snug",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>[data-slot=field]]:p-4",
        "has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:border-primary dark:has-data-[state=checked]:bg-primary/10",
        className
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "flex w-fit items-center gap-2 text-sm font-medium leading-snug group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-muted-foreground text-sm font-normal leading-normal group-has-[[data-orientation=horizontal]]/field:text-balance",
        "nth-last-2:-mt-1 last:mt-0 [[data-variant=legend]+&]:-mt-1.5",
        "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="bg-background text-muted-foreground relative mx-auto block w-fit px-2"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors) {
      return null
    }

    if (errors?.length === 1 && errors[0]?.message) {
      return errors[0].message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {errors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-destructive text-sm font-normal", className)}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}

```


### `artifacts/inventory-portal/src/components/ui/form.tsx` (176 lines)

```tsx
import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { Slot } from "@radix-ui/react-slot"
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>")
  }

  if (!itemContext) {
    throw new Error("useFormField should be used within <FormItem>")
  }

  const fieldState = getFieldState(fieldContext.name, formState)

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue | null>(null)

const FormItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const id = React.useId()

  return (
    <FormItemContext.Provider value={{ id }}>
      <div ref={ref} className={cn("space-y-2", className)} {...props} />
    </FormItemContext.Provider>
  )
})
FormItem.displayName = "FormItem"

const FormLabel = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField()

  return (
    <Label
      ref={ref}
      className={cn(error && "text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  )
})
FormLabel.displayName = "FormLabel"

const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={
        !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={!!error}
      {...props}
    />
  )
})
FormControl.displayName = "FormControl"

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField()

  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn("text-[0.8rem] text-muted-foreground", className)}
      {...props}
    />
  )
})
FormDescription.displayName = "FormDescription"

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message ?? "") : children

  if (!body) {
    return null
  }

  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn("text-[0.8rem] font-medium text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  )
})
FormMessage.displayName = "FormMessage"

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
}

```


### `artifacts/inventory-portal/src/components/ui/hover-card.tsx` (27 lines)

```tsx
import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"

import { cn } from "@/lib/utils"

const HoverCard = HoverCardPrimitive.Root

const HoverCardTrigger = HoverCardPrimitive.Trigger

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-hover-card-content-transform-origin]",
      className
    )}
    {...props}
  />
))
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName

export { HoverCard, HoverCardTrigger, HoverCardContent }

```


### `artifacts/inventory-portal/src/components/ui/input-group.tsx` (168 lines)

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group border-input dark:bg-input/30 shadow-xs relative flex w-full items-center rounded-md border outline-none transition-[color,box-shadow]",
        "h-9 has-[>textarea]:h-auto",

        // Variants based on alignment.
        "has-[>[data-align=inline-start]]:[&>input]:pl-2",
        "has-[>[data-align=inline-end]]:[&>input]:pr-2",
        "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3",
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3",

        // Focus state.
        "has-[[data-slot=input-group-control]:focus-visible]:ring-ring has-[[data-slot=input-group-control]:focus-visible]:ring-1",

        // Error state.
        "has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[[data-slot][aria-invalid=true]]:border-destructive dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40",

        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "text-muted-foreground flex h-auto cursor-text select-none items-center justify-center gap-2 py-1.5 text-sm font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start":
          "order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]",
        "inline-end":
          "order-last pr-3 has-[>button]:mr-[-0.4rem] has-[>kbd]:mr-[-0.35rem]",
        "block-start":
          "[.border-b]:pb-3 order-first w-full justify-start px-3 pt-3 group-has-[>input]/input-group:pt-2.5",
        "block-end":
          "[.border-t]:pt-3 order-last w-full justify-start px-3 pb-3 group-has-[>input]/input-group:pb-2.5",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "flex items-center gap-2 text-sm shadow-none",
  {
    variants: {
      size: {
        xs: "h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5",
        "icon-xs":
          "size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0",
        "icon-sm": "size-8 p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-muted-foreground flex items-center gap-2 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}

```


### `artifacts/inventory-portal/src/components/ui/input-otp.tsx` (69 lines)

```tsx
import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"
import { Minus } from "lucide-react"

import { cn } from "@/lib/utils"

const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName
    )}
    className={cn("disabled:cursor-not-allowed", className)}
    {...props}
  />
))
InputOTP.displayName = "InputOTP"

const InputOTPGroup = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center", className)} {...props} />
))
InputOTPGroup.displayName = "InputOTPGroup"

const InputOTPSlot = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div"> & { index: number }
>(({ index, className, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index]

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center border-y border-r border-input text-sm shadow-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
        isActive && "z-10 ring-1 ring-ring",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  )
})
InputOTPSlot.displayName = "InputOTPSlot"

const InputOTPSeparator = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}>
    <Minus />
  </div>
))
InputOTPSeparator.displayName = "InputOTPSeparator"

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }

```


### `artifacts/inventory-portal/src/components/ui/input.tsx` (22 lines)

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

```


### `artifacts/inventory-portal/src/components/ui/item.tsx` (193 lines)

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="list"
      data-slot="item-group"
      className={cn("group/item-group flex flex-col", className)}
      {...props}
    />
  )
}

function ItemSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn("my-0", className)}
      {...props}
    />
  )
}

const itemVariants = cva(
  "group/item [a]:hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-ring/50 [a]:transition-colors flex flex-wrap items-center rounded-md border border-transparent text-sm outline-none transition-colors duration-100 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-border",
        muted: "bg-muted/50",
      },
      size: {
        default: "gap-4 p-4 ",
        sm: "gap-2.5 px-4 py-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Item({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof itemVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div"
  return (
    <Comp
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(itemVariants({ variant, size, className }))}
      {...props}
    />
  )
}

const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:translate-y-0.5 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted size-8 rounded-sm border [&_svg:not([class*='size-'])]:size-4",
        image:
          "size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function ItemMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        "flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none",
        className
      )}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        "flex w-fit items-center gap-2 text-sm font-medium leading-snug",
        className
      )}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "text-muted-foreground line-clamp-2 text-balance text-sm font-normal leading-normal",
        "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        "flex basis-full items-center justify-between gap-2",
        className
      )}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn(
        "flex basis-full items-center justify-between gap-2",
        className
      )}
      {...props}
    />
  )
}

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
}

```


### `artifacts/inventory-portal/src/components/ui/kbd.tsx` (28 lines)

```tsx
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "bg-muted text-muted-foreground pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm px-1 font-sans text-xs font-medium",
        "[&_svg:not([class*='size-'])]:size-3",
        "[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }

```


### `artifacts/inventory-portal/src/components/ui/label.tsx` (26 lines)

```tsx
"use client"

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }

```


### `artifacts/inventory-portal/src/components/ui/menubar.tsx` (254 lines)

```tsx
import * as React from "react"
import * as MenubarPrimitive from "@radix-ui/react-menubar"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

function MenubarMenu({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu {...props} />
}

function MenubarGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group {...props} />
}

function MenubarPortal({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal {...props} />
}

function MenubarRadioGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return <MenubarPrimitive.RadioGroup {...props} />
}

function MenubarSub({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />
}

const Menubar = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Root
    ref={ref}
    className={cn(
      "flex h-9 items-center space-x-1 rounded-md border bg-background p-1 shadow-sm",
      className
    )}
    {...props}
  />
))
Menubar.displayName = MenubarPrimitive.Root.displayName

const MenubarTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-3 py-1 text-sm font-medium outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      className
    )}
    {...props}
  />
))
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName

const MenubarSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <MenubarPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </MenubarPrimitive.SubTrigger>
))
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName

const MenubarSubContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-menubar-content-transform-origin]",
      className
    )}
    {...props}
  />
))
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName

const MenubarContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(
  (
    { className, align = "start", alignOffset = -4, sideOffset = 8, ...props },
    ref
  ) => (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content
        ref={ref}
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-menubar-content-transform-origin]",
          className
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  )
)
MenubarContent.displayName = MenubarPrimitive.Content.displayName

const MenubarItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
MenubarItem.displayName = MenubarPrimitive.Item.displayName

const MenubarCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <MenubarPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.CheckboxItem>
))
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName

const MenubarRadioItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Circle className="h-4 w-4 fill-current" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.RadioItem>
))
MenubarRadioItem.displayName = MenubarPrimitive.RadioItem.displayName

const MenubarLabel = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
MenubarLabel.displayName = MenubarPrimitive.Label.displayName

const MenubarSeparator = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName

const MenubarShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
MenubarShortcut.displayname = "MenubarShortcut"

export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarLabel,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarPortal,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarGroup,
  MenubarSub,
  MenubarShortcut,
}

```


### `artifacts/inventory-portal/src/components/ui/navigation-menu.tsx` (128 lines)

```tsx
import * as React from "react"
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu"
import { cva } from "class-variance-authority"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

const NavigationMenu = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Root
    ref={ref}
    className={cn(
      "relative z-10 flex max-w-max flex-1 items-center justify-center",
      className
    )}
    {...props}
  >
    {children}
    <NavigationMenuViewport />
  </NavigationMenuPrimitive.Root>
))
NavigationMenu.displayName = NavigationMenuPrimitive.Root.displayName

const NavigationMenuList = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.List>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.List
    ref={ref}
    className={cn(
      "group flex flex-1 list-none items-center justify-center space-x-1",
      className
    )}
    {...props}
  />
))
NavigationMenuList.displayName = NavigationMenuPrimitive.List.displayName

const NavigationMenuItem = NavigationMenuPrimitive.Item

const navigationMenuTriggerStyle = cva(
  "group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:text-accent-foreground data-[state=open]:bg-accent/50 data-[state=open]:hover:bg-accent data-[state=open]:focus:bg-accent"
)

const NavigationMenuTrigger = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Trigger
    ref={ref}
    className={cn(navigationMenuTriggerStyle(), "group", className)}
    {...props}
  >
    {children}{" "}
    <ChevronDown
      className="relative top-[1px] ml-1 h-3 w-3 transition duration-300 group-data-[state=open]:rotate-180"
      aria-hidden="true"
    />
  </NavigationMenuPrimitive.Trigger>
))
NavigationMenuTrigger.displayName = NavigationMenuPrimitive.Trigger.displayName

const NavigationMenuContent = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Content
    ref={ref}
    className={cn(
      "left-0 top-0 w-full data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52 data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52 md:absolute md:w-auto ",
      className
    )}
    {...props}
  />
))
NavigationMenuContent.displayName = NavigationMenuPrimitive.Content.displayName

const NavigationMenuLink = NavigationMenuPrimitive.Link

const NavigationMenuViewport = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <div className={cn("absolute left-0 top-full flex justify-center")}>
    <NavigationMenuPrimitive.Viewport
      className={cn(
        "origin-top-center relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 md:w-[var(--radix-navigation-menu-viewport-width)]",
        className
      )}
      ref={ref}
      {...props}
    />
  </div>
))
NavigationMenuViewport.displayName =
  NavigationMenuPrimitive.Viewport.displayName

const NavigationMenuIndicator = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Indicator>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Indicator>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Indicator
    ref={ref}
    className={cn(
      "top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden data-[state=visible]:animate-in data-[state=hidden]:animate-out data-[state=hidden]:fade-out data-[state=visible]:fade-in",
      className
    )}
    {...props}
  >
    <div className="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-border shadow-md" />
  </NavigationMenuPrimitive.Indicator>
))
NavigationMenuIndicator.displayName =
  NavigationMenuPrimitive.Indicator.displayName

export {
  navigationMenuTriggerStyle,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
}

```


### `artifacts/inventory-portal/src/components/ui/pagination.tsx` (117 lines)

```tsx
import * as React from "react"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { ButtonProps, buttonVariants } from "@/components/ui/button"

const Pagination = ({ className, ...props }: React.ComponentProps<"nav">) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn("mx-auto flex w-full justify-center", className)}
    {...props}
  />
)
Pagination.displayName = "Pagination"

const PaginationContent = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-row items-center gap-1", className)}
    {...props}
  />
))
PaginationContent.displayName = "PaginationContent"

const PaginationItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("", className)} {...props} />
))
PaginationItem.displayName = "PaginationItem"

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<ButtonProps, "size"> &
  React.ComponentProps<"a">

const PaginationLink = ({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? "outline" : "ghost",
        size,
      }),
      className
    )}
    {...props}
  />
)
PaginationLink.displayName = "PaginationLink"

const PaginationPrevious = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to previous page"
    size="default"
    className={cn("gap-1 pl-2.5", className)}
    {...props}
  >
    <ChevronLeft className="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
)
PaginationPrevious.displayName = "PaginationPrevious"

const PaginationNext = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to next page"
    size="default"
    className={cn("gap-1 pr-2.5", className)}
    {...props}
  >
    <span>Next</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
)
PaginationNext.displayName = "PaginationNext"

const PaginationEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    aria-hidden
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
)
PaginationEllipsis.displayName = "PaginationEllipsis"

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}

```


### `artifacts/inventory-portal/src/components/ui/popover.tsx` (31 lines)

```tsx
import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }

```


### `artifacts/inventory-portal/src/components/ui/progress.tsx` (28 lines)

```tsx
"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }

```


### `artifacts/inventory-portal/src/components/ui/radio-group.tsx` (42 lines)

```tsx
import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-primary text-primary shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle className="h-3.5 w-3.5 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }

```


### `artifacts/inventory-portal/src/components/ui/resizable.tsx` (45 lines)

```tsx
"use client"

import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
)

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }

```


### `artifacts/inventory-portal/src/components/ui/scroll-area.tsx` (46 lines)

```tsx
import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }

```


### `artifacts/inventory-portal/src/components/ui/select.tsx` (159 lines)

```tsx
"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}

```


### `artifacts/inventory-portal/src/components/ui/separator.tsx` (29 lines)

```tsx
import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }

```


### `artifacts/inventory-portal/src/components/ui/sheet.tsx` (140 lines)

```tsx
"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}

```


### `artifacts/inventory-portal/src/components/ui/sidebar.tsx` (727 lines)

```tsx
"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, VariantProps } from "class-variance-authority"
import { PanelLeftIcon } from "lucide-react"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "bg-sidebar text-sidebar-foreground flex h-full w-[var(--sidebar-width)] flex-col",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="bg-sidebar text-sidebar-foreground w-[var(--sidebar-width)] p-0 [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-[var(--sidebar-width)] bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+var(--spacing-4))]"
            : "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]"
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear md:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+var(--spacing-4)+2px)]"
            : "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  // Note: Tailwind v3.4 doesn't support "in-" selectors. So the rail won't work perfectly.
  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "bg-background relative flex w-full flex-1 flex-col",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("bg-background h-8 w-full shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("bg-sidebar-border mx-2 w-auto", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:w-8! group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  showOnHover?: boolean
}) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  }, [])

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-[var(--skeleton-width)] flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "border-sidebar-border mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
  size?: "sm" | "md"
  isActive?: boolean
}) {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 outline outline-2 outline-transparent outline-offset-2 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}

```


### `artifacts/inventory-portal/src/components/ui/skeleton.tsx` (15 lines)

```tsx
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  )
}

export { Skeleton }

```


### `artifacts/inventory-portal/src/components/ui/slider.tsx` (26 lines)

```tsx
import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }

```


### `artifacts/inventory-portal/src/components/ui/sonner.tsx` (31 lines)

```tsx
"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

```


### `artifacts/inventory-portal/src/components/ui/spinner.tsx` (19 lines)

```tsx
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2>) {
  return (
    <Loader2 className={cn("animate-spin text-primary", className)} {...props} />
  );
}

export function FullScreenSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="h-10 w-10" />
        <p className="text-sm text-muted-foreground font-medium animate-pulse">Loading workspace...</p>
      </div>
    </div>
  );
}

```


### `artifacts/inventory-portal/src/components/ui/switch.tsx` (27 lines)

```tsx
import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }

```


### `artifacts/inventory-portal/src/components/ui/table.tsx` (120 lines)

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

```


### `artifacts/inventory-portal/src/components/ui/tabs.tsx` (53 lines)

```tsx
import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }

```


### `artifacts/inventory-portal/src/components/ui/textarea.tsx` (22 lines)

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }

```


### `artifacts/inventory-portal/src/components/ui/toaster.tsx` (33 lines)

```tsx
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}

```


### `artifacts/inventory-portal/src/components/ui/toast.tsx` (127 lines)

```tsx
import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}

```


### `artifacts/inventory-portal/src/components/ui/toggle-group.tsx` (61 lines)

```tsx
"use client"

import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
})

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("flex items-center justify-center gap-1", className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
))

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
})

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }

```


### `artifacts/inventory-portal/src/components/ui/toggle.tsx` (43 lines)

```tsx
import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))

Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle, toggleVariants }

```


### `artifacts/inventory-portal/src/components/ui/tooltip.tsx` (32 lines)

```tsx
"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

```


---

## Mockup Sandbox


### `artifacts/mockup-sandbox/package.json` (74 lines)

```json
{
  "name": "@workspace/mockup-sandbox",
  "version": "2.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.12",
    "@radix-ui/react-alert-dialog": "^1.1.15",
    "@radix-ui/react-aspect-ratio": "^1.1.8",
    "@radix-ui/react-avatar": "^1.1.11",
    "@radix-ui/react-checkbox": "^1.3.3",
    "@radix-ui/react-collapsible": "^1.1.12",
    "@radix-ui/react-context-menu": "^2.2.16",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-hover-card": "^1.1.15",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-menubar": "^1.1.16",
    "@radix-ui/react-navigation-menu": "^1.2.14",
    "@radix-ui/react-popover": "^1.1.15",
    "@radix-ui/react-progress": "^1.1.8",
    "@radix-ui/react-radio-group": "^1.3.8",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slider": "^1.3.6",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-switch": "^1.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.10",
    "@radix-ui/react-toggle-group": "^1.1.11",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@replit/vite-plugin-cartographer": "catalog:",
    "@replit/vite-plugin-runtime-error-modal": "catalog:",
    "@tailwindcss/vite": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "chokidar": "^4.0.3",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "cmdk": "^1.1.1",
    "date-fns": "^3.6.0",
    "embla-carousel-react": "^8.6.0",
    "fast-glob": "^3.3.3",
    "framer-motion": "catalog:",
    "input-otp": "^1.4.2",
    "lucide-react": "catalog:",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-day-picker": "^9.11.1",
    "react-dom": "catalog:",
    "react-hook-form": "^7.66.0",
    "react-resizable-panels": "^2.1.9",
    "recharts": "^2.15.4",
    "sonner": "^2.0.7",
    "tailwind-merge": "catalog:",
    "tailwindcss": "catalog:",
    "tailwindcss-animate": "^1.0.7",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "vite": "catalog:",
    "zod": "catalog:"
  }
}

```


### `artifacts/mockup-sandbox/tsconfig.json` (16 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "mockupPreviewPlugin.ts", "vite.config.ts"],
  "exclude": ["node_modules", "build", "dist", "**/*.test.ts"],
  "compilerOptions": {
    "noEmit": true,
    "lib": ["es2022", "dom", "dom.iterable"],
    "jsx": "preserve",
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "types": ["node", "vite/client"],
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}

```


### `artifacts/mockup-sandbox/vite.config.ts` (72 lines)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

```


### `artifacts/mockup-sandbox/mockupPreviewPlugin.ts` (180 lines)

```typescript
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import glob from "fast-glob";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { Plugin } from "vite";

const MOCKUPS_DIR = "src/components/mockups";
const GENERATED_MODULE = "src/.generated/mockup-components.ts";

interface DiscoveredComponent {
  globKey: string;
  importPath: string;
}

export function mockupPreviewPlugin(): Plugin {
  let root = "";
  let currentSource = "";
  let watcher: FSWatcher | null = null;

  function getMockupsAbsDir(): string {
    return path.join(root, MOCKUPS_DIR);
  }

  function getGeneratedModuleAbsPath(): string {
    return path.join(root, GENERATED_MODULE);
  }

  function isMockupFile(absolutePath: string): boolean {
    const rel = path.relative(getMockupsAbsDir(), absolutePath);
    return (
      !rel.startsWith("..") && !path.isAbsolute(rel) && rel.endsWith(".tsx")
    );
  }

  function isPreviewTarget(relativeToMockups: string): boolean {
    return relativeToMockups
      .split(path.sep)
      .every((segment) => !segment.startsWith("_"));
  }

  async function discoverComponents(): Promise<Array<DiscoveredComponent>> {
    const files = await glob(`${MOCKUPS_DIR}/**/*.tsx`, {
      cwd: root,
      ignore: ["**/_*/**", "**/_*.tsx"],
    });

    return files.map((f) => ({
      globKey: "./" + f.slice("src/".length),
      importPath: path.posix.relative("src/.generated", f),
    }));
  }

  function generateSource(components: Array<DiscoveredComponent>): string {
    const entries = components
      .map(
        (c) =>
          `  ${JSON.stringify(c.globKey)}: () => import(${JSON.stringify(c.importPath)})`,
      )
      .join(",\n");

    return [
      "// This file is auto-generated by mockupPreviewPlugin.ts.",
      "type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;",
      "export const modules: ModuleMap = {",
      entries,
      "};",
      "",
    ].join("\n");
  }

  function shouldAutoRescan(pathname: string): boolean {
    return (
      pathname.includes("/components/mockups/") ||
      pathname.includes("/.generated/mockup-components")
    );
  }

  let refreshInFlight = false;
  let refreshQueued = false;

  async function refresh(): Promise<boolean> {
    if (refreshInFlight) {
      refreshQueued = true;
      return false;
    }

    refreshInFlight = true;
    let changed = false;
    try {
      const components = await discoverComponents();
      const newSource = generateSource(components);
      if (newSource !== currentSource) {
        currentSource = newSource;
        const generatedModuleAbsPath = getGeneratedModuleAbsPath();
        mkdirSync(path.dirname(generatedModuleAbsPath), { recursive: true });
        writeFileSync(generatedModuleAbsPath, currentSource);
        changed = true;
      }
    } finally {
      refreshInFlight = false;
    }

    if (refreshQueued) {
      refreshQueued = false;
      const followUp = await refresh();
      return changed || followUp;
    }

    return changed;
  }

  async function onFileAddedOrRemoved(): Promise<void> {
    await refresh();
  }

  return {
    name: "mockup-preview",
    enforce: "pre",

    configResolved(config) {
      root = config.root;
    },

    async buildStart() {
      await refresh();
    },

    async configureServer(viteServer) {
      await refresh();

      const mockupsAbsDir = getMockupsAbsDir();
      mkdirSync(mockupsAbsDir, { recursive: true });

      watcher = chokidar.watch(mockupsAbsDir, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      });

      watcher.on("add", (file) => {
        if (
          isMockupFile(file) &&
          isPreviewTarget(path.relative(mockupsAbsDir, file))
        ) {
          void onFileAddedOrRemoved();
        }
      });

      watcher.on("unlink", (file) => {
        if (isMockupFile(file)) {
          void onFileAddedOrRemoved();
        }
      });

      viteServer.middlewares.use((req, res, next) => {
        const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        const pathname = requestUrl.pathname;
        const originalEnd = res.end.bind(res);

        res.end = ((...args: Parameters<typeof originalEnd>) => {
          if (res.statusCode === 404 && shouldAutoRescan(pathname)) {
            void refresh();
          }
          return originalEnd(...args);
        }) as typeof res.end;

        next();
      });
    },

    async closeWatcher() {
      if (watcher) {
        await watcher.close();
      }
    },
  };
}

```


### `artifacts/mockup-sandbox/index.html` (31 lines)

```html
<!DOCTYPE html>
<!--
  This file is the entry for ALL routes, including /preview/* canvas iframes.
  Fonts are loaded here as non-blocking <link> tags (not CSS @import, which is render-blocking).
-->
<html lang="en" style="height: 100%">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />

    <meta property="og:title" content="Mockup Canvas" />
    <meta property="og:description" content="UI prototyping sandbox with infinite canvas" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Mockup Canvas" />
    <meta name="twitter:description" content="UI prototyping sandbox with infinite canvas" />

    <title>Mockup Canvas</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎨</text></svg>">
    <!-- Non-blocking font bundle: renders with fallback fonts immediately, swaps in when loaded -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" media="print" onload="this.media='all'"
          href="https://fonts.googleapis.com/css2?family=Architects+Daughter&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Fira+Code:wght@300..700&family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=IBM+Plex+Sans:ital,wght@0,100..700;1,100..700&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400..700;1,400..700&family=Merriweather:ital,opsz,wght@0,18..144,300..900;1,18..144,300..900&family=Montserrat:ital,wght@0,100..900;1,100..900&family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Outfit:wght@100..900&family=Oxanium:wght@200..800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Roboto+Mono:ital,wght@0,100..700;1,100..700&family=Roboto:ital,wght@0,100..900;1,100..900&family=Source+Code+Pro:ital,wght@0,200..900;1,200..900&family=Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900&family=Space+Grotesk:wght@300..700&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Architects+Daughter&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Fira+Code:wght@300..700&family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=IBM+Plex+Sans:ital,wght@0,100..700;1,100..700&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400..700;1,400..700&family=Merriweather:ital,opsz,wght@0,18..144,300..900;1,18..144,300..900&family=Montserrat:ital,wght@0,100..900;1,100..900&family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Outfit:wght@100..900&family=Oxanium:wght@200..800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Roboto+Mono:ital,wght@0,100..700;1,100..700&family=Roboto:ital,wght@0,100..900;1,100..900&family=Source+Code+Pro:ital,wght@0,200..900;1,200..900&family=Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900&family=Space+Grotesk:wght@300..700&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"></noscript>
  </head>
  <body style="height: 100%; margin: 0">
    <div id="root" style="height: 100%"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```


### `artifacts/mockup-sandbox/src/main.tsx` (5 lines)

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

```


### `artifacts/mockup-sandbox/src/App.tsx` (146 lines)

```tsx
import { useEffect, useState, type ComponentType } from "react";

import { modules as discoveredModules } from "./.generated/mockup-components";

type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;

function _resolveComponent(
  mod: Record<string, unknown>,
  name: string,
): ComponentType | undefined {
  const fns = Object.values(mod).filter(
    (v) => typeof v === "function",
  ) as ComponentType[];
  return (
    (mod.default as ComponentType) ||
    (mod.Preview as ComponentType) ||
    (mod[name] as ComponentType) ||
    fns[fns.length - 1]
  );
}

function PreviewRenderer({
  componentPath,
  modules,
}: {
  componentPath: string;
  modules: ModuleMap;
}) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setComponent(null);
    setError(null);

    async function loadComponent(): Promise<void> {
      const key = `./components/mockups/${componentPath}.tsx`;
      const loader = modules[key];
      if (!loader) {
        setError(`No component found at ${componentPath}.tsx`);
        return;
      }

      try {
        const mod = await loader();
        if (cancelled) {
          return;
        }
        const name = componentPath.split("/").pop()!;
        const comp = _resolveComponent(mod, name);
        if (!comp) {
          setError(
            `No exported React component found in ${componentPath}.tsx\n\nMake sure the file has at least one exported function component.`,
          );
          return;
        }
        setComponent(() => comp);
      } catch (e) {
        if (cancelled) {
          return;
        }

        const message = e instanceof Error ? e.message : String(e);
        setError(`Failed to load preview.\n${message}`);
      }
    }

    void loadComponent();

    return () => {
      cancelled = true;
    };
  }, [componentPath, modules]);

  if (error) {
    return (
      <pre style={{ color: "red", padding: "2rem", fontFamily: "system-ui" }}>
        {error}
      </pre>
    );
  }

  if (!Component) return null;

  return <Component />;
}

function getBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function getPreviewExamplePath(): string {
  const basePath = getBasePath();
  return `${basePath}/preview/ComponentName`;
}

function Gallery() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">
          Component Preview Server
        </h1>
        <p className="text-gray-500 mb-4">
          This server renders individual components for the workspace canvas.
        </p>
        <p className="text-sm text-gray-400">
          Access component previews at{" "}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
            {getPreviewExamplePath()}
          </code>
        </p>
      </div>
    </div>
  );
}

function getPreviewPath(): string | null {
  const basePath = getBasePath();
  const { pathname } = window.location;
  const local =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  const match = local.match(/^\/preview\/(.+)$/);
  return match ? match[1] : null;
}

function App() {
  const previewPath = getPreviewPath();

  if (previewPath) {
    return (
      <PreviewRenderer
        componentPath={previewPath}
        modules={discoveredModules}
      />
    );
  }

  return <Gallery />;
}

export default App;

```


### `artifacts/mockup-sandbox/src/.generated/mockup-components.ts` (5 lines)

```typescript
// This file is auto-generated by mockupPreviewPlugin.ts.
type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;
export const modules: ModuleMap = {

};

```


> **Note:** mockup-sandbox/src/components/ui/ contains the same shadcn/ui components as inventory-portal. Omitted to avoid duplication.

---

## API Client React


### `lib/api-client-react/package.json` (15 lines)

```json
{
  "name": "@workspace/api-client-react",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@tanstack/react-query": "catalog:"
  },
  "peerDependencies": {
    "react": ">=18"
  }
}

```


### `lib/api-client-react/tsconfig.json` (12 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["dom", "es2022"]
  },
  "include": ["src"]
}

```


### `lib/api-client-react/src/index.ts` (4 lines)

```typescript
export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

```


### `lib/api-client-react/src/custom-fetch.ts` (368 lines)

```typescript
export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const response = await fetch(input, { ...init, method, headers });

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}

```


### `lib/api-client-react/src/generated/api.schemas.ts` (224 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
export interface HealthStatus {
  status: string;
}

export interface User {
  email: string;
  name: string;
  picture?: string;
  isOwner: boolean;
  role: string;
}

export interface InventoryItem {
  location: string;
  vehicle: string;
  vin: string;
  price: string;
  km?: string;
  carfax?: string;
  website?: string;
  onlinePrice?: string;
  matrixPrice?: string | null;
  cost?: string | null;
  bbAvgWholesale?: string | null;
}

export interface CacheStatus {
  lastUpdated?: string | null;
  isRefreshing: boolean;
  count: number;
}

export interface VehicleImages {
  vin: string;
  urls: string[];
}

export interface AccessEntry {
  email: string;
  addedAt: string;
  addedBy: string;
  role: string;
}

export interface AddAccessRequest {
  email: string;
  role?: string;
}

export interface UpdateAccessRoleRequest {
  role: string;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  targetEmail: string;
  changedBy: string;
  roleFrom?: string | null;
  roleTo?: string | null;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
}

export interface SuccessResponse {
  ok: boolean;
}

export interface LenderProgramTier {
  tierName: string;
  minRate: number;
  maxRate: number;
  maxPayment: number;
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  creditorFee: number;
  dealerReserve: number;
}

export interface VehicleTermMatrixData {
  term: number;
  kmFrom: number;
  kmTo: number;
}

export interface VehicleTermMatrixEntry {
  year: number;
  data: VehicleTermMatrixData[];
}

export interface KmRange {
  kmFrom: number;
  kmTo: number;
}

export interface VehicleConditionMatrixEntry {
  year: number;
  extraClean: KmRange;
  clean: KmRange;
  average: KmRange;
  rough: KmRange;
}

export interface LenderProgramGuide {
  programId: string;
  programTitle: string;
  programType: string;
  tiers: LenderProgramTier[];
  vehicleTermMatrix: VehicleTermMatrixEntry[];
  vehicleConditionMatrix: VehicleConditionMatrixEntry[];
  maxTerm?: number;
  maxWarrantyPrice?: number | null;
  maxGapPrice?: number | null;
  maxAdminFee?: number | null;
}

export interface LenderProgram {
  lenderCode: string;
  lenderName: string;
  creditorId: string;
  programs: LenderProgramGuide[];
}

export interface LenderProgramsResponse {
  programs: LenderProgram[];
  updatedAt?: string | null;
  role?: string;
}

export interface LenderStatus {
  running: boolean;
  startedAt?: string | null;
  lastRun?: string | null;
  lenderCount: number;
  error?: string | null;
  programsAge?: string | null;
}

export interface LenderCalculateRequest {
  lenderCode: string;
  programId: string;
  tierName: string;
  approvedRate: number;
  maxPaymentOverride?: number;
  downPayment?: number;
  tradeValue?: number;
  tradeLien?: number;
  taxRate?: number;
  adminFee?: number;
  /** 0, 6, or 12 — months added to matrix term */
  termStretchMonths?: number;
  /** When true, include vehicles that need extra cash down to meet LTV / max payment */
  showAllWithDownPayment?: boolean;
}

export interface LenderCalcResultItem {
  vin: string;
  vehicle: string;
  location: string;
  term: number;
  /** Vehicle term from lender matrix before exception stretch */
  matrixTerm?: number;
  /** Effective months added (0 / 6 / 12) after 84-month cap rules */
  termStretchApplied?: 0 | 6 | 12;
  /** When stretch was reduced (e.g. 78 cannot use +12; 84 matrix cannot stretch) */
  termStretchCappedReason?: string;
  conditionUsed: string;
  bbWholesale: number;
  sellingPrice: number;
  priceSource: string;
  adminFeeUsed: number;
  warrantyPrice: number;
  warrantyCost: number;
  gapPrice: number;
  gapCost: number;
  totalFinanced: number;
  monthlyPayment: number;
  profit: number;
  /** Target profit the deal aims to achieve (onlinePrice - pacCost for PATH A, 0 for PATH B) */
  profitTarget: number;
  /** 1 = full deal at selling price, 2 = reduced price with product-based profit recovery */
  qualificationTier: 1 | 2;
  hasPhotos?: boolean;
  website?: string;
  termStretched?: boolean;
  /** Extra cash down (beyond base downPayment) needed to fit program when showAllWithDownPayment is on */
  requiredDownPayment?: number;
}

export interface ProgramLimits {
  maxWarrantyPrice?: number | null;
  maxGapPrice?: number | null;
  maxAdminFee?: number | null;
  gapAllowed: boolean;
}

export interface LenderCalculateResponse {
  lender: string;
  program: string;
  tier: string;
  /** Echo: effective term stretch (0, 6, or 12 months added to matrix term) */
  termStretchMonths?: 0 | 6 | 12;
  /** Echo: server parsed show-all mode (see request `showAllWithDownPayment`) */
  showAllWithDownPayment?: boolean;
  tierConfig: LenderProgramTier;
  programLimits?: ProgramLimits;
  resultCount: number;
  results: LenderCalcResultItem[];
}

export type GetVehicleImagesParams = {
  vin: string;
};

```


### `lib/api-client-react/src/generated/api.ts` (1154 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MutationFunction,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";

import type {
  AccessEntry,
  AddAccessRequest,
  AuditLogEntry,
  CacheStatus,
  ErrorResponse,
  GetVehicleImagesParams,
  HealthStatus,
  InventoryItem,
  LenderCalculateRequest,
  LenderCalculateResponse,
  LenderProgramsResponse,
  LenderStatus,
  SuccessResponse,
  UpdateAccessRoleRequest,
  User,
  VehicleImages,
} from "./api.schemas";

import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";

type AwaitedInput<T> = PromiseLike<T> | T;

type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;

type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

/**
 * @summary Health check
 */
export const getHealthCheckUrl = () => {
  return `/api/healthz`;
};

export const healthCheck = async (
  options?: RequestInit,
): Promise<HealthStatus> => {
  return customFetch<HealthStatus>(getHealthCheckUrl(), {
    ...options,
    method: "GET",
  });
};

export const getHealthCheckQueryKey = () => {
  return [`/api/healthz`] as const;
};

export const getHealthCheckQueryOptions = <
  TData = Awaited<ReturnType<typeof healthCheck>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getHealthCheckQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof healthCheck>>> = ({
    signal,
  }) => healthCheck({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type HealthCheckQueryResult = NonNullable<
  Awaited<ReturnType<typeof healthCheck>>
>;
export type HealthCheckQueryError = ErrorType<unknown>;

/**
 * @summary Health check
 */

export function useHealthCheck<
  TData = Awaited<ReturnType<typeof healthCheck>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getHealthCheckQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get current authenticated user
 */
export const getGetMeUrl = () => {
  return `/api/me`;
};

export const getMe = async (options?: RequestInit): Promise<User> => {
  return customFetch<User>(getGetMeUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetMeQueryKey = () => {
  return [`/api/me`] as const;
};

export const getGetMeQueryOptions = <
  TData = Awaited<ReturnType<typeof getMe>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetMeQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getMe>>> = ({
    signal,
  }) => getMe({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getMe>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetMeQueryResult = NonNullable<Awaited<ReturnType<typeof getMe>>>;
export type GetMeQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get current authenticated user
 */

export function useGetMe<
  TData = Awaited<ReturnType<typeof getMe>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetMeQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get all inventory items
 */
export const getGetInventoryUrl = () => {
  return `/api/inventory`;
};

export const getInventory = async (
  options?: RequestInit,
): Promise<InventoryItem[]> => {
  return customFetch<InventoryItem[]>(getGetInventoryUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetInventoryQueryKey = () => {
  return [`/api/inventory`] as const;
};

export const getGetInventoryQueryOptions = <
  TData = Awaited<ReturnType<typeof getInventory>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getInventory>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetInventoryQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getInventory>>> = ({
    signal,
  }) => getInventory({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getInventory>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetInventoryQueryResult = NonNullable<
  Awaited<ReturnType<typeof getInventory>>
>;
export type GetInventoryQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get all inventory items
 */

export function useGetInventory<
  TData = Awaited<ReturnType<typeof getInventory>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getInventory>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetInventoryQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get the timestamp of the last inventory cache refresh
 */
export const getGetCacheStatusUrl = () => {
  return `/api/cache-status`;
};

export const getCacheStatus = async (
  options?: RequestInit,
): Promise<CacheStatus> => {
  return customFetch<CacheStatus>(getGetCacheStatusUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetCacheStatusQueryKey = () => {
  return [`/api/cache-status`] as const;
};

export const getGetCacheStatusQueryOptions = <
  TData = Awaited<ReturnType<typeof getCacheStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCacheStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetCacheStatusQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getCacheStatus>>> = ({
    signal,
  }) => getCacheStatus({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getCacheStatus>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetCacheStatusQueryResult = NonNullable<
  Awaited<ReturnType<typeof getCacheStatus>>
>;
export type GetCacheStatusQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get the timestamp of the last inventory cache refresh
 */

export function useGetCacheStatus<
  TData = Awaited<ReturnType<typeof getCacheStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCacheStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetCacheStatusQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get photo gallery URLs for a vehicle by VIN
 */
export const getGetVehicleImagesUrl = (params: GetVehicleImagesParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/vehicle-images?${stringifiedParams}`
    : `/api/vehicle-images`;
};

export const getVehicleImages = async (
  params: GetVehicleImagesParams,
  options?: RequestInit,
): Promise<VehicleImages> => {
  return customFetch<VehicleImages>(getGetVehicleImagesUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getGetVehicleImagesQueryKey = (
  params?: GetVehicleImagesParams,
) => {
  return [`/api/vehicle-images`, ...(params ? [params] : [])] as const;
};

export const getGetVehicleImagesQueryOptions = <
  TData = Awaited<ReturnType<typeof getVehicleImages>>,
  TError = ErrorType<ErrorResponse>,
>(
  params: GetVehicleImagesParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getVehicleImages>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getGetVehicleImagesQueryKey(params);

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getVehicleImages>>
  > = ({ signal }) => getVehicleImages(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getVehicleImages>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetVehicleImagesQueryResult = NonNullable<
  Awaited<ReturnType<typeof getVehicleImages>>
>;
export type GetVehicleImagesQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get photo gallery URLs for a vehicle by VIN
 */

export function useGetVehicleImages<
  TData = Awaited<ReturnType<typeof getVehicleImages>>,
  TError = ErrorType<ErrorResponse>,
>(
  params: GetVehicleImagesParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getVehicleImages>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetVehicleImagesQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get list of approved emails (owner only)
 */
export const getGetAccessListUrl = () => {
  return `/api/access`;
};

export const getAccessList = async (
  options?: RequestInit,
): Promise<AccessEntry[]> => {
  return customFetch<AccessEntry[]>(getGetAccessListUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetAccessListQueryKey = () => {
  return [`/api/access`] as const;
};

export const getGetAccessListQueryOptions = <
  TData = Awaited<ReturnType<typeof getAccessList>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getAccessList>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetAccessListQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getAccessList>>> = ({
    signal,
  }) => getAccessList({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getAccessList>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetAccessListQueryResult = NonNullable<
  Awaited<ReturnType<typeof getAccessList>>
>;
export type GetAccessListQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get list of approved emails (owner only)
 */

export function useGetAccessList<
  TData = Awaited<ReturnType<typeof getAccessList>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getAccessList>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetAccessListQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Add an email to the access list (owner only)
 */
export const getAddAccessEntryUrl = () => {
  return `/api/access`;
};

export const addAccessEntry = async (
  addAccessRequest: AddAccessRequest,
  options?: RequestInit,
): Promise<AccessEntry> => {
  return customFetch<AccessEntry>(getAddAccessEntryUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(addAccessRequest),
  });
};

export const getAddAccessEntryMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof addAccessEntry>>,
    TError,
    { data: BodyType<AddAccessRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof addAccessEntry>>,
  TError,
  { data: BodyType<AddAccessRequest> },
  TContext
> => {
  const mutationKey = ["addAccessEntry"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof addAccessEntry>>,
    { data: BodyType<AddAccessRequest> }
  > = (props) => {
    const { data } = props ?? {};

    return addAccessEntry(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type AddAccessEntryMutationResult = NonNullable<
  Awaited<ReturnType<typeof addAccessEntry>>
>;
export type AddAccessEntryMutationBody = BodyType<AddAccessRequest>;
export type AddAccessEntryMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Add an email to the access list (owner only)
 */
export const useAddAccessEntry = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof addAccessEntry>>,
    TError,
    { data: BodyType<AddAccessRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof addAccessEntry>>,
  TError,
  { data: BodyType<AddAccessRequest> },
  TContext
> => {
  return useMutation(getAddAccessEntryMutationOptions(options));
};

/**
 * @summary Update a user's role (owner only)
 */
export const getUpdateAccessRoleUrl = (email: string) => {
  return `/api/access/${email}`;
};

export const updateAccessRole = async (
  email: string,
  updateAccessRoleRequest: UpdateAccessRoleRequest,
  options?: RequestInit,
): Promise<AccessEntry> => {
  return customFetch<AccessEntry>(getUpdateAccessRoleUrl(email), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(updateAccessRoleRequest),
  });
};

export const getUpdateAccessRoleMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateAccessRole>>,
    TError,
    { email: string; data: BodyType<UpdateAccessRoleRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateAccessRole>>,
  TError,
  { email: string; data: BodyType<UpdateAccessRoleRequest> },
  TContext
> => {
  const mutationKey = ["updateAccessRole"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateAccessRole>>,
    { email: string; data: BodyType<UpdateAccessRoleRequest> }
  > = (props) => {
    const { email, data } = props ?? {};

    return updateAccessRole(email, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateAccessRoleMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateAccessRole>>
>;
export type UpdateAccessRoleMutationBody = BodyType<UpdateAccessRoleRequest>;
export type UpdateAccessRoleMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Update a user's role (owner only)
 */
export const useUpdateAccessRole = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateAccessRole>>,
    TError,
    { email: string; data: BodyType<UpdateAccessRoleRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateAccessRole>>,
  TError,
  { email: string; data: BodyType<UpdateAccessRoleRequest> },
  TContext
> => {
  return useMutation(getUpdateAccessRoleMutationOptions(options));
};

/**
 * @summary Remove an email from the access list (owner only)
 */
export const getRemoveAccessEntryUrl = (email: string) => {
  return `/api/access/${email}`;
};

export const removeAccessEntry = async (
  email: string,
  options?: RequestInit,
): Promise<SuccessResponse> => {
  return customFetch<SuccessResponse>(getRemoveAccessEntryUrl(email), {
    ...options,
    method: "DELETE",
  });
};

export const getRemoveAccessEntryMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof removeAccessEntry>>,
    TError,
    { email: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof removeAccessEntry>>,
  TError,
  { email: string },
  TContext
> => {
  const mutationKey = ["removeAccessEntry"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof removeAccessEntry>>,
    { email: string }
  > = (props) => {
    const { email } = props ?? {};

    return removeAccessEntry(email, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RemoveAccessEntryMutationResult = NonNullable<
  Awaited<ReturnType<typeof removeAccessEntry>>
>;

export type RemoveAccessEntryMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Remove an email from the access list (owner only)
 */
export const useRemoveAccessEntry = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof removeAccessEntry>>,
    TError,
    { email: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof removeAccessEntry>>,
  TError,
  { email: string },
  TContext
> => {
  return useMutation(getRemoveAccessEntryMutationOptions(options));
};

/**
 * @summary Get cached lender program matrices (owner only)
 */
export const getGetLenderProgramsUrl = () => {
  return `/api/lender-programs`;
};

export const getLenderPrograms = async (
  options?: RequestInit,
): Promise<LenderProgramsResponse> => {
  return customFetch<LenderProgramsResponse>(getGetLenderProgramsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetLenderProgramsQueryKey = () => {
  return [`/api/lender-programs`] as const;
};

export const getGetLenderProgramsQueryOptions = <
  TData = Awaited<ReturnType<typeof getLenderPrograms>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderPrograms>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetLenderProgramsQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getLenderPrograms>>
  > = ({ signal }) => getLenderPrograms({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getLenderPrograms>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetLenderProgramsQueryResult = NonNullable<
  Awaited<ReturnType<typeof getLenderPrograms>>
>;
export type GetLenderProgramsQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get cached lender program matrices (owner only)
 */

export function useGetLenderPrograms<
  TData = Awaited<ReturnType<typeof getLenderPrograms>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderPrograms>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetLenderProgramsQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get lender sync status (owner only)
 */
export const getGetLenderStatusUrl = () => {
  return `/api/lender-status`;
};

export const getLenderStatus = async (
  options?: RequestInit,
): Promise<LenderStatus> => {
  return customFetch<LenderStatus>(getGetLenderStatusUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetLenderStatusQueryKey = () => {
  return [`/api/lender-status`] as const;
};

export const getGetLenderStatusQueryOptions = <
  TData = Awaited<ReturnType<typeof getLenderStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetLenderStatusQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getLenderStatus>>> = ({
    signal,
  }) => getLenderStatus({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getLenderStatus>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetLenderStatusQueryResult = NonNullable<
  Awaited<ReturnType<typeof getLenderStatus>>
>;
export type GetLenderStatusQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get lender sync status (owner only)
 */

export function useGetLenderStatus<
  TData = Awaited<ReturnType<typeof getLenderStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetLenderStatusQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Trigger manual lender sync (owner only)
 */
export const getRefreshLenderUrl = () => {
  return `/api/refresh-lender`;
};

export const refreshLender = async (
  options?: RequestInit,
): Promise<SuccessResponse> => {
  return customFetch<SuccessResponse>(getRefreshLenderUrl(), {
    ...options,
    method: "POST",
  });
};

export const getRefreshLenderMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof refreshLender>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof refreshLender>>,
  TError,
  void,
  TContext
> => {
  const mutationKey = ["refreshLender"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof refreshLender>>,
    void
  > = () => {
    return refreshLender(requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RefreshLenderMutationResult = NonNullable<
  Awaited<ReturnType<typeof refreshLender>>
>;

export type RefreshLenderMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Trigger manual lender sync (owner only)
 */
export const useRefreshLender = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof refreshLender>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof refreshLender>>,
  TError,
  void,
  TContext
> => {
  return useMutation(getRefreshLenderMutationOptions(options));
};

/**
 * @summary Calculate inventory affordability by lender/tier (owner only)
 */
export const getLenderCalculateUrl = () => {
  return `/api/lender-calculate`;
};

export const lenderCalculate = async (
  lenderCalculateRequest: LenderCalculateRequest,
  options?: RequestInit,
): Promise<LenderCalculateResponse> => {
  return customFetch<LenderCalculateResponse>(getLenderCalculateUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(lenderCalculateRequest),
  });
};

export const getLenderCalculateMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof lenderCalculate>>,
    TError,
    { data: BodyType<LenderCalculateRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof lenderCalculate>>,
  TError,
  { data: BodyType<LenderCalculateRequest> },
  TContext
> => {
  const mutationKey = ["lenderCalculate"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof lenderCalculate>>,
    { data: BodyType<LenderCalculateRequest> }
  > = (props) => {
    const { data } = props ?? {};

    return lenderCalculate(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type LenderCalculateMutationResult = NonNullable<
  Awaited<ReturnType<typeof lenderCalculate>>
>;
export type LenderCalculateMutationBody = BodyType<LenderCalculateRequest>;
export type LenderCalculateMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Calculate inventory affordability by lender/tier (owner only)
 */
export const useLenderCalculate = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof lenderCalculate>>,
    TError,
    { data: BodyType<LenderCalculateRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof lenderCalculate>>,
  TError,
  { data: BodyType<LenderCalculateRequest> },
  TContext
> => {
  return useMutation(getLenderCalculateMutationOptions(options));
};

/**
 * @summary Get audit log of access changes (owner only)
 */
export const getGetAuditLogUrl = () => {
  return `/api/audit-log`;
};

export const getAuditLog = async (
  options?: RequestInit,
): Promise<AuditLogEntry[]> => {
  return customFetch<AuditLogEntry[]>(getGetAuditLogUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetAuditLogQueryKey = () => {
  return [`/api/audit-log`] as const;
};

export const getGetAuditLogQueryOptions = <
  TData = Awaited<ReturnType<typeof getAuditLog>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getAuditLog>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetAuditLogQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getAuditLog>>> = ({
    signal,
  }) => getAuditLog({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getAuditLog>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetAuditLogQueryResult = NonNullable<
  Awaited<ReturnType<typeof getAuditLog>>
>;
export type GetAuditLogQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get audit log of access changes (owner only)
 */

export function useGetAuditLog<
  TData = Awaited<ReturnType<typeof getAuditLog>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getAuditLog>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetAuditLogQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

```


---

## API Spec


### `lib/api-spec/package.json` (11 lines)

```json
{
  "name": "@workspace/api-spec",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "codegen": "orval --config ./orval.config.ts"
  },
  "devDependencies": {
    "orval": "^8.5.2"
  }
}

```


### `lib/api-spec/orval.config.ts` (72 lines)

```typescript
import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});

```


### `lib/api-spec/openapi.yaml` (822 lines)

```yaml
openapi: 3.1.0
info:
  # Do not change the title, if the title changes, the import paths will be broken
  title: Api
  version: 0.1.0
  description: API specification
servers:
  - url: /api
    description: Base API path
tags:
  - name: health
    description: Health operations
  - name: auth
    description: Authentication
  - name: inventory
    description: Inventory data
  - name: access
    description: Access list management
  - name: audit
    description: Audit log
  - name: lender
    description: Inventory Selector (lender program calculator)
paths:
  /healthz:
    get:
      operationId: healthCheck
      tags: [health]
      summary: Health check
      responses:
        "200":
          description: Healthy
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthStatus"

  /me:
    get:
      operationId: getMe
      tags: [auth]
      summary: Get current authenticated user
      responses:
        "200":
          description: Current user
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /inventory:
    get:
      operationId: getInventory
      tags: [inventory]
      summary: Get all inventory items
      responses:
        "200":
          description: List of inventory items
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/InventoryItem"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Access denied
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /cache-status:
    get:
      operationId: getCacheStatus
      tags: [inventory]
      summary: Get the timestamp of the last inventory cache refresh
      responses:
        "200":
          description: Cache status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CacheStatus"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /vehicle-images:
    get:
      operationId: getVehicleImages
      tags: [inventory]
      summary: Get photo gallery URLs for a vehicle by VIN
      parameters:
        - name: vin
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Vehicle image URLs
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/VehicleImages"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /access:
    get:
      operationId: getAccessList
      tags: [access]
      summary: Get list of approved emails (owner only)
      responses:
        "200":
          description: Approved emails
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/AccessEntry"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
    post:
      operationId: addAccessEntry
      tags: [access]
      summary: Add an email to the access list (owner only)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/AddAccessRequest"
      responses:
        "200":
          description: Entry added
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AccessEntry"
        "400":
          description: Bad request
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /access/{email}:
    patch:
      operationId: updateAccessRole
      tags: [access]
      summary: Update a user's role (owner only)
      parameters:
        - name: email
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/UpdateAccessRoleRequest"
      responses:
        "200":
          description: Entry updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AccessEntry"
        "400":
          description: Bad request
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "404":
          description: User not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
    delete:
      operationId: removeAccessEntry
      tags: [access]
      summary: Remove an email from the access list (owner only)
      parameters:
        - name: email
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Entry removed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /lender-programs:
    get:
      operationId: getLenderPrograms
      tags: [lender]
      summary: Get cached lender program matrices (owner or viewer)
      responses:
        "200":
          description: Lender programs
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LenderProgramsResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /lender-status:
    get:
      operationId: getLenderStatus
      tags: [lender]
      summary: Get lender sync status (owner or viewer)
      responses:
        "200":
          description: Sync status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LenderStatus"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /refresh-lender:
    post:
      operationId: refreshLender
      tags: [lender]
      summary: Trigger manual lender sync (owner only)
      responses:
        "200":
          description: Sync triggered
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /lender-calculate:
    post:
      operationId: lenderCalculate
      tags: [lender]
      summary: Calculate inventory affordability by lender/tier (owner or viewer)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/LenderCalculateRequest"
      responses:
        "200":
          description: Filtered results
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LenderCalculateResponse"
        "400":
          description: Bad request
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /audit-log:
    get:
      operationId: getAuditLog
      tags: [audit]
      summary: Get audit log of access changes (owner only)
      responses:
        "200":
          description: Audit log entries
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/AuditLogEntry"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

components:
  schemas:
    HealthStatus:
      type: object
      properties:
        status:
          type: string
      required:
        - status

    User:
      type: object
      properties:
        email:
          type: string
        name:
          type: string
        picture:
          type: string
        isOwner:
          type: boolean
        role:
          type: string
      required:
        - email
        - name
        - isOwner
        - role

    InventoryItem:
      type: object
      properties:
        location:
          type: string
        vehicle:
          type: string
        vin:
          type: string
        price:
          type: string
        km:
          type: string
        carfax:
          type: string
        website:
          type: string
        onlinePrice:
          type: string
        matrixPrice:
          type: string
          nullable: true
        cost:
          type: string
          nullable: true
        bbAvgWholesale:
          type: string
          nullable: true
      required:
        - location
        - vehicle
        - vin
        - price

    CacheStatus:
      type: object
      properties:
        lastUpdated:
          type: string
          nullable: true
        isRefreshing:
          type: boolean
        count:
          type: integer
      required:
        - isRefreshing
        - count

    VehicleImages:
      type: object
      properties:
        vin:
          type: string
        urls:
          type: array
          items:
            type: string
      required:
        - vin
        - urls

    AccessEntry:
      type: object
      properties:
        email:
          type: string
        addedAt:
          type: string
        addedBy:
          type: string
        role:
          type: string
      required:
        - email
        - addedAt
        - addedBy
        - role

    AddAccessRequest:
      type: object
      properties:
        email:
          type: string
        role:
          type: string
      required:
        - email

    UpdateAccessRoleRequest:
      type: object
      properties:
        role:
          type: string
      required:
        - role

    AuditLogEntry:
      type: object
      properties:
        id:
          type: integer
        action:
          type: string
        targetEmail:
          type: string
        changedBy:
          type: string
        roleFrom:
          type: string
          nullable: true
        roleTo:
          type: string
          nullable: true
        timestamp:
          type: string
      required:
        - id
        - action
        - targetEmail
        - changedBy
        - timestamp

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
      required:
        - error

    SuccessResponse:
      type: object
      properties:
        ok:
          type: boolean
      required:
        - ok

    LenderProgramTier:
      type: object
      properties:
        tierName:
          type: string
        minRate:
          type: number
        maxRate:
          type: number
        maxPayment:
          type: number
        maxAdvanceLTV:
          type: number
        maxAftermarketLTV:
          type: number
        maxAllInLTV:
          type: number
        creditorFee:
          type: number
        dealerReserve:
          type: number
      required:
        - tierName
        - minRate
        - maxRate
        - maxPayment
        - maxAdvanceLTV
        - maxAftermarketLTV
        - maxAllInLTV
        - creditorFee
        - dealerReserve

    VehicleTermMatrixData:
      type: object
      properties:
        term:
          type: integer
        kmFrom:
          type: integer
        kmTo:
          type: integer
      required: [term, kmFrom, kmTo]

    VehicleTermMatrixEntry:
      type: object
      properties:
        year:
          type: integer
        data:
          type: array
          items:
            $ref: "#/components/schemas/VehicleTermMatrixData"
      required: [year, data]

    KmRange:
      type: object
      properties:
        kmFrom:
          type: integer
        kmTo:
          type: integer
      required: [kmFrom, kmTo]

    VehicleConditionMatrixEntry:
      type: object
      properties:
        year:
          type: integer
        extraClean:
          $ref: "#/components/schemas/KmRange"
        clean:
          $ref: "#/components/schemas/KmRange"
        average:
          $ref: "#/components/schemas/KmRange"
        rough:
          $ref: "#/components/schemas/KmRange"
      required: [year, extraClean, clean, average, rough]

    LenderProgramGuide:
      type: object
      properties:
        programId:
          type: string
        programTitle:
          type: string
        programType:
          type: string
        tiers:
          type: array
          items:
            $ref: "#/components/schemas/LenderProgramTier"
        vehicleTermMatrix:
          type: array
          items:
            $ref: "#/components/schemas/VehicleTermMatrixEntry"
        vehicleConditionMatrix:
          type: array
          items:
            $ref: "#/components/schemas/VehicleConditionMatrixEntry"
        maxTerm:
          type: integer
        maxWarrantyPrice:
          type: number
          nullable: true
        maxGapPrice:
          type: number
          nullable: true
        maxAdminFee:
          type: number
          nullable: true
      required:
        - programId
        - programTitle
        - programType
        - tiers
        - vehicleTermMatrix
        - vehicleConditionMatrix

    LenderProgram:
      type: object
      properties:
        lenderCode:
          type: string
        lenderName:
          type: string
        creditorId:
          type: string
        programs:
          type: array
          items:
            $ref: "#/components/schemas/LenderProgramGuide"
      required:
        - lenderCode
        - lenderName
        - creditorId
        - programs

    LenderProgramsResponse:
      type: object
      properties:
        programs:
          type: array
          items:
            $ref: "#/components/schemas/LenderProgram"
        updatedAt:
          type: string
          nullable: true
        role:
          type: string
      required:
        - programs

    LenderStatus:
      type: object
      properties:
        running:
          type: boolean
        startedAt:
          type: string
          nullable: true
        lastRun:
          type: string
          nullable: true
        lenderCount:
          type: integer
        error:
          type: string
          nullable: true
        programsAge:
          type: string
          nullable: true
      required:
        - running
        - lenderCount

    LenderCalculateRequest:
      type: object
      properties:
        lenderCode:
          type: string
        programId:
          type: string
        tierName:
          type: string
        approvedRate:
          type: number
        maxPaymentOverride:
          type: number
        downPayment:
          type: number
        tradeValue:
          type: number
        tradeLien:
          type: number
        taxRate:
          type: number
        adminFee:
          type: number
      required:
        - lenderCode
        - programId
        - tierName
        - approvedRate

    LenderCalcResultItem:
      type: object
      properties:
        vin:
          type: string
        vehicle:
          type: string
        location:
          type: string
        term:
          type: integer
        conditionUsed:
          type: string
        bbWholesale:
          type: number
        sellingPrice:
          type: number
        priceSource:
          type: string
        adminFeeUsed:
          type: number
        warrantyPrice:
          type: number
        warrantyCost:
          type: number
        gapPrice:
          type: number
        gapCost:
          type: number
        totalFinanced:
          type: number
        monthlyPayment:
          type: number
        profit:
          type: number
        hasPhotos:
          type: boolean
        website:
          type: string
      required:
        - vin
        - vehicle
        - location
        - term
        - conditionUsed
        - bbWholesale
        - sellingPrice
        - priceSource
        - adminFeeUsed
        - warrantyPrice
        - warrantyCost
        - gapPrice
        - gapCost
        - totalFinanced
        - monthlyPayment
        - profit

    ProgramLimits:
      type: object
      properties:
        maxWarrantyPrice:
          type: number
          nullable: true
        maxGapPrice:
          type: number
          nullable: true
        maxAdminFee:
          type: number
          nullable: true
        gapAllowed:
          type: boolean
      required:
        - gapAllowed

    LenderCalculateResponse:
      type: object
      properties:
        lender:
          type: string
        program:
          type: string
        tier:
          type: string
        tierConfig:
          $ref: "#/components/schemas/LenderProgramTier"
        programLimits:
          $ref: "#/components/schemas/ProgramLimits"
        resultCount:
          type: integer
        results:
          type: array
          items:
            $ref: "#/components/schemas/LenderCalcResultItem"
      required:
        - lender
        - program
        - tier
        - tierConfig
        - resultCount
        - results

```


---

## API Zod


### `lib/api-zod/package.json` (12 lines)

```json
{
  "name": "@workspace/api-zod",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "catalog:"
  }
}

```


### `lib/api-zod/tsconfig.json` (11 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}

```


### `lib/api-zod/src/index.ts` (2 lines)

```typescript
export * from "./generated/api";
export * from "./generated/types";

```


### `lib/api-zod/src/generated/api.ts` (287 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import * as zod from "zod";

/**
 * @summary Health check
 */
export const HealthCheckResponse = zod.object({
  status: zod.string(),
});

/**
 * @summary Get current authenticated user
 */
export const GetMeResponse = zod.object({
  email: zod.string(),
  name: zod.string(),
  picture: zod.string().optional(),
  isOwner: zod.boolean(),
  role: zod.string(),
});

/**
 * @summary Get all inventory items
 */
export const GetInventoryResponseItem = zod.object({
  location: zod.string(),
  vehicle: zod.string(),
  vin: zod.string(),
  price: zod.string(),
  km: zod.string().optional(),
  carfax: zod.string().optional(),
  website: zod.string().optional(),
  onlinePrice: zod.string().optional(),
  matrixPrice: zod.string().nullish(),
  cost: zod.string().nullish(),
  bbAvgWholesale: zod.string().nullish(),
});
export const GetInventoryResponse = zod.array(GetInventoryResponseItem);

/**
 * @summary Get the timestamp of the last inventory cache refresh
 */
export const GetCacheStatusResponse = zod.object({
  lastUpdated: zod.string().nullish(),
  isRefreshing: zod.boolean(),
  count: zod.number(),
});

/**
 * @summary Get photo gallery URLs for a vehicle by VIN
 */
export const GetVehicleImagesQueryParams = zod.object({
  vin: zod.coerce.string(),
});

export const GetVehicleImagesResponse = zod.object({
  vin: zod.string(),
  urls: zod.array(zod.string()),
});

/**
 * @summary Get list of approved emails (owner only)
 */
export const GetAccessListResponseItem = zod.object({
  email: zod.string(),
  addedAt: zod.string(),
  addedBy: zod.string(),
  role: zod.string(),
});
export const GetAccessListResponse = zod.array(GetAccessListResponseItem);

/**
 * @summary Add an email to the access list (owner only)
 */
export const AddAccessEntryBody = zod.object({
  email: zod.string(),
  role: zod.string().optional(),
});

export const AddAccessEntryResponse = zod.object({
  email: zod.string(),
  addedAt: zod.string(),
  addedBy: zod.string(),
  role: zod.string(),
});

/**
 * @summary Update a user's role (owner only)
 */
export const UpdateAccessRoleParams = zod.object({
  email: zod.coerce.string(),
});

export const UpdateAccessRoleBody = zod.object({
  role: zod.string(),
});

export const UpdateAccessRoleResponse = zod.object({
  email: zod.string(),
  addedAt: zod.string(),
  addedBy: zod.string(),
  role: zod.string(),
});

/**
 * @summary Remove an email from the access list (owner only)
 */
export const RemoveAccessEntryParams = zod.object({
  email: zod.coerce.string(),
});

export const RemoveAccessEntryResponse = zod.object({
  ok: zod.boolean(),
});

/**
 * @summary Get cached lender program matrices (owner only)
 */
export const GetLenderProgramsResponse = zod.object({
  programs: zod.array(
    zod.object({
      lenderCode: zod.string(),
      lenderName: zod.string(),
      creditorId: zod.string(),
      programs: zod.array(
        zod.object({
          programId: zod.string(),
          programTitle: zod.string(),
          programType: zod.string(),
          tiers: zod.array(
            zod.object({
              tierName: zod.string(),
              minRate: zod.number(),
              maxRate: zod.number(),
              maxPayment: zod.number(),
              maxAdvanceLTV: zod.number(),
              maxAftermarketLTV: zod.number(),
              maxAllInLTV: zod.number(),
              creditorFee: zod.number(),
              dealerReserve: zod.number(),
            }),
          ),
          vehicleTermMatrix: zod.array(
            zod.object({
              year: zod.number(),
              data: zod.array(
                zod.object({
                  term: zod.number(),
                  kmFrom: zod.number(),
                  kmTo: zod.number(),
                }),
              ),
            }),
          ),
          vehicleConditionMatrix: zod.array(
            zod.object({
              year: zod.number(),
              extraClean: zod.object({
                kmFrom: zod.number(),
                kmTo: zod.number(),
              }),
              clean: zod.object({
                kmFrom: zod.number(),
                kmTo: zod.number(),
              }),
              average: zod.object({
                kmFrom: zod.number(),
                kmTo: zod.number(),
              }),
              rough: zod.object({
                kmFrom: zod.number(),
                kmTo: zod.number(),
              }),
            }),
          ),
          maxTerm: zod.number().optional(),
          maxWarrantyPrice: zod.number().nullish(),
          maxGapPrice: zod.number().nullish(),
          maxAdminFee: zod.number().nullish(),
        }),
      ),
    }),
  ),
  updatedAt: zod.string().nullish(),
});

/**
 * @summary Get lender sync status (owner only)
 */
export const GetLenderStatusResponse = zod.object({
  running: zod.boolean(),
  startedAt: zod.string().nullish(),
  lastRun: zod.string().nullish(),
  lenderCount: zod.number(),
  error: zod.string().nullish(),
  programsAge: zod.string().nullish(),
});

/**
 * @summary Trigger manual lender sync (owner only)
 */
export const RefreshLenderResponse = zod.object({
  ok: zod.boolean(),
});

/**
 * @summary Calculate inventory affordability by lender/tier (owner only)
 */
export const LenderCalculateBody = zod.object({
  lenderCode: zod.string(),
  programId: zod.string(),
  tierName: zod.string(),
  approvedRate: zod.number(),
  maxPaymentOverride: zod.number().optional(),
  downPayment: zod.number().optional(),
  tradeValue: zod.number().optional(),
  tradeLien: zod.number().optional(),
  taxRate: zod.number().optional(),
  warrantyPrice: zod.number().optional(),
  warrantyCost: zod.number().optional(),
  gapPrice: zod.number().optional(),
  gapCost: zod.number().optional(),
  adminFee: zod.number().optional(),
});

export const LenderCalculateResponse = zod.object({
  lender: zod.string(),
  program: zod.string(),
  tier: zod.string(),
  tierConfig: zod.object({
    tierName: zod.string(),
    minRate: zod.number(),
    maxRate: zod.number(),
    maxPayment: zod.number(),
    maxAdvanceLTV: zod.number(),
    maxAftermarketLTV: zod.number(),
    maxAllInLTV: zod.number(),
    creditorFee: zod.number(),
    dealerReserve: zod.number(),
  }),
  programLimits: zod
    .object({
      maxWarrantyPrice: zod.number().nullish(),
      maxGapPrice: zod.number().nullish(),
      maxAdminFee: zod.number().nullish(),
      gapAllowed: zod.boolean(),
    })
    .optional(),
  resultCount: zod.number(),
  results: zod.array(
    zod.object({
      vin: zod.string(),
      vehicle: zod.string(),
      location: zod.string(),
      term: zod.number(),
      conditionUsed: zod.string(),
      bbWholesale: zod.number(),
      sellingPrice: zod.number(),
      priceSource: zod.string(),
      totalFinanced: zod.number(),
      monthlyPayment: zod.number(),
      profit: zod.number(),
      hasPhotos: zod.boolean().optional(),
      website: zod.string().optional(),
    }),
  ),
});

/**
 * @summary Get audit log of access changes (owner only)
 */
export const GetAuditLogResponseItem = zod.object({
  id: zod.number(),
  action: zod.string(),
  targetEmail: zod.string(),
  changedBy: zod.string(),
  roleFrom: zod.string().nullish(),
  roleTo: zod.string().nullish(),
  timestamp: zod.string(),
});
export const GetAuditLogResponse = zod.array(GetAuditLogResponseItem);

```


### `lib/api-zod/src/generated/types/accessEntry.ts` (14 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface AccessEntry {
  email: string;
  addedAt: string;
  addedBy: string;
  role: string;
}

```


### `lib/api-zod/src/generated/types/addAccessRequest.ts` (12 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface AddAccessRequest {
  email: string;
  role?: string;
}

```


### `lib/api-zod/src/generated/types/auditLogEntry.ts` (17 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface AuditLogEntry {
  id: number;
  action: string;
  targetEmail: string;
  changedBy: string;
  roleFrom?: string | null;
  roleTo?: string | null;
  timestamp: string;
}

```


### `lib/api-zod/src/generated/types/cacheStatus.ts` (13 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface CacheStatus {
  lastUpdated?: string | null;
  isRefreshing: boolean;
  count: number;
}

```


### `lib/api-zod/src/generated/types/errorResponse.ts` (11 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface ErrorResponse {
  error: string;
}

```


### `lib/api-zod/src/generated/types/getVehicleImagesParams.ts` (11 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type GetVehicleImagesParams = {
  vin: string;
};

```


### `lib/api-zod/src/generated/types/healthStatus.ts` (11 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface HealthStatus {
  status: string;
}

```


### `lib/api-zod/src/generated/types/index.ts` (33 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export * from "./accessEntry";
export * from "./addAccessRequest";
export * from "./auditLogEntry";
export * from "./cacheStatus";
export * from "./errorResponse";
export * from "./getVehicleImagesParams";
export * from "./healthStatus";
export * from "./inventoryItem";
export * from "./kmRange";
export * from "./lenderCalcResultItem";
export * from "./lenderCalculateRequest";
export * from "./lenderCalculateResponse";
export * from "./lenderProgram";
export * from "./lenderProgramGuide";
export * from "./lenderProgramsResponse";
export * from "./lenderProgramTier";
export * from "./lenderStatus";
export * from "./programLimits";
export * from "./successResponse";
export * from "./updateAccessRoleRequest";
export * from "./user";
export * from "./vehicleConditionMatrixEntry";
export * from "./vehicleImages";
export * from "./vehicleTermMatrixData";
export * from "./vehicleTermMatrixEntry";

```


### `lib/api-zod/src/generated/types/inventoryItem.ts` (21 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface InventoryItem {
  location: string;
  vehicle: string;
  vin: string;
  price: string;
  km?: string;
  carfax?: string;
  website?: string;
  onlinePrice?: string;
  matrixPrice?: string | null;
  cost?: string | null;
  bbAvgWholesale?: string | null;
}

```


### `lib/api-zod/src/generated/types/kmRange.ts` (12 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface KmRange {
  kmFrom: number;
  kmTo: number;
}

```


### `lib/api-zod/src/generated/types/lenderCalcResultItem.ts` (23 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LenderCalcResultItem {
  vin: string;
  vehicle: string;
  location: string;
  term: number;
  conditionUsed: string;
  bbWholesale: number;
  sellingPrice: number;
  priceSource: string;
  totalFinanced: number;
  monthlyPayment: number;
  profit: number;
  hasPhotos?: boolean;
  website?: string;
}

```


### `lib/api-zod/src/generated/types/lenderCalculateRequest.ts` (24 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LenderCalculateRequest {
  lenderCode: string;
  programId: string;
  tierName: string;
  approvedRate: number;
  maxPaymentOverride?: number;
  downPayment?: number;
  tradeValue?: number;
  tradeLien?: number;
  taxRate?: number;
  warrantyPrice?: number;
  warrantyCost?: number;
  gapPrice?: number;
  gapCost?: number;
  adminFee?: number;
}

```


### `lib/api-zod/src/generated/types/lenderCalculateResponse.ts` (20 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { LenderCalcResultItem } from "./lenderCalcResultItem";
import type { LenderProgramTier } from "./lenderProgramTier";
import type { ProgramLimits } from "./programLimits";

export interface LenderCalculateResponse {
  lender: string;
  program: string;
  tier: string;
  tierConfig: LenderProgramTier;
  programLimits?: ProgramLimits;
  resultCount: number;
  results: LenderCalcResultItem[];
}

```


### `lib/api-zod/src/generated/types/lenderProgramGuide.ts` (23 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { LenderProgramTier } from "./lenderProgramTier";
import type { VehicleConditionMatrixEntry } from "./vehicleConditionMatrixEntry";
import type { VehicleTermMatrixEntry } from "./vehicleTermMatrixEntry";

export interface LenderProgramGuide {
  programId: string;
  programTitle: string;
  programType: string;
  tiers: LenderProgramTier[];
  vehicleTermMatrix: VehicleTermMatrixEntry[];
  vehicleConditionMatrix: VehicleConditionMatrixEntry[];
  maxTerm?: number;
  maxWarrantyPrice?: number | null;
  maxGapPrice?: number | null;
  maxAdminFee?: number | null;
}

```


### `lib/api-zod/src/generated/types/lenderProgramsResponse.ts` (13 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { LenderProgram } from "./lenderProgram";

export interface LenderProgramsResponse {
  programs: LenderProgram[];
  updatedAt?: string | null;
}

```


### `lib/api-zod/src/generated/types/lenderProgramTier.ts` (19 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LenderProgramTier {
  tierName: string;
  minRate: number;
  maxRate: number;
  maxPayment: number;
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  creditorFee: number;
  dealerReserve: number;
}

```


### `lib/api-zod/src/generated/types/lenderProgram.ts` (15 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { LenderProgramGuide } from "./lenderProgramGuide";

export interface LenderProgram {
  lenderCode: string;
  lenderName: string;
  creditorId: string;
  programs: LenderProgramGuide[];
}

```


### `lib/api-zod/src/generated/types/lenderStatus.ts` (16 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LenderStatus {
  running: boolean;
  startedAt?: string | null;
  lastRun?: string | null;
  lenderCount: number;
  error?: string | null;
  programsAge?: string | null;
}

```


### `lib/api-zod/src/generated/types/programLimits.ts` (14 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface ProgramLimits {
  maxWarrantyPrice?: number | null;
  maxGapPrice?: number | null;
  maxAdminFee?: number | null;
  gapAllowed: boolean;
}

```


### `lib/api-zod/src/generated/types/successResponse.ts` (11 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface SuccessResponse {
  ok: boolean;
}

```


### `lib/api-zod/src/generated/types/updateAccessRoleRequest.ts` (11 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface UpdateAccessRoleRequest {
  role: string;
}

```


### `lib/api-zod/src/generated/types/user.ts` (15 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface User {
  email: string;
  name: string;
  picture?: string;
  isOwner: boolean;
  role: string;
}

```


### `lib/api-zod/src/generated/types/vehicleConditionMatrixEntry.ts` (16 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { KmRange } from "./kmRange";

export interface VehicleConditionMatrixEntry {
  year: number;
  extraClean: KmRange;
  clean: KmRange;
  average: KmRange;
  rough: KmRange;
}

```


### `lib/api-zod/src/generated/types/vehicleImages.ts` (12 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface VehicleImages {
  vin: string;
  urls: string[];
}

```


### `lib/api-zod/src/generated/types/vehicleTermMatrixData.ts` (13 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface VehicleTermMatrixData {
  term: number;
  kmFrom: number;
  kmTo: number;
}

```


### `lib/api-zod/src/generated/types/vehicleTermMatrixEntry.ts` (13 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { VehicleTermMatrixData } from "./vehicleTermMatrixData";

export interface VehicleTermMatrixEntry {
  year: number;
  data: VehicleTermMatrixData[];
}

```


---

## Database


### `lib/db/package.json` (25 lines)

```json
{
  "name": "@workspace/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts"
  },
  "scripts": {
    "push": "drizzle-kit push --config ./drizzle.config.ts",
    "push-force": "drizzle-kit push --force --config ./drizzle.config.ts"
  },
  "dependencies": {
    "drizzle-orm": "catalog:",
    "drizzle-zod": "^0.8.3",
    "pg": "^8.20.0",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@types/pg": "^8.18.0",
    "drizzle-kit": "^0.31.9"
  }
}

```


### `lib/db/tsconfig.json` (12 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}

```


### `lib/db/drizzle.config.ts` (14 lines)

```typescript
import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

```


### `lib/db/src/index.ts` (16 lines)

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

```


### `lib/db/src/schema/index.ts` (5 lines)

```typescript
export * from "./access";
export * from "./audit-log";
export * from "./bb-session";
export * from "./inventory-cache";
export * from "./lender-session";

```


### `lib/db/src/schema/access.ts` (10 lines)

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const accessListTable = pgTable("access_list", {
  email:   text("email").primaryKey(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  addedBy: text("added_by").notNull(),
  role:    text("role").notNull().default("viewer"),
});

export type AccessListEntry = typeof accessListTable.$inferSelect;

```


### `lib/db/src/schema/audit-log.ts` (13 lines)

```typescript
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id:          serial("id").primaryKey(),
  action:      text("action").notNull(),
  targetEmail: text("target_email").notNull(),
  changedBy:   text("changed_by").notNull(),
  roleFrom:    text("role_from"),
  roleTo:      text("role_to"),
  timestamp:   timestamp("timestamp").defaultNow().notNull(),
});

export type AuditLogEntry = typeof auditLogTable.$inferSelect;

```


### `lib/db/src/schema/bb-session.ts` (8 lines)

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const bbSessionTable = pgTable("bb_session", {
  id:        text("id").primaryKey().default("singleton"),
  cookies:   text("cookies").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at"),
});

```


### `lib/db/src/schema/inventory-cache.ts` (7 lines)

```typescript
import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

export const inventoryCacheTable = pgTable("inventory_cache", {
  id:          integer("id").primaryKey(),
  data:        jsonb("data").notNull().default([]),
  lastUpdated: timestamp("last_updated").notNull(),
});

```


### `lib/db/src/schema/lender-session.ts` (8 lines)

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const lenderSessionTable = pgTable("lender_session", {
  id:        text("id").primaryKey().default("singleton"),
  cookies:   text("cookies").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at"),
});

```


---

## Scripts


### `scripts/package.json` (16 lines)

```json
{
  "name": "@workspace/scripts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "hello": "tsx ./src/hello.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test:lender-golden": "tsx --test ./src/lender-engine.golden.test.ts",
    "smoke:lender": "tsx ./src/lender-smoke.ts"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "tsx": "catalog:"
  }
}

```


### `scripts/tsconfig.json` (9 lines)

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}

```


### `scripts/post-merge.sh` (4 lines)

```bash
#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

```


### `scripts/src/hello.ts` (1 lines)

```typescript
console.log("Hello from @workspace/scripts");

```


### `scripts/src/lender-golden-fixtures.ts` (53 lines)

```typescript
export interface GoldenCapFixture {
  lender: string;
  tierName: string;
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  capModelResolved: "allInOnly" | "split" | "backendOnly" | "unknown";
  expectedProfileKey: string;
  expectedNoOnlineStrategy: string;
}

export const GOLDEN_CAP_FIXTURES: GoldenCapFixture[] = [
  {
    lender: "ACC",
    tierName: "Tier 1",
    maxAdvanceLTV: 140,
    maxAftermarketLTV: 25,
    maxAllInLTV: 175,
    capModelResolved: "split",
    expectedProfileKey: "111",
    expectedNoOnlineStrategy: "maximizeFromAdvanceAndAllIn",
  },
  {
    lender: "SAN",
    tierName: "7",
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 30,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
    expectedProfileKey: "001",
    expectedNoOnlineStrategy: "maximizeFromAllIn",
  },
  {
    lender: "iAF",
    tierName: "sample",
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 0,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
    expectedProfileKey: "001",
    expectedNoOnlineStrategy: "maximizeFromAllIn",
  },
  {
    lender: "QLI",
    tierName: "sample",
    maxAdvanceLTV: 140,
    maxAftermarketLTV: 40,
    maxAllInLTV: 0,
    capModelResolved: "split",
    expectedProfileKey: "110",
    expectedNoOnlineStrategy: "maximizeFromAdvance",
  },
];

```


### `scripts/src/lender-engine.golden.test.ts` (69 lines)

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_ONLINE_STRATEGY_BY_PROFILE,
  resolveCapProfile,
  resolveNoOnlineSellingPrice,
} from "../../artifacts/api-server/src/lib/lenderCalcEngine.js";
import { GOLDEN_CAP_FIXTURES } from "./lender-golden-fixtures.js";

test("golden cap profiles resolve expected strategy", () => {
  for (const fixture of GOLDEN_CAP_FIXTURES) {
    const profile = resolveCapProfile({
      maxAdvanceLTV: fixture.maxAdvanceLTV,
      maxAftermarketLTV: fixture.maxAftermarketLTV,
      maxAllInLTV: fixture.maxAllInLTV,
      capModelResolved: fixture.capModelResolved,
    });

    assert.equal(
      profile.key,
      fixture.expectedProfileKey,
      `${fixture.lender} ${fixture.tierName} cap profile mismatch`,
    );
    assert.equal(
      NO_ONLINE_STRATEGY_BY_PROFILE[profile.key],
      fixture.expectedNoOnlineStrategy,
      `${fixture.lender} ${fixture.tierName} strategy mismatch`,
    );
  }
});

test("PAC floor is enforced when no-online ceilings are below PAC", () => {
  const profile = resolveCapProfile({
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 0,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  const resolution = resolveNoOnlineSellingPrice({
    pacCost: 20000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    maxAdvance: Infinity,
    maxAllInPreTax: 18000,
    profile,
  });
  assert.equal(resolution.rejection, "ltvAllIn");
});

test("no-online sell price is maximized from all-in profile", () => {
  const profile = resolveCapProfile({
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 30,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  const resolution = resolveNoOnlineSellingPrice({
    pacCost: 15000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    maxAdvance: Infinity,
    maxAllInPreTax: 25000,
    profile,
  });
  assert.equal(resolution.source, "maximized");
  assert.equal(resolution.price, Math.round(25000 - 699));
});

```


### `scripts/src/lender-smoke.ts` (112 lines)

```typescript
type CalcPayload = {
  lenderCode: string;
  programId: string;
  tierName: string;
  approvedRate: number;
  downPayment?: number;
  tradeValue?: number;
  tradeLien?: number;
  taxRate?: number;
  adminFee?: number;
};

type Scenario = {
  name: string;
  payload: CalcPayload;
  assert: (data: any) => string[];
};

const BASE_URL = process.env["LENDER_SMOKE_BASE_URL"];
const COOKIE = process.env["LENDER_SMOKE_COOKIE"];

function fail(msg: string): never {
  throw new Error(msg);
}

function ensure(cond: unknown, message: string, errors: string[]) {
  if (!cond) errors.push(message);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) fail(`Set ${name}`);
  return v;
}

function lenderScenario(
  lenderCode: string,
  defaultRate: number,
  checks: (data: any, errors: string[]) => void,
): Scenario {
  return {
    name: `${lenderCode} smoke`,
    payload: {
      lenderCode,
      programId: required(`LENDER_${lenderCode}_PROGRAM_ID`),
      tierName: required(`LENDER_${lenderCode}_TIER_NAME`),
      approvedRate: Number(process.env[`LENDER_${lenderCode}_APPROVED_RATE`] ?? defaultRate),
      taxRate: 5,
    },
    assert: (data) => {
      const errors: string[] = [];
      ensure(typeof data?.calculatorVersion === "string", "Missing calculatorVersion fingerprint", errors);
      ensure(typeof data?.gitSha === "string", "Missing gitSha fingerprint", errors);
      ensure(Array.isArray(data?.results), "Missing results array", errors);
      const maxAdminFee = data?.programLimits?.maxAdminFee ?? 0;
      if (maxAdminFee > 0 && Array.isArray(data?.results) && data.results.length > 0) {
        const hasAdminUsage = data.results.some((r: any) => Number(r?.adminFeeUsed ?? 0) > 0);
        ensure(hasAdminUsage, "Expected admin fee usage when admin cap exists (admin priority)", errors);
      }
      checks(data, errors);
      return errors;
    },
  };
}

const scenarios: Scenario[] = [
  lenderScenario("SAN", 13.49, (data, errors) => {
    ensure(data?.programLimits?.noOnlineStrategy === "maximizeFromAllIn", "Expected noOnlineStrategy=maximizeFromAllIn", errors);
    ensure(data?.programLimits?.capModelResolved === "allInOnly", "Expected capModelResolved=allInOnly", errors);
  }),
  lenderScenario("ACC", 11.99, (data, errors) => {
    ensure(data?.programLimits?.gapAllowed !== false, "ACC GAP should not be hard-disabled", errors);
  }),
  lenderScenario("iAF", 12.99, (data, errors) => {
    ensure(data?.programLimits?.capModelResolved === "allInOnly", "Expected iAF to resolve allInOnly", errors);
  }),
  lenderScenario("QLI", 12.99, (data, errors) => {
    ensure(data?.programLimits?.noOnlineStrategy !== "pacFallback", "Quantifi should not fall back to PAC when sell caps exist", errors);
  }),
];

async function run() {
  if (!BASE_URL) fail("Set LENDER_SMOKE_BASE_URL");
  if (!COOKIE) fail("Set LENDER_SMOKE_COOKIE (session cookie)");

  for (const scenario of scenarios) {
    const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/api/lender-calculate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": COOKIE,
      },
      body: JSON.stringify(scenario.payload),
    });

    if (!res.ok) {
      fail(`[${scenario.name}] HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const errors = scenario.assert(data);
    if (errors.length > 0) {
      fail(`[${scenario.name}] ${errors.join("; ")}`);
    }
    console.log(`PASS: ${scenario.name}`);
  }
}

run().catch((err) => {
  console.error("Lender smoke failed:", err);
  process.exit(1);
});

```


---

## Templates


### `templates/dealerPortalWorker.template.ts` (635 lines)

```typescript
/**
 * ============================================================
 *  DEALER PORTAL AUTOMATION — REUSABLE TEMPLATE
 * ============================================================
 *
 *  PURPOSE
 *  -------
 *  Nightly headless-browser worker that:
 *    1. Restores a saved login session (no credentials at runtime)
 *    2. Looks up a list of identifiers (VINs, stock numbers, etc.)
 *       from a Google Apps Script web app
 *    3. Extracts a URL or value for each identifier from the
 *       target dealer portal
 *    4. Writes results back to Google Sheets via the same Apps Script
 *    5. Sends an alert to the sheet owner if something goes wrong
 *
 *  HOW TO ADAPT FOR A NEW PORTAL
 *  ------------------------------
 *  1. Fill in every block marked  ← CONFIGURE
 *  2. Replace every selector marked  ← SELECTOR
 *  3. Implement the three async functions at the bottom:
 *       loginFresh()   — logs in from scratch and saves cookies
 *       isLoggedIn()   — quick check: are we already in?
 *       lookupId()     — given one identifier, return the target value
 *  4. Set environment variables (see "Environment variables" section)
 *  5. Keep all anti-detection and human-behaviour helpers as-is —
 *     they are portal-agnostic and should never be removed.
 *
 *  ANTI-DETECTION PRINCIPLES (do not remove)
 *  ------------------------------------------
 *  - puppeteer-extra + stealth plugin (handles ~20 fingerprint vectors)
 *  - headless: "new"  (least detectable headless mode)
 *  - navigator.webdriver, userAgentData, plugins, mimeTypes all spoofed
 *  - Realistic HTTP headers set on every request
 *  - Canvas fingerprint noise injected per session
 *  - Human-like mouse curves (Bézier), variable keystroke timing,
 *    random micro-scrolls between actions
 *  - 4–9 second random pause between consecutive lookups
 *  - Session cookies persisted to disk; browser launched once per run
 *
 *  APPS SCRIPT CONTRACT (GET / POST)
 *  ----------------------------------
 *  GET  → returns JSON array of pending items:
 *           [ { rowIndex: number, identifier: string }, … ]
 *  POST → writes a result back to the sheet:
 *           { rowIndex, value, batchComplete? }
 *  POST (alert) → sends an email alert:
 *           { alert: true, message: string }
 * ============================================================
 */

import path    from "node:path";
import fs      from "node:fs/promises";
import pino    from "pino";
import type { Browser, Page } from "puppeteer";

// ---------------------------------------------------------------------------
// Environment variables                                         ← CONFIGURE
// ---------------------------------------------------------------------------

/** URL of the Google Apps Script web app that manages the sheet */
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_WEB_APP_URL ?? "";

/**
 * Optional: if routing through a residential / office proxy to match
 * the IP address that the portal recognises for this account, set this
 * to a value like  "socks5://user:pass@host:port"  or
 * "http://user:pass@host:port".  Leave blank to use the server's own IP.
 */
const PROXY_SERVER = process.env.PORTAL_PROXY_SERVER ?? "";

// ---------------------------------------------------------------------------
// Portal-specific constants                                     ← CONFIGURE
// ---------------------------------------------------------------------------

/** Base URL of the dealer portal login page */
const PORTAL_LOGIN_URL = "https://PORTAL_DOMAIN/login";                // ← CONFIGURE

/** The page you land on after a successful login */
const PORTAL_HOME_URL  = "https://PORTAL_DOMAIN/dashboard";            // ← CONFIGURE

/**
 * The page where you search for an identifier (VIN, stock number, etc.).
 * If search is embedded on the home page, set this equal to PORTAL_HOME_URL.
 */
const PORTAL_SEARCH_URL = "https://PORTAL_DOMAIN/search";              // ← CONFIGURE

/** Path to the session cookie file (relative to this file's working dir) */
const SESSION_FILE = path.resolve(process.cwd(), ".portal-session.json"); // ← CONFIGURE (rename as needed)

// ---------------------------------------------------------------------------
// Scheduler                                                     ← CONFIGURE
// ---------------------------------------------------------------------------

/** Hour (24h, server local time) at which the nightly run fires */
const SCHEDULE_HOUR   = 2;   // ← CONFIGURE
/** Minute at which the nightly run fires */
const SCHEDULE_MINUTE = 15;  // ← CONFIGURE

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const logger = pino({ level: "info" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingItem {
  rowIndex:   number;
  identifier: string;   // VIN, stock number, or whatever the portal uses
}

interface LookupResult {
  identifier: string;
  status:     "found" | "not_found" | "error";
  value?:     string;   // URL, price, or any string value returned by the portal
  error?:     string;
}

// ---------------------------------------------------------------------------
// Human-behaviour helpers  (portal-agnostic — do not modify)
// ---------------------------------------------------------------------------

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function humanDelay(ms: number): Promise<void> {
  const jitter = rand(-300, 300);
  await sleep(Math.max(500, ms + jitter));
}

async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.focus(selector);
  await sleep(rand(200, 500));
  for (const char of text) {
    await page.type(selector, char, { delay: rand(60, 180) });
    if (Math.random() < 0.08) await sleep(rand(200, 600));
  }
}

async function humanScroll(page: Page): Promise<void> {
  const distance = rand(80, 250);
  const direction = Math.random() > 0.3 ? 1 : -1;
  await page.evaluate((d, dir) => window.scrollBy(0, d * dir), distance, direction);
  await sleep(rand(300, 700));
}

async function humanMouseMove(page: Page): Promise<void> {
  const width  = 1280;
  const height = 900;
  const x = rand(100, width  - 100);
  const y = rand(100, height - 100);
  // Simple Bézier approximation — moves in steps with small random offsets
  const steps = rand(10, 20);
  for (let i = 0; i < steps; i++) {
    const progress = i / steps;
    const cx = Math.round(x * progress + rand(-5, 5));
    const cy = Math.round(y * progress + rand(-5, 5));
    await page.mouse.move(cx, cy);
    await sleep(rand(20, 60));
  }
}

// ---------------------------------------------------------------------------
// Anti-detection scripts  (portal-agnostic — do not modify)
// ---------------------------------------------------------------------------

async function addAntiDetectionScripts(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // Realistic plugin list
    const pluginData = [
      { name: "Chrome PDF Plugin",      filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Chrome PDF Viewer",      filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
      { name: "Native Client",          filename: "internal-nacl-plugin",  description: "Native Client Executable" },
    ];
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const arr: any = pluginData.map(p => {
          const plugin: any = { name: p.name, filename: p.filename, description: p.description, length: 1 };
          plugin[0] = { type: "application/pdf", suffixes: "pdf", description: p.description, enabledPlugin: plugin };
          plugin.item = (i: number) => plugin[i];
          plugin.namedItem = (n: string) => pluginData.find(pd => pd.name === n) ?? null;
          return plugin;
        });
        arr.item       = (i: number) => arr[i];
        arr.namedItem  = (n: string) => arr.find((p: any) => p.name === n) ?? null;
        arr.refresh    = () => {};
        return arr;
      },
    });

    // MimeTypes
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => {
        const mt: any = [
          { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
          { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format" },
        ];
        mt.item       = (i: number) => mt[i];
        mt.namedItem  = (n: string) => mt.find((m: any) => m.type === n) ?? null;
        return mt;
      },
    });

    // Languages
    Object.defineProperty(navigator, "languages",           { get: () => ["en-CA", "en-US", "en", "fr-CA"] });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory",        { get: () => 8 });

    // Connection profile
    Object.defineProperty(navigator, "connection", {
      get: () => ({
        effectiveType:   "4g",
        downlink:        10,
        rtt:             50,
        saveData:        false,
        addEventListener:    () => {},
        removeEventListener: () => {},
      }),
    });

    // Chrome user-agent data (Chrome 90+ API)
    Object.defineProperty(navigator, "userAgentData", {
      get: () => ({
        brands: [
          { brand: "Google Chrome",  version: "120" },
          { brand: "Chromium",       version: "120" },
          { brand: "Not-A.Brand",    version: "99"  },
        ],
        mobile:    false,
        platform:  "Windows",
        getHighEntropyValues: (hints: string[]) =>
          Promise.resolve({
            architecture:    "x86",
            bitness:         "64",
            brands:          [{ brand: "Google Chrome", version: "120" }],
            fullVersionList: [{ brand: "Google Chrome", version: "120.0.6099.130" }],
            mobile:          false,
            model:           "",
            platform:        "Windows",
            platformVersion: "10.0.0",
            uaFullVersion:   "120.0.6099.130",
          }),
      }),
    });

    // Screen
    Object.defineProperty(screen, "width",       { get: () => 1280 });
    Object.defineProperty(screen, "height",      { get: () => 900  });
    Object.defineProperty(screen, "availWidth",  { get: () => 1280 });
    Object.defineProperty(screen, "availHeight", { get: () => 862  });
    Object.defineProperty(screen, "colorDepth",  { get: () => 24   });

    // Permissions API
    const origQuery = (window as any).navigator?.permissions?.query;
    if (origQuery) {
      (window as any).navigator.permissions.query = (params: any) =>
        params.name === "notifications"
          ? Promise.resolve({ state: "prompt", onchange: null })
          : origQuery(params);
    }

    // Canvas fingerprint noise
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: any) {
      const ctx = this.getContext("2d");
      if (ctx) {
        const noise = new Uint8ClampedArray(4);
        window.crypto.getRandomValues(noise);
        const pixel = ctx.getImageData(0, 0, 1, 1);
        pixel.data[0] = (pixel.data[0] + (noise[0] % 3)) & 0xff;
        ctx.putImageData(pixel, 0, 0);
      }
      return origToDataURL.call(this, type, quality);
    };

    // window.chrome
    (window as any).chrome = {
      app:     { isInstalled: false, InstallState: {}, RunningState: {} },
      runtime: {
        id:          undefined,
        connect:     () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} }),
        sendMessage: () => {},
        onMessage:   { addListener: () => {} },
        lastError:   null,
        getManifest: () => ({}),
      },
      loadTimes:      () => ({}),
      csi:            () => ({}),
      webstore:       { onInstallStageChanged: {}, onDownloadProgress: {} },
      __defined:      true,
    };
  });
}

// ---------------------------------------------------------------------------
// Browser factory  (portal-agnostic — do not modify)
// ---------------------------------------------------------------------------

async function launchBrowser(): Promise<Browser> {
  let puppeteer: any;

  // Prefer puppeteer-extra with stealth plugin when installed
  try {
    const pe      = await import("puppeteer-extra");
    const stealth = await import("puppeteer-extra-plugin-stealth");
    pe.default.use(stealth.default());
    puppeteer = pe.default;
    logger.info("Portal worker: using puppeteer-extra with stealth plugin");
  } catch {
    puppeteer = (await import("puppeteer")).default;
    logger.warn("Portal worker: puppeteer-extra not available, using plain puppeteer");
  }

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--window-size=1280,900",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--lang=en-CA,en-US",
  ];

  if (PROXY_SERVER) {
    args.push(`--proxy-server=${PROXY_SERVER}`);
    logger.info({ proxy: PROXY_SERVER }, "Portal worker: routing through proxy");
  }

  return puppeteer.launch({
    headless:  "new",
    executablePath: process.env.CHROMIUM_PATH
      ?? "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
    args,
    defaultViewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
}

// ---------------------------------------------------------------------------
// Session persistence  (portal-agnostic — do not modify)
// ---------------------------------------------------------------------------

async function saveSession(page: Page): Promise<void> {
  const cookies = await page.cookies();
  await fs.writeFile(SESSION_FILE, JSON.stringify(cookies, null, 2));
  logger.info({ count: cookies.length, file: SESSION_FILE }, "Portal worker: session saved");
}

async function loadSession(page: Page): Promise<boolean> {
  try {
    const raw     = await fs.readFile(SESSION_FILE, "utf-8");
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return false;
    await page.setCookie(...cookies);
    logger.info({ count: cookies.length, file: SESSION_FILE }, "Portal worker: loaded saved session cookies");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Apps Script communication  (portal-agnostic — do not modify)
// ---------------------------------------------------------------------------

async function fetchPendingItems(): Promise<PendingItem[]> {
  if (!APPS_SCRIPT_URL) { logger.warn("APPS_SCRIPT_WEB_APP_URL not configured"); return []; }
  let retries = 3;
  while (retries > 0) {
    try {
      const resp = await fetch(APPS_SCRIPT_URL, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as PendingItem[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      if (--retries === 0) { logger.error({ err }, "Portal worker: failed to fetch pending items after 3 attempts"); return []; }
      logger.warn({ err, retriesLeft: retries }, "Portal worker: fetch failed, retrying in 2s");
      await sleep(2_000);
    }
  }
  return [];
}

async function writeResult(rowIndex: number, value: string, batchComplete = false): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  let retries = 3;
  while (retries > 0) {
    try {
      await fetch(APPS_SCRIPT_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rowIndex, value, batchComplete }),
        signal:  AbortSignal.timeout(15_000),
      });
      return;
    } catch (err) {
      if (--retries === 0) logger.error({ err, rowIndex, value }, "Portal worker: failed to write result after 3 attempts");
      else await sleep(1_000);
    }
  }
}

async function sendAlert(message: string): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ alert: true, message }),
      signal:  AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error({ err }, "Portal worker: failed to send alert");
  }
}

// ---------------------------------------------------------------------------
//
//  ╔═══════════════════════════════════════════════════════╗
//  ║   PORTAL-SPECIFIC FUNCTIONS — IMPLEMENT THESE THREE   ║
//  ╚═══════════════════════════════════════════════════════╝
//
// ---------------------------------------------------------------------------

/**
 * isLoggedIn
 * ----------
 * After restoring cookies, navigate to the portal and determine whether
 * the session is still valid.  Return true if already logged in.
 *
 * Typical implementation:
 *   await page.goto(PORTAL_HOME_URL, { waitUntil: "networkidle2" });
 *   return page.url().startsWith(PORTAL_HOME_URL);  // redirected to login = false
 */
async function isLoggedIn(page: Page): Promise<boolean> {
  // ↓ IMPLEMENT ↓
  throw new Error("isLoggedIn() not implemented — fill in portal-specific logic");
}

/**
 * loginFresh
 * ----------
 * Navigate to the login page, enter credentials, submit the form,
 * wait for the authenticated home page, then call saveSession(page).
 *
 * Read credentials from environment variables — never hard-code them.
 * Example env vars: PORTAL_USERNAME, PORTAL_PASSWORD
 *
 * Typical implementation:
 *   await page.goto(PORTAL_LOGIN_URL, { waitUntil: "networkidle2" });
 *   await humanType(page, "input#username", process.env.PORTAL_USERNAME!);
 *   await humanType(page, "input#password", process.env.PORTAL_PASSWORD!);
 *   await page.click("button[type=submit]");
 *   await page.waitForNavigation({ waitUntil: "networkidle2" });
 *   await saveSession(page);
 */
async function loginFresh(page: Page): Promise<void> {
  // ↓ IMPLEMENT ↓
  throw new Error("loginFresh() not implemented — fill in portal-specific login flow");
}

/**
 * lookupId
 * ---------
 * Given one identifier (VIN, stock number, etc.), navigate to the search
 * page, type the identifier, wait for results, and return the extracted
 * value (URL, price string, status, etc.).
 *
 * Return a LookupResult:
 *   { identifier, status: "found",     value: "https://…" }
 *   { identifier, status: "not_found"                     }
 *   { identifier, status: "error",     error: "message"   }
 *
 * Helper functions available:
 *   humanType(page, selector, text)   — human-like keystrokes
 *   humanScroll(page)                 — random micro-scroll
 *   humanMouseMove(page)              — Bézier mouse movement
 *   humanDelay(ms)                    — jittered sleep
 *   sleep(ms)                         — exact sleep
 *
 * Selector notes:
 *   Use  el.evaluate(a => a.getAttribute("href"))  for raw href values.
 *   Use  { visible: true }  in waitForSelector to guarantee the element
 *   is actually visible, not just present in the DOM.
 */
async function lookupId(page: Page, identifier: string): Promise<LookupResult> {
  // ↓ IMPLEMENT ↓

  // Example skeleton:
  //
  // try {
  //   await page.goto(PORTAL_SEARCH_URL, { waitUntil: "networkidle2" });
  //   await humanMouseMove(page);
  //   await humanType(page, "input.searchBox",  identifier);   // ← SELECTOR
  //   await humanScroll(page);
  //   await page.waitForSelector("a.resultLink", { visible: true, timeout: 10_000 }); // ← SELECTOR
  //
  //   const el = await page.$("a.resultLink");  // ← SELECTOR
  //   if (!el) return { identifier, status: "not_found" };
  //   const value = await el.evaluate(a => a.getAttribute("href"));
  //   return { identifier, status: "found", value: value ?? undefined };
  // } catch (err: any) {
  //   return { identifier, status: "error", error: String(err.message) };
  // }

  throw new Error("lookupId() not implemented — fill in portal-specific search logic");
}

// ---------------------------------------------------------------------------
// Main worker loop  (portal-agnostic — do not modify)
// ---------------------------------------------------------------------------

export async function runPortalWorker(): Promise<void> {
  const pending = await fetchPendingItems();
  if (pending.length === 0) {
    logger.info("Portal worker: no pending items — nothing to do");
    return;
  }
  logger.info({ count: pending.length }, "Portal worker: starting batch");

  let browser!: Browser;
  let page!: Page;
  let processed = 0;
  let failed    = 0;

  try {
    browser = await launchBrowser();
    page    = await browser.newPage();
    await addAntiDetectionScripts(page);

    // Restore or acquire session
    const hasCookies = await loadSession(page);
    if (hasCookies) {
      logger.info("Portal worker: restoring saved session");
      const ok = await isLoggedIn(page);
      if (ok) {
        logger.info("Portal worker: session restored — already logged in");
      } else {
        logger.info("Portal worker: session expired — logging in fresh");
        await loginFresh(page);
      }
    } else {
      logger.info("Portal worker: no saved session — logging in fresh");
      await loginFresh(page);
    }

    // Process each item
    for (const item of pending) {
      logger.info({ identifier: item.identifier }, "Portal worker: looking up identifier");
      const result = await lookupId(page, item.identifier);

      if (result.status === "found" && result.value) {
        logger.info({ identifier: item.identifier, value: result.value }, "Portal worker: found ✓");
        await writeResult(item.rowIndex, result.value);
      } else if (result.status === "not_found") {
        logger.warn({ identifier: item.identifier }, "Portal worker: not found");
        await writeResult(item.rowIndex, "NOT FOUND");
      } else {
        logger.error({ identifier: item.identifier, error: result.error }, "Portal worker: error");
        await writeResult(item.rowIndex, `ERROR: ${result.error ?? "unknown"}`);
        failed++;
      }

      processed++;
      // Human-like pause between lookups — critical for avoiding rate detection
      await humanDelay(rand(4_000, 9_000));
    }

    // Signal batch complete to Apps Script
    if (processed > 0) await writeResult(0, "", true);

  } catch (err: any) {
    logger.error({ err }, "Portal worker: fatal error");
    await sendAlert(`Portal worker failed: ${err?.message ?? String(err)}`);
  } finally {
    await browser?.close();
    logger.info({ processed, failed }, "Portal worker: batch complete");
  }
}

// ---------------------------------------------------------------------------
// Nightly scheduler  (portal-agnostic — do not modify)
// ---------------------------------------------------------------------------

function scheduleNightlyRun(): void {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(SCHEDULE_HOUR, SCHEDULE_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const msUntilRun = next.getTime() - now.getTime();
  logger.info(
    { nextRun: next.toISOString(), minutesFromNow: Math.round(msUntilRun / 60_000) },
    "Portal worker: nightly run scheduled",
  );

  setTimeout(async () => {
    await runPortalWorker().catch(err => logger.error({ err }, "Portal worker: scheduler caught error"));
    scheduleNightlyRun();   // reschedule for the next night
  }, msUntilRun);
}

/**
 * startWorker
 * -----------
 * Call this once from your server's startup (e.g. src/index.ts).
 * If the scheduled window was missed during a server restart it will
 * run immediately (catch-up logic), then schedule the next nightly run.
 */
export function startWorker(): void {
  const now         = new Date();
  const windowStart = new Date(now);
  const windowEnd   = new Date(now);
  windowStart.setHours(SCHEDULE_HOUR,     SCHEDULE_MINUTE,      0, 0);
  windowEnd.setHours  (SCHEDULE_HOUR + 1, SCHEDULE_MINUTE + 30, 0, 0);

  if (now >= windowStart && now <= windowEnd) {
    logger.info("Portal worker: inside scheduled window on startup — running now (catch-up)");
    runPortalWorker().catch(err => logger.error({ err }, "Portal worker: catch-up run failed"));
  }

  scheduleNightlyRun();
}

```


---

*End of document.*
