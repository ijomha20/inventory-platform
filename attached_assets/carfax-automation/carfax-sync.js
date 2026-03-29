// ================================================================
// CARFAX AUTOMATION v1.0
// Reads VINs from your "My List" Google Sheet,
// searches each one on Carfax using YOUR real Chrome profile
// (already logged in), and writes the report URL to column J.
//
// Run: node carfax-sync.js
// ================================================================

var fs   = require('fs');
var path = require('path');
var os   = require('os');

require('dotenv').config();

var { chromium }    = require('playwright');
var { google }      = require('googleapis');

// ----------------------------------------------------------------
// SELECTORS - update these if Carfax changes their layout
// ----------------------------------------------------------------
var SELECTORS = {
  // The VIN search input on the My VHRs page
  vinSearchInput: [
    'input[placeholder*="VIN"]',
    'input[placeholder*="vin"]',
    'input[name*="vin"]',
    'input[name*="VIN"]',
    'input[type="search"]',
    'input[aria-label*="VIN"]',
    'input[aria-label*="search"]'
  ],

  // The "Global Archive" toggle / checkbox (shown when My VHRs has no results)
  globalArchiveToggle: [
    'input[id*="archive"]',
    'input[id*="global"]',
    'label:has-text("Global")',
    'button:has-text("Global")',
    '[data-testid*="archive"]',
    'span:has-text("Global Archive")'
  ],

  // Report result links or cards shown after searching
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

  // A "no results" indicator
  noResults: [
    ':has-text("no reports found")',
    ':has-text("No VHRs found")',
    ':has-text("0 results")',
    ':has-text("no results")',
    '.no-results',
    '[data-testid*="no-results"]'
  ]
};

// Where Carfax navigates for My VHRs
var CARFAX_VHR_URL = 'https://www.carfax.com/cfm/vhrs/';
var CARFAX_HOME    = 'https://www.carfax.com/';

// Column positions (1-based for Sheets API)
var COL_VIN     = 2;   // Column B
var COL_CARFAX  = 10;  // Column J

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

// Move the mouse from its current position to the target element
// along a curved path with slight wobble, then click.
// This simulates a real human moving the cursor across the screen.
async function humanClick(page, element) {
  var box = await element.boundingBox();
  if (!box) {
    await element.click();
    return;
  }

  // Target: a random point inside the element (not always dead center)
  var targetX = box.x + rand(Math.floor(box.width * 0.2), Math.floor(box.width * 0.8));
  var targetY = box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8));

  // Start from a plausible "last position" somewhere on the screen
  var startX = rand(100, 900);
  var startY = rand(100, 600);

  // Move in small steps with slight random wobble
  var steps = rand(12, 22);
  for (var i = 0; i <= steps; i++) {
    var t     = i / steps;
    // Ease in-out curve
    var ease  = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    var x     = startX + (targetX - startX) * ease + rand(-3, 3);
    var y     = startY + (targetY - startY) * ease + rand(-3, 3);
    await page.mouse.move(x, y);
    await sleep(rand(8, 22));
  }

  // Small pause before clicking, like a human settling the cursor
  await sleep(rand(60, 180));
  await page.mouse.click(targetX, targetY);
}

// Type a string with variable per-character timing and occasional pauses,
// simulating the natural rhythm of human typing.
async function humanType(element, text) {
  await element.click();
  await sleep(rand(80, 200));

  for (var i = 0; i < text.length; i++) {
    await element.type(text[i], { delay: 0 });

    // Base keystroke gap: 60-160ms
    var charDelay = rand(60, 160);

    // Occasionally pause mid-word as if thinking (every ~4-7 chars)
    if (i > 0 && i % rand(4, 7) === 0) {
      charDelay += rand(150, 400);
    }

    await sleep(charDelay);
  }

  // Brief pause after finishing typing before pressing Enter
  await sleep(rand(200, 500));
}

