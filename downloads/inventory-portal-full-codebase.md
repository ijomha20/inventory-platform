# Inventory Portal — Full Codebase Document
Generated: April 05, 2026  
Live URL: https://script-reviewer.replit.app

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Google Apps Script — InventorySync v3.3](#2-google-apps-script--inventorysync-v33)
3. [API Server — Entry Point](#3-api-server--entry-point)
4. [API Server — Auth (Google OAuth)](#4-api-server--auth-google-oauth)
5. [API Server — Inventory Routes](#5-api-server--inventory-routes)
6. [API Server — Inventory Cache](#6-api-server--inventory-cache)
7. [API Server — Carfax Cloud Worker](#7-api-server--carfax-cloud-worker)
8. [Database Schema — Inventory Cache](#8-database-schema--inventory-cache)
9. [Frontend — Inventory Page](#9-frontend--inventory-page)
10. [Key Configuration Reference](#10-key-configuration-reference)

---

## 1. Architecture Overview

```
Google Sheet (Matrix source)
        │
        ▼  hourly Apps Script trigger
  My List tab (12 cols: A–L)
        │
        ├─ col J: Carfax URL    ◄── Replit Carfax worker (nightly 2:15am, Puppeteer)
        ├─ col K: Website URL   ◄── Typesense VIN search (on new vehicle add)
        └─ col L: Online Price  ◄── Typesense price lookup
        │
        ▼  Apps Script web app (?action=inventory)
  Replit API Server (Express)
        │
        ├─ POST /api/refresh  ◄── Apps Script notifyReplit() on every sync
        ├─ GET  /api/inventory       → role-filtered JSON to browser
        ├─ GET  /api/cache-status    → polling heartbeat
        └─ GET  /api/vehicle-images  → Typesense CDN photo URLs
        │
        ▼
  React Frontend (Vite)
  script-reviewer.replit.app
```

### Roles
| Role     | PAC Cost | Matrix Price | Cost | Notes |
|----------|----------|-------------|------|-------|
| Owner    | ✓        | ✓           | ✓    | View mode toggle: Own / User / Cust |
| Viewer   | ✓        | ✗           | ✗    | View mode toggle: User / Cust |
| Guest    | ✗        | ✗           | ✗    | No price filters |

### Column Order (UI)
Location → Vehicle → VIN → KM → Matrix Price (owner) → Cost (owner) → PAC Cost (non-guest) → Online Price → CFX → Pics → Link

---

## 2. Google Apps Script — InventorySync v3.3

**File:** `attached_assets/InventorySync_v3.3.gs`  
**Deploy:** Execute as Me, Access: Anyone

```javascript
// =============================================================================
// MATRIX INVENTORY SYNC v3.3
// =============================================================================
// Pulls directly from the shared Matrix spreadsheet into "My List".
// Serves inventory data to Replit via ?action=inventory (eliminates second sheet).
// Notifies Replit cache to refresh at end of every sync.
// Archives removed vehicles instead of deleting them.
// Creates daily backups (last 7 days retained).
//
// Column layout for "My List":
//   A  Location        (e.g. "MM")
//   B  VIN
//   C  Year/Make
//   D  Model
//   E  Mileage
//   F  Price           (Matrix list price -- sent to Replit as matrixPrice)
//   G  Your Cost       (user-managed, never overwritten by script -- sent to Replit as cost)
//   H  Notes/Your Cost (user-editable -- triggers portal visibility when filled)
//   I  Price Changed   (timestamp of last price change, auto-written)
//   J  Carfax          (populated by Replit cloud worker)
//   K  Website         (inventory URL; Parkdale preferred, Matrix fallback)
//   L  Online Price    (current retail price from dealer website via Typesense)
//
// v3.3 changes vs v3.2:
//   - doGetInventory now includes matrixPrice (col F) and cost (col G) in the
//     JSON response so the Replit portal can display them for Owner-only views.
//
// SETUP:
//   1. Replace all code in Apps Script with this file.
//   2. Run "First-Time Setup" from the Inventory Sync menu.
//   3. Fill in the Settings tab (especially SOURCE_SHEET_URL and NOTIFICATION_EMAILS).
//   4. Fill in REPLIT_REFRESH_URL and REPLIT_REFRESH_SECRET in Settings.
//   5. Run "Setup Auto-Sync" to activate hourly automation.
//   6. Deploy as a Web App: Execute as Me, Access: Anyone.
// =============================================================================

var COL_LOCATION      = 0;
var COL_VIN           = 1;
var COL_YEAR_MAKE     = 2;
var COL_MODEL         = 3;
var COL_MILEAGE       = 4;
var COL_PRICE         = 5;
var COL_PREV_PRICE    = 6;
var COL_NOTES         = 7;
var COL_PRICE_CHANGED = 8;
var COL_CARFAX        = 9;
var COL_WEBSITE       = 10;
var COL_ONLINE_PRICE  = 11;
var TOTAL_COLS        = 12;

var TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";
var DEALER_SITES = [
  {
    name:       "Parkdale",
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.parkdalemotors.ca"
  },
  {
    name:       "Matrix",
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.matrixmotorsyeg.ca"
  }
];

var TAB_MY_LIST  = "My List";
var TAB_SETTINGS = "Settings";
var TAB_LOG      = "Sync Log";
var TAB_ARCHIVE  = "Archive";

var SET_SOURCE_URL            = "SOURCE_SHEET_URL";
var SET_SOURCE_TAB            = "SOURCE_TAB_NAME";
var SET_EMAILS                = "NOTIFICATION_EMAILS";
var SET_INTERVAL_HOURS        = "CHECK_INTERVAL_HOURS";
var SET_LAST_SYNCED           = "LAST_SYNCED";
var SET_LAST_SYNC_RESULT      = "LAST_SYNC_RESULT";
var SET_REPLIT_REFRESH_URL    = "REPLIT_REFRESH_URL";
var SET_REPLIT_REFRESH_SECRET = "REPLIT_REFRESH_SECRET";

var PROP_STATE = "MATRIX_INVENTORY_STATE_V3";

// =============================================================================
// MENU
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Inventory Sync")
    .addItem("Sync Now",              "syncNow")
    .addItem("Fetch Website Links",   "fetchWebsiteLinks")
    .addItem("Fetch Online Prices",   "fetchOnlinePrices")
    .addItem("Create Daily Backup",   "createDailyBackup")
    .addSeparator()
    .addItem("First-Time Setup",      "firstTimeSetup")
    .addItem("Setup Auto-Sync",       "setupAutoSyncTrigger")
    .addToUi();
}

// =============================================================================
// SETTINGS
// =============================================================================

function getSettings() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_SETTINGS);
  var defaults = {};
  defaults[SET_SOURCE_URL]            = "";
  defaults[SET_SOURCE_TAB]            = "Sheet1";
  defaults[SET_EMAILS]                = "";
  defaults[SET_INTERVAL_HOURS]        = "1";
  defaults[SET_REPLIT_REFRESH_URL]    = "";
  defaults[SET_REPLIT_REFRESH_SECRET] = "";
  if (!sheet) return defaults;
  var data     = sheet.getDataRange().getValues();
  var settings = {};
  for (var k in defaults) settings[k] = defaults[k];
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0] ? data[i][0].toString().trim() : "";
    var val = (data[i][1] !== undefined && data[i][1] !== null) ? data[i][1].toString().trim() : "";
    if (key) settings[key] = val;
  }
  return settings;
}

function writeSetting(key, value) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_SETTINGS);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, "Auto-written by script"]);
}

// =============================================================================
// FIRST-TIME SETUP
// =============================================================================

function firstTimeSetup() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var ui      = SpreadsheetApp.getUi();
  var created = [];

  if (!ss.getSheetByName(TAB_SETTINGS)) {
    var s = ss.insertSheet(TAB_SETTINGS);
    s.getRange("A1:C1").setValues([["Setting", "Value", "Notes"]]).setFontWeight("bold");
    var rows = [
      [SET_SOURCE_URL,            "", "Full URL of the shared Matrix spreadsheet"],
      [SET_SOURCE_TAB,            "Sheet1", "Tab name inside the shared spreadsheet"],
      [SET_EMAILS,                "", "Comma-separated email addresses for notifications"],
      [SET_INTERVAL_HOURS,        "1", "How often auto-sync runs (hours)"],
      [SET_REPLIT_REFRESH_URL,    "", "Your Replit server URL + /api/refresh"],
      [SET_REPLIT_REFRESH_SECRET, "", "The REFRESH_SECRET value set in your Replit environment"],
      [SET_LAST_SYNCED,           "", "Auto-written -- do not edit"],
      [SET_LAST_SYNC_RESULT,      "", "Auto-written -- do not edit"]
    ];
    s.getRange(2, 1, rows.length, 3).setValues(rows);
    s.setColumnWidth(1, 220);
    s.setColumnWidth(2, 400);
    s.setColumnWidth(3, 420);
    created.push(TAB_SETTINGS);
  } else {
    var existSettings = ss.getSheetByName(TAB_SETTINGS);
    var settingsData  = existSettings.getDataRange().getValues();
    var settingsKeys  = {};
    for (var si = 1; si < settingsData.length; si++) {
      if (settingsData[si][0]) settingsKeys[settingsData[si][0].toString().trim()] = true;
    }
    if (!settingsKeys[SET_REPLIT_REFRESH_URL]) {
      existSettings.appendRow([SET_REPLIT_REFRESH_URL, "", "Your Replit server URL + /api/refresh"]);
    }
    if (!settingsKeys[SET_REPLIT_REFRESH_SECRET]) {
      existSettings.appendRow([SET_REPLIT_REFRESH_SECRET, "", "The REFRESH_SECRET value set in your Replit environment"]);
    }
  }

  if (!ss.getSheetByName(TAB_LOG)) {
    var l       = ss.insertSheet(TAB_LOG);
    var headers = ["Timestamp", "Trigger", "New Units", "Updated", "Removed", "Price Changes", "Result", "Notes"];
    l.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    l.setFrozenRows(1);
    created.push(TAB_LOG);
  }

  if (!ss.getSheetByName(TAB_MY_LIST)) {
    var m  = ss.insertSheet(TAB_MY_LIST);
    var mh = ["Location", "VIN", "Year/Make", "Model", "Mileage", "Price", "Prev Price", "Notes/Your Cost", "Price Changed", "Carfax", "Website", "Online Price"];
    m.getRange(1, 1, 1, mh.length).setValues([mh]).setFontWeight("bold");
    m.setFrozenRows(1);
    m.setColumnWidth(COL_PRICE_CHANGED + 1, 145);
    m.setColumnWidth(COL_ONLINE_PRICE  + 1, 120);
    m.setColumnWidth(COL_NOTES         + 1, 140);
    created.push(TAB_MY_LIST);
  } else {
    var em = ss.getSheetByName(TAB_MY_LIST);
    if (!em.getRange(1, COL_ONLINE_PRICE + 1).getValue()) {
      em.getRange(1, COL_ONLINE_PRICE + 1).setValue("Online Price").setFontWeight("bold");
      em.setColumnWidth(COL_ONLINE_PRICE + 1, 120);
    }
  }

  if (!ss.getSheetByName(TAB_ARCHIVE)) {
    var ar  = ss.insertSheet(TAB_ARCHIVE);
    var arh = ["Location", "VIN", "Year/Make", "Model", "Mileage", "Price", "Prev Price", "Notes/Your Cost", "Price Changed", "Carfax", "Website", "Online Price", "Archived Date"];
    ar.getRange(1, 1, 1, arh.length).setValues([arh]).setFontWeight("bold");
    ar.setFrozenRows(1);
    created.push(TAB_ARCHIVE);
  }

  if (created.length > 0) {
    ui.alert("Setup Complete!\n\nCreated tabs: " + created.join(", ") +
      "\n\nNext:\n1. Fill in the Settings tab\n2. Run Setup Auto-Sync\n3. Redeploy this script as a Web App");
  } else {
    ui.alert("Setup already complete. All tabs exist.");
  }
}

// =============================================================================
// ARCHIVE HELPER
// =============================================================================

function archiveVehicle(rowData) {
  var ss           = SpreadsheetApp.getActiveSpreadsheet();
  var archiveSheet = ss.getSheetByName(TAB_ARCHIVE);
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(TAB_ARCHIVE);
    var headers  = ["Location", "VIN", "Year/Make", "Model", "Mileage", "Price", "Prev Price", "Notes/Your Cost", "Price Changed", "Carfax", "Website", "Online Price", "Archived Date"];
    archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    archiveSheet.setFrozenRows(1);
  }
  var ts = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
  archiveSheet.appendRow(rowData.concat([ts]));
}

// =============================================================================
// MATRIX DATA FETCH
// =============================================================================

function fetchMatrixData() {
  var settings  = getSettings();
  var sourceUrl = settings[SET_SOURCE_URL];
  var sourceTab = settings[SET_SOURCE_TAB];
  if (!sourceUrl) throw new Error("SOURCE_SHEET_URL is not set. Fill it in on the Settings tab.");
  var sharedSS    = SpreadsheetApp.openByUrl(sourceUrl);
  var sharedSheet = sharedSS.getSheetByName(sourceTab);
  if (!sharedSheet) throw new Error("Cannot find tab \"" + sourceTab + "\" in the shared spreadsheet.");
  var allData = sharedSheet.getDataRange().getValues();
  if (allData.length < 2) throw new Error("The shared Matrix sheet appears to be empty.");
  var vinMap  = {};
  var rawRows = [];
  for (var i = 1; i < allData.length; i++) {
    var dealer = allData[i][0] ? allData[i][0].toString().trim().toLowerCase() : "";
    if (dealer !== "matrix") continue;
    var vin = allData[i][1] ? allData[i][1].toString().trim().toLowerCase() : "";
    if (vin === "" || vinMap[vin]) continue;
    vinMap[vin] = { vin: allData[i][1], col3: allData[i][2], col4: allData[i][3], col5: allData[i][4], price: allData[i][5] };
    rawRows.push(allData[i]);
  }
  return { vinMap: vinMap, rawRows: rawRows };
}

// =============================================================================
// MAIN SYNC
// =============================================================================

function performSync(isHeadless) {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var mySheet = ss.getSheetByName(TAB_MY_LIST);
  if (!mySheet) {
    var msg = "\"" + TAB_MY_LIST + "\" tab not found. Run First-Time Setup first.";
    if (!isHeadless) SpreadsheetApp.getUi().alert(msg);
    appendLog("Sync", 0, 0, 0, 0, "ERROR", msg);
    return null;
  }
  var vinMap, rawRows;
  try {
    var fetched = fetchMatrixData();
    vinMap  = fetched.vinMap;
    rawRows = fetched.rawRows;
  } catch (e) {
    if (!isHeadless) SpreadsheetApp.getUi().alert("Error fetching Matrix data:\n\n" + e.message);
    appendLog("Sync", 0, 0, 0, 0, "ERROR", e.message);
    return null;
  }
  var now    = new Date();
  var tz     = ss.getSpreadsheetTimeZone();
  var myData = mySheet.getDataRange().getValues();

  // Remove rows no longer in Matrix feed -- archive before deleting
  var removedVins = [];
  for (var i = myData.length - 1; i >= 1; i--) {
    var loc = myData[i][COL_LOCATION] ? myData[i][COL_LOCATION].toString().trim().toUpperCase() : "";
    var vin = myData[i][COL_VIN]      ? myData[i][COL_VIN].toString().trim().toLowerCase()      : "";
    if (loc === "MM" && vin !== "" && !vinMap[vin]) {
      archiveVehicle(myData[i]);
      mySheet.deleteRow(i + 1);
      removedVins.push(vin.toUpperCase());
    }
  }

  var currentData      = mySheet.getDataRange().getValues();
  var currentVinSet    = {};
  var priceChangedVins = [];
  var dataUpdateQueue  = [];
  var priceChangedRows = [];

  for (var j = 1; j < currentData.length; j++) {
    var cloc = currentData[j][COL_LOCATION] ? currentData[j][COL_LOCATION].toString().trim().toUpperCase() : "";
    var cvin = currentData[j][COL_VIN]      ? currentData[j][COL_VIN].toString().trim().toLowerCase()      : "";
    if (cvin !== "") currentVinSet[cvin] = j + 1;
    if (cloc !== "MM" || cvin === "" || !vinMap[cvin]) continue;
    var oldPriceRaw = currentData[j][COL_PRICE];
    var oldPrice    = typeof oldPriceRaw === "number" ? oldPriceRaw : parseFloat(oldPriceRaw);
    var newPriceRaw = vinMap[cvin].price;
    var newPrice    = typeof newPriceRaw === "number" ? newPriceRaw : parseFloat(newPriceRaw);
    var changed     = !isNaN(oldPrice) && !isNaN(newPrice) && oldPrice !== newPrice;
    if (changed) { priceChangedVins.push(cvin); priceChangedRows.push(j + 1); }
    dataUpdateQueue.push({
      rowNum: j + 1,
      values: [vinMap[cvin].vin, vinMap[cvin].col3, vinMap[cvin].col4, vinMap[cvin].col5, newPriceRaw]
    });
  }

  for (var u = 0; u < dataUpdateQueue.length; u++) {
    mySheet.getRange(dataUpdateQueue[u].rowNum, 2, 1, 5).setValues([dataUpdateQueue[u].values]);
  }

  if (priceChangedRows.length > 0) {
    var ts = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm");
    for (var p = 0; p < priceChangedRows.length; p++) {
      mySheet.getRange(priceChangedRows[p], COL_PRICE_CHANGED + 1).setValue(ts);
    }
  }

  var newVins = [];
  var newRows = [];
  for (var r = 0; r < rawRows.length; r++) {
    var sVin = rawRows[r][1] ? rawRows[r][1].toString().trim().toLowerCase() : "";
    if (sVin === "" || currentVinSet[sVin]) continue;
    newRows.push(["MM", rawRows[r][1], rawRows[r][2], rawRows[r][3], rawRows[r][4], rawRows[r][5], "", "", "", "", "", ""]);
    newVins.push(sVin);
  }
  if (newRows.length > 0) {
    var lastRow = mySheet.getLastRow();
    mySheet.getRange(lastRow + 1, 1, newRows.length, TOTAL_COLS).setValues(newRows);
  }

  // For new vehicles, automatically look up website links
  if (newVins.length > 0) {
    fetchWebsiteLinksInternal(mySheet, newVins);
  }

  var finalLastRow = mySheet.getLastRow();
  if (finalLastRow > 1) {
    var dataRows  = finalLastRow - 1;
    var dataRange = mySheet.getRange(2, 1, dataRows, TOTAL_COLS);
    dataRange.sort({ column: COL_PRICE_CHANGED + 1, ascending: false });
    dataRange.setFontFamily("Arial").setFontSize(12);
    mySheet.getRange(2, COL_LOCATION + 1,      dataRows, 1).setFontWeight("bold").setHorizontalAlignment("center");
    mySheet.getRange(2, COL_VIN + 1,           dataRows, 3).setHorizontalAlignment("left");
    mySheet.getRange(2, COL_MILEAGE + 1,       dataRows, 1).setNumberFormat("#,##0").setHorizontalAlignment("left");
    mySheet.getRange(2, COL_PRICE + 1,         dataRows, 2).setNumberFormat("$#,##0.00");
    mySheet.getRange(2, COL_PRICE_CHANGED + 1, dataRows, 1).setNumberFormat("yyyy-MM-dd HH:mm").setHorizontalAlignment("center");
    mySheet.getRange(2, COL_ONLINE_PRICE + 1,  dataRows, 1).setNumberFormat("$#,##0.00");
    dataRange.setBackground(null);
  }

  if (newVins.length > 0 || priceChangedVins.length > 0) {
    var finalData     = mySheet.getDataRange().getValues();
    var newVinSet     = {};
    var changedVinSet = {};
    for (var n = 0; n < newVins.length; n++)          newVinSet[newVins[n]]              = true;
    for (var c = 0; c < priceChangedVins.length; c++) changedVinSet[priceChangedVins[c]] = true;
    var cyanRanges   = [];
    var yellowRanges = [];
    for (var f = 1; f < finalData.length; f++) {
      var floc = finalData[f][COL_LOCATION] ? finalData[f][COL_LOCATION].toString().trim().toUpperCase() : "";
      var fvin = finalData[f][COL_VIN]      ? finalData[f][COL_VIN].toString().trim().toLowerCase()      : "";
      if (floc !== "MM" || fvin === "") continue;
      if (newVinSet[fvin])          cyanRanges.push("A" + (f + 1) + ":L" + (f + 1));
      else if (changedVinSet[fvin]) yellowRanges.push("A" + (f + 1) + ":L" + (f + 1));
    }
    if (cyanRanges.length > 0)   mySheet.getRangeList(cyanRanges).setBackground("#00FFFF");
    if (yellowRanges.length > 0) mySheet.getRangeList(yellowRanges).setBackground("#FFFF00");
  }

  var timestamp     = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
  var resultSummary = newVins.length + " new, " + dataUpdateQueue.length + " updated, " + removedVins.length + " removed, " + priceChangedVins.length + " price changes";
  writeSetting(SET_LAST_SYNCED,      timestamp);
  writeSetting(SET_LAST_SYNC_RESULT, resultSummary);
  appendLog("Sync", newVins.length, dataUpdateQueue.length, removedVins.length, priceChangedVins.length, "OK", "");

  // Notify Replit to refresh its cache immediately
  notifyReplit();

  return { newVins: newVins, updatedCount: dataUpdateQueue.length, removedVins: removedVins, priceChangedVins: priceChangedVins, timestamp: timestamp };
}

function syncNow() {
  var result = performSync(false);
  if (!result) return;
  var msg = "Sync Complete! (" + result.timestamp + ")";
  if (result.newVins.length > 0)          msg += "\n\nNEW: " + result.newVins.length + " new unit(s) highlighted in cyan";
  if (result.priceChangedVins.length > 0) msg += "\nPRICE CHANGES: " + result.priceChangedVins.length + " unit(s) highlighted in yellow";
  if (result.removedVins.length > 0)      msg += "\nREMOVED: " + result.removedVins.length + " unit(s) archived";
  if (result.updatedCount > 0)            msg += "\nUPDATED: " + result.updatedCount + " existing unit(s) refreshed";
  if (result.newVins.length === 0 && result.priceChangedVins.length === 0 && result.removedVins.length === 0 && result.updatedCount === 0)
    msg += "\n\nNo changes. Your list is already up to date.";
  SpreadsheetApp.getUi().alert(msg);
}

function syncNowHeadless() { performSync(true); }

// =============================================================================
// REPLIT CACHE REFRESH NOTIFICATION
// =============================================================================

function notifyReplit() {
  var settings = getSettings();
  var url      = settings[SET_REPLIT_REFRESH_URL];
  var secret   = settings[SET_REPLIT_REFRESH_SECRET];
  if (!url || !secret) return;
  try {
    UrlFetchApp.fetch(url, {
      method:             "post",
      headers:            { "x-refresh-secret": secret, "Content-Type": "application/json" },
      payload:            JSON.stringify({ source: "apps-script" }),
      muteHttpExceptions: true
    });
  } catch (e) {
    appendLog("Replit", 0, 0, 0, 0, "WARN", "Replit notification failed: " + e.message);
  }
}

// =============================================================================
// AUTO-SYNC TRIGGER (hourly)
// =============================================================================

function setupAutoSyncTrigger() {
  var ui       = SpreadsheetApp.getUi();
  var settings = getSettings();
  var hours    = parseInt(settings[SET_INTERVAL_HOURS], 10) || 1;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "autoCheckForChanges" || fn === "autoSync") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("autoSync").timeBased().everyHours(hours).create();
  ui.alert("Auto-Sync Activated!\n\nRunning every " + hours + " hour(s).");
}

function setupNotificationTrigger() { setupAutoSyncTrigger(); }

function autoSync() {
  var props = PropertiesService.getScriptProperties();
  var vinMap, rawRows;
  try {
    var fetched = fetchMatrixData();
    vinMap  = fetched.vinMap;
    rawRows = fetched.rawRows;
  } catch (e) {
    appendLog("Auto-Sync", 0, 0, 0, 0, "ERROR", e.message);
    notifyReplit();
    return;
  }
  var currentState = {};
  for (var i = 0; i < rawRows.length; i++) {
    var vin = rawRows[i][1] ? rawRows[i][1].toString().trim().toLowerCase() : "";
    if (!vin) continue;
    currentState[vin] = {
      vin:         rawRows[i][1],
      description: ((rawRows[i][2] || "") + " " + (rawRows[i][3] || "")).trim(),
      mileage:     rawRows[i][4],
      price:       rawRows[i][5]
    };
  }
  var newVehicles = [], priceChanges = [], removedVehicles = [];
  var previousState = null;
  var rawPrev = props.getProperty(PROP_STATE);
  if (rawPrev) { try { previousState = JSON.parse(rawPrev); } catch (e) {} }
  if (previousState) {
    var cvins = Object.keys(currentState);
    for (var c = 0; c < cvins.length; c++) {
      var cvin = cvins[c];
      if (!previousState[cvin]) {
        newVehicles.push(currentState[cvin]);
      } else {
        var oldP = parseFloat(previousState[cvin].price);
        var newP = parseFloat(currentState[cvin].price);
        if (!isNaN(oldP) && !isNaN(newP) && oldP !== newP)
          priceChanges.push({ vehicle: currentState[cvin], oldPrice: oldP, newPrice: newP, delta: newP - oldP });
      }
    }
    var pvins = Object.keys(previousState);
    for (var pv = 0; pv < pvins.length; pv++) {
      if (!currentState[pvins[pv]]) removedVehicles.push(previousState[pvins[pv]]);
    }
  }
  var snapshot = {};
  var svins    = Object.keys(currentState);
  for (var sv = 0; sv < svins.length; sv++) snapshot[svins[sv]] = { price: currentState[svins[sv]].price };
  try { props.setProperty(PROP_STATE, JSON.stringify(snapshot)); } catch (e) {
    var tiny = {};
    for (var tv = 0; tv < svins.length; tv++) tiny[svins[tv]] = currentState[svins[tv]].price;
    try { props.setProperty(PROP_STATE, JSON.stringify(tiny)); } catch (e2) {}
  }
  if (newVehicles.length > 0 || priceChanges.length > 0 || removedVehicles.length > 0) {
    sendChangeNotification(newVehicles, priceChanges, removedVehicles);
    performSync(true);
  } else {
    appendLog("Auto-Sync", 0, 0, 0, 0, "No changes", "");
    notifyReplit();
  }
}

function autoCheckForChanges() { autoSync(); }

// =============================================================================
// DAILY BACKUP
// =============================================================================

function createDailyBackup() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var mySheet = ss.getSheetByName(TAB_MY_LIST);
  if (!mySheet) return;

  var today      = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var backupName = "Backup " + today;
  var existing   = ss.getSheetByName(backupName);
  if (existing) ss.deleteSheet(existing);

  var backup = mySheet.copyTo(ss);
  backup.setName(backupName);

  // Prune backups older than 7 days
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf("Backup ") === 0) {
      var dateStr = name.replace("Backup ", "");
      try {
        var backupDate = new Date(dateStr);
        var daysDiff   = (new Date() - backupDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 7) ss.deleteSheet(sheets[i]);
      } catch (e) {}
    }
  }
  appendLog("Backup", 0, 0, 0, 0, "OK", "Daily backup created: " + backupName);
}

// =============================================================================
// CHANGE NOTIFICATION EMAIL
// =============================================================================

function sendChangeNotification(newVehicles, priceChanges, removedVehicles) {
  var settings = getSettings();
  var emailStr = settings[SET_EMAILS];
  if (!emailStr) { appendLog("Email", 0, 0, 0, 0, "SKIPPED", "No email addresses configured"); return; }
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MMMM dd, yyyy 'at' HH:mm");
  var parts = [];
  if (newVehicles.length > 0)     parts.push(newVehicles.length + " new");
  if (priceChanges.length > 0)    parts.push(priceChanges.length + " price change" + (priceChanges.length > 1 ? "s" : ""));
  if (removedVehicles.length > 0) parts.push(removedVehicles.length + " removed");
  var subject = "Matrix Inventory Update - " + now + (parts.length > 0 ? " (" + parts.join(", ") + ")" : "");
  var body    = "Matrix Inventory Changes - " + now + "\n==================================================\n\n";
  if (newVehicles.length > 0) {
    body += "NEW VEHICLES (" + newVehicles.length + ")\n----------------------------------------\n";
    for (var nv = 0; nv < newVehicles.length; nv++) {
      var v = newVehicles[nv];
      body += "Vehicle  : " + v.description + "\nVIN      : " + v.vin + "\nMileage  : " + formatNumber(v.mileage) + " km\nPrice    : " + formatCurrency(v.price) + "\n\n";
    }
  }
  if (priceChanges.length > 0) {
    body += "PRICE CHANGES (" + priceChanges.length + ")\n----------------------------------------\n";
    for (var pc = 0; pc < priceChanges.length; pc++) {
      var ch  = priceChanges[pc];
      var dir = ch.delta > 0 ? "UP" : "DOWN";
      var pct = ch.oldPrice > 0 ? " (" + Math.abs(Math.round((ch.delta / ch.oldPrice) * 1000) / 10) + "%)" : "";
      body += "Vehicle  : " + ch.vehicle.description + "\nVIN      : " + ch.vehicle.vin + "\nMileage  : " + formatNumber(ch.vehicle.mileage) + " km\n" +
        "Change   : " + dir + " " + formatCurrency(Math.abs(ch.delta)) + pct + "\nOld Price: " + formatCurrency(ch.oldPrice) + "\nNew Price: " + formatCurrency(ch.newPrice) + "\n\n";
    }
  }
  if (removedVehicles.length > 0) {
    body += "REMOVED FROM FEED (" + removedVehicles.length + ")\n----------------------------------------\n";
    body += "(Archived to the Archive tab in your spreadsheet)\n\n";
    for (var rv = 0; rv < removedVehicles.length; rv++) {
      var rem = removedVehicles[rv];
      body += "Vehicle  : " + (rem.description || "").trim() + "\nVIN      : " + rem.vin + "\n\n";
    }
  }
  body += "==================================================\nView spreadsheet: " + ss.getUrl() + "\n";
  try {
    MailApp.sendEmail(emailStr, subject, body);
    appendLog("Email", newVehicles.length, 0, removedVehicles.length, priceChanges.length, "Sent", "To: " + emailStr);
  } catch (e) {
    appendLog("Email", 0, 0, 0, 0, "ERROR", "Send failed: " + e.message);
  }
}

// =============================================================================
// LOG HELPER
// =============================================================================

function appendLog(trigger, newUnits, updated, removed, priceChanges, result, notes) {
  try {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName(TAB_LOG);
    if (!logSheet) return;
    var ts = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
    logSheet.appendRow([ts, trigger, newUnits, updated, removed, priceChanges, result, notes || ""]);
  } catch (e) {}
}

function formatCurrency(value) {
  var n = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(n)) return String(value);
  return "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value) {
  var n = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(n)) return String(value);
  return n.toLocaleString("en-CA");
}

// =============================================================================
// WEB APP ENDPOINTS
//
// GET  ?action=inventory  -- returns filtered inventory rows (col H filled)
//                            used by Replit as its primary data source
// GET  (no action)        -- returns pending Carfax VINs (used by Replit worker)
// POST                    -- writes Carfax result or sends alert notification
//
// DEPLOY: Apps Script > Deploy > Web App > Execute as: Me > Access: Anyone
// =============================================================================

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";
  if (action === "inventory") {
    return doGetInventory();
  }
  return doGetCarfaxVins();
}

function doGetInventory() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "My List tab not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data   = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var yourCost = data[i][COL_NOTES] ? data[i][COL_NOTES].toString().trim() : "";
    if (!yourCost) continue;

    var vin         = data[i][COL_VIN]          ? data[i][COL_VIN].toString().trim()          : "";
    var yearMake    = data[i][COL_YEAR_MAKE]     ? data[i][COL_YEAR_MAKE].toString().trim()    : "";
    var model       = data[i][COL_MODEL]         ? data[i][COL_MODEL].toString().trim()        : "";
    var vehicle     = (yearMake + " " + model).trim();
    var mileage     = data[i][COL_MILEAGE]       ? data[i][COL_MILEAGE].toString().trim()      : "";
    var matrixPrice = data[i][COL_PRICE]         ? data[i][COL_PRICE].toString().trim()        : "";
    var cost        = data[i][COL_PREV_PRICE]    ? data[i][COL_PREV_PRICE].toString().trim()   : "";
    var carfax      = data[i][COL_CARFAX]        ? data[i][COL_CARFAX].toString().trim()       : "";
    var website     = data[i][COL_WEBSITE]       ? data[i][COL_WEBSITE].toString().trim()      : "";
    var onlinePrice = data[i][COL_ONLINE_PRICE]  ? data[i][COL_ONLINE_PRICE].toString().trim() : "";

    if (!vin) continue;

    result.push({
      location:    data[i][COL_LOCATION] ? data[i][COL_LOCATION].toString().trim() : "",
      vehicle:     vehicle,
      vin:         vin,
      matrixPrice: matrixPrice,
      cost:        cost,
      price:       yourCost,
      km:          mileage,
      carfax:      carfax,
      website:     website,
      onlinePrice: onlinePrice
    });
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGetCarfaxVins() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "My List tab not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data   = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var vin    = data[i][COL_VIN]    ? data[i][COL_VIN].toString().trim()    : "";
    var carfax = data[i][COL_CARFAX] ? data[i][COL_CARFAX].toString().trim() : "";
    if (vin && vin.length > 5 && (!carfax || carfax === "NOT FOUND")) {
      result.push({ rowIndex: i + 1, vin: vin });
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  var ss      = SpreadsheetApp.getActiveSpreadsheet();

  if (payload.action === "notify") {
    var settings = getSettings();
    var emailStr = settings[SET_EMAILS];
    if (emailStr && payload.message) {
      try {
        MailApp.sendEmail(emailStr, "Inventory System Alert", payload.message);
      } catch (err) {}
    }
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "My List tab not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!payload.rowIndex || !payload.value) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "Missing rowIndex or value" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var rowIndex = parseInt(payload.rowIndex, 10);
  if (isNaN(rowIndex) || rowIndex < 2 || rowIndex > 10000) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "Invalid rowIndex" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var value = payload.value.toString().trim();
  sheet.getRange(rowIndex, COL_CARFAX + 1).setValue(value);

  if (payload.batchComplete) notifyReplit();

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// WEBSITE LINK LOOKUP (Column K)
// =============================================================================

function searchTypesense(site, vin) {
  var endpoint = "https://" + TYPESENSE_HOST +
    "/collections/" + site.collection +
    "/documents/search" +
    "?q="           + encodeURIComponent(vin) +
    "&query_by=vin" +
    "&num_typos=0"  +
    "&per_page=1"   +
    "&x-typesense-api-key=" + site.apiKey;
  try {
    var resp = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var body = JSON.parse(resp.getContentText());
    if (!body.hits || body.hits.length === 0) return null;
    var doc    = body.hits[0].document;
    var docVin = doc.vin ? doc.vin.toString().trim().toUpperCase() : "";
    if (docVin !== vin.toUpperCase()) return null;
    if (doc.page_url) {
      var path = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
      return site.siteUrl + "/" + path + "/";
    }
    var id   = doc.id    || doc.post_id  || doc.vehicle_id || "";
    var slug = doc.slug  || doc.url_slug || "";
    if (!slug && doc.year && doc.make && doc.model) {
      slug = [doc.year, doc.make, doc.model, doc.trim || ""]
        .filter(function(part) { return String(part).trim() !== ""; })
        .join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }
    if (!id || !slug) return null;
    return site.siteUrl + "/inventory/" + slug + "/" + id + "/";
  } catch (err) { return null; }
}

function fetchWebsiteLinksInternal(sheet, onlyVins) {
  var onlyVinSet = {};
  if (onlyVins) { for (var k = 0; k < onlyVins.length; k++) onlyVinSet[onlyVins[k].toLowerCase()] = true; }
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var vin      = data[i][COL_VIN]     ? data[i][COL_VIN].toString().trim()     : "";
    var existing = data[i][COL_WEBSITE] ? data[i][COL_WEBSITE].toString().trim() : "";
    if (!vin || vin.length < 6) continue;
    if (onlyVins && !onlyVinSet[vin.toLowerCase()]) continue;
    if (existing && existing !== "NOT FOUND") continue;
    var url = null;
    for (var s = 0; s < DEALER_SITES.length; s++) {
      url = searchTypesense(DEALER_SITES[s], vin);
      if (url) break;
    }
    sheet.getRange(i + 1, COL_WEBSITE + 1).setValue(url || "NOT FOUND");
    Utilities.sleep(400);
  }
}

function fetchWebsiteLinks() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) { SpreadsheetApp.getUi().alert("My List tab not found."); return; }
  var data = sheet.getDataRange().getValues();
  var found = 0, missing = 0, skipped = 0;
  for (var i = 1; i < data.length; i++) {
    var vin      = data[i][COL_VIN]     ? data[i][COL_VIN].toString().trim()     : "";
    var existing = data[i][COL_WEBSITE] ? data[i][COL_WEBSITE].toString().trim() : "";
    if (!vin || vin.length < 6) { skipped++; continue; }
    if (existing && existing !== "NOT FOUND") { skipped++; continue; }
    var url = null;
    for (var s = 0; s < DEALER_SITES.length; s++) {
      url = searchTypesense(DEALER_SITES[s], vin);
      if (url) break;
    }
    if (url) { sheet.getRange(i + 1, COL_WEBSITE + 1).setValue(url); found++; }
    else      { sheet.getRange(i + 1, COL_WEBSITE + 1).setValue("NOT FOUND"); missing++; }
    Utilities.sleep(400);
  }
  SpreadsheetApp.getUi().alert("Website links complete.\n\n  Found   : " + found + "\n  Missing : " + missing + "\n  Skipped : " + skipped);
}

// =============================================================================
// ONLINE PRICE LOOKUP (Column L)
// =============================================================================

function searchTypesensePrice(site, vin) {
  var endpoint = "https://" + TYPESENSE_HOST +
    "/collections/" + site.collection +
    "/documents/search" +
    "?q="           + encodeURIComponent(vin) +
    "&query_by=vin" +
    "&num_typos=0"  +
    "&per_page=1"   +
    "&x-typesense-api-key=" + site.apiKey;
  try {
    var resp = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var body = JSON.parse(resp.getContentText());
    if (!body.hits || body.hits.length === 0) return null;
    var doc    = body.hits[0].document;
    var docVin = doc.vin ? doc.vin.toString().trim().toUpperCase() : "";
    if (docVin !== vin.toUpperCase()) return null;
    var specialOn    = parseInt(doc.special_price_on) === 1;
    var specialPrice = parseFloat(doc.special_price);
    var regularPrice = parseFloat(doc.price);
    var price = (specialOn && !isNaN(specialPrice) && specialPrice > 0) ? specialPrice : regularPrice;
    if (isNaN(price) || price <= 0) return null;
    return price;
  } catch (err) { return null; }
}

function fetchOnlinePrices() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) { SpreadsheetApp.getUi().alert("My List tab not found."); return; }
  sheet.getRange(1, COL_ONLINE_PRICE + 1).setValue("Online Price").setFontWeight("bold");
  var data = sheet.getDataRange().getValues();
  var found = 0, missing = 0, skipped = 0;
  for (var i = 1; i < data.length; i++) {
    var vin = data[i][COL_VIN] ? data[i][COL_VIN].toString().trim() : "";
    if (!vin || vin.length < 6) { skipped++; continue; }
    var price = null;
    for (var s = 0; s < DEALER_SITES.length; s++) {
      price = searchTypesensePrice(DEALER_SITES[s], vin);
      if (price !== null) break;
    }
    if (price !== null) { sheet.getRange(i + 1, COL_ONLINE_PRICE + 1).setValue(price); found++; }
    else                { sheet.getRange(i + 1, COL_ONLINE_PRICE + 1).setValue("NOT FOUND"); missing++; }
    Utilities.sleep(300);
  }
  var dataRows = data.length - 1;
  if (dataRows > 0) sheet.getRange(2, COL_ONLINE_PRICE + 1, dataRows, 1).setNumberFormat("$#,##0.00");
  SpreadsheetApp.getUi().alert("Online prices complete.\n\n  Found   : " + found + "\n  Missing : " + missing + "\n  Skipped : " + skipped);
}
```

---

## 3. API Server — Entry Point

**File:** `artifacts/api-server/src/index.ts`

```typescript
import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundRefresh } from "./lib/inventoryCache";
import { scheduleCarfaxWorker } from "./lib/carfaxWorker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Load inventory from DB first (instant), then start background refresh cycle.
// await ensures the DB snapshot is in memory before we accept any requests.
startBackgroundRefresh().then(() => {
  // Schedule the Carfax cloud worker — runs nightly at 2:15am
  scheduleCarfaxWorker();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}).catch((err) => {
  logger.error({ err }, "Failed to initialise inventory cache — starting anyway");
  scheduleCarfaxWorker();
  app.listen(port, () => logger.info({ port }, "Server listening (cache init failed)"));
});
```

---

## 4. API Server — Auth (Google OAuth)

**File:** `artifacts/api-server/src/lib/auth.ts`

```typescript
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { logger } from "./logger.js";

const OWNER_EMAIL   = (process.env["OWNER_EMAIL"] ?? "").toLowerCase().trim();
const CLIENT_ID     = process.env["GOOGLE_CLIENT_ID"]     ?? "";
const CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"] ?? "";

// Derive callback URL from REPLIT_DOMAINS (works in both dev and prod)
function getCallbackUrl(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (domain) return `https://${domain}/api/auth/google/callback`;
  return "http://localhost:8080/api/auth/google/callback";
}

export function isOwner(email: string): boolean {
  return !!OWNER_EMAIL && email.toLowerCase() === OWNER_EMAIL;
}

export function configurePassport() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    logger.warn("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth disabled");
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID:     CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        callbackURL:  getCallbackUrl(),
      },
      (_accessToken, _refreshToken, profile, done) => {
        const email   = profile.emails?.[0]?.value ?? "";
        const name    = profile.displayName ?? "";
        const picture = profile.photos?.[0]?.value ?? "";
        done(null, { email, name, picture });
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user as Express.User));
}
```

---

## 5. API Server — Inventory Routes

**File:** `artifacts/api-server/src/routes/inventory.ts`

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, refreshCache } from "../lib/inventoryCache.js";

const router = Router();

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";
const IMAGE_CDN_BASE = "https://zopsoftware-asset.b-cdn.net";

const DEALER_COLLECTIONS = [
  {
    name:       "Matrix",
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
  {
    name:       "Parkdale",
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
];

// Determine the calling user's role ('owner' | 'viewer' | 'guest')
async function getUserRole(req: any): Promise<string> {
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) return "owner";
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  return entry?.role ?? "viewer";
}

async function requireAccess(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) { next(); return; }
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  if (entry) { next(); return; }
  res.status(403).json({ error: "Access denied" });
}

// GET /inventory — instant response from server-side cache, role-filtered
router.get("/inventory", requireAccess, async (req, res) => {
  const role = await getUserRole(req);
  const { data } = getCacheState();

  const items = data.map((item) => {
    // Owners see everything
    if (role === "owner") return item;

    // Strip owner-only fields (matrixPrice, cost) for all non-owners
    const { matrixPrice, cost, ...rest } = item;

    // Guests also lose the price field
    if (role === "guest") return { ...rest, price: "" };

    return rest;
  });

  res.set("Cache-Control", "no-store");
  res.json(items);
});

// GET /cache-status — lightweight poll so the portal can detect updates
router.get("/cache-status", requireAccess, (_req, res) => {
  const { lastUpdated, isRefreshing, data } = getCacheState();
  res.set("Cache-Control", "no-store");
  res.json({
    lastUpdated:  lastUpdated?.toISOString() ?? null,
    isRefreshing,
    count:        data.length,
  });
});

// POST /refresh — webhook from Apps Script to trigger an immediate cache refresh
router.post("/refresh", (req, res) => {
  const secret   = req.headers["x-refresh-secret"];
  const expected = process.env["REFRESH_SECRET"]?.trim();

  if (!expected || secret !== expected) {
    logger.warn({ ip: (req as any).ip }, "Unauthorized /refresh attempt");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  refreshCache().catch((err) =>
    logger.error({ err }, "Webhook-triggered refresh failed"),
  );

  res.json({ ok: true, message: "Cache refresh triggered" });
});

// GET /vehicle-images?vin=XXX — fetch photo gallery from Typesense CDN
router.get("/vehicle-images", requireAccess, async (req, res) => {
  const vin = (req.query["vin"] as string ?? "").trim().toUpperCase();
  if (!vin || vin.length < 10) {
    res.json({ vin, urls: [] });
    return;
  }

  const urls: string[] = [];

  for (const dealer of DEALER_COLLECTIONS) {
    try {
      const endpoint =
        `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search` +
        `?q=${encodeURIComponent(vin)}&query_by=vin&num_typos=0&per_page=1` +
        `&x-typesense-api-key=${dealer.apiKey}`;

      const resp = await fetch(endpoint);
      if (!resp.ok) continue;

      const body: any = await resp.json();
      if (!body.hits?.length) continue;

      const doc    = body.hits[0].document;
      const docVin = (doc.vin ?? "").toString().trim().toUpperCase();
      if (docVin !== vin) continue;

      const rawUrls: string = doc.image_urls ?? "";
      if (!rawUrls) continue;

      rawUrls.split(";").forEach((path: string) => {
        const trimmed = path.trim();
        if (trimmed) urls.push(IMAGE_CDN_BASE + trimmed);
      });

      break; // Stop after first successful collection
    } catch (_err) {
      // Silently continue to next collection
    }
  }

  res.set("Cache-Control", "public, max-age=300"); // Cache images for 5 min
  res.json({ vin, urls });
});

export default router;
```

---

## 6. API Server — Inventory Cache

**File:** `artifacts/api-server/src/lib/inventoryCache.ts`

```typescript
import { db, inventoryCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export interface InventoryItem {
  location:    string;
  vehicle:     string;
  vin:         string;
  price:       string;
  km:          string;
  carfax:      string;
  website:     string;
  onlinePrice: string;
  matrixPrice: string; // Column F — matrix list price (owner only)
  cost:        string; // Column G — business acquisition cost (owner only)
}

interface CacheState {
  data:         InventoryItem[];
  lastUpdated:  Date | null;
  isRefreshing: boolean;
}

const state: CacheState = {
  data:         [],
  lastUpdated:  null,
  isRefreshing: false,
};

export function getCacheState(): CacheState {
  return state;
}

// ---------------------------------------------------------------------------
// Database persistence — load on startup, save after every successful fetch
// ---------------------------------------------------------------------------

async function loadFromDb(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(inventoryCacheTable)
      .where(eq(inventoryCacheTable.id, 1));

    if (rows.length > 0) {
      const row   = rows[0];
      const items = row.data as InventoryItem[];
      if (Array.isArray(items) && items.length > 0) {
        state.data        = items;
        state.lastUpdated = row.lastUpdated;
        logger.info({ count: state.data.length }, "Inventory loaded from database — serving immediately");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Could not load inventory from database — will fetch fresh from source");
  }
}

async function persistToDb(): Promise<void> {
  if (!state.lastUpdated) return;
  try {
    await db
      .insert(inventoryCacheTable)
      .values({ id: 1, data: state.data, lastUpdated: state.lastUpdated })
      .onConflictDoUpdate({
        target: inventoryCacheTable.id,
        set: { data: state.data, lastUpdated: state.lastUpdated },
      });
    logger.info({ count: state.data.length }, "Inventory persisted to database");
  } catch (err) {
    logger.warn({ err }, "Could not persist inventory to database (non-fatal)");
  }
}

// ---------------------------------------------------------------------------
// Typesense — batch price enrichment
// ---------------------------------------------------------------------------

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

const PRICE_COLLECTIONS = [
  {
    collection: "37042ac7ece3a217b1a41d6f54ba6855", // Parkdale (checked first — preferred)
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
  {
    collection: "cebacbca97920d818d57c6f0526d7413", // Matrix
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
];

/**
 * Fetch ALL currently listed vehicles from Typesense and return a
 * VIN (uppercase) to price string map.
 */
async function fetchOnlinePricesFromTypesense(): Promise<Map<string, string>> {
  const priceMap = new Map<string, string>();

  for (const col of PRICE_COLLECTIONS) {
    try {
      let page = 1;
      while (true) {
        const url =
          `https://${TYPESENSE_HOST}/collections/${col.collection}/documents/search` +
          `?q=*&per_page=250&page=${page}&x-typesense-api-key=${col.apiKey}`;

        const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) break;

        const body: any = await resp.json();
        const hits: any[] = body.hits ?? [];
        if (hits.length === 0) break;

        for (const hit of hits) {
          const doc = hit.document ?? {};
          const vin = (doc.vin ?? "").toString().trim().toUpperCase();
          if (!vin || priceMap.has(vin)) continue; // first collection wins

          const specialOn    = Number(doc.special_price_on) === 1;
          const specialPrice = parseFloat(doc.special_price);
          const regularPrice = parseFloat(doc.price);
          const raw          = specialOn && specialPrice > 0 ? specialPrice : regularPrice;

          if (!isNaN(raw) && raw > 0) {
            priceMap.set(vin, String(Math.round(raw)));
          }
        }

        if (hits.length < 250) break;
        page++;
      }
    } catch (err) {
      logger.warn({ err, collection: col.collection }, "Typesense price fetch failed for collection");
    }
  }

  return priceMap;
}

