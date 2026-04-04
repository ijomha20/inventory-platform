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
