/**
 * Carfax Cloud Worker
 *
 * Runs nightly at 2:15am on the Replit cloud server.
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
  await page.goto(CARFAX_HOME, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await humanDelay(1500);
  const content = (await page.content()).toLowerCase();
  return (
    content.includes("sign out")  ||
    content.includes("log out")   ||
    content.includes("my account") ||
    content.includes("my carfax") ||
    content.includes("my vhrs")
  );
}

async function loginWithAuth0(page: any): Promise<boolean> {
  logger.info("Carfax worker: navigating to Auth0 login page");
  await page.goto(CARFAX_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
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
export async function runCarfaxWorker(): Promise<void> {
  logger.info("Carfax worker: starting run");

  if (!CARFAX_ENABLED) {
    logger.info("Carfax worker: DISABLED (set CARFAX_ENABLED=true to activate)");
    return;
  }
  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    logger.warn("Carfax worker: CARFAX_EMAIL or CARFAX_PASSWORD not set — skipping");
    await sendAlert("Carfax worker could not run: credentials not set in Replit secrets.");
    return;
  }

  const pendingVins = await fetchPendingVins();
  if (pendingVins.length === 0) {
    logger.info("Carfax worker: no pending VINs — nothing to do");
    return;
  }
  logger.info({ count: pendingVins.length }, "Carfax worker: fetched pending VINs");

  let browser: any = null;
  let processed = 0, succeeded = 0, notFound = 0, failed = 0;

  try {
    browser = await launchBrowser();
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
// Scheduler — nightly 2:15am with startup catch-up
// ---------------------------------------------------------------------------
export function scheduleCarfaxWorker(): void {
  let lastRunDate = "";

  const tryRun = (reason: string) => {
    const today = new Date().toISOString().slice(0, 10);
    if (lastRunDate === today) return;
    lastRunDate = today;
    logger.info({ reason }, "Carfax worker: triggering run");
    runCarfaxWorker().catch((err) => logger.error({ err }, "Carfax worker: run error"));
  };

  // Catch-up: if server starts after 2:15am, run in 30s
  const now = new Date();
  const isPast215 = now.getHours() > 2 || (now.getHours() === 2 && now.getMinutes() >= 15);
  if (isPast215) {
    logger.info("Carfax worker: server started after 2:15am — running catch-up in 30s");
    setTimeout(() => tryRun("startup catch-up"), 30_000);
  }

  // Check every minute for 2:15am
  setInterval(() => {
    const n = new Date();
    if (n.getHours() === 2 && n.getMinutes() === 15) tryRun("nightly schedule");
  }, 60_000);

  logger.info("Carfax cloud worker scheduled — runs nightly at 2:15am (with startup catch-up)");
}
