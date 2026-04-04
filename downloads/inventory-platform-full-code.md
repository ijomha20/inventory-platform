# Inventory Platform — Complete Source Code
## Current Platform (April 2026)

---

## TABLE OF CONTENTS

1. [Platform Architecture](#architecture)
2. [Google Apps Script — InventorySync_FINAL.gs](#apps-script)
3. [Desktop Carfax Script — carfax-sync.js](#desktop-carfax)
4. [API Server](#api-server)
   - index.ts
   - app.ts
   - lib/logger.ts
   - lib/auth.ts
   - lib/inventoryCache.ts
   - lib/emailService.ts
   - lib/carfaxWorker.ts
   - routes/index.ts
   - routes/health.ts
   - routes/auth.ts
   - routes/inventory.ts
   - routes/access.ts
   - routes/carfax.ts
   - routes/price-lookup.ts
   - scripts/testCarfax.ts
   - build.mjs
   - package.json
5. [Inventory Portal — React/Vite Frontend](#portal)
   - main.tsx
   - App.tsx
   - components/layout.tsx
   - pages/login.tsx
   - pages/denied.tsx
   - pages/inventory.tsx
   - pages/admin.tsx
6. [Reusable Automation Template](#template)

---

## 1. PLATFORM ARCHITECTURE {#architecture}

```
Google Sheet ("My List")
        │
        │  hourly Apps Script trigger
        ▼
InventorySync_FINAL.gs   ◄──── reads shared Matrix spreadsheet
        │                       writes: Location, VIN, Vehicle,
        │                               KM, Price, Website link
        │
        │  GET/POST (web app URL)
        ▼
Replit API Server  (https://script-reviewer.replit.app/api)
        │
        ├── Carfax Cloud Worker (nightly 2:15am)
        │     Puppeteer + stealth → dealer.carfax.ca
        │     writes Carfax URL back to sheet via POST
        │
        ├── Inventory Cache (hourly refresh)
        │     fetches sheet data → enriches with Typesense prices
        │
        ├── Google OAuth (Passport.js)
        │     roles: Owner / Viewer / Guest
        │
        └── REST API
              /api/inventory      — cached vehicle list
              /api/vehicle-images — photo gallery (Typesense CDN)
              /api/price-lookup   — live Typesense price by URL
              /api/access         — user management (owner only)
              /api/audit-log      — change history (owner only)
              /api/carfax/test    — manual Carfax test (owner only)

Inventory Portal  (same domain, path /)
        React + Vite SPA
        ├── Login page  → Google OAuth
        ├── Inventory   → table/cards, search, filters, photos, links
        └── Admin       → access list, role management, audit log

Typesense (external, read-only)
        Host: v6eba1srpfohj89dp-1.a1.typesense.net
        Matrix collection:   cebacbca97920d818d57c6f0526d7413
        Parkdale collection: 37042ac7ece3a217b1a41d6f54ba6855
        CDN: https://zopsoftware-asset.b-cdn.net

Environment Variables Required:
        SESSION_SECRET          — express-session signing key
        GOOGLE_CLIENT_ID        — Google OAuth app client ID
        GOOGLE_CLIENT_SECRET    — Google OAuth app client secret
        OWNER_EMAIL             — Google email of the portal owner
        INVENTORY_DATA_URL      — Apps Script web app GET URL
        APPS_SCRIPT_WEB_APP_URL — Apps Script web app URL (Carfax worker)
        REFRESH_SECRET          — shared secret for /api/refresh webhook
        CARFAX_EMAIL            — dealer.carfax.ca login email
        CARFAX_PASSWORD         — dealer.carfax.ca login password
        CARFAX_ENABLED          — "true" to activate nightly worker
        RESEND_API_KEY          — Resend.com key for invitation emails
        PORT                    — assigned automatically by Replit
```

---

## 2. GOOGLE APPS SCRIPT — InventorySync_FINAL.gs {#apps-script}

Paste this entire file into the Apps Script editor bound to "My List".
Handles: hourly sync from the shared Matrix sheet, price-change notifications,
website link lookup via Typesense, and the GET/POST web app bridge used by
the Carfax cloud worker.

```javascript
// =============================================================================
// MATRIX INVENTORY SYNC v3.1
// =============================================================================
// Pulls directly from the shared Matrix spreadsheet into "My List".
// No intermediate Source List tab required.
//
// Column layout for "My List":
//   A  Location        (e.g. "MM")
//   B  VIN
//   C  Year/Make
//   D  Model
//   E  Mileage
//   F  Price
//   G  Prev Price      (auto-written when price changes)
//   H  Notes           (user-editable, never overwritten by script)
//   I  Price Changed   (timestamp of last price change, auto-written)
//   J  Carfax          (populated by the Carfax automation script)
//   K  Website         (inventory URL; Parkdale preferred, Matrix fallback)
//
// Rows are sorted by column I descending (most recently changed at top).
//
// Setup instructions:
//   1. Paste this entire file into Apps Script, replacing any old code.
//   2. Run firstTimeSetup from the function dropdown.
//   3. Fill in the Settings tab (source URL, emails, etc.)
//   4. Run setupNotificationTrigger to activate the hourly auto-check.
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
var TOTAL_COLS        = 11;

// Website link lookup (Typesense — same engine both sites use)
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

var SET_SOURCE_URL       = "SOURCE_SHEET_URL";
var SET_SOURCE_TAB       = "SOURCE_TAB_NAME";
var SET_EMAILS           = "NOTIFICATION_EMAILS";
var SET_INTERVAL_HOURS   = "CHECK_INTERVAL_HOURS";
var SET_LAST_SYNCED      = "LAST_SYNCED";
var SET_LAST_SYNC_RESULT = "LAST_SYNC_RESULT";

var PROP_STATE = "MATRIX_INVENTORY_STATE_V3";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Inventory Sync")
    .addItem("Sync Now", "syncNow")
    .addItem("Fetch Website Links", "fetchWebsiteLinks")
    .addSeparator()
    .addItem("First-Time Setup", "firstTimeSetup")
    .addItem("Setup Auto-Notifications", "setupNotificationTrigger")
    .addToUi();
}

function getSettings() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_SETTINGS);
  var defaults = {};
  defaults[SET_SOURCE_URL]     = "";
  defaults[SET_SOURCE_TAB]     = "Sheet1";
  defaults[SET_EMAILS]         = "";
  defaults[SET_INTERVAL_HOURS] = "1";
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

function firstTimeSetup() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var ui      = SpreadsheetApp.getUi();
  var created = [];

  if (!ss.getSheetByName(TAB_SETTINGS)) {
    var s = ss.insertSheet(TAB_SETTINGS);
    s.getRange("A1:C1").setValues([["Setting", "Value", "Notes"]]).setFontWeight("bold");
    var rows = [
      [SET_SOURCE_URL,       "",       "Full URL of the shared Matrix spreadsheet"],
      [SET_SOURCE_TAB,       "Sheet1", "Tab name inside the shared spreadsheet"],
      [SET_EMAILS,           "",       "Comma-separated email addresses for notifications"],
      [SET_INTERVAL_HOURS,   "1",      "How often auto-check runs (hours). Re-run Setup Auto-Notifications to apply."],
      [SET_LAST_SYNCED,      "",       "Auto-written by script, do not edit"],
      [SET_LAST_SYNC_RESULT, "",       "Auto-written by script, do not edit"]
    ];
    s.getRange(2, 1, rows.length, 3).setValues(rows);
    s.setColumnWidth(1, 200);
    s.setColumnWidth(2, 350);
    s.setColumnWidth(3, 380);
    created.push(TAB_SETTINGS);
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
    var mh = ["Location", "VIN", "Year/Make", "Model", "Mileage", "Price", "Prev Price", "Notes", "Price Changed", "Carfax", "Website"];
    m.getRange(1, 1, 1, mh.length).setValues([mh]).setFontWeight("bold");
    m.setFrozenRows(1);
    m.setColumnWidth(COL_PRICE_CHANGED + 1, 145);
    created.push(TAB_MY_LIST);
  }

  if (created.length > 0) {
    ui.alert("Setup Complete!\n\nCreated tabs: " + created.join(", ") +
      "\n\nNext: Fill in the Settings tab, then run Setup Auto-Notifications.");
  } else {
    ui.alert("Setup already complete. All required tabs exist.");
  }
}

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

  var removedVins = [];
  for (var i = myData.length - 1; i >= 1; i--) {
    var loc = myData[i][COL_LOCATION] ? myData[i][COL_LOCATION].toString().trim().toUpperCase() : "";
    var vin = myData[i][COL_VIN]      ? myData[i][COL_VIN].toString().trim().toLowerCase()      : "";
    if (loc === "MM" && vin !== "" && !vinMap[vin]) {
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
      values: [vinMap[cvin].vin, vinMap[cvin].col3, vinMap[cvin].col4, vinMap[cvin].col5, newPriceRaw, changed ? oldPrice : currentData[j][COL_PREV_PRICE]]
    });
  }

  for (var u = 0; u < dataUpdateQueue.length; u++) {
    mySheet.getRange(dataUpdateQueue[u].rowNum, 2, 1, 6).setValues([dataUpdateQueue[u].values]);
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
    newRows.push(["MM", rawRows[r][1], rawRows[r][2], rawRows[r][3], rawRows[r][4], rawRows[r][5], "", "", "", ""]);
    newVins.push(sVin);
  }
  if (newRows.length > 0) {
    var lastRow = mySheet.getLastRow();
    mySheet.getRange(lastRow + 1, 1, newRows.length, TOTAL_COLS).setValues(newRows);
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
      if (newVinSet[fvin])          cyanRanges.push("A" + (f + 1) + ":J" + (f + 1));
      else if (changedVinSet[fvin]) yellowRanges.push("A" + (f + 1) + ":J" + (f + 1));
    }
    if (cyanRanges.length > 0)   mySheet.getRangeList(cyanRanges).setBackground("#00FFFF");
    if (yellowRanges.length > 0) mySheet.getRangeList(yellowRanges).setBackground("#FFFF00");
  }

  var timestamp     = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
  var resultSummary = newVins.length + " new, " + dataUpdateQueue.length + " updated, " + removedVins.length + " removed, " + priceChangedVins.length + " price changes";
  writeSetting(SET_LAST_SYNCED,      timestamp);
  writeSetting(SET_LAST_SYNC_RESULT, resultSummary);
  appendLog("Sync", newVins.length, dataUpdateQueue.length, removedVins.length, priceChangedVins.length, "OK", "");
  return { newVins: newVins, updatedCount: dataUpdateQueue.length, removedVins: removedVins, priceChangedVins: priceChangedVins, timestamp: timestamp };
}

function syncNow() {
  var result = performSync(false);
  if (!result) return;
  var msg = "Sync Complete! (" + result.timestamp + ")";
  if (result.newVins.length > 0)          msg += "\n\nNEW: " + result.newVins.length + " new unit(s) highlighted in cyan";
  if (result.priceChangedVins.length > 0) msg += "\nPRICE CHANGES: " + result.priceChangedVins.length + " unit(s) highlighted in yellow, timestamp in col I";
  if (result.removedVins.length > 0)      msg += "\nREMOVED: " + result.removedVins.length + " unit(s) no longer in Matrix feed";
  if (result.updatedCount > 0)            msg += "\nUPDATED: " + result.updatedCount + " existing unit(s) refreshed";
  if (result.newVins.length === 0 && result.priceChangedVins.length === 0 && result.removedVins.length === 0 && result.updatedCount === 0)
    msg += "\n\nNo changes. Your list is already up to date.";
  SpreadsheetApp.getUi().alert(msg);
}

function syncNowHeadless() { performSync(true); }

function setupNotificationTrigger() {
  var ui       = SpreadsheetApp.getUi();
  var settings = getSettings();
  var hours    = parseInt(settings[SET_INTERVAL_HOURS], 10) || 1;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "autoCheckForChanges") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("autoCheckForChanges").timeBased().everyHours(hours).create();
  ui.alert("Auto-Notifications Activated!\n\nChecking every " + hours + " hour(s).\nNotifications sent to: " + (settings[SET_EMAILS] || "(not configured)"));
}

function autoCheckForChanges() {
  var props = PropertiesService.getScriptProperties();
  var vinMap, rawRows;
  try {
    var fetched = fetchMatrixData();
    vinMap  = fetched.vinMap;
    rawRows = fetched.rawRows;
  } catch (e) {
    appendLog("Auto-Check", 0, 0, 0, 0, "ERROR", e.message);
    return;
  }
  var currentState = {};
  for (var i = 0; i < rawRows.length; i++) {
    var vin = rawRows[i][1] ? rawRows[i][1].toString().trim().toLowerCase() : "";
    if (!vin) continue;
    currentState[vin] = {
      vin: rawRows[i][1],
      description: ((rawRows[i][2] || "") + " " + (rawRows[i][3] || "")).trim(),
      mileage: rawRows[i][4],
      price: rawRows[i][5]
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
  var svins = Object.keys(currentState);
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
    appendLog("Auto-Check", 0, 0, 0, 0, "No changes", "");
  }
}

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
// WEB APP BRIDGE (for Carfax cloud worker)
// Deploy as Web App: Execute as Me, Who has access: Anyone
// =============================================================================

function doGet(e) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ error: "My List tab not found" })).setMimeType(ContentService.MimeType.JSON);
  var data = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var vin    = data[i][COL_VIN]    ? data[i][COL_VIN].toString().trim()    : "";
    var carfax = data[i][COL_CARFAX] ? data[i][COL_CARFAX].toString().trim() : "";
    if (vin && vin.length > 5 && (!carfax || carfax === "NOT FOUND")) result.push({ rowIndex: i + 1, vin: vin });
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ error: "My List tab not found" })).setMimeType(ContentService.MimeType.JSON);
  if (!payload.rowIndex || !payload.value) return ContentService.createTextOutput(JSON.stringify({ error: "Missing rowIndex or value" })).setMimeType(ContentService.MimeType.JSON);
  sheet.getRange(payload.rowIndex, COL_CARFAX + 1).setValue(payload.value);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// WEBSITE LINK LOOKUP (Column K) — Typesense direct query
// =============================================================================

function searchTypesense(site, vin) {
  var endpoint = "https://" + TYPESENSE_HOST +
    "/collections/" + site.collection +
    "/documents/search" +
    "?q="            + encodeURIComponent(vin) +
    "&query_by=vin"  +
    "&num_typos=0"   +
    "&per_page=1"    +
    "&x-typesense-api-key=" + site.apiKey;
  try {
    var resp = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var body = JSON.parse(resp.getContentText());
    if (!body.hits || body.hits.length === 0) return null;
    var doc = body.hits[0].document;
    var docVin = doc.vin ? doc.vin.toString().trim().toUpperCase() : "";
    if (docVin !== vin.toUpperCase()) return null;
    if (doc.page_url) {
      var p = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
      return site.siteUrl + "/" + p + "/";
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

function fetchWebsiteLinks() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) { SpreadsheetApp.getUi().alert("My List tab not found."); return; }
  var data    = sheet.getDataRange().getValues();
  var found   = 0;
  var missing = 0;
  var skipped = 0;
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
    else     { sheet.getRange(i + 1, COL_WEBSITE + 1).setValue("NOT FOUND"); missing++; }
    Utilities.sleep(400);
  }
  SpreadsheetApp.getUi().alert(
    "Website link lookup complete.\n\n" +
    "  Links found : " + found    + "\n" +
    "  Not found   : " + missing  + "\n" +
    "  Skipped     : " + skipped
  );
}
```

---

## 3. DESKTOP CARFAX SCRIPT — carfax-sync.js {#desktop-carfax}

Original local automation (Playwright). Kept as reference — the cloud worker
(Section 4 — carfaxWorker.ts) supersedes this for production use.

```javascript
// ================================================================
// CARFAX AUTOMATION v1.3
// Uses Playwright. Saves login session locally.
// Run once:   node carfax-sync.js
// Watch mode: node carfax-sync.js --watch
// ================================================================

var fs   = require('fs');
var path = require('path');
require('dotenv').config();
var { chromium } = require('playwright');
var fetch        = require('node-fetch');

var SELECTORS = {
  loginEmail:         ['input[type="email"]', 'input[name="email"]', 'input[id*="email"]', 'input[placeholder*="email"]'],
  loginPassword:      ['input[type="password"]', 'input[name="password"]', 'input[id*="password"]'],
  loginButton:        ['button[type="submit"]', 'button:has-text("Sign In")', 'button:has-text("Log In")', 'input[type="submit"]'],
  vinSearchInput:     ['input.searchVehicle', 'input.searchbox.searchVehicle', 'input[placeholder*="VIN"]', 'input[type="search"]'],
  globalArchiveToggle:['label#global-archive', 'input#globalreports'],
  reportLink:         ['a.reportLink', 'a[href*="cfm/display_cfm"]', 'a[href*="vhr"]', 'a[href*="/cfm/"]']
};

var CARFAX_LOGIN_URL = 'https://dealer.carfax.ca/login';
var CARFAX_VHR_URL   = 'https://dealer.carfax.ca/MyReports';
var CARFAX_HOME      = 'https://dealer.carfax.ca/';
var SESSION_DIR      = path.join(__dirname, '.carfax-session');

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function humanDelay(base) { return sleep(base + rand(0, 1000)); }

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
    await page.mouse.move(startX + (targetX - startX) * ease + rand(-3, 3), startY + (targetY - startY) * ease + rand(-3, 3));
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
  if (Math.random() > 0.6) { await page.mouse.wheel(0, -rand(20, 80)); await sleep(rand(200, 400)); }
}

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
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: rowIndex, value: value }) });
}

async function findElement(page, selectors, timeout) {
  timeout = timeout || 5000;
  for (var i = 0; i < selectors.length; i++) {
    try { var el = await page.waitForSelector(selectors[i], { timeout: timeout }); if (el) return el; } catch (e) {}
  }
  return null;
}

async function findReportLink(page) {
  for (var i = 0; i < SELECTORS.reportLink.length; i++) {
    try {
      var el = await page.$(SELECTORS.reportLink[i]);
      if (el) {
        var href = await el.getAttribute('href');
        if (href) { if (href.startsWith('/')) href = 'https://dealer.carfax.ca' + href; return href; }
      }
    } catch (e) {}
  }
  try {
    var links = await page.$$('a[href]');
    for (var j = 0; j < links.length; j++) {
      var h = await links[j].getAttribute('href');
      if (h && (h.indexOf('cfm/display_cfm') !== -1 || h.indexOf('vhr.carfax.ca') !== -1 || h.indexOf('carfax.ca/cfm') !== -1)) {
        if (h.startsWith('/')) h = 'https://dealer.carfax.ca' + h;
        return h;
      }
    }
  } catch (e) {}
  return null;
}

async function isLoggedIn(page) {
  await page.goto(CARFAX_HOME, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await humanDelay(1500);
  var content = (await page.content()).toLowerCase();
  return content.indexOf('sign out') !== -1 || content.indexOf('log out') !== -1 || content.indexOf('my account') !== -1 || content.indexOf('my carfax') !== -1;
}

async function loginToCarfax(page) {
  var email    = process.env.CARFAX_EMAIL;
  var password = process.env.CARFAX_PASSWORD;
  if (!email || !password) {
    console.log('ACTION REQUIRED: Log in manually in the browser window, then press Enter.');
    await new Promise(function(resolve) { process.stdin.once('data', resolve); });
    return;
  }
  await page.goto(CARFAX_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await humanDelay(1500);
  var emailInput = await findElement(page, SELECTORS.loginEmail, 8000);
  if (emailInput) { await humanClick(page, emailInput); await humanType(emailInput, email); }
  var passInput = await findElement(page, SELECTORS.loginPassword, 5000);
  if (passInput) { await humanClick(page, passInput); await humanType(passInput, password); }
  var loginBtn = await findElement(page, SELECTORS.loginButton, 5000);
  if (loginBtn) { await humanClick(page, loginBtn); await humanDelay(3000); await page.waitForLoadState('domcontentloaded'); await humanDelay(2000); }
}

async function processVin(page, vin, screenshotDir) {
  try {
    await page.goto(CARFAX_VHR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay(2000);
    var currentUrl = page.url();
    if (currentUrl.indexOf('login') !== -1) { await loginToCarfax(page); await page.goto(CARFAX_VHR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }); await humanDelay(2000); }
    var searchInput = await findElement(page, SELECTORS.vinSearchInput, 8000);
    if (!searchInput) { await page.screenshot({ path: path.join(screenshotDir, 'no-input-' + vin + '.png') }); return 'ERROR'; }
    await humanClick(page, searchInput);
    await page.keyboard.press('Control+A');
    await sleep(rand(80, 180));
    await page.keyboard.press('Backspace');
    await sleep(rand(100, 250));
    await humanType(searchInput, vin);
    await humanScroll(page);
    var found = false;
    try { await page.waitForSelector('a.reportLink', { timeout: 10000 }); found = true; } catch (e) {}
    if (found) { var reportLink = await findReportLink(page); if (reportLink) return reportLink; }
    var archiveToggle = await findElement(page, SELECTORS.globalArchiveToggle, 3000);
    if (!archiveToggle) { await page.screenshot({ path: path.join(screenshotDir, 'no-archive-toggle-' + vin + '.png') }); return 'NOT_FOUND'; }
    await humanClick(page, archiveToggle);
    var found2 = false;
    try { await page.waitForSelector('a.reportLink', { timeout: 6000 }); found2 = true; } catch (e) {}
    if (found2) { var reportLink2 = await findReportLink(page); if (reportLink2) return reportLink2; }
    return 'NOT_FOUND';
  } catch (err) { await page.screenshot({ path: path.join(screenshotDir, 'error-' + vin + '.png') }).catch(function() {}); return 'ERROR'; }
}

async function launchBrowser() {
  var context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--disable-infobars'],
    ignoreDefaultArgs: ['--enable-automation'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });
  var page = await context.newPage();
  await page.addInitScript(function() { Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; } }); window.chrome = { runtime: {} }; });
  return { context: context, page: page };
}

async function runBatch(page, screenshotDir) {
  var toProcess;
  try { toProcess = await getVinsToProcess(); } catch (err) { console.log('ERROR reading spreadsheet: ' + err.message); return; }
  if (toProcess.length === 0) { console.log('Nothing to process.'); return; }
  var delay   = parseInt(process.env.DELAY_BETWEEN_VINS || '3000', 10);
  var results = { found: 0, notFound: 0, errors: 0 };
  for (var i = 0; i < toProcess.length; i++) {
    var item   = toProcess[i];
    var result = await processVin(page, item.vin, screenshotDir);
    if (result === 'NOT_FOUND') { results.notFound++; await writeCarfaxUrl(item.rowIndex, 'NOT FOUND').catch(function() {}); }
    else if (result === 'ERROR') { results.errors++; }
    else { results.found++; await writeCarfaxUrl(item.rowIndex, result).catch(function() {}); }
    if (i < toProcess.length - 1) await humanDelay(delay);
  }
  console.log('Batch done — Found: ' + results.found + '  Not found: ' + results.notFound + '  Errors: ' + results.errors);
}

async function main() {
  var watchMode    = process.argv.indexOf('--watch') !== -1;
  var intervalMins = parseInt(process.env.WATCH_INTERVAL || '5', 10);
  var screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);
  var browser = await launchBrowser();
  var context  = browser.context;
  var page     = browser.page;
  var loggedIn = await isLoggedIn(page);
  if (!loggedIn) { await loginToCarfax(page); }
  await runBatch(page, screenshotDir);
  if (!watchMode) { await context.close(); return; }
  while (true) { await sleep(intervalMins * 60 * 1000); await runBatch(page, screenshotDir); }
}

main().catch(function(err) { console.log('FATAL ERROR: ' + err.message); process.exit(1); });
```

---

## 4. API SERVER {#api-server}

### artifacts/api-server/src/index.ts

```typescript
import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundRefresh } from "./lib/inventoryCache";
import { scheduleCarfaxWorker } from "./lib/carfaxWorker";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

startBackgroundRefresh();
scheduleCarfaxWorker();

app.listen(port, (err) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }
  logger.info({ port }, "Server listening");
});
```

---

### artifacts/api-server/src/app.ts

```typescript
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import passport from "passport";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { configurePassport } from "./lib/auth.js";

const app: Express = express();
const PgSession = connectPg(session);

app.set("trust proxy", 1);

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: false }),
  secret: process.env["SESSION_SECRET"] ?? "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

configurePassport();
app.use(passport.initialize());
app.use(passport.session());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
  skip: (req) => req.path === "/api/healthz",
});

app.use("/api", apiLimiter);
app.use("/api", router);

export default app;
```

---

### artifacts/api-server/src/lib/logger.ts

```typescript
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
  ...(isProduction ? {} : {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
});
```

---

### artifacts/api-server/src/lib/auth.ts

```typescript
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { logger } from "./logger.js";

const OWNER_EMAIL   = (process.env["OWNER_EMAIL"] ?? "").toLowerCase().trim();
const CLIENT_ID     = process.env["GOOGLE_CLIENT_ID"]     ?? "";
const CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"] ?? "";

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
  passport.use(new GoogleStrategy(
    { clientID: CLIENT_ID, clientSecret: CLIENT_SECRET, callbackURL: getCallbackUrl() },
    (_accessToken, _refreshToken, profile, done) => {
      const email   = profile.emails?.[0]?.value ?? "";
      const name    = profile.displayName ?? "";
      const picture = profile.photos?.[0]?.value ?? "";
      done(null, { email, name, picture });
    }
  ));
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user as Express.User));
}
```

---

### artifacts/api-server/src/lib/inventoryCache.ts

```typescript
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
}

interface CacheState {
  data:         InventoryItem[];
  lastUpdated:  Date | null;
  isRefreshing: boolean;
}

const state: CacheState = { data: [], lastUpdated: null, isRefreshing: false };

export function getCacheState(): CacheState { return state; }

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

const PRICE_COLLECTIONS = [
  {
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
  {
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
];

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
          if (!vin || priceMap.has(vin)) continue;
          const specialOn    = Number(doc.special_price_on) === 1;
          const specialPrice = parseFloat(doc.special_price);
          const regularPrice = parseFloat(doc.price);
          const raw          = specialOn && specialPrice > 0 ? specialPrice : regularPrice;
          if (!isNaN(raw) && raw > 0) priceMap.set(vin, String(Math.round(raw)));
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

export async function refreshCache(): Promise<void> {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  try {
    const dataUrl = process.env["INVENTORY_DATA_URL"]?.trim();
    if (!dataUrl) { logger.warn("INVENTORY_DATA_URL is not set"); return; }
    const response = await fetch(dataUrl, { signal: AbortSignal.timeout(15_000) });
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
    }));
    const needPrice = items.filter((item) => !item.onlinePrice || item.onlinePrice === "NOT FOUND");
    if (needPrice.length > 0) {
      const priceMap = await fetchOnlinePricesFromTypesense();
      for (const item of items) {
        if (!item.onlinePrice || item.onlinePrice === "NOT FOUND") {
          const fetched = priceMap.get(item.vin.toUpperCase());
          if (fetched) item.onlinePrice = fetched;
        }
      }
      logger.info({ enriched: priceMap.size, total: items.length }, "Typesense price enrichment complete");
    }
    state.data        = items;
    state.lastUpdated = new Date();
    logger.info({ count: items.length }, "Inventory cache refreshed");
  } catch (err) {
    logger.error({ err }, "Inventory cache refresh failed — serving stale data");
  } finally {
    state.isRefreshing = false;
  }
}

export function startBackgroundRefresh(intervalMs = 60 * 60 * 1000): void {
  refreshCache().catch((err) => logger.error({ err }, "Initial inventory cache fetch failed"));
  setInterval(() => {
    refreshCache().catch((err) => logger.error({ err }, "Background inventory cache refresh failed"));
  }, intervalMs);
}
```

---

### artifacts/api-server/src/lib/emailService.ts

```typescript
import { Resend } from "resend";
import { logger } from "./logger.js";

const RESEND_API_KEY = process.env["RESEND_API_KEY"]?.trim() ?? "";
const APP_URL = (() => {
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  return domain ? `https://${domain}` : "https://script-reviewer.replit.app";
})();

export async function sendInvitationEmail(toEmail: string, role: string, invitedBy: string): Promise<void> {
  if (!RESEND_API_KEY) { logger.warn("RESEND_API_KEY not set — skipping invitation email"); return; }
  const resend = new Resend(RESEND_API_KEY);
  const roleName = role === "guest" ? "Guest (prices hidden)" : "Viewer";
  try {
    await resend.emails.send({
      from:    "Inventory Portal <onboarding@resend.dev>",
      to:      toEmail,
      subject: "You've been invited to the Inventory Portal",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;">
          <h2 style="margin:0 0 8px;font-size:20px;color:#111;">You have been invited</h2>
          <p style="margin:0 0 20px;font-size:15px;color:#444;">
            <strong>${invitedBy}</strong> has given you <strong>${roleName}</strong> access
            to the Vehicle Inventory Portal.
          </p>
          <a href="${APP_URL}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
            Open Inventory Portal
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#888;">
            Sign in with the Google account associated with <strong>${toEmail}</strong>.
          </p>
        </div>
      `,
    });
    logger.info({ toEmail, role }, "Invitation email sent");
  } catch (err) {
    logger.error({ err, toEmail }, "Failed to send invitation email");
  }
}
```

---

### artifacts/api-server/src/lib/carfaxWorker.ts

The nightly cloud Carfax worker. Runs at 2:15am, restores session cookies,
looks up VINs on dealer.carfax.ca, and writes results back to the sheet.

```typescript
/**
 * Carfax Cloud Worker
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
const SESSION_FILE     = path.join(process.cwd(), ".carfax-session.json");

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

const GLOBAL_ARCHIVE_SELECTORS = ["label#global-archive", "input#globalreports"];
const AUTH0_EMAIL_SELECTORS    = ["#username", 'input[name="username"]', 'input[type="email"]'];
const AUTH0_PASSWORD_SELECTORS = ["#password", 'input[name="password"]', 'input[type="password"]'];

export interface CarfaxTestResult {
  vin:    string;
  status: "found" | "not_found" | "error" | "captcha";
  url?:   string;
  error?: string;
}

interface PendingVin { rowIndex: number; vin: string; }

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function rand(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function humanDelay(base: number): Promise<void> { return sleep(base + rand(0, 1000)); }

// ---------------------------------------------------------------------------
// Apps Script communication (3-attempt retry, 15s timeout)
// ---------------------------------------------------------------------------

async function fetchPendingVins(): Promise<PendingVin[]> {
  if (!APPS_SCRIPT_URL) { logger.warn("APPS_SCRIPT_WEB_APP_URL not configured"); return []; }
  let retries = 3;
  while (retries > 0) {
    try {
      const resp = await fetch(APPS_SCRIPT_URL, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as PendingVin[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      retries--;
      if (retries === 0) { logger.error({ err }, "Carfax worker: failed to fetch pending VINs after 3 attempts"); return []; }
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, value, batchComplete }),
        signal: AbortSignal.timeout(15_000),
      });
      return;
    } catch (err) {
      retries--;
      if (retries === 0) logger.error({ err, rowIndex, value }, "Carfax worker: failed to write result after 3 attempts");
      else await sleep(1_000);
    }
  }
}

async function sendAlert(message: string): Promise<void> {
  if (!APPS_SCRIPT_URL) return;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "notify", message }),
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

function loadSavedCookies(): any[] {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, "utf8");
      const cookies = JSON.parse(raw);
      logger.info({ count: cookies.length, file: SESSION_FILE }, "Carfax worker: loaded saved session cookies");
      return cookies;
    }
  } catch (_) {}
  return [];
}

function saveCookies(cookies: any[]): void {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2), "utf8"); logger.info({ count: cookies.length }, "Carfax worker: session cookies saved to disk"); }
  catch (err) { logger.warn({ err }, "Carfax worker: could not save session cookies"); }
}

// ---------------------------------------------------------------------------
// Browser — puppeteer-extra + stealth plugin with plain-puppeteer fallback
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
    try { puppeteer = (await import("puppeteer")).default; }
    catch (__) { throw new Error("puppeteer not installed"); }
  }

  let executablePath: string | undefined;
  try {
    const { execSync } = await import("child_process");
    const found = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) { executablePath = found; logger.info({ executablePath }, "Carfax worker: using system Chromium"); }
  } catch (_) {}

  return puppeteer.launch({
    headless: "new" as any,
    executablePath,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-gpu", "--no-zygote",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run", "--no-default-browser-check",
      "--disable-infobars", "--disable-extensions-except=",
      "--disable-plugins-discovery", "--window-size=1280,900",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

// ---------------------------------------------------------------------------
// Anti-detection — injected before every page load
// ---------------------------------------------------------------------------

async function addAntiDetectionScripts(page: any): Promise<void> {
  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8,fr;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1", "Sec-Fetch-Dest": "document",
    "Sec-Ch-Ua": '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0", "Sec-Ch-Ua-Platform": '"Windows"',
    "Upgrade-Insecure-Requests": "1", "Cache-Control": "max-age=0",
  });
  await page.setCacheEnabled(true);
  await page.evaluateOnNewDocument(() => {
    // 1. webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // 2. window.chrome
    (window as any).chrome = {
      runtime: { connect: () => {}, sendMessage: () => {}, onMessage: { addListener: () => {}, removeListener: () => {} } },
      loadTimes: () => {}, csi: () => {}, app: {},
    };
    // 3. userAgentData (Chrome 90+ API)
    Object.defineProperty(navigator, "userAgentData", {
      get: () => ({
        brands: [{ brand: "Google Chrome", version: "124" }, { brand: "Chromium", version: "124" }, { brand: "Not-A.Brand", version: "99" }],
        mobile: false, platform: "Windows",
        getHighEntropyValues: async (_hints: string[]) => ({
          brands: [{ brand: "Google Chrome", version: "124" }],
          mobile: false, platform: "Windows", platformVersion: "10.0.0",
          architecture: "x86", bitness: "64", model: "", uaFullVersion: "124.0.6367.60",
          fullVersionList: [{ brand: "Google Chrome", version: "124.0.6367.60" }, { brand: "Not-A.Brand", version: "99.0.0.0" }],
        }),
      }),
    });
    // 4. plugins
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client",     filename: "internal-nacl-plugin", description: "" },
        ];
        return Object.assign(plugins, { item: (i: number) => plugins[i], namedItem: (n: string) => plugins.find(p => p.name === n) || null, refresh: () => {}, length: plugins.length });
      },
    });
    // 5. mimeTypes
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => {
        const types = [{ type: "application/pdf", description: "Portable Document Format", suffixes: "pdf" }];
        return Object.assign(types, { item: (i: number) => types[i], namedItem: (n: string) => types.find(t => t.type === n) || null, length: types.length });
      },
    });
    // 6. languages / language
    Object.defineProperty(navigator, "languages", { get: () => ["en-CA", "en-US", "en", "fr-CA"] });
    Object.defineProperty(navigator, "language",  { get: () => "en-CA" });
    // 7. hardware profile
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory",        { get: () => 8 });
    // 8. connection (4G)
    Object.defineProperty(navigator, "connection", {
      get: () => ({ effectiveType: "4g", rtt: 50 + Math.floor(Math.random() * 50), downlink: 5 + Math.random() * 5, saveData: false, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }),
    });
    // 9. screen dimensions
    Object.defineProperty(screen, "width",       { get: () => 1280 }); Object.defineProperty(screen, "height",      { get: () => 900  });
    Object.defineProperty(screen, "availWidth",  { get: () => 1280 }); Object.defineProperty(screen, "availHeight", { get: () => 860  });
    Object.defineProperty(screen, "colorDepth",  { get: () => 24   }); Object.defineProperty(screen, "pixelDepth",  { get: () => 24   });
    Object.defineProperty(window, "outerWidth",  { get: () => 1280 }); Object.defineProperty(window, "outerHeight", { get: () => 900  });
    // 10. Canvas fingerprint noise
    const _origToDataURL    = HTMLCanvasElement.prototype.toDataURL;
    const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const noise = () => Math.floor(Math.random() * 3) - 1;
    HTMLCanvasElement.prototype.toDataURL = function(...args: any[]) {
      const ctx = this.getContext("2d");
      if (ctx) { const img = ctx.getImageData(0, 0, this.width, this.height); for (let i = 0; i < img.data.length; i += 4) { img.data[i] += noise(); img.data[i+1] += noise(); img.data[i+2] += noise(); } ctx.putImageData(img, 0, 0); }
      return _origToDataURL.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.getImageData = function(...args: any[]) {
      const img = _origGetImageData.apply(this, args);
      for (let i = 0; i < img.data.length; i += 4) { img.data[i] += noise(); img.data[i+1] += noise(); img.data[i+2] += noise(); }
      return img;
    };
    // 11. Permissions API
    const _origQuery = window.navigator.permissions?.query.bind(navigator.permissions);
    if (_origQuery) {
      (navigator.permissions as any).query = (parameters: any) =>
        parameters.name === "notifications" ? Promise.resolve({ state: "denied" } as PermissionStatus) : _origQuery(parameters);
    }
  });
}

// ---------------------------------------------------------------------------
// Human-like interaction helpers
// ---------------------------------------------------------------------------

async function findSelector(page: any, selectors: string[], timeout = 5000): Promise<any> {
  for (const sel of selectors) {
    try { const el = await page.waitForSelector(sel, { timeout }); if (el) return el; } catch (_) {}
  }
  return null;
}

async function humanClick(page: any, element: any): Promise<void> {
  const box = await element.boundingBox();
  if (!box) { await element.click(); return; }
  const tx = box.x + rand(Math.floor(box.width * 0.2),  Math.floor(box.width * 0.8));
  const ty = box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8));
  const sx = rand(100, 900); const sy = rand(100, 600);
  const steps = rand(12, 22);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await page.mouse.move(sx + (tx - sx) * ease + rand(-3, 3), sy + (ty - sy) * ease + rand(-3, 3));
    await sleep(rand(8, 22));
  }
  await sleep(rand(60, 180));
  await page.mouse.click(tx, ty);
}

async function humanType(page: any, element: any, text: string): Promise<void> {
  await element.click(); await sleep(rand(80, 200));
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
  return content.includes("sign out") || content.includes("log out") || content.includes("my account") || content.includes("my vhrs");
}

async function loginWithAuth0(page: any): Promise<boolean> {
  logger.info("Carfax worker: navigating to Auth0 login page");
  await page.goto(CARFAX_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await humanDelay(1500);
  const emailInput = await findSelector(page, AUTH0_EMAIL_SELECTORS, 10_000);
  if (!emailInput) { logger.error("Carfax worker: could not find email input"); return false; }
  await humanClick(page, emailInput);
  await humanType(page, emailInput, CARFAX_EMAIL);
  const passInput = await findSelector(page, AUTH0_PASSWORD_SELECTORS, 5_000);
  if (!passInput) { logger.error("Carfax worker: could not find password input"); return false; }
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
  if (confirmed) { const cookies = await page.cookies(); saveCookies(cookies); logger.info("Carfax worker: login successful — session saved"); }
  else { logger.error("Carfax worker: login failed"); }
  return confirmed;
}

async function ensureLoggedIn(browser: any, page: any): Promise<boolean> {
  const savedCookies = loadSavedCookies();
  if (savedCookies.length > 0) {
    logger.info("Carfax worker: restoring saved session cookies");
    await page.setCookie(...savedCookies);
    const loggedIn = await isLoggedIn(page);
    if (loggedIn) { logger.info("Carfax worker: session restored — already logged in"); return true; }
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
  return !(!h || h === "#" || h.startsWith("javascript:") || h === "about:blank");
}

async function getRawHref(el: any): Promise<string | null> {
  try { return await el.evaluate((a: Element) => a.getAttribute("href")); } catch (_) { return null; }
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
    } catch (_) {}
  }
  try {
    const links = await page.$$("a[href]");
    for (const link of links) {
      const href = await getRawHref(link);
      if (!isValidReportHref(href)) continue;
      const h = href!;
      if (h.includes("cfm/display_cfm") || h.includes("vhr.carfax.ca") || h.includes("carfax.ca/cfm")) {
        return h.startsWith("/") ? "https://dealer.carfax.ca" + h : h;
      }
    }
  } catch (_) {}
  return null;
}

async function lookupVinOnDealerPortal(page: any, vin: string): Promise<{ status: "found" | "not_found" | "session_expired" | "error"; url?: string }> {
  try {
    logger.info({ vin }, "Carfax worker: navigating to dealer VHR page");
    await page.goto(CARFAX_VHR_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await humanDelay(2000);
    const currentUrl: string = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("signin")) { logger.warn({ vin }, "Carfax worker: session expired mid-batch"); return { status: "session_expired" }; }
    const searchInput = await findSelector(page, VIN_SEARCH_SELECTORS, 8_000);
    if (!searchInput) { logger.error({ vin }, "Carfax worker: could not find VIN search input"); return { status: "error" }; }
    await searchInput.click({ clickCount: 3 });
    await sleep(rand(80, 180));
    await humanType(page, searchInput, vin);
    // Human scroll after typing — gives AJAX time to fire
    await page.evaluate(() => window.scrollBy(0, rand(80, 250)));
    await sleep(rand(300, 700));
    let reportUrl: string | null = null;
    try {
      await page.waitForSelector("a.reportLink", { visible: true, timeout: 8_000 });
      reportUrl = await findReportLink(page);
      if (reportUrl) { logger.info({ vin, url: reportUrl }, "Carfax worker: found in My VHRs ✓"); return { status: "found", url: reportUrl }; }
    } catch (_) {}
    // Try Global Archive
    logger.info({ vin }, "Carfax worker: not in My VHRs — trying Global Archive");
    const archiveToggle = await findSelector(page, GLOBAL_ARCHIVE_SELECTORS, 3_000);
    if (archiveToggle) {
      await humanClick(page, archiveToggle);
      await humanDelay(1500);
      try {
        await page.waitForSelector("a.reportLink", { visible: true, timeout: 6_000 });
        reportUrl = await findReportLink(page);
        if (reportUrl) { logger.info({ vin, url: reportUrl }, "Carfax worker: found in Global Archive ✓"); return { status: "found", url: reportUrl }; }
      } catch (_) {}
    }
    logger.info({ vin }, "Carfax worker: VIN not found in either archive");
    return { status: "not_found" };
  } catch (err: any) {
    logger.error({ vin, err: err.message }, "Carfax worker: lookup error");
    return { status: "error" };
  }
}

// ---------------------------------------------------------------------------
// Public API — single VIN or full nightly batch
// ---------------------------------------------------------------------------

export async function runCarfaxWorkerForVins(vins: string[]): Promise<CarfaxTestResult[]> {
  const results: CarfaxTestResult[] = [];
  let browser: any;
  let page: any;
  try {
    logger.info({ vins }, "Carfax test run: starting");
    browser = await launchBrowser();
    page    = await browser.newPage();
    await addAntiDetectionScripts(page);
    await ensureLoggedIn(browser, page);
    for (const vin of vins) {
      logger.info({ vin }, "Carfax test run: looking up VIN");
      const r = await lookupVinOnDealerPortal(page, vin);
      if (r.status === "found")      results.push({ vin, status: "found",     url: r.url });
      else if (r.status === "not_found") results.push({ vin, status: "not_found" });
      else                               results.push({ vin, status: "error",    error: "Lookup failed" });
      if (vins.indexOf(vin) < vins.length - 1) await humanDelay(rand(4_000, 9_000));
    }
    logger.info({ results }, "Carfax test run: complete");
  } catch (err: any) {
    logger.error({ err }, "Carfax test run: fatal error");
  } finally {
    await browser?.close();
  }
  return results;
}

async function runCarfaxWorker(): Promise<void> {
  if (!CARFAX_ENABLED) { logger.info("Carfax worker: CARFAX_ENABLED is not true — skipping nightly run"); return; }
  const pending = await fetchPendingVins();
  if (pending.length === 0) { logger.info("Carfax worker: no pending VINs"); return; }
  logger.info({ count: pending.length }, "Carfax worker: starting nightly batch");
  let browser: any; let page: any;
  let processed = 0; let failed = 0;
  try {
    browser = await launchBrowser();
    page    = await browser.newPage();
    await addAntiDetectionScripts(page);
    const loggedIn = await ensureLoggedIn(browser, page);
    if (!loggedIn) { await sendAlert("Carfax worker: login failed — batch aborted"); return; }
    for (const item of pending) {
      const r = await lookupVinOnDealerPortal(page, item.vin);
      if (r.status === "session_expired") {
        const relogged = await loginWithAuth0(page);
        if (!relogged) { logger.error("Carfax worker: could not re-login after session expiry"); break; }
        const r2 = await lookupVinOnDealerPortal(page, item.vin);
        if (r2.status === "found" && r2.url) await writeCarfaxResult(item.rowIndex, r2.url);
        else { await writeCarfaxResult(item.rowIndex, "NOT FOUND"); failed++; }
      } else if (r.status === "found" && r.url) {
        await writeCarfaxResult(item.rowIndex, r.url);
      } else {
        await writeCarfaxResult(item.rowIndex, "NOT FOUND");
        if (r.status === "error") failed++;
      }
      processed++;
      await humanDelay(rand(4_000, 9_000));
    }
    if (processed > 0) await writeCarfaxResult(0, "", true);
  } catch (err: any) {
    logger.error({ err }, "Carfax worker: fatal error during batch");
    await sendAlert(`Carfax worker batch failed: ${err?.message ?? String(err)}`);
  } finally {
    await browser?.close();
    logger.info({ processed, failed }, "Carfax worker: nightly batch complete");
  }
}

export function scheduleCarfaxWorker(): void {
  const SCHEDULE_HOUR   = 2;
  const SCHEDULE_MINUTE = 15;
  const now         = new Date();
  const windowStart = new Date(now); windowStart.setHours(SCHEDULE_HOUR,     SCHEDULE_MINUTE,      0, 0);
  const windowEnd   = new Date(now); windowEnd.setHours  (SCHEDULE_HOUR + 1, SCHEDULE_MINUTE + 30, 0, 0);
  if (now >= windowStart && now <= windowEnd) {
    logger.info("Carfax worker: inside scheduled window on startup — running now (catch-up)");
    runCarfaxWorker().catch((err) => logger.error({ err }, "Carfax worker: catch-up run failed"));
  }
  function scheduleNext() {
    const n = new Date(); const next = new Date(n);
    next.setHours(SCHEDULE_HOUR, SCHEDULE_MINUTE, 0, 0);
    if (next <= n) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - n.getTime();
    logger.info({ nextRun: next.toISOString(), minutesFromNow: Math.round(ms / 60_000) }, "Carfax worker: nightly run scheduled");
    setTimeout(async () => {
      await runCarfaxWorker().catch((err) => logger.error({ err }, "Carfax worker: scheduled run error"));
      scheduleNext();
    }, ms);
  }
  scheduleNext();
}
```

---

### artifacts/api-server/src/routes/index.ts

```typescript
import { Router, type IRouter } from "express";
import healthRouter    from "./health.js";
import authRouter      from "./auth.js";
import inventoryRouter from "./inventory.js";
import accessRouter    from "./access.js";
import carfaxRouter    from "./carfax.js";

const router: IRouter = Router();
router.use(healthRouter);
router.use(authRouter);
router.use(inventoryRouter);
router.use(accessRouter);
router.use(carfaxRouter);
export default router;
```

---

### artifacts/api-server/src/routes/health.ts

```typescript
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});
export default router;
```

---

### artifacts/api-server/src/routes/auth.ts

```typescript
import { Router } from "express";
import passport from "passport";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";

const router = Router();

router.get("/auth/debug-callback", (_req, res) => {
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  const callbackURL = domain ? `https://${domain}/api/auth/google/callback` : "http://localhost:8080/api/auth/google/callback";
  res.json({ callbackURL, REPLIT_DOMAINS: process.env["REPLIT_DOMAINS"] ?? "(not set)" });
});

router.get("/auth/google", passport.authenticate("google", { scope: ["email", "profile"] }));

router.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/?auth_error=1" }),
  (_req, res) => { res.redirect("/"); }
);

router.get("/auth/logout", (req, res, next) => {
  req.logout((err) => { if (err) return next(err); res.redirect("/"); });
});

router.get("/me", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) { res.status(401).json({ error: "Not authenticated" }); return; }
  const user  = req.user as { email: string; name: string; picture: string };
  const email = user.email.toLowerCase();
  const owner = isOwner(email);
  let role = "viewer";
  if (owner) {
    role = "owner";
  } else {
    const [entry] = await db.select().from(accessListTable).where(eq(accessListTable.email, email)).limit(1);
    if (entry) role = entry.role;
    else { res.status(403).json({ error: "Access denied" }); return; }
  }
  res.json({ email: user.email, name: user.name, picture: user.picture, isOwner: owner, role });
});

export default router;
```

---

### artifacts/api-server/src/routes/inventory.ts

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
  { name: "Matrix",   collection: "cebacbca97920d818d57c6f0526d7413", apiKey: "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9" },
  { name: "Parkdale", collection: "37042ac7ece3a217b1a41d6f54ba6855", apiKey: "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9" },
];

async function getUserRole(req: any): Promise<string> {
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) return "owner";
  const [entry] = await db.select().from(accessListTable).where(eq(accessListTable.email, email)).limit(1);
  return entry?.role ?? "viewer";
}

async function requireAccess(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) { res.status(401).json({ error: "Not authenticated" }); return; }
  const user  = req.user as { email: string };
  const email = user.email.toLowerCase();
  if (isOwner(email)) { next(); return; }
  const [entry] = await db.select().from(accessListTable).where(eq(accessListTable.email, email)).limit(1);
  if (entry) { next(); return; }
  res.status(403).json({ error: "Access denied" });
}

router.get("/inventory", requireAccess, async (req, res) => {
  const role = await getUserRole(req);
  const { data } = getCacheState();
  const items = role === "guest" ? data.map((item) => ({ ...item, price: "" })) : data;
  res.set("Cache-Control", "no-store");
  res.json(items);
});

router.get("/cache-status", requireAccess, (_req, res) => {
  const { lastUpdated, isRefreshing, data } = getCacheState();
  res.set("Cache-Control", "no-store");
  res.json({ lastUpdated: lastUpdated?.toISOString() ?? null, isRefreshing, count: data.length });
});

router.post("/refresh", (req, res) => {
  const secret   = req.headers["x-refresh-secret"];
  const expected = process.env["REFRESH_SECRET"]?.trim();
  if (!expected || secret !== expected) { logger.warn({ ip: (req as any).ip }, "Unauthorized /refresh attempt"); res.status(401).json({ error: "Unauthorized" }); return; }
  refreshCache().catch((err) => logger.error({ err }, "Webhook-triggered refresh failed"));
  res.json({ ok: true, message: "Cache refresh triggered" });
});

router.get("/vehicle-images", requireAccess, async (req, res) => {
  const vin = (req.query["vin"] as string ?? "").trim().toUpperCase();
  if (!vin || vin.length < 10) { res.json({ vin, urls: [] }); return; }
  const urls: string[] = [];
  for (const dealer of DEALER_COLLECTIONS) {
    try {
      const endpoint =
        `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search` +
        `?q=${encodeURIComponent(vin)}&query_by=vin&num_typos=0&per_page=1&x-typesense-api-key=${dealer.apiKey}`;
      const resp = await fetch(endpoint);
      if (!resp.ok) continue;
      const body: any = await resp.json();
      if (!body.hits?.length) continue;
      const doc    = body.hits[0].document;
      const docVin = (doc.vin ?? "").toString().trim().toUpperCase();
      if (docVin !== vin) continue;
      const rawUrls: string = doc.image_urls ?? "";
      if (!rawUrls) continue;
      rawUrls.split(";").forEach((path: string) => { const trimmed = path.trim(); if (trimmed) urls.push(IMAGE_CDN_BASE + trimmed); });
      break;
    } catch (_err) {}
  }
  res.set("Cache-Control", "public, max-age=300");
  res.json({ vin, urls });
});

export default router;
```

---

### artifacts/api-server/src/routes/access.ts

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable, auditLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { sendInvitationEmail } from "../lib/emailService.js";

const router = Router();

function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) { res.status(401).json({ error: "Not authenticated" }); return; }
  const user = req.user as { email: string };
  if (!isOwner(user.email)) { res.status(403).json({ error: "Owner only" }); return; }
  next();
}

async function writeAudit(action: string, targetEmail: string, changedBy: string, roleFrom?: string | null, roleTo?: string | null) {
  try { await db.insert(auditLogTable).values({ action, targetEmail, changedBy, roleFrom: roleFrom ?? null, roleTo: roleTo ?? null }); } catch (_err) {}
}

router.get("/access", requireOwner, async (_req, res) => {
  const list = await db.select().from(accessListTable).orderBy(accessListTable.addedAt);
  res.json(list);
});

router.post("/access", requireOwner, async (req, res) => {
  const rawEmail = (req.body?.email ?? "").toString().trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes("@")) { res.status(400).json({ error: "Invalid email" }); return; }
  const role  = ["viewer", "guest"].includes(req.body?.role) ? req.body.role : "viewer";
  const owner = (req.user as { email: string }).email;
  const [entry] = await db.insert(accessListTable).values({ email: rawEmail, addedBy: owner, role }).onConflictDoNothing().returning();
  await writeAudit("add", rawEmail, owner, null, role);
  if (entry) sendInvitationEmail(rawEmail, role, owner).catch(() => {});
  res.json(entry ?? { email: rawEmail, addedBy: owner, addedAt: new Date().toISOString(), role });
});