// Perform a small natural scroll as a human would while waiting
// for a page to load or scanning results.
async function humanScroll(page) {
  var scrollY = rand(60, 220);
  var direction = Math.random() > 0.3 ? 1 : -1;
  await page.mouse.wheel(0, scrollY * direction);
  await sleep(rand(300, 700));
  // Sometimes scroll back a little
  if (Math.random() > 0.6) {
    await page.mouse.wheel(0, -rand(20, 80));
    await sleep(rand(200, 400));
  }
}

function getChromePath() {
  if (process.env.CHROME_PROFILE_PATH) {
    return process.env.CHROME_PROFILE_PATH;
  }
  var platform = os.platform();
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  } else if (platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  } else {
    return path.join(os.homedir(), '.config', 'google-chrome');
  }
}

function log(msg) {
  var ts = new Date().toLocaleTimeString();
  console.log('[' + ts + '] ' + msg);
}

// ----------------------------------------------------------------
// GOOGLE SHEETS AUTH
// ----------------------------------------------------------------

function getAuthClient() {
  var credFile  = path.join(__dirname, 'credentials.json');
  var tokenFile = path.join(__dirname, 'token.json');

  if (!fs.existsSync(credFile)) {
    throw new Error('credentials.json not found. Run "node auth-setup.js" first.');
  }
  if (!fs.existsSync(tokenFile)) {
    throw new Error('token.json not found. Run "node auth-setup.js" first.');
  }

  var credentials = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  var token       = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  var clientInfo  = credentials.installed || credentials.web;

  var oAuth2Client = new google.auth.OAuth2(
    clientInfo.client_id,
    clientInfo.client_secret,
    'http://localhost:3456'
  );
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

// ----------------------------------------------------------------
// READ SHEET - returns array of { rowIndex, vin }
// where rowIndex is the 1-based sheet row number
// ----------------------------------------------------------------

async function getVinsToProcess(auth) {
  var sheets   = google.sheets({ version: 'v4', auth: auth });
  var sheetName = process.env.SHEET_NAME || 'My List';
  var spreadsheetId = process.env.SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID not set in .env file.');
  }

  // Read columns B and J together
  var response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId,
    ranges: [
      sheetName + '!B:B',
      sheetName + '!J:J'
    ]
  });

  var vinCol     = (response.data.valueRanges[0].values || []);
  var carfaxCol  = (response.data.valueRanges[1].values || []);

  var toProcess = [];

  // Row 0 is the header row - skip it (row index 1 = sheet row 2)
  for (var i = 1; i < vinCol.length; i++) {
    var vin       = (vinCol[i] && vinCol[i][0]) ? vinCol[i][0].toString().trim() : '';
    var existing  = (carfaxCol[i] && carfaxCol[i][0]) ? carfaxCol[i][0].toString().trim() : '';

    if (vin && vin.length > 5 && !existing) {
      toProcess.push({ rowIndex: i + 1, vin: vin });
    }
  }

  return toProcess;
}

// ----------------------------------------------------------------
// WRITE ONE RESULT BACK TO SHEET
// ----------------------------------------------------------------

async function writeCarfaxUrl(auth, rowIndex, value) {
  var sheets        = google.sheets({ version: 'v4', auth: auth });
  var sheetName     = process.env.SHEET_NAME || 'My List';
  var spreadsheetId = process.env.SPREADSHEET_ID;
  var cell          = sheetName + '!J' + rowIndex;

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range:         cell,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] }
  });
}

// ----------------------------------------------------------------
// CARFAX SEARCH - tries to find a first selector match on the page
// ----------------------------------------------------------------

async function findElement(page, selectors, timeout) {
  timeout = timeout || 5000;
  for (var i = 0; i < selectors.length; i++) {
    try {
      var el = await page.waitForSelector(selectors[i], { timeout: timeout });
      if (el) return el;
    } catch (e) {
      // try next selector
    }
  }
  return null;
}

async function pageHasText(page, textFragments) {
  var content = (await page.content()).toLowerCase();
  for (var i = 0; i < textFragments.length; i++) {
    if (content.indexOf(textFragments[i].toLowerCase()) !== -1) return true;
  }
  return false;
}

// ----------------------------------------------------------------
// PROCESS ONE VIN
// Returns: the report URL string, or "NOT_FOUND", or "ERROR"
// ----------------------------------------------------------------

