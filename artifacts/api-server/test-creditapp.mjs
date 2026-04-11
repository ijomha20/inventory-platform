/**
 * CreditApp Black Book — login + endpoint test
 * Run: node artifacts/api-server/test-creditapp.mjs
 *
 * Tests:
 *  1. Puppeteer login to admin.creditapp.ca via Auth0
 *  2. 2FA "remind me later" dismissal
 *  3. Cookie extraction (appSession + CA_CSRF_TOKEN)
 *  4. POST /api/cbb/find with a real VIN
 *  5. Response structure validation
 */

import fs from "fs";
import { execSync } from "child_process";

const EMAIL    = process.env.CREDITAPP_EMAIL    ?? "";
const PASSWORD = process.env.CREDITAPP_PASSWORD ?? "";
const SESSION_FILE = "./artifacts/api-server/.creditapp-session.json";

const TEST_VIN = "2T1BU4EE6DC038563";  // Toyota Corolla from known cURL
const TEST_KM  = 145000;

const CBB_ENDPOINT = "https://admin.creditapp.ca/api/cbb/find";
const HOME_URL     = "https://admin.creditapp.ca";
const LOGIN_URL    = "https://admin.creditapp.ca/api/auth/login";

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function log(msg, data) {
  const ts = new Date().toISOString().slice(11, 19);
  if (data !== undefined) console.log(`[${ts}] ${msg}`, typeof data === "object" ? JSON.stringify(data, null, 2) : data);
  else console.log(`[${ts}] ${msg}`);
}

// ─── Session persistence ───────────────────────────────────────────────────────
function loadSavedCookies() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, "utf8");
      const parsed = JSON.parse(raw);
      log(`Loaded ${parsed.length} saved cookies from disk`);
      return parsed;
    }
  } catch (_) {}
  return [];
}

function saveCookies(cookies) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2), "utf8");
    log(`Saved ${cookies.length} cookies to disk`);
  } catch (err) {
    log("Could not save cookies: " + err.message);
  }
}

// ─── Browser launch ────────────────────────────────────────────────────────────
async function launchBrowser() {
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer-extra")).default;
    const Stealth = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(Stealth());
    log("Using puppeteer-extra + stealth");
  } catch (_) {
    puppeteer = (await import("puppeteer")).default;
    log("Using plain puppeteer (stealth not available)");
  }

  let executablePath;
  try {
    const found = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) { executablePath = found; log(`Chromium: ${found}`); }
  } catch (_) {}

  return puppeteer.launch({
    headless: "new",
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

// ─── Anti-detection ────────────────────────────────────────────────────────────
async function addAntiDetection(page) {
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8" });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
}

// ─── Element helpers ───────────────────────────────────────────────────────────
async function findSelector(page, selectors, timeout = 8000) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout });
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

async function humanType(page, element, text) {
  await element.click();
  await sleep(rand(80, 200));
  for (const ch of text) {
    await element.type(ch, { delay: 0 });
    await sleep(rand(60, 150));
  }
  await sleep(rand(200, 400));
}

// ─── 2FA dismissal ─────────────────────────────────────────────────────────────
async function dismiss2FA(page) {
  await sleep(2000);
  const dismissed = await page.evaluate(() => {
    const texts = ["remind me later", "skip", "not now", "maybe later", "do it later"];
    const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
    for (const btn of buttons) {
      const t = (btn.textContent || "").toLowerCase().trim();
      if (texts.some((x) => t.includes(x))) {
        btn.click();
        return btn.textContent.trim();
      }
    }
    return null;
  });
  if (dismissed) log(`Dismissed 2FA prompt: "${dismissed}"`);
  else log("No 2FA prompt detected");
  return dismissed;
}

// ─── Login check ───────────────────────────────────────────────────────────────
async function isLoggedIn(page) {
  try {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(2000);
    const url     = page.url();
    const content = (await page.content()).toLowerCase();
    log(`Current URL after goto HOME: ${url}`);
    // Logged in = on the dashboard/application list, NOT on auth0 domain
    const onAuth0 = url.includes("auth0.com") || url.includes("/login") || url.includes("/authorize");
    const hasDashboard = content.includes("application") || content.includes("dashboard") || content.includes("deal");
    return !onAuth0 && hasDashboard;
  } catch (err) {
    log("isLoggedIn check failed: " + err.message);
    return false;
  }
}