router.patch("/access/:email", requireOwner, async (req, res) => {
  const email   = decodeURIComponent(req.params.email ?? "").toLowerCase();
  const newRole = (req.body?.role ?? "").toString().trim().toLowerCase();
  if (!["viewer", "guest"].includes(newRole)) { res.status(400).json({ error: "Role must be 'viewer' or 'guest'" }); return; }
  const [existing] = await db.select().from(accessListTable).where(eq(accessListTable.email, email)).limit(1);
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }
  const [updated] = await db.update(accessListTable).set({ role: newRole }).where(eq(accessListTable.email, email)).returning();
  const owner = (req.user as { email: string }).email;
  await writeAudit("role_change", email, owner, existing.role, newRole);
  res.json(updated);
});

router.delete("/access/:email", requireOwner, async (req, res) => {
  const email = decodeURIComponent(req.params.email ?? "").toLowerCase();
  const owner = (req.user as { email: string }).email;
  const [existing] = await db.select().from(accessListTable).where(eq(accessListTable.email, email)).limit(1);
  await db.delete(accessListTable).where(eq(accessListTable.email, email));
  await writeAudit("remove", email, owner, existing?.role ?? null, null);
  res.json({ ok: true });
});

router.get("/audit-log", requireOwner, async (_req, res) => {
  const entries = await db.select().from(auditLogTable).orderBy(desc(auditLogTable.timestamp)).limit(200);
  res.json(entries);
});

