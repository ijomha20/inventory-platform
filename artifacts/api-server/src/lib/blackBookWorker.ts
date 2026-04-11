/**
 * Black Book Worker
 *
 * Runs nightly at 2:00am. Manual trigger via POST /api/refresh-blackbook (owner only).
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
    if (rows.length > 0 && rows[0].cookies) {
      const cookies = JSON.parse(rows[0].cookies);
      logger.info({ count: cookies.length }, "BB worker: loaded session cookies from database");
      return cookies;
    }
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
 * Get valid auth cookies — tries DB first, then file, then full browser login.
 * Browser is only launched when existing cookies fail the health check.
 */
async function getAuthCookies(): Promise<{ appSession: string; csrfToken: string }> {
  // 1. Try database cookies (shared across dev + prod, no browser needed)
  const dbCookies = await loadCookiesFromDb();
  if (dbCookies.length > 0) {
    const auth = extractAuthCookies(dbCookies);
    if (auth) {
      const ok = await healthCheck(auth.appSession, auth.csrfToken);
      if (ok) {
        logger.info("BB worker: database session valid — skipping browser login");
        return auth;
      }
      logger.info("BB worker: database session expired — will re-login");
    }
  }

  // 2. Try file cookies (dev convenience)
  const fileCookies = loadCookiesFromFile();
  if (fileCookies.length > 0) {
    const auth = extractAuthCookies(fileCookies);
    if (auth) {
      const ok = await healthCheck(auth.appSession, auth.csrfToken);
      if (ok) {
        logger.info("BB worker: file session valid — saving to database");
        await saveCookiesToDb(fileCookies);
        return auth;
      }
      logger.info("BB worker: file session expired — will re-login");
    }
  }

  // 3. Full browser login
  logger.info("BB worker: launching browser for fresh login");
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

    // Persist to both DB and file
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
    if (!Array.isArray(data) || data.length === 0) return false;
    const ok = "adjusted_whole_avg" in data[0] && "uvc" in data[0];
    if (!ok) logger.warn({ keys: Object.keys(data[0]) }, "BB worker: health check — unexpected response structure");
    return ok;
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: health check failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// NHTSA — free VIN decode for trim matching
// ---------------------------------------------------------------------------

async function decodeVinNhtsa(vin: string): Promise<{ trim: string; series: string }> {
  try {
    const resp = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!resp.ok) return { trim: "", series: "" };
    const body: any = await resp.json();
    const results: any[] = body?.Results ?? [];
    const get = (variable: string) =>
      (results.find((r) => r.Variable === variable)?.Value ?? "").toString().trim();
    return { trim: get("Trim"), series: get("Series") };
  } catch {
    return { trim: "", series: "" };
  }
}

// ---------------------------------------------------------------------------
// Trim matching
// ---------------------------------------------------------------------------

