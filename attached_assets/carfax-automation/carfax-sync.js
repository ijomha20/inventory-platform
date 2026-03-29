// ================================================================
// CARFAX AUTOMATION v1.3
// Uses Playwright's own built-in browser — no conflict with Chrome
// or Edge being open. Saves your Carfax login session locally so
// you only need to log in on the very first run.
//
// Run once:        node carfax-sync.js
// Watch mode:      node carfax-sync.js --watch
//   Keeps running, checks every WATCH_INTERVAL minutes (default 5)
//   for new VINs and processes them automatically.
// ================================================================

var fs   = require('fs');
var path = require('path');

require('dotenv').config();

var { chromium } = require('playwright');
var fetch        = require('node-fetch');

// ----------------------------------------------------------------
// SELECTORS
// ----------------------------------------------------------------
var SELECTORS = {
  loginEmail: [
    'input[type="email"]',
    'input[name="email"]',
    'input[id*="email"]',
    'input[placeholder*="email"]'
  ],
  loginPassword: [
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="password"]'
  ],
  loginButton: [
    'button[type="submit"]',
    'button:has-text("Sign In")',
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'input[type="submit"]'
  ],
  vinSearchInput: [
    'input.searchVehicle',
    'input.searchbox.searchVehicle',
    'input[placeholder*="VIN"]',
    'input[type="search"]'
  ],
  globalArchiveToggle: [
    'label#global-archive',
    'input#globalreports'
  ],
  reportLink: [
    'a.reportLink',
    'a[href*="cfm/display_cfm"]',
    'a[href*="vhr"]',
    'a[href*="/cfm/"]'
  ]
};

var CARFAX_LOGIN_URL = 'https://dealer.carfax.ca/login';
var CARFAX_VHR_URL   = 'https://dealer.carfax.ca/MyReports';
var CARFAX_HOME      = 'https://dealer.carfax.ca/';

// Session is saved here so login persists between runs
var SESSION_DIR = path.join(__dirname, '.carfax-session');

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function humanDelay(base) {
  return sleep(base + rand(0, 1000));
}

async function humanClick(page, element) {
  var box = await element.boundingBox();
  if (!box) { await element.click(); return; }
  var targetX = box.x + rand(Math.floor(box.width * 0.2),  Math.floor(box.width * 0.8));
  var targetY = box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8));
  var startX  = rand(100, 900);
  var startY  = rand(100, 600);
  var steps   = rand(12, 22);
  for (var i = 0; i <= steps; i++) {
    var t    = i / steps;
    var ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await page.mouse.move(
      startX + (targetX - startX) * ease + rand(-3, 3),
      startY + (targetY - startY) * ease + rand(-3, 3)
    );
    await sleep(rand(8, 22));
  }
  await sleep(rand(60, 180));
  await page.mouse.click(targetX, targetY);
}

async function humanType(element, text) {
  await element.click();
  await sleep(rand(80, 200));
  for (var i = 0; i < text.length; i++) {
    await element.type(text[i], { delay: 0 });
    var d = rand(60, 160);
    if (i > 0 && i % rand(4, 7) === 0) d += rand(150, 400);
    await sleep(d);
  }
  await sleep(rand(200, 500));
}

async function humanScroll(page) {
  var dir = Math.random() > 0.3 ? 1 : -1;
  await page.mouse.wheel(0, rand(60, 220) * dir);
  await sleep(rand(300, 700));
  if (Math.random() > 0.6) {
    await page.mouse.wheel(0, -rand(20, 80));
    await sleep(rand(200, 400));
  }
}

function log(msg) {
  console.log('[' + new Date().toLocaleTimeString() + '] ' + msg);
}

// ----------------------------------------------------------------
// SHEET COMMUNICATION
// ----------------------------------------------------------------

async function getVinsToProcess() {
  var url = process.env.WEBAPP_URL;
  if (!url) throw new Error('WEBAPP_URL not set in .env file.');
  var res  = await fetch(url);
  var data = await res.json();
  if (data.error) throw new Error('Web App error: ' + data.error);
  return data;
}

async function writeCarfaxUrl(rowIndex, value) {
  var url = process.env.WEBAPP_URL;
  await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ rowIndex: rowIndex, value: value })
  });
}

// ----------------------------------------------------------------
// BROWSER HELPERS
// ----------------------------------------------------------------

async function findElement(page, selectors, timeout) {
  timeout = timeout || 5000;
  for (var i = 0; i < selectors.length; i++) {
    try {
      var el = await page.waitForSelector(selectors[i], { timeout: timeout });
      if (el) return el;
    } catch (e) {}
  }
  return null;
}