export default router;
```

---

### artifacts/api-server/src/routes/carfax.ts

```typescript
import { Router } from "express";
import { isOwner } from "../lib/auth.js";
import { runCarfaxWorkerForVins } from "../lib/carfaxWorker.js";
import { logger } from "../lib/logger.js";

const router = Router();

function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) { res.status(401).json({ error: "Not authenticated" }); return; }
  const user = req.user as { email: string };
  if (!isOwner(user.email)) { res.status(403).json({ error: "Owner only" }); return; }
  next();
}

router.post("/carfax/test", requireOwner, async (req: any, res: any) => {
  const { vins } = req.body as { vins?: string[] };
  if (!Array.isArray(vins) || vins.length === 0) { res.status(400).json({ error: "Provide an array of VINs: { vins: [...] }" }); return; }
  if (vins.length > 10) { res.status(400).json({ error: "Maximum 10 VINs per test run" }); return; }
  const cleanVins = vins.map((v) => String(v).trim().toUpperCase()).filter(Boolean);
  logger.info({ vins: cleanVins, requestedBy: (req.user as any)?.email }, "Carfax test run requested via API");
  try {
    const results = await runCarfaxWorkerForVins(cleanVins);
    res.json({ ok: true, results });
  } catch (err: any) {
    logger.error({ err }, "Carfax test endpoint error");
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
```

---

### artifacts/api-server/src/routes/price-lookup.ts

```typescript
import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();
const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

const DEALERS: Record<string, { collection: string; apiKey: string }> = {
  "matrixmotorsyeg.ca": { collection: "cebacbca97920d818d57c6f0526d7413", apiKey: "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9" },
  "parkdalemotors.ca":  { collection: "37042ac7ece3a217b1a41d6f54ba6855", apiKey: "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9" },
};

function formatPrice(n: number): string { return "$" + Math.round(n).toLocaleString("en-US"); }

router.get("/price-lookup", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.set("Cache-Control", "no-store");
  const url = (req.query.url as string ?? "").trim();
  if (!url || !url.startsWith("http")) { res.status(400).json({ error: "Invalid URL" }); return; }
  try {
    const parsed   = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const dealer   = DEALERS[hostname];
    if (!dealer) { res.json({ price: null }); return; }
    const idMatch = parsed.pathname.match(/\/(\d+)\/?$/);
    if (!idMatch) { res.json({ price: null }); return; }
    const docId = idMatch[1];
    const params = new URLSearchParams({ q: "*", filter_by: `id:=[${docId}]`, per_page: "1", "x-typesense-api-key": dealer.apiKey });
    const tsRes  = await fetch(`https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search?${params}`, { signal: AbortSignal.timeout(5000) });
    if (!tsRes.ok) { res.json({ price: null }); return; }
    const body = await tsRes.json() as { hits?: Array<{ document: Record<string, unknown> }> };
    if (!body.hits || body.hits.length === 0) { res.json({ price: null }); return; }
    const doc = body.hits[0].document;
    const specialOn    = Number(doc.special_price_on) === 1;
    const specialPrice = Number(doc.special_price);
    const regularPrice = Number(doc.price);
    const rawPrice     = specialOn && specialPrice > 0 ? specialPrice : regularPrice;
    if (!rawPrice || rawPrice <= 0) { res.json({ price: null }); return; }
    res.json({ price: formatPrice(rawPrice) });
  } catch (err) { logger.warn({ err, url }, "price-lookup error"); res.json({ price: null }); }
});

export default router;
```

---

### artifacts/api-server/src/scripts/testCarfax.ts

```typescript
/**
 * Quick Carfax test:
 *   npx tsx src/scripts/testCarfax.ts 2C4RC1ZG7RR152266 5YFB4MDE3PP000858
 */
import { runCarfaxWorkerForVins } from "../lib/carfaxWorker.js";

const vins = process.argv.slice(2);
if (vins.length === 0) { console.error("Usage: npx tsx src/scripts/testCarfax.ts <VIN1> <VIN2> ..."); process.exit(1); }

console.log(`\nRunning Carfax test on ${vins.length} VIN(s): ${vins.join(", ")}\n`);

runCarfaxWorkerForVins(vins).then((results) => {
  console.log("\n========== RESULTS ==========");
  for (const r of results) {
    if (r.status === "found")     { console.log(`✓ ${r.vin} — FOUND`); console.log(`  URL: ${r.url}`); }
    else if (r.status === "not_found") console.log(`✗ ${r.vin} — NOT FOUND`);
    else                               console.log(`✗ ${r.vin} — ERROR: ${r.error}`);
  }
  console.log("=============================\n");
  process.exit(0);
}).catch((err) => { console.error("Fatal error:", err); process.exit(1); });
```

---

### artifacts/api-server/build.mjs

```javascript
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);
const artifactDir  = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });
  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node", bundle: true, format: "esm",
    outdir: distDir, outExtension: { ".js": ".mjs" }, logLevel: "info",
    external: [
      "*.node", "connect-pg-simple", "sharp", "better-sqlite3", "sqlite3", "canvas",
      "bcrypt", "argon2", "fsevents", "re2", "farmhash", "xxhash-addon", "bufferutil",
      "utf-8-validate", "ssh2", "cpu-features", "dtrace-provider", "isolated-vm",
      "lightningcss", "pg-native", "oracledb", "mongodb-client-encryption", "nodemailer",
      "handlebars", "knex", "typeorm", "protobufjs", "onnxruntime-node",
      "@tensorflow/*", "@prisma/client", "@mikro-orm/*", "@grpc/*", "@swc/*",
      "@aws-sdk/*", "@azure/*", "@opentelemetry/*", "@google-cloud/*", "@google/*",
      "googleapis", "firebase-admin", "@parcel/watcher", "@sentry/profiling-node",
      "@tree-sitter/*", "aws-sdk", "classic-level", "dd-trace", "ffi-napi", "grpc",
      "hiredis", "kerberos", "leveldown", "miniflare", "mysql2", "newrelic", "odbc",
      "piscina", "realm", "ref-napi", "rocksdb", "sass-embedded", "sequelize",
      "serialport", "snappy", "tinypool", "usb", "workerd", "wrangler", "zeromq",
      "zeromq-prebuilt", "playwright", "puppeteer", "puppeteer-core",
      "puppeteer-extra", "puppeteer-extra-plugin-stealth", "electron",
    ],
    sourcemap: "linked",
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