// ---------------------------------------------------------------------------
// Cache refresh
// ---------------------------------------------------------------------------

export async function refreshCache(): Promise<void> {
  if (state.isRefreshing) return;
  state.isRefreshing = true;

  try {
    const dataUrl = process.env["INVENTORY_DATA_URL"]?.trim();
    if (!dataUrl) {
      logger.warn("INVENTORY_DATA_URL is not set — cache not populated");
      return;
    }

    const response = await fetch(dataUrl, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);

    const raw: any[] = await response.json();

    const items: InventoryItem[] = raw.map((r) => ({
      location:    String(r.location    ?? "").trim(),
      vehicle:     String(r.vehicle     ?? "").trim(),
      vin:         String(r.vin         ?? "").trim().toUpperCase(),
      price:       String(r.price       ?? "").trim(),
      km:          String(r.km          ?? "").trim(),
      carfax:      String(r.carfax      ?? "").trim(),
      website:     String(r.website     ?? "").trim(),
      onlinePrice: String(r.onlinePrice ?? "").trim(),
      matrixPrice: String(r.matrixPrice ?? "").trim(), // Column F
      cost:        String(r.cost        ?? "").trim(), // Column G
    }));

    // Enrich with Typesense prices for items where Apps Script didn't send one
    const needPrice = items.filter(
      (item) => !item.onlinePrice || item.onlinePrice === "NOT FOUND",
    );

    if (needPrice.length > 0) {
      const priceMap = await fetchOnlinePricesFromTypesense();

      for (const item of items) {
        if (!item.onlinePrice || item.onlinePrice === "NOT FOUND") {
          const fetched = priceMap.get(item.vin.toUpperCase());
          if (fetched) item.onlinePrice = fetched;
        }
      }

      logger.info(
        { enriched: priceMap.size, total: items.length },
        "Typesense price enrichment complete",
      );
    }

    state.data        = items;
    state.lastUpdated = new Date();
    logger.info({ count: items.length }, "Inventory cache refreshed");

    await persistToDb();
  } catch (err) {
    logger.error({ err }, "Inventory cache refresh failed — serving stale data");
  } finally {
    state.isRefreshing = false;
  }
}

