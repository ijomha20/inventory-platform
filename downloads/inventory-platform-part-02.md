# Inventory Platform — Complete Source Code
## Part 2 of 10

API Server (inventoryCache, blackBookWorker, carfaxWorker)

Lines 2562-5550 of 27,616 total

---

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

