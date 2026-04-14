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
        operationName: "CurrentUser",
        variables: {},
        query: "query CurrentUser { currentUser { id email } }",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) return false;
    const body: any = await resp.json();
    const hasUser = !!body?.data?.currentUser?.id;
    if (hasUser) logger.info("Lender auth: GraphQL health check passed");
    return hasUser;
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
    body: JSON.stringify({ operationName, variables, query }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) throw new Error(`GraphQL HTTP ${resp.status}`);
  const body = await resp.json();
  if (body.errors?.length) {
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
    logger.info("Lender auth: on OTP enrollment page — looking for code input");
    const enrollText = await getPageText(page);
    logger.info({ pageTextSnippet: enrollText.substring(0, 400) }, "Lender auth: OTP enrollment page content");
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

  if (LENDER_TOTP_SECRET) {
    const totpCode = generateTOTP(LENDER_TOTP_SECRET);
    logger.info({ codeLength: totpCode.length }, "Lender auth: TOTP code generated");

    const otpInput = await findSelector(page, [
      'input[name="code"]',
      'input[inputmode="numeric"]',
      'input[type="text"]',
      'input[name="otp"]',
    ], 10_000);

    if (otpInput) {
      await otpInput.click().catch(() => otpInput.focus());
      await sleep(300);
      await otpInput.type(totpCode, { delay: 50 });
      await sleep(500);

      const typedLen = await otpInput.evaluate((el: HTMLInputElement) => el.value.length);
      logger.info({ typedLen, expected: 6 }, "Lender auth: TOTP code typed");

      const submitBtn = await findSelector(page, ['button[type="submit"]', 'button[name="action"]'], 5_000);
      if (submitBtn) {
        try { await submitBtn.click(); } catch (_) {
          await submitBtn.evaluate((el: HTMLElement) => el.click());
        }
        logger.info("Lender auth: TOTP code submitted");
      } else {
        await page.keyboard.press("Enter");
        logger.info("Lender auth: TOTP code submitted via Enter");
      }

      await sleep(3000);
      try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }); } catch (_) {}
      logger.info({ url: page.url() }, "Lender auth: page after TOTP submit");
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