export async function startBackgroundRefresh(intervalMs = 60 * 60 * 1000): Promise<void> {
  // Step 1: load the last-known inventory from the database immediately.
  await loadFromDb();

  // Step 2: kick off a fresh fetch in the background.
  async function fetchWithRetry(attempt = 1): Promise<void> {
    try {
      await refreshCache();
      if (state.data.length === 0 && attempt <= 3) {
        const delay = attempt * 30_000;
        logger.warn({ attempt, delayMs: delay }, "Cache still empty after refresh — retrying");
        setTimeout(() => fetchWithRetry(attempt + 1), delay);
      }
    } catch (err) {
      logger.error({ err, attempt }, "Inventory cache fetch failed");
      if (attempt <= 3) {
        const delay = attempt * 30_000;
        logger.info({ delayMs: delay }, "Scheduling retry");
        setTimeout(() => fetchWithRetry(attempt + 1), delay);
      }
    }
  }

  fetchWithRetry();

  // Step 3: hourly refresh keeps the data current
  setInterval(() => {
    refreshCache().catch((err) =>
      logger.error({ err }, "Background inventory cache refresh failed"),
    );
  }, intervalMs);
}
```

---

## 7. API Server — Carfax Cloud Worker

**File:** `artifacts/api-server/src/lib/carfaxWorker.ts`

```typescript
/**
 * Carfax Cloud Worker
 *
 * Runs nightly at 2:15am on the Replit cloud server.
 * Modelled on the proven desktop script — uses the dealer portal VIN search
 * at dealer.carfax.ca/MyReports, hides automation detection, and saves the
 * login session to disk so login only happens once.
 *
 * REQUIRED ENVIRONMENT VARIABLES:
 *   APPS_SCRIPT_WEB_APP_URL  — deployed Apps Script web app URL
 *   CARFAX_EMAIL             — Carfax Canada dealer login email
 *   CARFAX_PASSWORD          — Carfax Canada dealer login password
 *   CARFAX_ENABLED           — set to "true" to activate
 */

