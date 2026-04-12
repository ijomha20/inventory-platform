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