// ─── Auth0 login ───────────────────────────────────────────────────────────────
async function loginWithAuth0(page) {
  log("Navigating to CreditApp login...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(2000);
  log(`Login page URL: ${page.url()}`);

  const emailInput = await findSelector(page, ["#username", 'input[name="username"]', 'input[type="email"]'], 12_000);
  if (!emailInput) {
    log("ERROR: Could not find email input");
    const content = (await page.content()).slice(0, 500);
    log("Page content snippet:", content);
    return false;
  }
  log("Found email input — typing email");
  await humanType(page, emailInput, EMAIL);

  // Some Auth0 flows need a "Continue" click before password appears
  const continueBtn = await findSelector(page, ['button[type="submit"]'], 3000);
  if (continueBtn) {
    await continueBtn.click();
    await sleep(2000);
  }

  const passInput = await findSelector(page, ["#password", 'input[name="password"]', 'input[type="password"]'], 8_000);
  if (!passInput) {
    log("ERROR: Could not find password input");
    log(`URL at this point: ${page.url()}`);
    return false;
  }
  log("Found password input — typing password");
  await humanType(page, passInput, PASSWORD);

  const submitBtn = await findSelector(page, ['button[type="submit"]', 'button[name="action"]'], 5000);
  if (submitBtn) {
    await submitBtn.click();
    log("Clicked submit");
  }

  // Wait for navigation back to creditapp.ca
  await sleep(4000);
  try {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch (_) {}
  await sleep(2000);

  log(`Post-login URL: ${page.url()}`);

  // Handle 2FA if present
  await dismiss2FA(page);
  await sleep(1500);

  const loggedIn = await isLoggedIn(page);
  log(`Login result: ${loggedIn ? "SUCCESS" : "FAILED"}`);
  return loggedIn;
}

// ─── Session restore ───────────────────────────────────────────────────────────
async function ensureLoggedIn(browser, page) {
  const saved = loadSavedCookies();
  if (saved.length > 0) {
    log("Trying saved session cookies...");
    await page.setCookie(...saved);
    if (await isLoggedIn(page)) {
      log("Saved session is valid");
      return true;
    }
    log("Saved session expired — doing full login");
  }

  const ok = await loginWithAuth0(page);
  if (ok) {
    const cookies = await page.cookies();
    saveCookies(cookies);
  }
  return ok;
}

// ─── Extract auth cookies ──────────────────────────────────────────────────────
function extractAuthCookies(cookies) {
  const appSession = cookies.find((c) => c.name === "appSession");
  const csrfToken  = cookies.find((c) => c.name === "CA_CSRF_TOKEN");
  return { appSession, csrfToken };
}

// ─── Call /api/cbb/find ────────────────────────────────────────────────────────
async function callCbbEndpoint(appSession, csrfToken, vin, kilometers) {
  const cookieHeader = `appSession=${appSession}; CA_CSRF_TOKEN=${csrfToken}`;

  const body = JSON.stringify({
    vin,
    province:  "AB",
    kilometers,
    frequency: "DEFAULT",
    kmsperyear: 0,
  });

  log(`Calling ${CBB_ENDPOINT} for VIN ${vin} (${kilometers} km)...`);

  const resp = await fetch(CBB_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type":            "application/json",
      "accept":                  "*/*",
      "origin":                  "https://admin.creditapp.ca",
      "referer":                 "https://admin.creditapp.ca/",
      "x-creditapp-csrf-token":  csrfToken,
      "cookie":                  cookieHeader,
      "user-agent":              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body,
  });

  log(`Response status: ${resp.status} ${resp.statusText}`);

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }

  return { status: resp.status, data };
}

// ─── Validate response ─────────────────────────────────────────────────────────
function validateResponse(data) {
  if (!Array.isArray(data)) {
    log("FAIL: Response is not an array");
    return false;
  }
  if (data.length === 0) {
    log("WARN: Response is empty array (VIN may not exist in CBB)");
    return true;
  }
  const first = data[0];
  const hasUvc = "uvc" in first;
  const hasAvg = "adjusted_whole_avg" in first;
  log(`Response array length: ${data.length}`);
  log(`Has 'uvc' field: ${hasUvc}`);
  log(`Has 'adjusted_whole_avg' field: ${hasAvg}`);
  if (hasAvg) {
    log(`Sample values from first trim option:`, {
      uvc:                  first.uvc,
      series:               first.series,
      style:                first.style,
      adjusted_whole_avg:   first.adjusted_whole_avg,
      adjusted_whole_clean: first.adjusted_whole_clean,
      adjusted_whole_rough: first.adjusted_whole_rough,
    });
  }
  return hasUvc && hasAvg;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log("=== CreditApp Black Book Test ===");

  if (!EMAIL || !PASSWORD) {
    log("ERROR: CREDITAPP_EMAIL or CREDITAPP_PASSWORD not set in environment");
    process.exit(1);
  }

  log(`Email: ${EMAIL}`);

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await addAntiDetection(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      log("FAIL: Could not log in to CreditApp");
      process.exit(1);
    }

    const cookies = await page.cookies();
    const { appSession, csrfToken } = extractAuthCookies(cookies);

    log(`appSession found: ${!!appSession}`);
    log(`CA_CSRF_TOKEN found: ${!!csrfToken}`);

    if (!appSession || !csrfToken) {
      log("FAIL: Required auth cookies not found after login");
      log("All cookie names:", cookies.map((c) => c.name));
      process.exit(1);
    }

    await browser.close();
    browser = null;

    log("Browser closed — making direct API call with session cookies");

    const { status, data } = await callCbbEndpoint(
      appSession.value,
      csrfToken.value,
      TEST_VIN,
      TEST_KM,
    );

    if (status !== 200) {
      log(`FAIL: API returned status ${status}`);
      log("Response body:", typeof data === "string" ? data.slice(0, 500) : data);
      process.exit(1);
    }

    const valid = validateResponse(data);
    if (valid) {
      log("=== TEST PASSED: Login + endpoint both working ===");
    } else {
      log("=== TEST FAILED: Response structure unexpected ===");
      log("Raw response (first 1000 chars):", JSON.stringify(data).slice(0, 1000));
    }

  } catch (err) {
    log("UNEXPECTED ERROR: " + err.message);
    console.error(err);
    process.exit(1);
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

main();