async function pageHasText(page, fragments) {
  var content = (await page.content()).toLowerCase();
  for (var i = 0; i < fragments.length; i++) {
    if (content.indexOf(fragments[i].toLowerCase()) !== -1) return true;
  }
  return false;
}

async function findReportLink(page) {
  for (var i = 0; i < SELECTORS.reportLink.length; i++) {
    try {
      var el = await page.$(SELECTORS.reportLink[i]);
      if (el) {
        var href = await el.getAttribute('href');
        if (href) {
          if (href.startsWith('/')) href = 'https://www.carfax.com' + href;
          return href;
        }
      }
    } catch (e) {}
  }
  try {
    var links = await page.$$('a[href]');
    for (var j = 0; j < links.length; j++) {
      var h = await links[j].getAttribute('href');
      if (h && (h.indexOf('cfm/display_cfm') !== -1 || h.indexOf('cfm/vhr') !== -1 ||
                h.indexOf('vehicle-history') !== -1 || h.indexOf('carfax.ca') !== -1)) {
        if (h.startsWith('/')) h = 'https://dealer.carfax.ca' + h;
        return h;
      }
    }
  } catch (e) {}
  return null;
}

// ----------------------------------------------------------------
// LOGIN
// ----------------------------------------------------------------

async function isLoggedIn(page) {
  await page.goto(CARFAX_HOME, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await humanDelay(1500);
  var content = (await page.content()).toLowerCase();
  // If "sign in" or "log in" link is visible, we are NOT logged in
  return content.indexOf('sign out') !== -1 ||
         content.indexOf('log out')  !== -1 ||
         content.indexOf('my account') !== -1 ||
         content.indexOf('my carfax') !== -1;
}

async function loginToCarfax(page) {
  var email    = process.env.CARFAX_EMAIL;
  var password = process.env.CARFAX_PASSWORD;

  if (!email || !password) {
    log('');
    log('ACTION REQUIRED: The browser opened Carfax but you are not logged in.');
    log('Please log in manually in the browser window, then press Enter here.');
    log('');
    await new Promise(function(resolve) {
      process.stdin.once('data', resolve);
    });
    return;
  }

  log('  Logging into Carfax...');
  await page.goto(CARFAX_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await humanDelay(1500);

  var emailInput = await findElement(page, SELECTORS.loginEmail, 8000);
  if (emailInput) {
    await humanClick(page, emailInput);
    await humanType(emailInput, email);
  }

  var passInput = await findElement(page, SELECTORS.loginPassword, 5000);
  if (passInput) {
    await humanClick(page, passInput);
    await humanType(passInput, password);
  }

  var loginBtn = await findElement(page, SELECTORS.loginButton, 5000);
  if (loginBtn) {
    await humanClick(page, loginBtn);
    await humanDelay(3000);
    await page.waitForLoadState('domcontentloaded');
    await humanDelay(2000);
  }
}

// ----------------------------------------------------------------
// PROCESS ONE VIN
// ----------------------------------------------------------------

async function typeInSearchBox(page, searchInput, vin) {
  await humanClick(page, searchInput);
  await page.keyboard.press('Control+A');
  await sleep(rand(80, 180));
  await page.keyboard.press('Backspace');
  await sleep(rand(100, 250));
  await humanType(searchInput, vin);
}

async function waitForResults(page) {
  try {
    await page.waitForSelector('a.reportLink', { timeout: 10000 });
    return true;
  } catch (e) {
    return false;
  }
}

async function processVin(page, vin, screenshotDir) {
  log('  Searching: ' + vin);
  try {
    await page.goto(CARFAX_VHR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay(2000);

    var currentUrl = page.url();
    if (currentUrl.indexOf('login') !== -1 || currentUrl.indexOf('signin') !== -1) {
      log('  Redirected to login — session expired. Re-logging in...');
      await loginToCarfax(page);
      await page.goto(CARFAX_VHR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await humanDelay(2000);
    }

    var searchInput = await findElement(page, SELECTORS.vinSearchInput, 8000);
    if (!searchInput) {
      log('  Could not find search input. Screenshot saved.');
      await page.screenshot({ path: path.join(screenshotDir, 'no-input-' + vin + '.png') });
      return 'ERROR';
    }

    // ---- Try My VHRs first (radio is already selected by default) ----
    await typeInSearchBox(page, searchInput, vin);
    await humanScroll(page);
    var found = await waitForResults(page);
    if (found) {
      var reportLink = await findReportLink(page);
      if (reportLink) { log('  Found in My VHRs.'); return reportLink; }
    }

    // ---- Switch to Global Archive ----
    log('  Not in My VHRs. Trying Global Archive...');
    var archiveToggle = await findElement(page, SELECTORS.globalArchiveToggle, 3000);
    if (!archiveToggle) {
      log('  Could not find Global Archive toggle. Screenshot saved.');
      await page.screenshot({ path: path.join(screenshotDir, 'no-archive-toggle-' + vin + '.png') });
      log('  No report found.');
      return 'NOT_FOUND';
    }

    await humanClick(page, archiveToggle);

    // VIN is already in the search box — wait up to 6 seconds for results to populate
    var found2 = false;
    try {
      await page.waitForSelector('a.reportLink', { timeout: 6000 });
      found2 = true;
    } catch (e) { found2 = false; }

    if (found2) {
      var reportLink2 = await findReportLink(page);
      if (reportLink2) { log('  Found in Global Archive.'); return reportLink2; }
    }

    log('  No report found.');
    return 'NOT_FOUND';

  } catch (err) {
    log('  ERROR: ' + err.message);
    await page.screenshot({ path: path.join(screenshotDir, 'error-' + vin + '.png') }).catch(function() {});
    return 'ERROR';
  }
}

// ----------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------

async function launchBrowser() {
  var context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });
  var page = await context.newPage();
  await page.addInitScript(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; } });
    window.chrome = { runtime: {} };
  });
  return { context: context, page: page };
}

