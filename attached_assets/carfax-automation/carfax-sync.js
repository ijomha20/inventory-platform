// ================================================================
// CARFAX AUTOMATION v1.1
// Reads VINs from your spreadsheet via your Apps Script Web App,
// searches each one on Carfax using YOUR real Chrome profile
// (already logged in), and writes the report URL back to column J.
//
// Run: node carfax-sync.js
// ================================================================

var fs   = require('fs');
var path = require('path');
var os   = require('os');

require('dotenv').config();

var { chromium } = require('playwright');
var fetch        = require('node-fetch');

// ----------------------------------------------------------------
// SELECTORS - update these if Carfax changes their layout
// ----------------------------------------------------------------
var SELECTORS = {
  vinSearchInput: [
    'input[placeholder*="VIN"]',
    'input[placeholder*="vin"]',
    'input[name*="vin"]',
    'input[name*="VIN"]',
    'input[type="search"]',
    'input[aria-label*="VIN"]',
    'input[aria-label*="search"]'
  ],

  globalArchiveToggle: [
    'input[id*="archive"]',
    'input[id*="global"]',
    'label:has-text("Global")',
    'button:has-text("Global")',
    '[data-testid*="archive"]',
    'span:has-text("Global Archive")'
  ],

  reportLink: [
    'a[href*="cfm/display_cfm"]',
    'a[href*="vhr"]',
    'a[href*="vehicle-history"]',
    'a[href*="/cfm/"]',
    '[data-testid*="report"] a',
    '.report-card a',
    '.vhr-result a',
    'a:has-text("View Report")',
    'a:has-text("View Full Report")'
  ],

  noResults: [
    ':has-text("no reports found")',
    ':has-text("No VHRs found")',
    ':has-text("0 results")',
    ':has-text("no results")',
    '.no-results',
    '[data-testid*="no-results"]'
  ]
};

var CARFAX_VHR_URL = 'https://www.carfax.com/cfm/vhrs/';
var CARFAX_HOME    = 'https://www.carfax.com/';

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
    var x    = startX + (targetX - startX) * ease + rand(-3, 3);
    var y    = startY + (targetY - startY) * ease + rand(-3, 3);
    await page.mouse.move(x, y);
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
    var charDelay = rand(60, 160);
    if (i > 0 && i % rand(4, 7) === 0) charDelay += rand(150, 400);
    await sleep(charDelay);
  }

  await sleep(rand(200, 500));
}

async function humanScroll(page) {
  var direction = Math.random() > 0.3 ? 1 : -1;
  await page.mouse.wheel(0, rand(60, 220) * direction);
  await sleep(rand(300, 700));
  if (Math.random() > 0.6) {
    await page.mouse.wheel(0, -rand(20, 80));
    await sleep(rand(200, 400));
  }
}

function getChromePath() {
  if (process.env.CHROME_PROFILE_PATH) return process.env.CHROME_PROFILE_PATH;
  var p = os.platform();
  if (p === 'darwin')  return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  if (p === 'win32')   return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  return path.join(os.homedir(), '.config', 'google-chrome');
}

function log(msg) {
  console.log('[' + new Date().toLocaleTimeString() + '] ' + msg);
}

// ----------------------------------------------------------------
// SHEET COMMUNICATION (via Apps Script Web App)
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
  if (!url) throw new Error('WEBAPP_URL not set in .env file.');

  await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ rowIndex: rowIndex, value: value })
  });
}

// ----------------------------------------------------------------
// CARFAX SEARCH HELPERS
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
      if (h && (h.indexOf('cfm/display_cfm') !== -1 ||
                h.indexOf('cfm/vhr')         !== -1 ||
                h.indexOf('vehicle-history')  !== -1)) {
        if (h.startsWith('/')) h = 'https://www.carfax.com' + h;
        return h;
      }
    }
  } catch (e) {}

  return null;
}

// ----------------------------------------------------------------
// PROCESS ONE VIN
// ----------------------------------------------------------------

