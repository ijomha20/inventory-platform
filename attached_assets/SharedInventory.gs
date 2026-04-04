// =============================================================================
// SHARED INVENTORY SYNC
// =============================================================================
// Paste this script into the Apps Script editor of the SHARED Google Sheet.
// It pulls from your private master "My List" and writes a clean,
// public-facing inventory list that updates every hour.
//
// Only vehicles where column H (your manually-set price) is filled in
// will appear on the shared list.
//
// Shared sheet column layout:
//   A  Location
//   B  Vehicle
//   C  VIN
//   D  Price          (your cost — col H of master)
//   E  KM
//   F  Carfax
//   G  Website
//   H  Online Price   (col L of master)
//
// Setup:
//   1. Paste this file into Apps Script of the SHARED sheet.
//   2. Set MASTER_SHEET_URL below to the URL of your private master sheet.
//   3. Run firstTimeSetup once from the function dropdown.
//   4. Run setupHourlyTrigger once to activate automatic hourly refresh.
// =============================================================================

// ---- CONFIGURE THIS --------------------------------------------------------
var MASTER_SHEET_URL = "https://docs.google.com/spreadsheets/d/1BBvsRqGAdKaDnHPds0bl-GJkhbwhfHAMQp1jXiB3S-Q/edit?gid=320358469#gid=320358469";
var MASTER_TAB_NAME  = "My List";
var OUTPUT_TAB_NAME  = "Inventory";
// ---- OPTIONAL: Replit cache refresh webhook --------------------------------
// Set this to your Replit API server URL to push updates to the portal
// immediately after each sync, rather than waiting for the hourly cache refresh.
// Leave blank to disable.
var REPLIT_REFRESH_URL    = "";  // e.g. "https://your-replit-url/api/refresh"
var REPLIT_REFRESH_SECRET = "";  // must match REFRESH_SECRET in Replit env
// ----------------------------------------------------------------------------

// Master sheet column indexes (0-based)
var M_LOCATION     = 0;   // A - Location
var M_VIN          = 1;   // B - VIN
var M_YEAR_MAKE    = 2;   // C - Year/Make
var M_MODEL        = 3;   // D - Model
var M_MILEAGE      = 4;   // E - Mileage/KM
var M_NOTES        = 7;   // H - Notes (manually-set public price)
var M_CARFAX       = 9;   // J - Carfax
var M_WEBSITE      = 10;  // K - Website
var M_ONLINE_PRICE = 11;  // L - Online Price

// Output column indexes (0-based)
var O_LOCATION     = 0;  // A
var O_VEHICLE      = 1;  // B
var O_VIN          = 2;  // C
var O_PRICE        = 3;  // D
var O_KM           = 4;  // E
var O_CARFAX       = 5;  // F
var O_WEBSITE      = 6;  // G
var O_ONLINE_PRICE = 7;  // H
var TOTAL_OUT      = 8;

var HEADER_ROW = ["Location", "Vehicle", "VIN", "Price", "KM", "Carfax", "Website", "Online Price"];

// =============================================================================
// MENU
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Shared Inventory")
    .addItem("Refresh Now", "refreshSharedList")
    .addSeparator()
    .addItem("First-Time Setup",   "firstTimeSetup")
    .addItem("Setup Hourly Auto-Refresh", "setupHourlyTrigger")
    .addItem("Remove Auto-Refresh",      "removeHourlyTrigger")
    .addToUi();
}

// =============================================================================
// SETUP
// =============================================================================

function firstTimeSetup() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  var tab = ss.getSheetByName(OUTPUT_TAB_NAME);

  if (!tab) {
    tab = ss.insertSheet(OUTPUT_TAB_NAME);
  }

  applyHeader(tab);

  ui.alert(
    "Setup complete!\n\n" +
    "Next steps:\n" +
    "  1. Make sure MASTER_SHEET_URL is filled in at the top of the script.\n" +
    "  2. Run \"Shared Inventory > Setup Hourly Auto-Refresh\".\n" +
    "  3. Run \"Shared Inventory > Refresh Now\" to do the first pull."
  );
}

function applyHeader(tab) {
  tab.getRange(1, 1, 1, TOTAL_OUT)
    .setValues([HEADER_ROW])
    .setFontWeight("bold")
    .setBackground("#f3f3f3");
  tab.setFrozenRows(1);
  tab.setColumnWidth(O_LOCATION     + 1, 90);
  tab.setColumnWidth(O_VEHICLE      + 1, 220);
  tab.setColumnWidth(O_VIN          + 1, 160);
  tab.setColumnWidth(O_PRICE        + 1, 100);
  tab.setColumnWidth(O_KM           + 1, 90);
  tab.setColumnWidth(O_CARFAX       + 1, 320);
  tab.setColumnWidth(O_WEBSITE      + 1, 320);
  tab.setColumnWidth(O_ONLINE_PRICE + 1, 110);
}

// =============================================================================
// TRIGGER MANAGEMENT
// =============================================================================

function setupHourlyTrigger() {
  removeHourlyTrigger();
  ScriptApp.newTrigger("refreshSharedList")
    .timeBased()
    .everyHours(1)
    .create();
  SpreadsheetApp.getUi().alert("Hourly auto-refresh is now active.");
}

function removeHourlyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "refreshSharedList") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

// =============================================================================
// MAIN REFRESH
// =============================================================================

