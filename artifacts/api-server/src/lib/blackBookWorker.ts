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
 * OPTIONAL SECRETS: CREDITAPP_TOTP_SECRET, BB_CBB_ENDPOINT
 */

import { logger }                         from "./logger.js";
import { env, isProduction }              from "./env.js";
import * as fs                            from "fs";
import * as path                          from "path";
import * as crypto                        from "crypto";
import { getCacheState, applyBlackBookValues } from "./inventoryCache.js";
import {
  loadSessionFromStore,
  saveSessionToStore,
  saveBbValuesToStore,
} from "./bbObjectStore.js";
import { scheduleRandomDaily, toMountainDateStr } from "./randomScheduler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREDITAPP_EMAIL       = env.CREDITAPP_EMAIL;
const CREDITAPP_PASSWORD    = env.CREDITAPP_PASSWORD;
const CREDITAPP_TOTP_SECRET = env.CREDITAPP_TOTP_SECRET;
const BB_ENABLED            = !!(CREDITAPP_EMAIL && CREDITAPP_PASSWORD);

const CBB_ENDPOINT    = env.BB_CBB_ENDPOINT || "https://admin.creditapp.ca/api/cbb/find";
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

export async function getBlackBookLastRunAtIso(): Promise<string | null> {
  try {
    // Lazy: DB only needed for status/ops introspection
    const { db, bbSessionTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select({ lastRunAt: bbSessionTable.lastRunAt })
      .from(bbSessionTable)
      .where(eq(bbSessionTable.id, "singleton"));
    const lastRunAt = rows[0]?.lastRunAt ?? null;
    return lastRunAt ? lastRunAt.toISOString() : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "BB worker: could not read persistent last run timestamp");
    return null;
  }
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
// TOTP generation (mirrors lenderAuth.ts)
// ---------------------------------------------------------------------------

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
    // Lazy: DB only needed for session/schedule bookkeeping
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
    // Lazy: DB only needed for session/schedule bookkeeping
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

    // After Auth0 login the browser may be on the auth domain — navigate to
    // the app domain so appSession + CA_CSRF_TOKEN cookies are set.
    let currentUrl = page.url() as string;
    logger.info({ currentUrl }, "BB worker: URL after login flow");

    if (currentUrl.includes("auth.admin.creditapp.ca") || !currentUrl.includes("admin.creditapp.ca")) {
      logger.info("BB worker: navigating to admin.creditapp.ca to collect app cookies");
      await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(3000);
      currentUrl = page.url() as string;
      logger.info({ currentUrl }, "BB worker: URL after navigating to app domain");
    }

    const cookies = await page.cookies(CREDITAPP_HOME);
    const cookieNames = cookies.map((c: any) => c.name);
    logger.info({ currentUrl, cookieCount: cookies.length, cookieNames }, "BB worker: cookies after login");

    let auth = extractAuthCookies(cookies);
    if (!auth) {
      // Fallback: try the auth subdomain (some Auth0 configs set cookies there)
      const authDomainCookies = await page.cookies("https://auth.admin.creditapp.ca");
      const authCookieNames = authDomainCookies.map((c: any) => c.name);
      logger.warn({ cookieNames, authCookieNames, currentUrl }, "BB worker: appSession/CA_CSRF_TOKEN not on app domain — trying auth domain");
      auth = extractAuthCookies(authDomainCookies);
    }
    if (!auth) {
      // Last resort: use CDP to get all cookies including httpOnly
      try {
        const client = await page.createCDPSession();
        const { cookies: allCookies } = await client.send("Network.getAllCookies");
        const allNames = allCookies.map((c: any) => c.name);
        logger.info({ allCookieCount: allCookies.length, allNames }, "BB worker: all cookies via CDP");
        auth = extractAuthCookies(allCookies);
        if (auth) {
          // Use the full CDP cookie set for persistence
          cookies.length = 0;
          cookies.push(...allCookies);
        }
      } catch (cdpErr) {
        logger.warn({ err: String(cdpErr) }, "BB worker: CDP cookie fallback failed");
      }
    }
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
  // Lazy: heavy deps loaded only when browser automation runs
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
// Page helpers (mirrored from lenderAuth.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 2FA / MFA handling (mirrored from lenderAuth.ts)
// ---------------------------------------------------------------------------

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
    logger.info("BB worker: already on OTP challenge page");
    return;
  }

  if (url.includes("mfa-sms-enrollment") || url.includes("mfa-sms-challenge")) {
    logger.info("BB worker: on SMS page — clicking 'try another method'");
    const switched = await clickLinkByText(page, SWITCH_LINKS);
    if (switched) {
      logger.info({ clicked: switched }, "BB worker: clicked switch link");
      await sleep(3000);
      url = page.url() as string;
    }
  }

  if (url.includes("mfa-enroll-options") || url.includes("mfa-login-options")) {
    logger.info("BB worker: on method selection page — selecting OTP/authenticator");
    const pageText = await getPageText(page);
    logger.info({ pageTextSnippet: pageText.substring(0, 400) }, "BB worker: method options page content");

    const otpClicked = await clickLinkByText(page, OTP_METHODS);
    if (otpClicked) {
      logger.info({ clicked: otpClicked }, "BB worker: selected OTP method");
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
      logger.info({ links: allLinks.slice(0, 15) }, "BB worker: clickable elements on options page");
    }
    url = page.url() as string;
    logger.info({ url }, "BB worker: page after selecting OTP method");
  }

  if (url.includes("mfa-otp-enrollment")) {
    logger.info("BB worker: on OTP enrollment page — extracting secret from QR/page");

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
      logger.info({ secretLen: extractedSecret.length, method: "qr-img-src" }, "BB worker: extracted TOTP secret");
      enrolledTotpSecret = extractedSecret;
    } else {
      logger.info("BB worker: QR src extraction failed — trying 'trouble scanning?' link");
      const cantScan = await clickLinkByText(page, [
        "can't scan", "trouble scanning", "enter key manually",
        "manual entry", "enter code manually", "having trouble",
        "can not scan", "setup key", "enter this code",
      ]);
      if (cantScan) {
        logger.info({ clicked: cantScan }, "BB worker: clicked 'trouble scanning' link");
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
        logger.info({ secretLen: extractedSecret.length, method: "trouble-scanning" }, "BB worker: extracted TOTP secret");
        enrolledTotpSecret = extractedSecret;
      } else {
        const pageHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || "");
        logger.warn({ pageHtmlSnippet: pageHtml.substring(0, 800) }, "BB worker: could not extract TOTP secret");
      }
    }
  }
}