buildAll().catch((err) => { console.error(err); process.exit(1); });
```

---

### artifacts/api-server/package.json

```json
{
  "name": "@workspace/api-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":       "export NODE_ENV=development && pnpm run build && pnpm run start",
    "build":     "node ./build.mjs",
    "start":     "node --enable-source-maps ./dist/index.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@workspace/api-zod":              "workspace:*",
    "@workspace/db":                   "workspace:*",
    "connect-pg-simple":               "^10.0.0",
    "cookie-parser":                   "^1.4.7",
    "cors":                            "^2",
    "drizzle-orm":                     "catalog:",
    "express":                         "^5",
    "express-rate-limit":              "^8.3.2",
    "express-session":                 "^1.19.0",
    "passport":                        "^0.7.0",
    "passport-google-oauth20":         "^2.0.0",
    "pino":                            "^9",
    "pino-http":                       "^10",
    "puppeteer":                       "^24.40.0",
    "puppeteer-extra":                 "^3.3.6",
    "puppeteer-extra-plugin-stealth":  "^2.11.2",
    "resend":                          "^6.10.0"
  },
  "devDependencies": {
    "@types/connect-pg-simple":        "^7.0.3",
    "@types/cookie-parser":            "^1.4.10",
    "@types/cors":                     "^2.8.19",
    "@types/express":                  "^5.0.6",
    "@types/express-session":          "^1.18.2",
    "@types/node":                     "catalog:",
    "@types/passport":                 "^1.0.17",
    "@types/passport-google-oauth20":  "^2.0.17",
    "esbuild":                         "^0.27.3",
    "esbuild-plugin-pino":             "^2.3.3",
    "pino-pretty":                     "^13",
    "thread-stream":                   "3.1.0"
  }
}
```

---

## 5. INVENTORY PORTAL — React/Vite Frontend {#portal}

### artifacts/inventory-portal/src/main.tsx

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
```