function refreshSharedList() {
  if (!MASTER_SHEET_URL) {
    SpreadsheetApp.getUi().alert(
      "MASTER_SHEET_URL is not set.\n\n" +
      "Open Apps Script, paste your master sheet URL into the MASTER_SHEET_URL variable at the top, and save."
    );
    return;
  }

  // --- Open master sheet ---
  var masterSS, masterTab;
  try {
    masterSS  = SpreadsheetApp.openByUrl(MASTER_SHEET_URL);
    masterTab = masterSS.getSheetByName(MASTER_TAB_NAME);
  } catch (e) {
    logError("Could not open master sheet: " + e.message);
    return;
  }
  if (!masterTab) {
    logError("Tab \"" + MASTER_TAB_NAME + "\" not found in master sheet.");
    return;
  }

  var masterData = masterTab.getDataRange().getValues();

  // --- Filter rows: only where column H (Notes / public price) is filled ---
  var outputRows = [];
  for (var i = 1; i < masterData.length; i++) {
    var row   = masterData[i];
    var price = row[M_NOTES] ? row[M_NOTES].toString().trim() : "";
    if (!price) continue; // skip if no manually-set price

    var location    = row[M_LOCATION]     ? row[M_LOCATION].toString().trim()     : "";
    var yearMake    = row[M_YEAR_MAKE]    ? row[M_YEAR_MAKE].toString().trim()    : "";
    var model       = row[M_MODEL]        ? row[M_MODEL].toString().trim()        : "";
    var vehicle     = (yearMake + " " + model).trim();
    var vin         = row[M_VIN]          ? row[M_VIN].toString().trim()          : "";
    var km          = row[M_MILEAGE]      ? row[M_MILEAGE].toString().trim()      : "";
    var carfax      = row[M_CARFAX]       ? row[M_CARFAX].toString().trim()       : "";
    var website     = row[M_WEBSITE]      ? row[M_WEBSITE].toString().trim()      : "";
    var onlinePrice = row[M_ONLINE_PRICE] ? row[M_ONLINE_PRICE].toString().trim() : "";

    outputRows.push([location, vehicle, vin, price, km, carfax, website, onlinePrice]);
  }

  // --- Write to shared sheet ---
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(OUTPUT_TAB_NAME);
  if (!tab) {
    tab = ss.insertSheet(OUTPUT_TAB_NAME);
    applyHeader(tab);
  }

  // Clear existing data (keep header)
  var lastRow = tab.getLastRow();
  if (lastRow > 1) {
    tab.getRange(2, 1, lastRow - 1, TOTAL_OUT).clearContent();
  }

  if (outputRows.length === 0) return;

  // Write new data
  tab.getRange(2, 1, outputRows.length, TOTAL_OUT).setValues(outputRows);

  // Formatting
  var dataRange = tab.getRange(2, 1, outputRows.length, TOTAL_OUT);
  dataRange.setFontFamily("Arial").setFontSize(11).setBackground(null);
  tab.getRange(2, O_LOCATION + 1, outputRows.length, 1)
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.getRange(2, O_ONLINE_PRICE + 1, outputRows.length, 1)
    .setNumberFormat("$#,##0.00");

  // --- Notify Replit to refresh its cache immediately ---
  notifyReplitRefresh();
}

// =============================================================================
// REPLIT CACHE REFRESH WEBHOOK
// Calls the Replit API server so the portal reflects the new data within
// seconds of a sync completing, rather than waiting for the hourly cache cycle.
// =============================================================================

function notifyReplitRefresh() {
  if (!REPLIT_REFRESH_URL || !REPLIT_REFRESH_SECRET) return;
  try {
    UrlFetchApp.fetch(REPLIT_REFRESH_URL, {
      method:             "post",
      headers:            { "x-refresh-secret": REPLIT_REFRESH_SECRET },
      muteHttpExceptions: true
    });
  } catch (e) {
    // Non-critical — portal will catch up on its next hourly cycle
    Logger.log("Replit refresh notification failed: " + e.message);
  }
}

// =============================================================================
// DATA ENDPOINT (for the Inventory Portal web app)
// Deploy this script as a Web App (Execute as: Me, Anyone can access)
// and paste the resulting URL into INVENTORY_DATA_URL in Replit Secrets.
// The web app handles its own authentication — this endpoint just serves data.
// =============================================================================

function doGet(e) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(OUTPUT_TAB_NAME);
  if (!tab) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "Inventory tab not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = tab.getDataRange().getValues();
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // Skip completely empty rows
    if (!row[O_LOCATION] && !row[O_VIN] && !row[O_VEHICLE]) continue;
    rows.push({
      location:    row[O_LOCATION]     ? row[O_LOCATION].toString().trim()     : "",
      vehicle:     row[O_VEHICLE]      ? row[O_VEHICLE].toString().trim()      : "",
      vin:         row[O_VIN]          ? row[O_VIN].toString().trim()          : "",
      price:       row[O_PRICE]        ? row[O_PRICE].toString().trim()        : "",
      km:          row[O_KM]           ? row[O_KM].toString().trim()           : "",
      carfax:      row[O_CARFAX]       ? row[O_CARFAX].toString().trim()       : "",
      website:     row[O_WEBSITE]      ? row[O_WEBSITE].toString().trim()      : "",
      onlinePrice: row[O_ONLINE_PRICE] ? row[O_ONLINE_PRICE].toString().trim() : ""
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify(rows))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// HELPERS
// =============================================================================

function logError(msg) {
  Logger.log("SharedInventory ERROR: " + msg);
  try {
    SpreadsheetApp.getUi().alert("Error: " + msg);
  } catch (e) {
    // Running headless (trigger) — swallow UI error
  }
}