async function handle2FA(page: any): Promise<void> {
  await sleep(2000);

  const currentUrl = page.url() as string;
  if (currentUrl.includes("/u/login/password")) {
    logger.info("BB worker: still on password page — not a 2FA prompt, skipping");
    return;
  }

  const pageText = await getPageText(page);
  if (pageText.includes("enter your password") || pageText.includes("wrong password")) {
    logger.info("BB worker: password page detected — skipping 2FA handler");
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
    // No MFA wall — try the old dismiss approach as a fallback for soft prompts
    const dismissed = await clickLinkByText(page, ["remind me later", "skip", "not now", "maybe later", "do it later"]);
    if (dismissed) logger.info({ dismissed }, "BB worker: 2FA prompt dismissed");
    else logger.info("BB worker: no 2FA prompt detected — skipping");
    return;
  }

  logger.info({ url: currentUrl, pageTextSnippet: pageText.substring(0, 300) }, "BB worker: 2FA prompt detected");

  await navigateToOtpPage(page, currentUrl);

  const activeSecret = enrolledTotpSecret || CREDITAPP_TOTP_SECRET;
  if (activeSecret) {
    const secretSource = enrolledTotpSecret ? "enrollment-extracted" : "env-var";
    const totpCode = generateTOTP(activeSecret);
    logger.info({ codeLength: totpCode.length, secretSource }, "BB worker: TOTP code generated");

    const allInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map((el: HTMLInputElement) => ({
        name: el.name, type: el.type, id: el.id, placeholder: el.placeholder,
        inputMode: el.inputMode, readOnly: el.readOnly, disabled: el.disabled,
        valueLen: el.value.length, visible: el.offsetParent !== null,
        classes: el.className.substring(0, 60),
      }));
    });
    logger.info({ allInputs }, "BB worker: all inputs on page before OTP entry");

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
      logger.info({ inputAttrs }, "BB worker: selected OTP input element");

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
      logger.info({ typedLen, expected: 6 }, "BB worker: TOTP code typed");

      if (typedLen !== 6) {
        logger.warn("BB worker: keyboard.press result unexpected — using nativeSet + dispatchEvent");
        await otpInput.evaluate((el: HTMLInputElement, code: string) => {
          const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          nativeSet.call(el, code);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, totpCode);
        await sleep(500);
        const retryLen = await otpInput.evaluate((el: HTMLInputElement) => el.value.length);
        logger.info({ retryLen }, "BB worker: TOTP code set (nativeSet fallback)");
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
        logger.info({ method: submitted }, "BB worker: TOTP code submitted via same-form method");
      } else {
        const submitBtn = await findSelector(page, ['button[type="submit"]', 'button[name="action"]'], 5_000);
        if (submitBtn) {
          try { await submitBtn.click(); } catch (_) {
            await submitBtn.evaluate((el: HTMLElement) => el.click());
          }
          logger.info("BB worker: TOTP code submitted via global button");
        } else {
          await page.keyboard.press("Enter");
          logger.info("BB worker: TOTP code submitted via Enter");
        }
      }

      await sleep(3000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }); } catch (_) {}
      const postTotpUrl = page.url() as string;
      logger.info({ url: postTotpUrl }, "BB worker: page after TOTP submit");

      if (postTotpUrl.includes("mfa-otp-enrollment")) {
        const errText = await page.evaluate(() => {
          const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"]');
          return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
        });
        logger.warn({ errText }, "BB worker: still on OTP enrollment — code may have been rejected");
      }

      if (postTotpUrl.includes("recovery-code") || postTotpUrl.includes("new-code")) {
        const recoveryText = await getPageText(page);
        logger.info({ pageTextSnippet: recoveryText.substring(0, 300) }, "BB worker: recovery code page detected");

        const checkbox = await page.$('input[type="checkbox"]');
        if (checkbox) {
          await checkbox.click();
          logger.info("BB worker: checked recovery code confirmation checkbox");
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
          logger.info({ clicked: formSubmitted }, "BB worker: submitted recovery code form");
        } else {
          const continueBtn = await clickLinkByText(page, ["continue", "done", "next", "i have saved it", "i've saved"]);
          if (continueBtn) logger.info({ clicked: continueBtn }, "BB worker: clicked continue on recovery code page");
        }
        await sleep(3000);
        try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}

        const afterRecoveryUrl = page.url() as string;
        logger.info({ url: afterRecoveryUrl }, "BB worker: page after recovery code");

        if (afterRecoveryUrl.includes("recovery-code")) {
          logger.info("BB worker: still on recovery code page — trying all buttons");
          await page.evaluate(() => {
            const btns = document.querySelectorAll("button");
            for (const btn of btns) {
              if (!btn.disabled && btn.offsetParent !== null) { btn.click(); break; }
            }
          });
          await sleep(3000);
          try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}
          logger.info({ url: page.url() }, "BB worker: page after recovery code retry");
        }
      }

      const afterUrl = page.url() as string;
      if (afterUrl.includes("mfa-sms-enrollment")) {
        logger.info("BB worker: redirected to SMS enrollment after OTP — attempting to skip");
        const skipBtn = await clickLinkByText(page, [
          "skip", "not now", "maybe later", "do it later", "remind me later",
        ]);
        if (skipBtn) {
          logger.info({ clicked: skipBtn }, "BB worker: skipped SMS enrollment");
          await sleep(3000);
          try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }); } catch (_) {}
        }
        logger.info({ url: page.url() }, "BB worker: page after SMS enrollment skip attempt");
      }
    } else {
      logger.error("BB worker: could not find OTP input field");
    }
  } else {
    logger.warn("BB worker: no TOTP secret — cannot handle 2FA automatically");
  }
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

  const loginUrl = page.url() as string;
  logger.info({ url: loginUrl }, "BB worker: login page loaded");

  const emailInput = await findSelector(page, AUTH0_EMAIL_SELECTORS, 12_000);
  if (!emailInput) { logger.error("BB worker: email input not found"); return false; }
  logger.info("BB worker: email input found — typing email");
  await humanType(page, emailInput, CREDITAPP_EMAIL);

  const maybeBtn = await findSelector(page, ['button[type="submit"]'], 2000);
  if (maybeBtn) {
    logger.info("BB worker: clicking continue/submit after email");
    try { await maybeBtn.click(); } catch (_) {
      await maybeBtn.evaluate((el: HTMLElement) => el.click());
    }
    await sleep(3000);
  }

  const passUrl = page.url() as string;
  logger.info({ url: passUrl }, "BB worker: page after email submit");

  const passInput = await findSelector(page, AUTH0_PASS_SELECTORS, 12_000);
  if (!passInput) { logger.error("BB worker: password input not found"); return false; }

  await passInput.click().catch(() => passInput.focus());
  await sleep(500);

  for (const ch of CREDITAPP_PASSWORD) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
    await sleep(rand(40, 80));
  }
  await sleep(1000);

  const typedLen = await passInput.evaluate((el: HTMLInputElement) => el.value.length);
  logger.info({ typedLen, expected: CREDITAPP_PASSWORD.length }, "BB worker: password typed");

  if (typedLen !== CREDITAPP_PASSWORD.length) {
    logger.warn("BB worker: keyboard.press didn't fill — falling back to element.type()");
    await passInput.evaluate((el: HTMLInputElement) => {
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      nativeSet.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(200);
    await passInput.type(CREDITAPP_PASSWORD, { delay: 50 });
    await sleep(500);
  }

  await sleep(500);
  logger.info("BB worker: submitting password via Enter key");
  await page.keyboard.press("Enter");

  logger.info("BB worker: waiting for post-password navigation");
  await sleep(4000);
  try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }); } catch (_) {}
  await sleep(2000);

  const postPasswordUrl = page.url() as string;
  const postPasswordText = await getPageText(page);
  logger.info({ url: postPasswordUrl, textSnippet: postPasswordText.substring(0, 500) }, "BB worker: page state after password submit");

  const stillOnPassword = postPasswordUrl.includes("/u/login/password") || postPasswordText.includes("enter your password");
  if (stillOnPassword) {
    const errorText = await page.evaluate(() => {
      const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"], .ulp-input-error');
      return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
    });
    logger.error({ errorText }, "BB worker: still on password page — checking for error messages");

    logger.info("BB worker: retrying password — select all + retype");
    const passRetry = await findSelector(page, AUTH0_PASS_SELECTORS, 5_000);
    if (passRetry) {
      await passRetry.click({ clickCount: 3 }).catch(() => passRetry.focus());
      await sleep(300);
      await passRetry.type(CREDITAPP_PASSWORD, { delay: 40 });
      await sleep(500);
      await page.keyboard.press("Enter");
      await sleep(5000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }); } catch (_) {}
      await sleep(2000);
      const retryUrl = page.url() as string;
      logger.info({ url: retryUrl }, "BB worker: URL after password retry");
      if (retryUrl.includes("/u/login/password")) {
        const retryErrors = await page.evaluate(() => {
          const errs = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"], .ulp-input-error');
          return Array.from(errs).map((e: Element) => (e as HTMLElement).textContent?.trim()).filter(Boolean);
        });
        logger.error({ retryErrors }, "BB worker: still on password page after retry — login failed");
        return false;
      }
    }
  }

  await handle2FA(page);
  await sleep(3000);

  const postUrl = page.url() as string;
  const postContent = (await page.content() as string).substring(0, 500);
  logger.info({ url: postUrl, contentSnippet: postContent.substring(0, 200) }, "BB worker: page state after 2FA");

  const onAuthDomain = postUrl.includes("auth0.com") || postUrl.includes("auth.admin.creditapp.ca") || postUrl.includes("/login");
  if (onAuthDomain) {
    logger.info("BB worker: still on auth page after 2FA — navigating to CreditApp home");
    try {
      await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (_) {}
    await sleep(3000);
    const redirectedUrl = page.url() as string;
    logger.info({ url: redirectedUrl }, "BB worker: URL after navigating to CreditApp home");

    if (redirectedUrl.includes("mfa-otp-challenge") || redirectedUrl.includes("mfa-sms-challenge") ||
        redirectedUrl.includes("mfa-otp-enrollment") || redirectedUrl.includes("mfa-sms-enrollment")) {
      logger.info("BB worker: redirected to MFA page after nav — handling second 2FA round");
      await handle2FA(page);
      await sleep(3000);

      const post2ndUrl = page.url() as string;
      logger.info({ url: post2ndUrl }, "BB worker: URL after second 2FA round");

      if (post2ndUrl.includes("auth.admin.creditapp.ca")) {
        logger.info("BB worker: still on auth domain after second 2FA — navigating to CreditApp home again");
        try {
          await page.goto(CREDITAPP_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
        } catch (_) {}
        await sleep(3000);
        logger.info({ url: page.url() }, "BB worker: URL after second CreditApp nav");
      }
    }
  }

  const ok = await isLoggedIn(page);
  logger.info({ ok }, "BB worker: login result");
  return ok;
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
// Self-healing retry — bounded; avoids wedging status.running forever
// ---------------------------------------------------------------------------

const PERMANENT_ERROR_PREFIX = "BB worker: session cookies expired in production";
/** Matches runBlackBookBatch() when the in-memory inventory list is empty */
const EMPTY_INVENTORY_MSG = "Inventory cache is empty";
/** Cap transient retries so the worker cannot block all future runs indefinitely */
const MAX_BATCH_ATTEMPTS = 20;

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
    // Empty cache is not transient — retrying would wedge status.running until cache fills
    if (msg.includes(EMPTY_INVENTORY_MSG)) {
      logger.warn({ err: msg }, "BB worker: empty inventory — not retrying");
      throw err;
    }
    if (attempt >= MAX_BATCH_ATTEMPTS) {
      logger.error({ err: msg, attempt }, "BB worker: max transient retries exceeded — giving up");
      throw err;
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
    // Lazy: DB only needed for session/schedule bookkeeping
    const { db, bbSessionTable } = await import("@workspace/db");
    const { eq }                 = await import("drizzle-orm");
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
    // Lazy: DB only needed for session/schedule bookkeeping
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
