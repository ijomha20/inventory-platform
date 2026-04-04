/**
 * Carfax Cloud Worker
 *
 * Runs nightly at 2:15am on the Replit cloud server — no desktop required.
 * Fetches pending VINs from the Apps Script web app, opens a headless browser
 * on Replit's servers, logs into Carfax Canada, and looks up each VIN.
 * Results are written directly back into My List via the doPost endpoint.
 *
 * REQUIRED ENVIRONMENT VARIABLES:
 *   APPS_SCRIPT_WEB_APP_URL  — your deployed Apps Script web app URL
 *   CARFAX_EMAIL             — your Carfax Canada login email
 *   CARFAX_PASSWORD          — your Carfax Canada login password
 *
 * OPTIONAL:
 *   CARFAX_ENABLED           — set to "true" to activate (default: disabled until credentials set)
 */

import { logger } from "./logger.js";

const APPS_SCRIPT_URL = process.env["APPS_SCRIPT_WEB_APP_URL"]?.trim() ?? "";
const CARFAX_EMAIL    = process.env["CARFAX_EMAIL"]?.trim()    ?? "";
const CARFAX_PASSWORD = process.env["CARFAX_PASSWORD"]?.trim() ?? "";
const CARFAX_ENABLED  = process.env["CARFAX_ENABLED"]?.trim().toLowerCase() === "true";

const CARFAX_LOGIN_URL  = "https://dealer.carfax.ca/";
const CARFAX_REPORT_URL = "https://www.carfaxcanada.ca/vehicle-history-reports/en/";

interface PendingVin {
  rowIndex: number;
  vin:      string;
}

export interface CarfaxTestResult {
  vin:    string;
  status: "found" | "not_found" | "error" | "captcha";
  url?:   string;
  error?: string;
}

async function fetchPendingVins(): Promise<PendingVin[]> {
  if (!APPS_SCRIPT_URL) {
    logger.warn("APPS_SCRIPT_WEB_APP_URL not configured — Carfax worker skipping");
    return [];
  }
  try {
    const resp = await fetch(APPS_SCRIPT_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as PendingVin[];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logger.error({ err }, "Failed to fetch pending VINs");
    return [];
  }
}

async function writeCarfaxResult(rowIndex: number, value: string, batchComplete = false): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ rowIndex, value, batchComplete }),
    });
  } catch (err) {
    logger.error({ err, rowIndex, value }, "Failed to write Carfax result");
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
  } catch (_err) {
    logger.error({ message }, "Failed to send Carfax alert");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

async function launchBrowser(): Promise<{ puppeteer: any; browser: any }> {
  let puppeteer: any;
  try {
    puppeteer = await import("puppeteer");
  } catch (_err) {
    throw new Error("puppeteer not installed — run: pnpm add puppeteer");
  }

  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process");
    executablePath = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim() || undefined;
    if (executablePath) logger.info({ executablePath }, "Using system Chromium");
  } catch (_) { /* fall back to puppeteer's bundled browser */ }

  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
    ],
  });

  return { puppeteer, browser };
}

async function loginToCarfax(browser: any): Promise<boolean> {
  const loginPage = await browser.newPage();
  await loginPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  logger.info("Carfax worker: navigating to dealer login page");
  await loginPage.goto(CARFAX_LOGIN_URL, { waitUntil: "networkidle2", timeout: 30_000 });

  const loginCaptcha = await loginPage.$("[data-hcaptcha-widget-id], .g-recaptcha, [id*='captcha']");
  if (loginCaptcha) {
    logger.error("Carfax login page: CAPTCHA detected — worker stopping");
    await loginPage.close();
    return false;
  }

  try {
    await loginPage.waitForSelector("#username", { timeout: 10_000 });
    logger.info("Carfax worker: filling in credentials");
    await loginPage.type("#username", CARFAX_EMAIL, { delay: 80 });
    await randomDelay(300, 600);
    await loginPage.type("#password", CARFAX_PASSWORD, { delay: 80 });
    await randomDelay(400, 800);
    await loginPage.click("button[type='submit']");
    await loginPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15_000 });
  } catch (loginErr: any) {
    logger.error({ err: loginErr }, "Carfax login: form interaction failed — selectors may need updating");
    await loginPage.close();
    return false;
  }

  const currentUrl = loginPage.url();
  if (currentUrl.includes("login") || currentUrl.includes("sign-in")) {
    logger.error({ currentUrl }, "Carfax login: still on login page after submit — credentials may be wrong");
    await loginPage.close();
    return false;
  }

  await loginPage.close();
  logger.info({ landedAt: currentUrl }, "Carfax login: SUCCESS");
  return true;
}