import { logger } from "./logger.js";
import * as fs   from "fs";
import * as path from "path";

const APPS_SCRIPT_URL = process.env["APPS_SCRIPT_WEB_APP_URL"]?.trim() ?? "";
const CARFAX_EMAIL    = process.env["CARFAX_EMAIL"]?.trim()    ?? "";
const CARFAX_PASSWORD = process.env["CARFAX_PASSWORD"]?.trim() ?? "";
const CARFAX_ENABLED  = process.env["CARFAX_ENABLED"]?.trim().toLowerCase() === "true";

const CARFAX_HOME      = "https://dealer.carfax.ca/";
const CARFAX_LOGIN_URL = "https://dealer.carfax.ca/login";
const CARFAX_VHR_URL   = "https://dealer.carfax.ca/MyReports";

const SESSION_FILE = path.join(process.cwd(), ".carfax-session.json");

const VIN_SEARCH_SELECTORS = [
  "input.searchVehicle",
  "input.searchbox.searchVehicle",
  'input[placeholder*="VIN"]',
  'input[type="search"]',
];

const REPORT_LINK_SELECTORS = [
  "a.reportLink",
  'a[href*="cfm/display_cfm"]',
  'a[href*="vhr"]',
  'a[href*="/cfm/"]',
];

const GLOBAL_ARCHIVE_SELECTORS = [
  "label#global-archive",
  "input#globalreports",
];