async function runBatch(page, screenshotDir) {
  log('Checking spreadsheet for new VINs...');
  var toProcess;
  try {
    toProcess = await getVinsToProcess();
  } catch (err) {
    log('ERROR reading spreadsheet: ' + err.message);
    return;
  }

  if (toProcess.length === 0) {
    log('Nothing to process — all VINs are up to date.');
    return;
  }

  log('Found ' + toProcess.length + ' VIN(s) to process.');
  console.log('');

  var delay   = parseInt(process.env.DELAY_BETWEEN_VINS || '3000', 10);
  var results = { found: 0, notFound: 0, errors: 0 };

  for (var i = 0; i < toProcess.length; i++) {
    var item = toProcess[i];
    log('[' + (i + 1) + '/' + toProcess.length + '] Row ' + item.rowIndex + ' - VIN: ' + item.vin);
    var result = await processVin(page, item.vin, screenshotDir);

    if (result === 'NOT_FOUND') {
      results.notFound++;
      await writeCarfaxUrl(item.rowIndex, 'NOT FOUND').catch(function(e) { log('  WARNING: Could not write to sheet: ' + e.message); });
    } else if (result === 'ERROR') {
      results.errors++;
    } else {
      results.found++;
      await writeCarfaxUrl(item.rowIndex, result).catch(function(e) { log('  WARNING: Could not write to sheet: ' + e.message); });
    }

    if (i < toProcess.length - 1) await humanDelay(delay);
  }

  console.log('');
  log('Batch done — Found: ' + results.found + '  Not found: ' + results.notFound + '  Errors (will retry): ' + results.errors);
  if (results.errors > 0) log('Check the screenshots/ folder for error details.');
  console.log('');
}

async function main() {
  var watchMode     = process.argv.indexOf('--watch') !== -1;
  var intervalMins  = parseInt(process.env.WATCH_INTERVAL || '5', 10);
  var intervalMs    = intervalMins * 60 * 1000;

  console.log('');
  console.log('=== CARFAX AUTOMATION v1.3 ===');
  if (watchMode) console.log('=== WATCH MODE — checks every ' + intervalMins + ' min(s) for new VINs ===');
  console.log('');

  var screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

  log('Launching browser... (a window will open — do not close it)');
  var browser = await launchBrowser();
  var context  = browser.context;
  var page     = browser.page;

  log('Checking Carfax login status...');
  var loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    log('Not logged in.');
    await loginToCarfax(page);
    loggedIn = await isLoggedIn(page);
    if (!loggedIn) {
      log('');
      log('WARNING: Could not confirm login. The script will continue but may fail.');
      log('If it fails, add CARFAX_EMAIL and CARFAX_PASSWORD to your .env file,');
      log('or delete the .carfax-session folder and run again to reset the session.');
      log('');
    } else {
      log('Login successful. Session saved for future runs.');
    }
  } else {
    log('Already logged in. Proceeding...');
  }
  console.log('');

  // First run immediately
  await runBatch(page, screenshotDir);

  if (!watchMode) {
    await context.close();
    console.log('=== DONE ===');
    console.log('');
    return;
  }

  // Watch mode — keep looping
  log('Watching for new VINs. Press Ctrl+C to stop.');
  while (true) {
    log('Next check in ' + intervalMins + ' minute(s)...');
    await sleep(intervalMs);
    await runBatch(page, screenshotDir);
  }
}

main().catch(function(err) {
  console.log('\nFATAL ERROR: ' + err.message);
  process.exit(1);
});