async function processVin(page, vin, screenshotDir) {
  log('  Searching VIN: ' + vin);

  try {
    // Navigate to My VHRs page
    await page.goto(CARFAX_VHR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay(1500);

    // Check if we got redirected to login
    var currentUrl = page.url();
    if (currentUrl.indexOf('login') !== -1 || currentUrl.indexOf('signin') !== -1) {
      log('  WARNING: Redirected to login page. Make sure you are logged into Carfax in Chrome.');
      await page.screenshot({ path: path.join(screenshotDir, 'login-redirect.png') });
      return 'ERROR';
    }

    // Find the VIN search input
    var searchInput = await findElement(page, SELECTORS.vinSearchInput, 6000);

    if (!searchInput) {
      // Fallback: try the homepage search bar
      await page.goto(CARFAX_HOME, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await humanDelay(1000);
      searchInput = await findElement(page, SELECTORS.vinSearchInput, 6000);
    }

    if (!searchInput) {
      log('  WARNING: Could not find VIN search input. Taking screenshot...');
      await page.screenshot({ path: path.join(screenshotDir, 'no-search-input-' + vin + '.png') });
      return 'ERROR';
    }

    // Clear any existing text, then type the VIN with human-like keystrokes
    await humanClick(page, searchInput);
    await searchInput.selectText().catch(function() {});
    await page.keyboard.press('Control+A');
    await sleep(rand(80, 180));
    await page.keyboard.press('Backspace');
    await sleep(rand(100, 250));
    await humanType(searchInput, vin);
    await humanScroll(page);
    await searchInput.press('Enter');
    await humanDelay(2000);

    // Wait for results to load
    await page.waitForLoadState('domcontentloaded');
    await humanDelay(1500);
    await humanScroll(page);

    // Check for a report link in "My VHRs" results
    var reportLink = await findReportLink(page);
    if (reportLink) {
      log('  Found in My VHRs: ' + reportLink);
      return reportLink;
    }

    // Check if "no results" is shown
    var noResults = await pageHasText(page, ['no reports', 'no results', '0 results', 'no vhr', "couldn't find"]);

    if (noResults || !reportLink) {
      log('  Not found in My VHRs. Trying Global Archive...');

      // Try to click the Global Archive toggle
      var archiveToggle = await findElement(page, SELECTORS.globalArchiveToggle, 3000);
      if (archiveToggle) {
        await humanClick(page, archiveToggle);
        await humanDelay(2000);

        // Search again with the VIN
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
            log('  Found in Global Archive: ' + reportLink2);
            return reportLink2;
          }
        }
      } else {
        // Some Carfax layouts show Global Archive as a separate search option.
        // Try appending a query param or navigating to a global search URL.
        var globalUrl = CARFAX_VHR_URL + '?archive=true&vin=' + vin;
        await page.goto(globalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await humanDelay(2000);

        var reportLink3 = await findReportLink(page);
        if (reportLink3) {
          log('  Found via Global Archive URL: ' + reportLink3);
          return reportLink3;
        }
      }
    }

    log('  No Carfax report found for VIN: ' + vin);
    return 'NOT_FOUND';

  } catch (err) {
    log('  ERROR processing VIN ' + vin + ': ' + err.message);
    await page.screenshot({ path: path.join(screenshotDir, 'error-' + vin + '.png') }).catch(function() {});
    return 'ERROR';
  }
}

// ----------------------------------------------------------------
// FIND REPORT LINK on the current page
// Returns the URL string or null
// ----------------------------------------------------------------

async function findReportLink(page) {
  for (var i = 0; i < SELECTORS.reportLink.length; i++) {
    try {
      var el = await page.$(SELECTORS.reportLink[i]);
      if (el) {
        var href = await el.getAttribute('href');
        if (href) {
          if (href.startsWith('/')) {
            href = 'https://www.carfax.com' + href;
          }
          return href;
        }
      }
    } catch (e) {
      // try next
    }
  }

  // Fallback: look for ANY link that looks like a Carfax report
  try {
    var links = await page.$$('a[href]');
    for (var j = 0; j < links.length; j++) {
      var href2 = await links[j].getAttribute('href');
      if (href2 &&
          (href2.indexOf('cfm/display_cfm') !== -1 ||
           href2.indexOf('cfm/vhr') !== -1 ||
           href2.indexOf('vehicle-history-reports') !== -1)) {
        if (href2.startsWith('/')) {
          href2 = 'https://www.carfax.com' + href2;
        }
        return href2;
      }
    }
  } catch (e) {}

  return null;
}

// ----------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------

async function main() {
  console.log('');
  console.log('=== CARFAX AUTOMATION v1.0 ===');
  console.log('');

  // Create screenshots folder for debugging
  var screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

  // Auth with Google Sheets
  log('Connecting to Google Sheets...');
  var auth;
  try {
    auth = getAuthClient();
  } catch (err) {
    console.log('');
    console.log('ERROR: ' + err.message);
    console.log('');
    process.exit(1);
  }

  // Read VINs that need processing
  log('Reading VINs from sheet...');
  var toProcess;
  try {
    toProcess = await getVinsToProcess(auth);
  } catch (err) {
    console.log('');
    console.log('ERROR reading sheet: ' + err.message);
    console.log('');
    process.exit(1);
  }

  if (toProcess.length === 0) {
    log('No VINs to process. All rows in column J are already filled.');
    console.log('');
    process.exit(0);
  }

  log('Found ' + toProcess.length + ' VINs that need Carfax links.');
  console.log('');

  // Launch Chrome with the user's profile
  var chromePath  = getChromePath();
  var profileName = process.env.CHROME_PROFILE || 'Default';

  log('Launching Chrome from profile: ' + chromePath);
  log('Profile: ' + profileName);
  console.log('');
  console.log('NOTE: A Chrome window will open. Do not close it while the script runs.');
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
    console.log('');
    console.log('ERROR: Could not launch Chrome: ' + err.message);
    console.log('');
    console.log('Possible fixes:');
    console.log('  1. Make sure Google Chrome is installed (not Chromium).');
    console.log('  2. Close all Chrome windows before running this script.');
    console.log('  3. Set the correct CHROME_PROFILE_PATH in your .env file.');
    console.log('');
    process.exit(1);
  }

  var page = await context.newPage();

  // Mask the webdriver flag for extra safety
  await page.addInitScript(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; } });
  });

  var delay = parseInt(process.env.DELAY_BETWEEN_VINS || '3000', 10);

  var results = { found: 0, notFound: 0, errors: 0 };

  for (var i = 0; i < toProcess.length; i++) {
    var item = toProcess[i];
    log('[' + (i + 1) + '/' + toProcess.length + '] Row ' + item.rowIndex + ' - VIN: ' + item.vin);

    var result = await processVin(page, item.vin, screenshotDir);

    if (result === 'NOT_FOUND') {
      results.notFound++;
      // Write "NOT FOUND" to the sheet so we don't retry it every run
      await writeCarfaxUrl(auth, item.rowIndex, 'NOT FOUND').catch(function(e) {
        log('  WARNING: Could not write to sheet: ' + e.message);
      });
    } else if (result === 'ERROR') {
      results.errors++;
      // Don't write anything so it will be retried next run
    } else {
      results.found++;
      await writeCarfaxUrl(auth, item.rowIndex, result).catch(function(e) {
        log('  WARNING: Could not write to sheet: ' + e.message);
      });
    }

    if (i < toProcess.length - 1) {
      await humanDelay(delay);
    }
  }

  await context.close();

  console.log('');
  console.log('=== DONE ===');
  console.log('  Reports found:  ' + results.found);
  console.log('  Not found:      ' + results.notFound);
  console.log('  Errors:         ' + results.errors);
  if (results.errors > 0) {
    console.log('');
    console.log('  Rows with errors were left blank so they will be retried next run.');
    console.log('  Check the screenshots/ folder for clues on what went wrong.');
  }
  console.log('');
}

main().catch(function(err) {
  console.log('');
  console.log('FATAL ERROR: ' + err.message);
  console.log(err.stack);
  console.log('');
  process.exit(1);
});