const AUTH0_EMAIL_SELECTORS    = ["#username", 'input[name="username"]', 'input[type="email"]'];
const AUTH0_PASSWORD_SELECTORS = ["#password", 'input[name="password"]', 'input[type="password"]'];

export interface CarfaxTestResult {
  vin:    string;
  status: "found" | "not_found" | "error" | "captcha";
  url?:   string;
  error?: string;
}

interface PendingVin {
  rowIndex: number;
  vin:      string;
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

function humanDelay(base: number): Promise<void> {
  return sleep(base + rand(0, 1000));
}

// ---------------------------------------------------------------------------
// Apps Script communication
// ---------------------------------------------------------------------------

async function fetchPendingVins(): Promise<PendingVin[]> {
  if (!APPS_SCRIPT_URL) {
    logger.warn("APPS_SCRIPT_WEB_APP_URL not configured");
    return [];
  }
  let retries = 3;
  while (retries > 0) {
    try {
      const resp = await fetch(APPS_SCRIPT_URL, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as PendingVin[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      retries--;
      if (retries === 0) {
        logger.error({ err }, "Carfax worker: failed to fetch pending VINs after 3 attempts");
        return [];
      }
      logger.warn({ err, retriesLeft: retries }, "Carfax worker: fetch failed, retrying in 2s");
      await sleep(2_000);
    }
  }
  return [];
}

async function writeCarfaxResult(rowIndex: number, value: string, batchComplete = false): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  let retries = 3;
  while (retries > 0) {
    try {
      await fetch(APPS_SCRIPT_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rowIndex, value, batchComplete }),
        signal:  AbortSignal.timeout(15_000),
      });
      return;
    } catch (err) {
      retries--;
      if (retries === 0) {
        logger.error({ err, rowIndex, value }, "Carfax worker: failed to write result after 3 attempts");
      } else {
        await sleep(1_000);
      }
    }
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
  } catch (_) { /* silent */ }
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

function loadSavedCookies(): any[] {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw     = fs.readFileSync(SESSION_FILE, "utf8");
      const cookies = JSON.parse(raw);
      logger.info({ count: cookies.length, file: SESSION_FILE }, "Carfax worker: loaded saved session cookies");
      return cookies;
    }
  } catch (_) { /* ignore corrupt file */ }
  return [];
}

function saveCookies(cookies: any[]): void {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2), "utf8");
    logger.info({ count: cookies.length }, "Carfax worker: session cookies saved to disk");
  } catch (err) {
    logger.warn({ err }, "Carfax worker: could not save session cookies");
  }
}

// ---------------------------------------------------------------------------
// Browser launch
// ---------------------------------------------------------------------------

async function launchBrowser(): Promise<any> {
  let puppeteer: any;
  try {
    puppeteer = (await import("puppeteer-extra")).default;
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(StealthPlugin());
    logger.info("Carfax worker: using puppeteer-extra with stealth plugin");
  } catch (_) {
    logger.warn("Carfax worker: puppeteer-extra not available, falling back to plain puppeteer");
    try {
      puppeteer = (await import("puppeteer")).default;
    } catch (__) {
      throw new Error("puppeteer not installed");
    }
  }

  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process");
    const found = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) {
      executablePath = found;
      logger.info({ executablePath }, "Carfax worker: using system Chromium");
    }
  } catch (_) { /* use bundled */ }

  const browser = await puppeteer.launch({
    headless: "new" as any,
    executablePath,
    timeout:         90_000,  // 90s browser launch timeout (was 30s, caused crashes)
    protocolTimeout: 90_000,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--disable-extensions-except=",
      "--disable-plugins-discovery",
      "--window-size=1280,900",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  return browser;
}

async function addAntiDetectionScripts(page: any): Promise<void> {
  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({
    "Accept-Language":           "en-CA,en-US;q=0.9,en;q=0.8,fr;q=0.7",
    "Accept-Encoding":           "gzip, deflate, br",
    "Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Sec-Fetch-Site":            "none",
    "Sec-Fetch-Mode":            "navigate",
    "Sec-Fetch-User":            "?1",
    "Sec-Fetch-Dest":            "document",
    "Sec-Ch-Ua":                 '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile":          "?0",
    "Sec-Ch-Ua-Platform":        '"Windows"',
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control":             "max-age=0",
  });
  await page.setCacheEnabled(true);

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    (window as any).chrome = {
      runtime: {
        connect:     () => {},
        sendMessage: () => {},
        onMessage:   { addListener: () => {}, removeListener: () => {} },
      },
      loadTimes: () => {},
      csi:       () => {},
      app:       {},
    };
    Object.defineProperty(navigator, "userAgentData", {
      get: () => ({
        brands: [
          { brand: "Google Chrome", version: "124" },
          { brand: "Chromium",      version: "124" },
          { brand: "Not-A.Brand",   version: "99"  },
        ],
        mobile:   false,
        platform: "Windows",
        getHighEntropyValues: async (_hints: string[]) => ({
          brands: [
            { brand: "Google Chrome", version: "124" },
            { brand: "Chromium",      version: "124" },
            { brand: "Not-A.Brand",   version: "99"  },
          ],
          mobile: false, platform: "Windows", platformVersion: "10.0.0",
          architecture: "x86", bitness: "64", model: "", uaFullVersion: "124.0.6367.60",
          fullVersionList: [
            { brand: "Google Chrome", version: "124.0.6367.60" },
            { brand: "Chromium",      version: "124.0.6367.60" },
            { brand: "Not-A.Brand",   version: "99.0.0.0"      },
          ],
        }),
      }),
    });
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer",              description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client",     filename: "internal-nacl-plugin",             description: "" },
        ];
        return Object.assign(plugins, {
          item: (i: number) => plugins[i], namedItem: (n: string) => plugins.find(p => p.name === n) || null,
          refresh: () => {}, length: plugins.length,
        });
      },
    });
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => {
        const types = [
          { type: "application/pdf",                 description: "Portable Document Format", suffixes: "pdf" },
          { type: "application/x-google-chrome-pdf", description: "Portable Document Format", suffixes: "pdf" },
        ];
        return Object.assign(types, {
          item: (i: number) => types[i], namedItem: (n: string) => types.find(t => t.type === n) || null,
          length: types.length,
        });
      },
    });
    Object.defineProperty(navigator, "languages",           { get: () => ["en-CA", "en-US", "en", "fr-CA"] });
    Object.defineProperty(navigator, "language",            { get: () => "en-CA" });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory",        { get: () => 8 });
    Object.defineProperty(navigator, "connection", {
      get: () => ({
        effectiveType: "4g", rtt: 50 + Math.floor(Math.random() * 50),
        downlink: 5 + Math.random() * 5, saveData: false,
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
      }),
    });
    Object.defineProperty(screen, "width",       { get: () => 1280 });
    Object.defineProperty(screen, "height",      { get: () => 900  });
    Object.defineProperty(screen, "availWidth",  { get: () => 1280 });
    Object.defineProperty(screen, "availHeight", { get: () => 860  });
    Object.defineProperty(screen, "colorDepth",  { get: () => 24   });
    Object.defineProperty(screen, "pixelDepth",  { get: () => 24   });
    Object.defineProperty(window, "outerWidth",  { get: () => 1280 });
    Object.defineProperty(window, "outerHeight", { get: () => 900  });
    const _origToDataURL    = HTMLCanvasElement.prototype.toDataURL;
    const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const noise = () => Math.floor(Math.random() * 3) - 1;
    HTMLCanvasElement.prototype.toDataURL = function(...args: any[]) {
      const ctx = this.getContext("2d");
      if (ctx) {
        const img = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] += noise(); img.data[i+1] += noise(); img.data[i+2] += noise();
        }
        ctx.putImageData(img, 0, 0);
      }
      return _origToDataURL.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.getImageData = function(...args: any[]) {
      const img = _origGetImageData.apply(this, args);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] += noise(); img.data[i+1] += noise(); img.data[i+2] += noise();
      }
      return img;
    };
    const _origQuery = window.navigator.permissions?.query.bind(navigator.permissions);
    if (_origQuery) {
      (navigator.permissions as any).query = (parameters: any) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: "denied" } as PermissionStatus)
          : _origQuery(parameters);
    }
  });
}