async function processVin(page, vin, screenshotDir) {
  log('  Searching: ' + vin);

  try {
    await page.goto(CARFAX_VHR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay(1500);

    var currentUrl = page.url();
    if (currentUrl.indexOf('login') !== -1 || currentUrl.indexOf('signin') !== -1) {
      log('  WARNING: Redirected to login. Make sure you are logged into Carfax in Chrome.');
      await page.screenshot({ path: path.join(screenshotDir, 'login-redirect.png') });
      return 'ERROR';
    }

    var searchInput = await findElement(page, SELECTORS.vinSearchInput, 6000);

    if (!searchInput) {
      await page.goto(CARFAX_HOME, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await humanDelay(1000);
      searchInput = await findElement(page, SELECTORS.vinSearchInput, 6000);
    }

    if (!searchInput) {
      log('  WARNING: Could not find search input. Screenshot saved.');
      await page.screenshot({ path: path.join(screenshotDir, 'no-input-' + vin + '.png') });
      return 'ERROR';
    }

    await humanClick(page, searchInput);
    await page.keyboard.press('Control+A');
    await sleep(rand(80, 180));
    await page.keyboard.press('Backspace');
    await sleep(rand(100, 250));
    await humanType(searchInput, vin);
    await humanScroll(page);
    await searchInput.press('Enter');
    await humanDelay(2000);
    await page.waitForLoadState('domcontentloaded');
    await humanDelay(1500);
    await humanScroll(page);

    var reportLink = await findReportLink(page);
    if (reportLink) {
      log('  Found in My VHRs.');
      return reportLink;
    }

    var noResults = await pageHasText(page, ['no reports', 'no results', '0 results', 'no vhr', "couldn't find"]);

    if (noResults || !reportLink) {
      log('  Not in My VHRs. Trying Global Archive...');

      var archiveToggle = await findElement(page, SELECTORS.globalArchiveToggle, 3000);
      if (archiveToggle) {
        await humanClick(page, archiveToggle);
        await humanDelay(2000);

        var searchInput2 = await findElement(page, SELECTORS.vinSearchInput, 4000);
        if (searchInput2) {
          await humanClick(page, searchInput2);
          await page.keyboard.press('Control+A');
          await sleep(rand(80, 180));
          await page.keyboard.press('Backspace');
          await sleep(rand(100, 250));
          await humanType(searchInput2, vin);
          await humanScroll(page);
          await searchInput2.press('Enter');
          await humanDelay(2500);
          await page.waitForLoadState('domcontentloaded');
          await humanDelay(1500);
          await humanScroll(page);

          var reportLink2 = await findReportLink(page);
          if (reportLink2) {
            log('  Found in Global Archive.');
            return reportLink2;
          }
        }
      } else {
        var globalUrl = CARFAX_VHR_URL + '?archive=true&vin=' + vin;
        await page.goto(globalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await humanDelay(2000);
        await humanScroll(page);

        var reportLink3 = await findReportLink(page);
        if (reportLink3) {
          log('  Found via Global Archive URL.');
          return reportLink3;
        }
      }
    }

    log('  No Carfax report found.');
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

async function main() {
  console.log('');
  console.log('=== CARFAX AUTOMATION v1.1 ===');
  console.log('');

  var screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

  log('Reading VINs from spreadsheet...');
  var toProcess;
  try {
    toProcess = await getVinsToProcess();
  } catch (err) {
    console.log('\nERROR: ' + err.message + '\n');
    process.exit(1);
  }

  if (toProcess.length === 0) {
    log('No VINs to process. All rows in column J are already filled.');
    console.log('');
    process.exit(0);
  }

  log('Found ' + toProcess.length + ' VINs that need Carfax links.');
  console.log('');

  var chromePath  = getChromePath();
  var profileName = process.env.CHROME_PROFILE || 'Default';

  log('Launching Chrome... (a browser window will open — do not close it)');
  console.log('');

  var context;
  try {
    context = await chromium.launchPersistentContext(chromePath, {
      headless: false,
      channel:  'chrome',
      args: [
        '--profile-directory=' + profileName,
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: { width: 1280, height: 900 }
    });
  } catch (err) {
    console.log('\nERROR: Could not launch Chrome: ' + err.message);
    console.log('\nPossible fixes:');
    console.log('  1. Make sure Google Chrome is installed.');
    console.log('  2. Close all Chrome windows before running this script.');
    console.log('  3. Set CHROME_PROFILE_PATH in your .env file.');
    console.log('');
    process.exit(1);
  }

  var page = await context.newPage();
  await page.addInitScript(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; } });
  });

  var delay   = parseInt(process.env.DELAY_BETWEEN_VINS || '3000', 10);
  var results = { found: 0, notFound: 0, errors: 0 };

  for (var i = 0; i < toProcess.length; i++) {
    var item = toProcess[i];
    log('[' + (i + 1) + '/' + toProcess.length + '] Row ' + item.rowIndex + ' - VIN: ' + item.vin);

    var result = await processVin(page, item.vin, screenshotDir);

    if (result === 'NOT_FOUND') {
      results.notFound++;
      await writeCarfaxUrl(item.rowIndex, 'NOT FOUND').catch(function(e) {
        log('  WARNING: Could not write to sheet: ' + e.message);
      });
    } else if (result === 'ERROR') {
      results.errors++;
    } else {
      results.found++;
      await writeCarfaxUrl(item.rowIndex, result).catch(function(e) {
        log('  WARNING: Could not write to sheet: ' + e.message);
      });
    }

    if (i < toProcess.length - 1) await humanDelay(delay);
  }

  await context.close();

  console.log('');
  console.log('=== DONE ===');
  console.log('  Reports found:  ' + results.found);
  console.log('  Not found:      ' + results.notFound);
  console.log('  Errors (blank, will retry next run): ' + results.errors);
  if (results.errors > 0) {
    console.log('  Check the screenshots/ folder for details on errors.');
  }
  console.log('');
}

main().catch(function(err) {
  console.log('\nFATAL ERROR: ' + err.message);
  process.exit(1);
});
