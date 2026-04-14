import { logger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";
import {
  loadLenderSessionFromStore,
  saveLenderSessionToStore,
} from "./bbObjectStore.js";

const LENDER_EMAIL    = process.env["LENDER_CREDITAPP_EMAIL"]?.trim()    ?? "";
const LENDER_PASSWORD = process.env["LENDER_CREDITAPP_PASSWORD"]?.trim() ?? "";
const LENDER_2FA_CODE = process.env["LENDER_CREDITAPP_2FA_CODE"]?.trim() ?? "";
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

async function handle2FA(page: any): Promise<void> {
  if (!LENDER_2FA_CODE) {
    logger.warn("Lender auth: LENDER_CREDITAPP_2FA_CODE not set — attempting dismiss");
    await sleep(2000);
    const dismissed = await clickLinkByText(page, ["remind me later", "skip", "not now", "maybe later", "do it later"]);
    if (dismissed) logger.info({ dismissed }, "Lender auth: 2FA prompt dismissed");
    return;
  }

  await sleep(2000);

  const currentUrl = page.url() as string;
  if (currentUrl.includes("/u/login/password")) {
    logger.info("Lender auth: still on password page — not a 2FA prompt, skipping");
    return;
  }

  const pageText = await getPageText(page);
  if (pageText.includes("enter your password") || pageText.includes("wrong password") || pageText.includes("incorrect password")) {
    logger.info("Lender auth: password page detected — not a 2FA prompt, skipping");
    return;
  }

  const has2FA = pageText.includes("verification") || pageText.includes("two-factor") ||
                 pageText.includes("2fa") || pageText.includes("authenticator") ||
                 pageText.includes("security code") || pageText.includes("enter the code") ||
                 pageText.includes("recovery code") || pageText.includes("verify your identity") ||
                 pageText.includes("multi-factor");

  if (!has2FA) {
    logger.info("Lender auth: no 2FA prompt detected — skipping");
    return;
  }

  logger.info("Lender auth: 2FA prompt detected — navigating to recovery code input");
  logger.info({ url: currentUrl, pageTextSnippet: pageText.substring(0, 300) }, "Lender auth: 2FA page state");

  const step1 = await clickLinkByText(page, [
    "try another method", "try another way", "use another method",
    "other methods", "i can't use this method", "other options",
    "choose another method",
  ]);
  if (step1) {
    logger.info({ clicked: step1 }, "Lender auth: step 1 — clicked 'try another method'");
    await sleep(3000);
  } else {
    logger.info("Lender auth: no 'try another method' link found — may already be on method selection");
  }

  const step2Text = await getPageText(page);
  logger.info({ pageTextSnippet: step2Text.substring(0, 300) }, "Lender auth: page state after step 1");

  const step2 = await clickLinkByText(page, [
    "recovery code", "backup code", "use a recovery code",
    "use recovery code", "enter a recovery code",
  ]);
  if (step2) {
    logger.info({ clicked: step2 }, "Lender auth: step 2 — clicked 'recovery code' option");
    await sleep(3000);
  } else {
    logger.info("Lender auth: no 'recovery code' link found — may already be on code input");
  }

  const codeInput = await findSelector(page, [
    'input[name="code"]',
    'input[name="recovery-code"]',
    'input[name="recoveryCode"]',
    'input[name="backup_code"]',
    'input[name="recovery_code"]',
    'input[type="text"]',
    'input[inputmode="numeric"]',
  ], 10000);

  if (codeInput) {
    logger.info("Lender auth: found recovery code input — entering code");
    try {
      await humanType(page, codeInput, LENDER_2FA_CODE);
    } catch (typeErr: any) {
      logger.warn({ err: typeErr.message }, "Lender auth: humanType failed for 2FA — using JS fallback");
      await codeInput.evaluate((el: HTMLInputElement, code: string) => {
        el.focus();
        el.value = code;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, LENDER_2FA_CODE);
      await sleep(500);
    }

    await sleep(1000);
    const submitBtn = await findSelector(page, ['button[type="submit"]', 'button[name="action"]'], 5000);
    if (submitBtn) {
      try {
        await submitBtn.click();
      } catch (_) {
        await submitBtn.evaluate((el: HTMLElement) => el.click());
      }
      logger.info("Lender auth: 2FA recovery code submitted");
    }
    await sleep(3000);
    try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }); } catch (_) {}
  } else {
    const finalText = await getPageText(page);
    logger.warn({ pageTextSnippet: finalText.substring(0, 400) }, "Lender auth: could not find recovery code input field");
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

  if (postUrl.includes("auth0.com") || postUrl.includes("/login")) {
    logger.info("Lender auth: still on auth page after 2FA — waiting for redirect");
    try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }); } catch (_) {}
    await sleep(3000);
    const redirectedUrl = page.url() as string;
    logger.info({ url: redirectedUrl }, "Lender auth: URL after waiting for redirect");
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

    const cookies = await page.cookies();
    const auth = extractAuthCookies(cookies);
    if (!auth) throw new Error("Required auth cookies not found after lender login");

    await saveLenderSessionToStore(cookies);
    await saveCookiesToDb(cookies);
    saveCookiesToFile(cookies);

    return auth;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}