function matchBestTrim(vehicleStr: string, nhtsaTrim: string, nhtsaSeries: string, options: any[]): any | null {
  if (!options || options.length === 0) return null;
  if (options.length === 1) return options[0];

  const vLower = vehicleStr.toLowerCase();
  const tLower = nhtsaTrim.toLowerCase();
  const sLower = nhtsaSeries.toLowerCase();

  const scored = options.map((opt) => {
    const series = (opt.series ?? "").toLowerCase();
    let score = 0;
    if (series) {
      if (vLower.includes(series)) score += 20;  // vehicle string contains series name
      if (tLower.includes(series)) score += 15;  // NHTSA trim contains series name
      if (sLower.includes(series)) score += 10;  // NHTSA series contains series name
    }
    return { opt, score };
  });

  scored.sort((a, b) => b.score - a.score);

  if (scored[0].score > 0) {
    logger.info({ series: scored[0].opt.series, score: scored[0].score }, "BB worker: trim matched");
    return scored[0].opt;
  }

  // Conservative fallback: lowest avg wholesale (never over-estimate)
  const fallback = options.reduce((min, opt) =>
    (opt.adjusted_whole_avg ?? Infinity) < (min.adjusted_whole_avg ?? Infinity) ? opt : min,
  );
  logger.info({ series: fallback.series, note: "fallback-lowest" }, "BB worker: no trim match — using lowest value");
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
  let succeeded = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const item of items) {
    const { vin, vehicle, km } = item;
    if (!vin || vin.length < 10) continue;

    try {
      const kmInt = parseKm(km);

      // NHTSA decode for trim matching (best-effort — never blocks the lookup)
      const { trim: nhtsaTrim, series: nhtsaSeries } = await decodeVinNhtsa(vin);

      const options = await callCbbEndpoint(appSession, csrfToken, vin, kmInt);

      if (options.length === 0) {
        logger.info({ vin }, "BB worker: no options returned (VIN not in CBB)");
        skipped++;
        continue;
      }

      // Validate structure
      if (!("adjusted_whole_avg" in options[0])) {
        logger.warn({ vin, keys: Object.keys(options[0]) }, "BB worker: unexpected option structure — skipping VIN");
        skipped++;
        continue;
      }

      const best = matchBestTrim(vehicle, nhtsaTrim, nhtsaSeries, options);
      if (!best) { skipped++; continue; }

      bbMap.set(vin.toUpperCase(), String(Math.round(best.adjusted_whole_avg)));
      succeeded++;

      logger.info({ vin, series: best.series, avg: best.adjusted_whole_avg }, "BB worker: VIN processed");

      // Polite delay between calls
      await sleep(rand(1500, 3000));
    } catch (err) {
      logger.warn({ vin, err: String(err) }, "BB worker: VIN lookup failed — skipping");
      failed++;
    }
  }

  logger.info({ succeeded, skipped, failed, total: items.length }, "BB worker: batch complete");

  if (bbMap.size > 0) {
    await applyBlackBookValues(bbMap);
  }
}

// ---------------------------------------------------------------------------
// Self-healing retry — infinite, no notifications
// ---------------------------------------------------------------------------

async function runWithRetry(attempt = 1): Promise<void> {
  try {
    await runBlackBookBatch();
  } catch (err) {
    const waitMin = Math.min(attempt * 5, 30);
    logger.warn({ err: String(err), attempt, waitMin }, "BB worker: run failed — self-healing, will retry");
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
    const rows = await db.select({ lastRunAt: bbSessionTable.lastRunAt })
      .from(bbSessionTable)
      .where(eq(bbSessionTable.id, "singleton"));
    if (rows.length > 0 && rows[0].lastRunAt) {
      return rows[0].lastRunAt.toISOString().slice(0, 10);
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
// Scheduler — nightly 2:00am with startup catch-up
// DB-persisted run date prevents duplicate runs across restarts and dev/prod
// ---------------------------------------------------------------------------

export function scheduleBlackBookWorker(): void {
  const tryRun = async (reason: string) => {
    const today   = new Date().toISOString().slice(0, 10);
    const lastRan = await getLastRunDateFromDb();
    if (lastRan === today) {
      logger.info({ reason, lastRan }, "BB worker: already ran today — skipping");
      return;
    }
    logger.info({ reason }, "BB worker: triggering scheduled run");
    runBlackBookWorker().catch((err) => logger.error({ err }, "BB worker: scheduled run error"));
  };

  // Catch-up: if server starts after 2am and today's run not yet recorded
  const now = new Date();
  if (now.getHours() >= 2) {
    logger.info("BB worker: server started after 2am — catch-up check in 60s");
    setTimeout(() => tryRun("startup catch-up"), 60_000);
  }

  // Check every minute for 2:00am
  setInterval(() => {
    const n = new Date();
    if (n.getHours() === 2 && n.getMinutes() === 0) tryRun("nightly schedule");
  }, 60_000);

  logger.info("BB worker scheduled — runs nightly at 2:00am");
}