---

### artifacts/inventory-portal/src/App.tsx

```tsx
import React from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { FullScreenSpinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import AccessDenied from "@/pages/denied";
import Inventory from "@/pages/inventory";
import Admin from "@/pages/admin";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { isLoading, error } = useGetMe({ query: { retry: false } });
  React.useEffect(() => {
    if (!error) return;
    const status = (error as any)?.response?.status;
    if (status === 401) setLocation("/login");
    else if (status === 403) setLocation("/denied");
  }, [error, setLocation]);
  if (isLoading) return <FullScreenSpinner />;
  if (error)     return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login"  component={Login} />
      <Route path="/denied" component={AccessDenied} />
      <Route path="/">
        <RequireAuth><Layout><Inventory /></Layout></RequireAuth>
      </Route>
      <Route path="/admin">
        <RequireAuth><Layout><Admin /></Layout></RequireAuth>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
```

---

### artifacts/inventory-portal/src/components/layout.tsx

```tsx
import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Car, LogOut, Settings } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user } = useGetMe({ query: { retry: false } });
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-40 w-full bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <Car className="w-4 h-4 text-white" />
              </div>
              <Link href="/" className="font-semibold text-gray-900 hover:text-blue-600 transition-colors text-base">
                Inventory Portal
              </Link>
            </div>
            {user && (
              <div className="flex items-center gap-3">
                {user.isOwner && (
                  <Link href="/admin" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
                    <Settings className="w-4 h-4" /><span className="hidden sm:inline">Manage Access</span>
                  </Link>
                )}
                <div className="h-5 w-px bg-gray-200 hidden sm:block" />
                <div className="flex items-center gap-2.5">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-sm font-medium text-gray-800 leading-none">{user.name}</span>
                    <span className="text-xs text-gray-400 mt-0.5">{user.email}</span>
                  </div>
                  {user.picture
                    ? <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                    : <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center"><span className="text-xs font-bold text-gray-600">{user.name.charAt(0).toUpperCase()}</span></div>}
                  <a href="/api/auth/logout" title="Sign Out" className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <LogOut className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}
```