async function lookupVin(browser: any, vin: string): Promise<{ status: "found" | "not_found" | "captcha"; url?: string }> {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.goto(`${CARFAX_REPORT_URL}?vin=${vin}`, {
    waitUntil: "networkidle2",
    timeout:   30_000,
  });

  const captcha = await page.$("[data-hcaptcha-widget-id], .g-recaptcha, [id*='captcha'], [class*='captcha']");
  if (captcha) {
    await page.close();
    return { status: "captcha" };
  }

  const pageUrl = page.url();
  await page.close();

  if (pageUrl.includes("vehicle-history-report") && !pageUrl.includes("search")) {
    return { status: "found", url: pageUrl };
  }
  return { status: "not_found" };
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
    await sendAlert(
      "Carfax worker could not run: CARFAX_EMAIL or CARFAX_PASSWORD is not set.\n\n" +
      "Add these secrets in Replit to activate automatic Carfax lookups."
    );
    return;
  }

  const pendingVins = await fetchPendingVins();
  if (pendingVins.length === 0) {
    logger.info("Carfax worker: no pending VINs — nothing to do");
    return;
  }

  logger.info({ count: pendingVins.length }, "Carfax worker: fetched pending VINs");

  let browser: any = null;
  let processed    = 0;
  let succeeded    = 0;
  let notFound     = 0;
  let failed       = 0;
  let captchaStop  = false;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;

    const loggedIn = await loginToCarfax(browser);
    if (!loggedIn) {
      await sendAlert("Carfax worker login failed. Check credentials or CAPTCHA status.");
      return;
    }

    for (const { rowIndex, vin } of pendingVins) {
      if (captchaStop) break;

      logger.info({ vin, rowIndex }, "Carfax worker: looking up VIN");

      try {
        const result = await lookupVin(browser, vin);

        if (result.status === "captcha") {
          captchaStop = true;
          logger.error({ vin }, "Carfax worker: CAPTCHA hit during VIN lookup — stopping batch");
          await sendAlert(
            `Carfax CAPTCHA detected after ${processed} VINs. Lookups paused — will retry tomorrow.`
          );
          break;
        }

        if (result.status === "found" && result.url) {
          logger.info({ vin, url: result.url }, "Carfax worker: VIN found ✓");
          await writeCarfaxResult(rowIndex, result.url);
          succeeded++;
        } else {
          logger.info({ vin }, "Carfax worker: VIN not found in Carfax");
          await writeCarfaxResult(rowIndex, "NOT FOUND");
          notFound++;
        }

        processed++;
        await randomDelay(3_000, 7_000);
      } catch (vinErr: any) {
        logger.error({ vin, err: vinErr }, "Carfax worker: VIN lookup error");
        failed++;
        await randomDelay(2_000, 4_000);
      }
    }

    if (processed > 0) {
      await writeCarfaxResult(0, "", true);
    }
  } catch (err) {
    logger.error({ err }, "Carfax worker: unexpected crash");
    await sendAlert("Carfax worker crashed unexpectedly: " + String(err));
  } finally {
    if (browser) await browser.close();
  }

  logger.info({ processed, succeeded, notFound, failed, captchaStop }, "Carfax worker: run complete");
}