async function findSelector(page: any, selectors: string[], timeout = 5000): Promise<any> {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout });
      if (el) return el;
    } catch (_) { /* try next */ }
  }
  return null;
}

async function humanClick(page: any, element: any): Promise<void> {
  const box = await element.boundingBox();
  if (!box) { await element.click(); return; }
  const tx = box.x + rand(Math.floor(box.width * 0.2),  Math.floor(box.width * 0.8));
  const ty = box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8));
  const sx = rand(100, 900);
  const sy = rand(100, 600);
  const steps = rand(12, 22);
  for (let i = 0; i <= steps; i++) {
    const t    = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await page.mouse.move(
      sx + (tx - sx) * ease + rand(-3, 3),
      sy + (ty - sy) * ease + rand(-3, 3),
    );
    await sleep(rand(8, 22));
  }
  await sleep(rand(60, 180));
  await page.mouse.click(tx, ty);
}

async function humanType(page: any, element: any, text: string): Promise<void> {
  await element.click();
  await sleep(rand(80, 200));
  for (let i = 0; i < text.length; i++) {
    await element.type(text[i], { delay: 0 });
    let d = rand(60, 160);
    if (i > 0 && i % rand(4, 7) === 0) d += rand(150, 400);
    await sleep(d);
  }
  await sleep(rand(200, 500));
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function isLoggedIn(page: any): Promise<boolean> {
  await page.goto(CARFAX_HOME, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await humanDelay(1500);
  const content = (await page.content()).toLowerCase();
  return (
    content.includes("sign out")   ||
    content.includes("log out")    ||
    content.includes("my account") ||
    content.includes("my carfax")  ||
    content.includes("my vhrs")
  );
}

async function loginWithAuth0(page: any): Promise<boolean> {
  logger.info("Carfax worker: navigating to Auth0 login page");
  await page.goto(CARFAX_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await humanDelay(1500);

  const emailInput = await findSelector(page, AUTH0_EMAIL_SELECTORS, 10_000);
  if (!emailInput) {
    logger.error("Carfax worker: could not find email/username input on login page");
    return false;
  }
  await humanClick(page, emailInput);
  await humanType(page, emailInput, CARFAX_EMAIL);

  const passInput = await findSelector(page, AUTH0_PASSWORD_SELECTORS, 5_000);
  if (!passInput) {
    logger.error("Carfax worker: could not find password input on login page");
    return false;
  }
  await humanClick(page, passInput);
  await humanType(page, passInput, CARFAX_PASSWORD);

  const submitBtn = await findSelector(page, ['button[type="submit"]'], 5_000);
  if (submitBtn) {
    await humanClick(page, submitBtn);
    await humanDelay(3000);
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
    await humanDelay(2000);
  }

  const confirmed = await isLoggedIn(page);
  if (confirmed) {
    const cookies = await page.cookies();
    saveCookies(cookies);
    logger.info("Carfax worker: login successful — session saved");
  } else {
    logger.error("Carfax worker: login failed — still not authenticated after submit");
  }
  return confirmed;
}

async function ensureLoggedIn(browser: any, page: any): Promise<boolean> {
  const savedCookies = loadSavedCookies();
  if (savedCookies.length > 0) {
    logger.info("Carfax worker: restoring saved session cookies");
    await page.setCookie(...savedCookies);
    const loggedIn = await isLoggedIn(page);
    if (loggedIn) {
      logger.info("Carfax worker: session restored — already logged in");
      return true;
    }
    logger.info("Carfax worker: saved session expired — performing fresh login");
  }
  return loginWithAuth0(page);
}

// ---------------------------------------------------------------------------
// VIN lookup
// ---------------------------------------------------------------------------

function isValidReportHref(href: string | null): boolean {
  if (!href) return false;
  const h = href.trim();
  if (!h || h === "#" || h.startsWith("javascript:") || h === "about:blank") return false;
  return true;
}

async function getRawHref(el: any): Promise<string | null> {
  try {
    return await el.evaluate((a: Element) => a.getAttribute("href"));
  } catch (_) { return null; }
}

async function findReportLink(page: any): Promise<string | null> {
  for (const sel of REPORT_LINK_SELECTORS) {
    try {
      const el = await page.$(sel + ":not([style*='display: none']):not([style*='display:none'])");
      if (el) {
        const visible = await el.evaluate((e: Element) => {
          const s = window.getComputedStyle(e);
          return s.display !== "none" && s.visibility !== "hidden" && (e as HTMLElement).offsetParent !== null;
        }).catch(() => false);
        if (!visible) continue;
        const href = await getRawHref(el);
        if (isValidReportHref(href)) {
          let resolved = href!;
          if (resolved.startsWith("/")) resolved = "https://dealer.carfax.ca" + resolved;
          return resolved;
        }
      }
    } catch (_) { /* try next */ }
  }
  try {
    const links = await page.$$("a[href]");
    for (const link of links) {
      const href = await getRawHref(link);
      if (!isValidReportHref(href)) continue;
      const h = href!;
      if (
        h.includes("cfm/display_cfm")  ||
        h.includes("cfm/vhr")          ||
        h.includes("vehicle-history")  ||
        h.includes("vhr.carfax.ca")    ||
        h.includes("carfax.ca/cfm")
      ) {
        return h.startsWith("/") ? "https://dealer.carfax.ca" + h : h;
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function lookupVinOnDealerPortal(
  page: any,
  vin:  string,
): Promise<{ status: "found" | "not_found" | "session_expired" | "error"; url?: string }> {
  try {
    logger.info({ vin }, "Carfax worker: navigating to dealer VHR page");
    await page.goto(CARFAX_VHR_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await humanDelay(2000);

    const currentUrl: string = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("signin")) {
      logger.warn({ vin }, "Carfax worker: redirected to login mid-batch — session expired");
      return { status: "session_expired" };
    }

    const searchInput = await findSelector(page, VIN_SEARCH_SELECTORS, 8_000);
    if (!searchInput) {
      logger.error({ vin }, "Carfax worker: could not find VIN search input on dealer portal");
      return { status: "error" };
    }

    await searchInput.click({ clickCount: 3 });
    await sleep(rand(80, 180));
    await humanType(page, searchInput, vin);

    await page.mouse.wheel({ deltaY: rand(60, 220) * (Math.random() > 0.3 ? 1 : -1) });
    await sleep(rand(300, 700));
    if (Math.random() > 0.6) {
      await page.mouse.wheel({ deltaY: -rand(20, 80) });
      await sleep(rand(200, 400));
    }

    let found = false;
    try {
      await page.waitForSelector("a.reportLink", { visible: true, timeout: 10_000 });
      found = true;
    } catch (_) { found = false; }

    if (found) {
      const link = await findReportLink(page);
      if (link) {
        logger.info({ vin, url: link }, "Carfax worker: found in My VHRs");
        return { status: "found", url: link };
      }
    }

    logger.info({ vin }, "Carfax worker: not in My VHRs — trying Global Archive");
    const archiveToggle = await findSelector(page, GLOBAL_ARCHIVE_SELECTORS, 3_000);
    if (!archiveToggle) {
      logger.info({ vin }, "Carfax worker: no Global Archive toggle found — not found");
      return { status: "not_found" };
    }

    await humanClick(page, archiveToggle);
    let found2 = false;
    try {
      await page.waitForSelector("a.reportLink", { visible: true, timeout: 6_000 });
      found2 = true;
    } catch (_) { found2 = false; }

    if (found2) {
      const link2 = await findReportLink(page);
      if (link2) {
        logger.info({ vin, url: link2 }, "Carfax worker: found in Global Archive");
        return { status: "found", url: link2 };
      }
    }

    logger.info({ vin }, "Carfax worker: VIN not found in Carfax");
    return { status: "not_found" };
  } catch (err: any) {
    logger.error({ vin, err }, "Carfax worker: VIN lookup error");
    return { status: "error" };
  }
}

// ---------------------------------------------------------------------------
// Public: run against real pending VINs from Apps Script
// ---------------------------------------------------------------------------
let batchRunning   = false;
let batchStartedAt: Date | null = null;

export function getCarfaxBatchStatus(): { running: boolean; startedAt: string | null } {
  return { running: batchRunning, startedAt: batchStartedAt?.toISOString() ?? null };
}

export async function runCarfaxWorker(opts: { force?: boolean } = {}): Promise<void> {
  if (batchRunning) {
    logger.warn("Carfax worker: batch already in progress — skipping duplicate trigger");
    return;
  }

  logger.info("Carfax worker: starting run");

  if (!opts.force && !CARFAX_ENABLED) {
    logger.info("Carfax worker: DISABLED (set CARFAX_ENABLED=true to activate)");
    return;
  }
  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    logger.warn("Carfax worker: CARFAX_EMAIL or CARFAX_PASSWORD not set — skipping");
    await sendAlert("Carfax worker could not run: credentials not set in Replit secrets.");
    return;
  }

  batchRunning   = true;
  batchStartedAt = new Date();

  const pendingVins = await fetchPendingVins();
  if (pendingVins.length === 0) {
    logger.info("Carfax worker: no pending VINs — nothing to do");
    batchRunning = false; batchStartedAt = null;
    return;
  }
  logger.info({ count: pendingVins.length }, "Carfax worker: fetched pending VINs");

  let browser: any = null;
  let processed = 0, succeeded = 0, notFound = 0, failed = 0;

  try {
    // Retry browser launch up to 3 times — Chromium occasionally times out under container load
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        browser = await launchBrowser();
        break;
      } catch (launchErr: any) {
        logger.warn({ attempt, err: String(launchErr) }, "Carfax worker: browser launch attempt failed");
        if (attempt === 3) throw launchErr;
        await sleep(10_000 * attempt); // 10s, 20s back-off
      }
    }
    const page = await browser.newPage();
    await addAntiDetectionScripts(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      await sendAlert("Carfax worker login failed. Check credentials.");
      return;
    }

    for (const { rowIndex, vin } of pendingVins) {
      logger.info({ vin, rowIndex, processed: processed + 1, total: pendingVins.length }, "Carfax worker: processing VIN");

      const result = await lookupVinOnDealerPortal(page, vin);

      if (result.status === "session_expired") {
        logger.info("Carfax worker: re-logging in after session expiry");
        const relogged = await loginWithAuth0(page);
        if (!relogged) { failed++; continue; }
        const retry = await lookupVinOnDealerPortal(page, vin);
        if (retry.status === "found" && retry.url) {
          await writeCarfaxResult(rowIndex, retry.url);
          succeeded++;
        } else if (retry.status === "not_found") {
          await writeCarfaxResult(rowIndex, "NOT FOUND");
          notFound++;
        } else {
          failed++;
        }
      } else if (result.status === "found" && result.url) {
        await writeCarfaxResult(rowIndex, result.url);
        succeeded++;
      } else if (result.status === "not_found") {
        await writeCarfaxResult(rowIndex, "NOT FOUND");
        notFound++;
      } else {
        failed++;
      }

      processed++;
      await humanDelay(rand(4_000, 9_000));
    }

    if (processed > 0) await writeCarfaxResult(0, "", true);

  } catch (err) {
    logger.error({ err }, "Carfax worker: unexpected crash");
    await sendAlert("Carfax worker crashed: " + String(err));
  } finally {
    if (browser) await browser.close();
    batchRunning   = false;
    batchStartedAt = null;
  }

  logger.info({ processed, succeeded, notFound, failed }, "Carfax worker: run complete");
}

// ---------------------------------------------------------------------------
// Public: test with specific VINs — no Apps Script writes
// ---------------------------------------------------------------------------
export async function runCarfaxWorkerForVins(vins: string[]): Promise<CarfaxTestResult[]> {
  const results: CarfaxTestResult[] = [];
  logger.info({ vins }, "Carfax test run: starting");

  if (!CARFAX_EMAIL || !CARFAX_PASSWORD) {
    return vins.map((vin) => ({ vin, status: "error" as const, error: "Missing CARFAX_EMAIL / CARFAX_PASSWORD" }));
  }

  let browser: any = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await addAntiDetectionScripts(page);

    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) {
      return vins.map((vin) => ({ vin, status: "error" as const, error: "Login failed" }));
    }

    for (const vin of vins) {
      logger.info({ vin }, "Carfax test run: looking up VIN");
      const result = await lookupVinOnDealerPortal(page, vin);

      if (result.status === "found" && result.url) {
        results.push({ vin, status: "found", url: result.url });
      } else if (result.status === "not_found") {
        results.push({ vin, status: "not_found" });
      } else if (result.status === "session_expired") {
        results.push({ vin, status: "error", error: "Session expired during test" });
      } else {
        results.push({ vin, status: "error", error: "Lookup error" });
      }

      await humanDelay(rand(2_000, 4_000));
    }
  } catch (err: any) {
    logger.error({ err }, "Carfax test run: crash");
    const remaining = vins.filter((v) => !results.find((r) => r.vin === v));
    for (const vin of remaining) results.push({ vin, status: "error", error: err.message });
  } finally {
    if (browser) await browser.close();
  }

  logger.info({ results }, "Carfax test run: complete");
  return results;
}

// ---------------------------------------------------------------------------
// Scheduler — nightly 2:15am with startup catch-up
// ---------------------------------------------------------------------------
export function scheduleCarfaxWorker(): void {
  let lastRunDate = "";

  const tryRun = (reason: string) => {
    const today = new Date().toISOString().slice(0, 10);
    if (lastRunDate === today) return;
    lastRunDate = today;
    logger.info({ reason }, "Carfax worker: triggering run");
    runCarfaxWorker().catch((err) => logger.error({ err }, "Carfax worker: run error"));
  };

  // Catch-up: if server starts after 2:15am, run in 30s
  const now       = new Date();
  const isPast215 = now.getHours() > 2 || (now.getHours() === 2 && now.getMinutes() >= 15);
  if (isPast215) {
    logger.info("Carfax worker: server started after 2:15am — running catch-up in 30s");
    setTimeout(() => tryRun("startup catch-up"), 30_000);
  }

  setInterval(() => {
    const n = new Date();
    if (n.getHours() === 2 && n.getMinutes() === 15) tryRun("nightly schedule");
  }, 60_000);

  logger.info("Carfax cloud worker scheduled — runs nightly at 2:15am (with startup catch-up)");
}
```

---

## 8. Database Schema — Inventory Cache

**File:** `lib/db/src/schema/inventory-cache.ts`

```typescript
import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

export const inventoryCacheTable = pgTable("inventory_cache", {
  id:          integer("id").primaryKey(),
  data:        jsonb("data").notNull().default([]),
  lastUpdated: timestamp("last_updated").notNull(),
});
```

---

## 9. Frontend — Inventory Page

**File:** `artifacts/inventory-portal/src/pages/inventory.tsx`

```tsx
import { useState, useCallback, useEffect, useRef } from "react";
import {
  useGetInventory,
  useGetCacheStatus,
  useGetVehicleImages,
  useGetMe,
} from "@workspace/api-client-react";
import {
  Search, ExternalLink, FileText, AlertCircle, ChevronUp, ChevronDown,
  ChevronsUpDown, Copy, Check, RefreshCw, Camera, X, ChevronLeft,
  ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

type SortKey = "location" | "vehicle" | "vin" | "price" | "km";
type SortDir = "asc" | "desc";

interface Filters {
  yearMin:  string;
  yearMax:  string;
  kmMax:    string;
  priceMin: string;
  priceMax: string;
}

const EMPTY_FILTERS: Filters = { yearMin: "", yearMax: "", kmMax: "", priceMin: "", priceMax: "" };

function parseNum(s: string): number {
  return parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
}

function extractYear(vehicle: string): number {
  const y = parseInt(vehicle.trim().split(/\s+/)[0] ?? "0", 10);
  return y > 1900 && y < 2100 ? y : 0;
}

function formatPrice(raw: string | undefined): string {
  if (!raw || raw === "NOT FOUND") return "—";
  const n = parseNum(raw);
  if (!n) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30 inline ml-1" />;
  return dir === "asc"
    ? <ChevronUp   className="w-3.5 h-3.5 text-blue-600 inline ml-1" />
    : <ChevronDown className="w-3.5 h-3.5 text-blue-600 inline ml-1" />;
}

function CopyVin({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(vin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [vin]);
  return (
    <button onClick={handleCopy} title="Click to copy VIN"
      className="group flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 transition-colors">
      <span className="font-mono text-xs">{vin}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy  className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 shrink-0 transition-opacity" />}
    </button>
  );
}

function PhotoGallery({ vin, onClose }: { vin: string; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const { data, isLoading } = useGetVehicleImages({ vin });
  const urls = data?.urls ?? [];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")     onClose();
      if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, urls.length - 1));
      if (e.key === "ArrowLeft")  setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [urls.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-4xl w-full bg-white rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 bg-white/90 rounded-full shadow hover:bg-gray-100">
          <X className="w-5 h-5 text-gray-700" />
        </button>
        {isLoading ? (
          <div className="flex items-center justify-center h-64"><RefreshCw className="w-8 h-8 text-gray-400 animate-spin" /></div>
        ) : urls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Camera className="w-10 h-10 mb-2" /><p className="text-sm">No photos available</p>
          </div>
        ) : (
          <>
            <div className="relative bg-black flex items-center justify-center" style={{ height: "420px" }}>
              <img src={urls[idx]} alt={`Photo ${idx + 1}`} className="max-h-full max-w-full object-contain" />
              {urls.length > 1 && (
                <>
                  <button onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx === 0}
                    className="absolute left-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </button>
                  <button onClick={() => setIdx((i) => Math.min(i + 1, urls.length - 1))} disabled={idx === urls.length - 1}
                    className="absolute right-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </button>
                </>
              )}
            </div>
            {urls.length > 1 && (
              <div className="flex gap-1.5 p-3 overflow-x-auto bg-gray-50">
                {urls.map((url, i) => (
                  <button key={i} onClick={() => setIdx(i)}
                    className={`shrink-0 w-16 h-12 rounded overflow-hidden border-2 transition-colors ${i === idx ? "border-blue-500" : "border-transparent hover:border-gray-300"}`}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="px-4 py-2 text-center text-xs text-gray-400 border-t">
              {idx + 1} / {urls.length} photos — VIN: {vin}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PhotoThumb({ vin }: { vin: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="View photos"
        className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
        <Camera className="w-4 h-4" />
      </button>
      {open && <PhotoGallery vin={vin} onClose={() => setOpen(false)} />}
    </>
  );
}

function VehicleCard({ item, showPacCost, showOwnerCols }: { item: any; showPacCost: boolean; showOwnerCols: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{item.location}</span>
        <div className="flex items-center gap-2">
          <PhotoThumb vin={item.vin} />
          {item.carfax && item.carfax !== "NOT FOUND" && (
            <a href={item.carfax} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
              <FileText className="w-4 h-4" />
            </a>
          )}
          {item.website && item.website !== "NOT FOUND" && (
            <a href={item.website} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="Listing">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="font-semibold text-gray-900 text-sm mb-1">{item.vehicle}</p>
        <CopyVin vin={item.vin} />
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-gray-400 mb-0.5">KM</p>
            <p className="font-medium text-gray-700">
              {item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") : "—"}
            </p>
          </div>
          {showOwnerCols && (
            <div>
              <p className="text-gray-400 mb-0.5">Matrix Price</p>
              <p className="font-medium text-gray-700">{formatPrice(item.matrixPrice)}</p>
            </div>
          )}
          {showOwnerCols && (
            <div>
              <p className="text-gray-400 mb-0.5">Cost</p>
              <p className="font-semibold text-red-700">{formatPrice(item.cost)}</p>
            </div>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          {showPacCost && (
            <div>
              <p className="text-gray-400 mb-0.5">PAC Cost</p>
              <p className="font-semibold text-gray-900">{formatPrice(item.price)}</p>
            </div>
          )}
          <div>
            <p className="text-gray-400 mb-0.5">Online Price</p>
            <p className="font-medium text-gray-700">{formatPrice(item.onlinePrice)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RangeInputs({
  label, minVal, maxVal, minPlaceholder, maxPlaceholder,
  onMinChange, onMaxChange, prefix = "",
}: {
  label: string; minVal: string; maxVal: string;
  minPlaceholder: string; maxPlaceholder: string;
  onMinChange: (v: string) => void; onMaxChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={minVal} onChange={(e) => onMinChange(e.target.value)}
            placeholder={minPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
        <span className="text-gray-300 text-sm">—</span>
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={maxVal} onChange={(e) => onMaxChange(e.target.value)}
            placeholder={maxPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-200">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 transition-colors"><X className="w-3 h-3" /></button>
    </span>
  );
}

export default function Inventory() {
  const [search,      setSearch]      = useState("");
  const [sortKey,     setSortKey]     = useState<SortKey>("vehicle");
  const [sortDir,     setSortDir]     = useState<SortDir>("asc");
  const [showFilters, setShowFilters] = useState(false);
  const [filters,     setFilters]     = useState<Filters>(EMPTY_FILTERS);
  const [, setLocation]               = useLocation();
  const lastKnownUpdate               = useRef<string | null>(null);

  const { data: me } = useGetMe({ query: { retry: false } });
  const isGuest = me?.role === "guest";
  const isOwner = me?.isOwner === true;

  type ViewMode = "owner" | "user" | "customer";
  const [viewMode, setViewMode] = useState<ViewMode>("user");
  useEffect(() => { if (isOwner) setViewMode("owner"); }, [isOwner]);

  // Derived display booleans
  const showOwnerCols = isOwner && viewMode === "owner";
  const showPacCost   = !isGuest && viewMode !== "customer";

  const { data: inventory, isLoading, error, refetch: refetchInventory } = useGetInventory({ query: { retry: false } });
  const { data: cacheStatus } = useGetCacheStatus({ query: { refetchInterval: 60_000, retry: false } });

  // Auto-refetch when the cache updates
  useEffect(() => {
    if (!cacheStatus?.lastUpdated) return;
    if (lastKnownUpdate.current === null) { lastKnownUpdate.current = cacheStatus.lastUpdated; return; }
    if (cacheStatus.lastUpdated !== lastKnownUpdate.current) {
      lastKnownUpdate.current = cacheStatus.lastUpdated;
      refetchInventory();
    }
  }, [cacheStatus?.lastUpdated, refetchInventory]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401) { setLocation("/login"); return null; }
    if (status === 403) { setLocation("/denied"); return null; }
    return (
      <div className="p-8 text-center rounded-lg border border-red-200 bg-red-50 mt-10 max-w-xl mx-auto">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
        <h2 className="text-base font-semibold text-gray-900 mb-1">Error loading inventory</h2>
        <p className="text-sm text-gray-500">Please refresh the page or contact support.</p>
      </div>
    );
  }

  if (isLoading) return <FullScreenSpinner />;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter    = (key: keyof Filters) => (val: string) => setFilters((f) => ({ ...f, [key]: val }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const hasFilters   = Object.values(filters).some(Boolean);

  // Deduplicate by VIN — keep lowest price
  const parseNumericPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || Infinity;
  type Item = NonNullable<typeof inventory>[number];
  const dedupedMap = new Map<string, Item>();
  for (const item of (inventory ?? [])) {
    const existing = dedupedMap.get(item.vin);
    if (!existing || parseNumericPrice(item.price) < parseNumericPrice(existing.price))
      dedupedMap.set(item.vin, item);
  }
  const deduped = Array.from(dedupedMap.values());

  const years      = deduped.map((i) => extractYear(i.vehicle)).filter(Boolean);
  const dataYearMin = years.length ? Math.min(...years) : 2000;
  const dataYearMax = years.length ? Math.max(...years) : new Date().getFullYear();
  const kms         = deduped.map((i) => parseNum(i.km)).filter(Boolean);
  const dataKmMax   = kms.length ? Math.max(...kms) : 300000;
  const prices      = deduped.map((i) => parseNum(i.price)).filter(Boolean);
  const dataPriceMax = prices.length ? Math.max(...prices) : 100000;

  const filtered = deduped.filter((item) => {
    if (search) {
      const term = search.toLowerCase();
      if (!item.vehicle.toLowerCase().includes(term) &&
          !item.vin.toLowerCase().includes(term) &&
          !item.location.toLowerCase().includes(term)) return false;
    }
    const year = extractYear(item.vehicle);
    if (filters.yearMin && year && year < parseInt(filters.yearMin)) return false;
    if (filters.yearMax && year && year > parseInt(filters.yearMax)) return false;
    const km = parseNum(item.km);
    if (filters.kmMax && km && km > parseNum(filters.kmMax)) return false;
    if (!isGuest) {
      const price = parseNum(item.price);
      if (filters.priceMin && price && price < parseNum(filters.priceMin)) return false;
      if (filters.priceMax && price && price > parseNum(filters.priceMax)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av  = (a[sortKey] ?? "").toLowerCase();
    const bv  = (b[sortKey] ?? "").toLowerCase();
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const activeChips: { label: string; clear: () => void }[] = [
    ...(filters.yearMin || filters.yearMax ? [{
      label: `Year: ${filters.yearMin || dataYearMin}–${filters.yearMax || dataYearMax}`,
      clear: () => setFilters((f) => ({ ...f, yearMin: "", yearMax: "" })),
    }] : []),
    ...(filters.kmMax ? [{
      label: `KM <= ${parseInt(filters.kmMax).toLocaleString("en-US")}`,
      clear: () => setFilter("kmMax")(""),
    }] : []),
    ...(!isGuest && (filters.priceMin || filters.priceMax) ? [{
      label: `PAC Cost: $${filters.priceMin || "0"}–$${filters.priceMax || "inf"}`,
      clear: () => setFilters((f) => ({ ...f, priceMin: "", priceMax: "" })),
    }] : []),
  ];

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-20 text-center rounded-lg border border-gray-200 bg-white">
      <Search className="w-8 h-8 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-700 mb-1">No vehicles found</p>
      <p className="text-sm text-gray-400">Try adjusting your search or filters.</p>
      {(search || hasFilters) && (
        <button onClick={() => { setSearch(""); clearFilters(); }}
          className="mt-4 px-4 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          Clear all
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header + search + controls */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Vehicle Inventory</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {sorted.length} {sorted.length === 1 ? "vehicle" : "vehicles"}
              {sorted.length !== deduped.length ? ` of ${deduped.length} total` : ""}
            </p>
            {cacheStatus?.lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                {cacheStatus.isRefreshing
                  ? <><RefreshCw className="w-3 h-3 animate-spin" /> Updating…</>
                  : <>Updated {timeAgo(cacheStatus.lastUpdated)}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input type="text"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                placeholder="Search vehicle, VIN, location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowFilters((s) => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showFilters || hasFilters
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}>
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {hasFilters && <span className="bg-white text-blue-600 text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{activeChips.length}</span>}
            </button>
            {/* View mode toggle — owners see Own/User/Cust, viewers see User/Cust */}
            {!isGuest && (
              <div className="flex rounded overflow-hidden border border-gray-200 shrink-0">
                {isOwner && (
                  <button onClick={() => setViewMode("owner")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "owner" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    Own
                  </button>
                )}
                <button onClick={() => setViewMode("user")}
                  className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "user" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                  User
                </button>
                <button onClick={() => setViewMode("customer")}
                  className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "customer" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                  Cust
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <div className={`grid gap-4 ${isGuest ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
              <RangeInputs label="Year" minVal={filters.yearMin} maxVal={filters.yearMax}
                minPlaceholder={String(dataYearMin)} maxPlaceholder={String(dataYearMax)}
                onMinChange={setFilter("yearMin")} onMaxChange={setFilter("yearMax")} />
              <RangeInputs label="Max KM" minVal="" maxVal={filters.kmMax}
                minPlaceholder="0" maxPlaceholder={Math.round(dataKmMax / 1000) * 1000 + ""}
                onMinChange={() => {}} onMaxChange={setFilter("kmMax")} />
              {showPacCost && (
                <RangeInputs label="PAC Cost" minVal={filters.priceMin} maxVal={filters.priceMax}
                  minPlaceholder="0" maxPlaceholder={Math.round(dataPriceMax / 1000) * 1000 + ""}
                  onMinChange={setFilter("priceMin")} onMaxChange={setFilter("priceMax")} prefix="$" />
              )}
            </div>
            {hasFilters && (
              <button onClick={clearFilters}
                className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors">
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <FilterChip key={chip.label} label={chip.label} onRemove={chip.clear} />
            ))}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      {isMobile ? (
        sorted.length === 0 ? emptyState : (
          <div className="space-y-3">
            {sorted.map((item, i) => (
              <VehicleCard key={`${item.vin}-${i}`} item={item} showPacCost={showPacCost} showOwnerCols={showOwnerCols} />
            ))}
          </div>
        )
      ) : (
        /* Desktop table */
        sorted.length === 0 ? emptyState : (
          <div className="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
            {/* Header row */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              {[
                { key: "location" as SortKey, label: "Location", cls: "w-24 shrink-0" },
                { key: "vehicle"  as SortKey, label: "Vehicle",  cls: "flex-1 min-w-0" },
                { key: "vin"      as SortKey, label: "VIN",      cls: "w-40 shrink-0" },
                { key: "km"       as SortKey, label: "KM",       cls: "w-24 shrink-0" },
              ].map((col) => (
                <div key={col.label} className={col.cls}>
                  <button onClick={() => handleSort(col.key)}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    {col.label}<SortIcon active={sortKey === col.key} dir={sortDir} />
                  </button>
                </div>
              ))}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Matrix Price</div>}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Cost</div>}
              {showPacCost   && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">PAC Cost</div>}
              <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Online Price</div>
              <div className="w-8  shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">CFX</div>
              <div className="w-8  shrink-0" />
              <div className="w-8  shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Link</div>
            </div>
            {/* Data rows */}
            <div>
              {sorted.map((item, i) => (
                <div key={`${item.vin}-${i}`}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i < sorted.length - 1 ? "border-b border-gray-100" : ""}`}>
                  <div className="w-24 shrink-0 text-sm text-gray-700 truncate font-medium">{item.location || "—"}</div>
                  <div className="flex-1 min-w-0 text-sm text-gray-900 font-medium truncate">{item.vehicle}</div>
                  <div className="w-40 shrink-0"><CopyVin vin={item.vin} /></div>
                  <div className="w-24 shrink-0 text-sm text-gray-600">
                    {item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : "—"}
                  </div>
                  {showOwnerCols && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.matrixPrice ?? "")}</div>}
                  {showOwnerCols && <div className="w-24 shrink-0 text-sm font-medium text-red-700">{formatPrice(item.cost ?? "")}</div>}
                  {showPacCost   && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.price)}</div>}
                  <div className="w-28 shrink-0 text-sm text-gray-700">{formatPrice(item.onlinePrice)}</div>
                  <div className="w-8 shrink-0 flex justify-center">
                    {item.carfax && item.carfax !== "NOT FOUND"
                      ? <a href={item.carfax} target="_blank" rel="noopener noreferrer"
                          className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
                          <FileText className="w-4 h-4" />
                        </a>
                      : <span className="text-gray-200 text-sm">—</span>}
                  </div>
                  <div className="w-8 shrink-0 flex justify-center"><PhotoThumb vin={item.vin} /></div>
                  <div className="w-8 shrink-0 flex justify-center">
                    {item.website && item.website !== "NOT FOUND"
                      ? <a href={item.website} target="_blank" rel="noopener noreferrer"
                          className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="View Listing">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      : <span className="text-gray-200 text-sm">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
```

---

## 10. Key Configuration Reference

### Environment Variables (Replit Secrets)

| Variable                 | Used By           | Description |
|--------------------------|-------------------|-------------|
| `SESSION_SECRET`         | API Server        | Express session signing key |
| `GOOGLE_CLIENT_ID`       | API Server        | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET`   | API Server        | Google OAuth client secret |
| `OWNER_EMAIL`            | API Server        | Email address of the portal owner (bypasses access check) |
| `INVENTORY_DATA_URL`     | API Server        | Apps Script web app URL + `?action=inventory` |
| `REFRESH_SECRET`         | API Server        | Shared secret for `/api/refresh` webhook |
| `CARFAX_EMAIL`           | Carfax Worker     | Dealer portal login email |
| `CARFAX_PASSWORD`        | Carfax Worker     | Dealer portal login password |
| `CARFAX_ENABLED`         | Carfax Worker     | Set to `"true"` to activate nightly runs |
| `APPS_SCRIPT_WEB_APP_URL`| Carfax Worker     | Apps Script web app URL (no `?action=`) |

### Apps Script Settings Tab

| Setting                   | Description |
|---------------------------|-------------|
| `SOURCE_SHEET_URL`        | Full URL of the shared Matrix spreadsheet |
| `SOURCE_TAB_NAME`         | Tab name inside the shared spreadsheet (default: `Sheet1`) |
| `NOTIFICATION_EMAILS`     | Comma-separated emails for change notifications and alerts |
| `CHECK_INTERVAL_HOURS`    | How often auto-sync runs (default: `1`) |
| `REPLIT_REFRESH_URL`      | `https://<domain>/api/refresh` |
| `REPLIT_REFRESH_SECRET`   | Must match `REFRESH_SECRET` in Replit |

### Spreadsheet Column Layout ("My List" tab)

| Col | Index | Field         | Notes |
|-----|-------|---------------|-------|
| A   | 0     | Location      | e.g. `MM` |
| B   | 1     | VIN           | |
| C   | 2     | Year/Make     | |
| D   | 3     | Model         | |
| E   | 4     | Mileage       | |
| F   | 5     | Price         | Matrix list price → `matrixPrice` (owner-only) |
| G   | 6     | Your Cost     | **User-managed, never overwritten** → `cost` (owner-only) |
| H   | 7     | Notes/Your Cost | PAC selling price → `price`; must be filled for row to appear in portal |
| I   | 8     | Price Changed | Auto-written timestamp |
| J   | 9     | Carfax        | Populated by Replit Carfax worker |
| K   | 10    | Website       | Inventory URL from Typesense |
| L   | 11    | Online Price  | Current retail price from Typesense |

### Typesense Collections

| Site     | Collection ID                        | Preferred? |
|----------|--------------------------------------|------------|
| Parkdale | `37042ac7ece3a217b1a41d6f54ba6855`   | Yes (checked first) |
| Matrix   | `cebacbca97920d818d57c6f0526d7413`   | Fallback |

### Access Control

- **Owner bypass:** `IJOMHA20@GMAIL.COM` — always has full access, no DB entry needed.
- **Invite others:** `/admin` page → add email + role (`viewer` or `guest`).
- **Sandra:** `sandra@driveurdream.ca` — needs to be added via `/admin`.

### Carfax Worker Notes

- Session cookies stored at `.carfax-session.json` (27 cookies, **not encrypted** — do not modify).
- Nightly schedule: **2:15am**. Startup catch-up runs 30s after server start if already past 2:15am.
- Browser launch timeout: **90s** (increased from 30s). Up to **3 retry attempts** with 10s/20s back-off.
- Alerts on failure sent via Apps Script `notify` action → email to `NOTIFICATION_EMAILS`.

---

*End of document — all 9 source files captured.*