---

### artifacts/inventory-portal/src/pages/login.tsx

```tsx
import { Car, Lock } from "lucide-react";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-5">
          <Car className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Inventory Portal</h1>
        <p className="text-sm text-gray-500 mb-7">Access is restricted to authorized personnel. Sign in with your Google account to continue.</p>
        <a href="/api/auth/google"
          className="w-full inline-flex items-center justify-center gap-3 px-5 py-2.5 border border-gray-200 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </a>
        <p className="mt-6 flex items-center gap-1.5 text-xs text-gray-400"><Lock className="w-3 h-3" />Secure authentication via Google</p>
      </div>
    </div>
  );
}
```

---

### artifacts/inventory-portal/src/pages/denied.tsx

```tsx
import { ShieldAlert } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";

export default function AccessDenied() {
  const { data: user } = useGetMe({ query: { retry: false } });
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-5">
          <ShieldAlert className="w-6 h-6 text-red-500" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-sm text-gray-500 mb-5">You don't have permission to view this portal. Contact the owner to request access.</p>
        {user && (
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 text-left">
            <p className="text-xs text-gray-400 mb-0.5">Signed in as</p>
            <p className="text-sm font-medium text-gray-800">{user.email}</p>
          </div>
        )}
        <a href="/api/auth/logout" className="w-full inline-flex items-center justify-center px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">
          Sign out and try another account
        </a>
      </div>
    </div>
  );
}
```

