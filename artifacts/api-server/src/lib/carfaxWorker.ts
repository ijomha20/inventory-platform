/**
 * Carfax Cloud Worker
 *
 * Runs nightly at 2am on the Replit cloud server — no desktop required.
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

// Carfax Canada URLs — verify against current site if lookups stop working
// Consumer login uses magic links; dealer accounts use dealer.carfax.ca (Auth0 password form)
const CARFAX_LOGIN_URL  = "https://dealer.carfax.ca/";
const CARFAX_REPORT_URL = "https://www.carfaxcanada.ca/vehicle-history-reports/en/";

interface PendingVin {
  rowIndex: number;
  vin:      string;
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

export async function runCarfaxWorker(): Promise<void> {
  if (!CARFAX_ENABLED) {
    logger.info("Carfax worker is disabled (set CARFAX_ENABLED=true to activate)");
    return;
  }

  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    logger.warn("CARFAX_EMAIL or CARFAX_PASSWORD not set — Carfax worker skipping");
    await sendAlert(
      "Carfax worker could not run: CARFAX_EMAIL or CARFAX_PASSWORD is not set in your Replit environment secrets.\n\n" +
      "Add these secrets to activate automatic Carfax lookups."
    );
    return;
  }

  const pendingVins = await fetchPendingVins();
  if (pendingVins.length === 0) {
    logger.info("Carfax worker: no pending VINs");
    return;
  }

  logger.info({ count: pendingVins.length }, "Carfax worker starting");

  let puppeteer: any;
  try {
    puppeteer = await import("puppeteer");
  } catch (_err) {
    logger.warn("puppeteer not installed — Carfax worker cannot run. Run: pnpm add puppeteer");
    return;
  }

  let browser: any = null;
  let processed    = 0;
  let succeeded    = 0;
  let notFound     = 0;
  let failed       = 0;
  let captchaStop  = false;

  // Resolve system Chromium path (NixOS wraps Chromium with all its dependencies)
  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process");
    executablePath = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim() || undefined;
  } catch (_) { /* fall back to puppeteer's bundled browser */ }

  try {
    browser = await puppeteer.default.launch({
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

    // -------------------------------------------------------------------------
    // Login to Carfax Canada
    // -------------------------------------------------------------------------
    const loginPage = await browser.newPage();
    await loginPage.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await loginPage.goto(CARFAX_LOGIN_URL, { waitUntil: "networkidle2", timeout: 30_000 });

    // Check for CAPTCHA on login page
    const loginCaptcha = await loginPage.$("[data-hcaptcha-widget-id], .g-recaptcha, [id*='captcha']");
    if (loginCaptcha) {
      logger.error("Carfax login page CAPTCHA detected — worker stopping");
      await sendAlert(
        "Carfax CAPTCHA detected on login page. Automatic lookups paused.\n\n" +
        "This usually resolves on its own within 24 hours. No action needed unless this persists."
      );
      return;
    }

    // Fill in dealer login form (Auth0 — selectors: #username, #password, button[type='submit'])
    try {
      await loginPage.waitForSelector("#username", { timeout: 10_000 });
      await loginPage.type("#username", CARFAX_EMAIL, { delay: 80 });
      await randomDelay(300, 600);
      await loginPage.type("#password", CARFAX_PASSWORD, { delay: 80 });
      await randomDelay(400, 800);
      await loginPage.click("button[type='submit']");
      await loginPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15_000 });
    } catch (loginErr: any) {
      logger.error({ err: loginErr }, "Carfax login failed — selectors may need updating");
      await sendAlert(
        "Carfax worker login failed. The Carfax website may have changed.\n\n" +
        "Error: " + loginErr.message + "\n\n" +
        "Carfax lookups will need to be done manually until this is fixed."
      );
      return;
    }

    // Verify login succeeded
    const currentUrl = loginPage.url();
    if (currentUrl.includes("login") || currentUrl.includes("sign-in")) {
      logger.error("Carfax login appears to have failed — still on login page");
      await sendAlert(
        "Carfax worker could not log in. Check that your CARFAX_EMAIL and CARFAX_PASSWORD are correct."
      );
      return;
    }

    await loginPage.close();
    logger.info("Carfax login successful");

    // -------------------------------------------------------------------------
    // Look up each VIN
    // -------------------------------------------------------------------------
    for (const { rowIndex, vin } of pendingVins) {
      if (captchaStop) break;

      try {
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        await page.goto(`${CARFAX_REPORT_URL}?vin=${vin}`, {
          waitUntil: "networkidle2",
          timeout:   30_000,
        });

        // Check for CAPTCHA
        const captcha = await page.$("[data-hcaptcha-widget-id], .g-recaptcha, [id*='captcha'], [class*='captcha']");
        if (captcha) {
          captchaStop = true;
          await page.close();
          logger.error({ vin }, "Carfax CAPTCHA detected during VIN lookup — stopping");
          await sendAlert(
            `Carfax CAPTCHA detected after ${processed} VINs processed. ` +
            "Lookups paused for today — will retry tomorrow automatically."
          );
          break;
        }

        const pageUrl = page.url();

        // Success: the URL changes to include a report identifier
        if (pageUrl.includes("vehicle-history-report") && !pageUrl.includes("search")) {
          await writeCarfaxResult(rowIndex, pageUrl);
          succeeded++;
        } else {
          // VIN not found in Carfax
          await writeCarfaxResult(rowIndex, "NOT FOUND");
          notFound++;
        }

        processed++;
        await page.close();

        // Human-like delay between lookups (3–7 seconds)
        await randomDelay(3_000, 7_000);
      } catch (vinErr: any) {
        logger.error({ vin, err: vinErr }, "VIN lookup error");
        failed++;
        await randomDelay(2_000, 4_000);
      }
    }

    // Final batch-complete signal so Apps Script notifies Replit to refresh
    if (processed > 0) {
      await writeCarfaxResult(0, "", true);
    }
  } catch (err) {
    logger.error({ err }, "Carfax worker crashed");
    await sendAlert("Carfax worker encountered an unexpected error: " + String(err));
  } finally {
    if (browser) await browser.close();
  }

  logger.info({ processed, succeeded, notFound, failed, captchaStop }, "Carfax worker complete");
}

export function scheduleCarfaxWorker(): void {
  // Run nightly at 2:15am to avoid peak hours
  // Uses a simple setInterval that checks the time every minute
  const TWO_FIFTEEN_AM_HOUR   = 2;
  const TWO_FIFTEEN_AM_MINUTE = 15;

  let lastRunDate = "";

  const checkAndRun = () => {
    const now    = new Date();
    const today  = now.toISOString().slice(0, 10);
    const hour   = now.getHours();
    const minute = now.getMinutes();

    if (
      hour === TWO_FIFTEEN_AM_HOUR &&
      minute === TWO_FIFTEEN_AM_MINUTE &&
      today !== lastRunDate
    ) {
      lastRunDate = today;
      logger.info("Carfax worker triggered by scheduler");
      runCarfaxWorker().catch((err) => logger.error({ err }, "Carfax worker error"));
    }
  };

  // Check every minute
  setInterval(checkAndRun, 60_000);
  logger.info("Carfax cloud worker scheduled — runs nightly at 2:15am");
}