// ---------------------------------------------------------------------------
// Public: run against specific VINs for testing — does NOT write to Apps Script
// ---------------------------------------------------------------------------
export async function runCarfaxWorkerForVins(vins: string[]): Promise<CarfaxTestResult[]> {
  const results: CarfaxTestResult[] = [];

  logger.info({ vins }, "Carfax test run: starting");

  if (!CARFAX_ENABLED) {
    logger.warn("Carfax test run: CARFAX_ENABLED is not true — proceeding anyway for test");
  }

  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    logger.error("Carfax test run: CARFAX_EMAIL or CARFAX_PASSWORD not set");
    return vins.map((vin) => ({ vin, status: "error" as const, error: "Missing credentials" }));
  }

  let browser: any = null;

  try {
    logger.info("Carfax test run: launching browser");
    const launched = await launchBrowser();
    browser = launched.browser;

    logger.info("Carfax test run: logging in");
    const loggedIn = await loginToCarfax(browser);
    if (!loggedIn) {
      logger.error("Carfax test run: login failed");
      return vins.map((vin) => ({ vin, status: "error" as const, error: "Login failed — check credentials or CAPTCHA" }));
    }

    for (const vin of vins) {
      logger.info({ vin }, "Carfax test run: looking up VIN");
      try {
        const result = await lookupVin(browser, vin);

        if (result.status === "captcha") {
          logger.error({ vin }, "Carfax test run: CAPTCHA hit");
          results.push({ vin, status: "captcha", error: "CAPTCHA detected — try again later" });
          break;
        }

        if (result.status === "found" && result.url) {
          logger.info({ vin, url: result.url }, "Carfax test run: VIN found ✓");
          results.push({ vin, status: "found", url: result.url });
        } else {
          logger.info({ vin }, "Carfax test run: VIN not found");
          results.push({ vin, status: "not_found" });
        }

        await randomDelay(2_000, 4_000);
      } catch (vinErr: any) {
        logger.error({ vin, err: vinErr }, "Carfax test run: VIN lookup error");
        results.push({ vin, status: "error", error: vinErr.message });
      }
    }
  } catch (err: any) {
    logger.error({ err }, "Carfax test run: unexpected crash");
    const remaining = vins.filter((v) => !results.find((r) => r.vin === v));
    for (const vin of remaining) {
      results.push({ vin, status: "error", error: err.message });
    }
  } finally {
    if (browser) await browser.close();
  }

  logger.info({ results }, "Carfax test run: complete");
  return results;
}

// ---------------------------------------------------------------------------
// Scheduler — runs nightly at 2:15am with catch-up on startup
// ---------------------------------------------------------------------------
export function scheduleCarfaxWorker(): void {
  const TWO_FIFTEEN_HOUR   = 2;
  const TWO_FIFTEEN_MINUTE = 15;

  let lastRunDate = "";

  const tryRun = (reason: string) => {
    const today = new Date().toISOString().slice(0, 10);
    if (lastRunDate === today) return;
    lastRunDate = today;
    logger.info({ reason }, "Carfax worker: triggering run");
    runCarfaxWorker().catch((err) => logger.error({ err }, "Carfax worker: run error"));
  };

  // Catch-up check: if we're past 2:15am today and haven't run yet, run now
  const now    = new Date();
  const hour   = now.getHours();
  const minute = now.getMinutes();
  const isPast215 = hour > TWO_FIFTEEN_HOUR || (hour === TWO_FIFTEEN_HOUR && minute >= TWO_FIFTEEN_MINUTE);

  if (isPast215) {
    logger.info("Carfax worker: server started after 2:15am — running catch-up in 30s");
    setTimeout(() => tryRun("startup catch-up"), 30_000);
  }

  // Regular nightly schedule — check every minute
  setInterval(() => {
    const n      = new Date();
    const h      = n.getHours();
    const m      = n.getMinutes();
    if (h === TWO_FIFTEEN_HOUR && m === TWO_FIFTEEN_MINUTE) {
      tryRun("nightly schedule");
    }
  }, 60_000);

  logger.info("Carfax cloud worker scheduled — runs nightly at 2:15am (with startup catch-up)");
}