---

### artifacts/inventory-portal/src/pages/inventory.tsx

Full inventory page — search, sort, filters, mobile cards, desktop table,
photo gallery modal, Carfax link, website link, online price, copy-VIN.

(See full source in the repository at artifacts/inventory-portal/src/pages/inventory.tsx — 537 lines)

The key logical sections:
- `parseNum / extractYear / formatPrice / timeAgo` — formatting utilities
- `CopyVin` — click-to-copy VIN with checkmark feedback
- `PhotoGallery` — full-screen lightbox with keyboard nav (arrow keys + Esc)
- `PhotoThumb` — camera icon that opens the gallery
- `VehicleCard` — mobile card layout
- `RangeInputs` — reusable min/max filter pair
- `FilterChip` — removable active filter badge
- `Inventory` (default export) — main page:
  - Deduplicates VINs (keeps lowest price when same VIN appears twice)
  - Filters: text search, year range, max KM, price range (hidden for guests)
  - Sorts: any column, asc/desc
  - Auto-refreshes when cache-status detects a new update (polls every 60s)
  - Renders mobile cards on viewports < 768px, desktop table otherwise

---

### artifacts/inventory-portal/src/pages/admin.tsx

Access management page — owner only.

Key sections:
- `RoleSelector` — dropdown to switch a user between Viewer and Guest
- `Admin` (default export):
  - Tab 1 (Users): lists all approved users, add/remove/change-role
  - Tab 2 (Audit Log): timestamped record of every add/remove/role-change
  - Role legend explaining Viewer vs Guest permissions
  - Invitation email sent automatically on user add (via emailService)

---

## 6. REUSABLE AUTOMATION TEMPLATE {#template}

### templates/dealerPortalWorker.template.ts

Generic template for adapting this automation approach to any dealer portal
(e.g. Cherry Black Book). Fill in the three functions marked IMPLEMENT and
the constants at the top. Everything else is portal-agnostic and reusable.

(See full source at templates/dealerPortalWorker.template.ts)

What to fill in:
| Item | What it is |
|---|---|
| `PORTAL_LOGIN_URL` | Login page URL |
| `PORTAL_HOME_URL` | Authenticated home page URL |
| `PORTAL_SEARCH_URL` | Search page URL |
| `SESSION_FILE` | Path to save session cookies |
| `isLoggedIn(page)` | Return true if already authenticated |
| `loginFresh(page)` | Enter credentials, submit, save cookies |
| `lookupId(page, id)` | Search for one ID, return the extracted value |

Everything else (anti-detection, stealth plugin, human behavior,
session persistence, Apps Script bridge, retry logic, nightly scheduler)
is already written and ready to use.

---

*End of document — generated April 2026*
