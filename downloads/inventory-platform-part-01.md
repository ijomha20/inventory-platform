# Inventory Platform — Complete Source Code
## Part 1 of 10

Root Configuration + API Server (config, entry, auth, lib utilities through bbObjectStore)

Lines 1-2561 of 27,616 total

---

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

