# Inventory Platform — Complete Source Code Reference
## Updated April 11, 2026

---

## TABLE OF CONTENTS

1. [Platform Architecture](#architecture)
2. [Database Schema (Drizzle ORM)](#db-schema)
3. [Google Apps Script — InventorySync_FINAL.gs](#apps-script)
4. [API Server](#api-server)
   - index.ts (entry point)
   - app.ts (Express setup)
   - lib/logger.ts
   - lib/auth.ts (Google OAuth + Passport)
   - lib/inventoryCache.ts (hourly refresh + BB overlay)
   - lib/bbObjectStore.ts (GCS shared storage)
   - lib/blackBookWorker.ts (CBB trim matching + nightly batch)
   - lib/emailService.ts (Resend invitations)
   - lib/carfaxWorker.ts (Puppeteer stealth automation)
   - routes/index.ts (router aggregator)
   - routes/health.ts
   - routes/auth.ts
   - routes/inventory.ts (inventory + BB + photos)
   - routes/access.ts (user management + audit)
   - routes/carfax.ts
   - build.mjs (esbuild production bundler)
   - package.json
5. [Inventory Portal — React/Vite Frontend](#portal)
   - main.tsx
   - App.tsx
   - components/layout.tsx
   - pages/login.tsx
   - pages/denied.tsx
   - pages/inventory.tsx (table + cards + BB expanded rows + view modes)
   - pages/admin.tsx (access list + audit log)
   - vite.config.ts
   - package.json
6. [OpenAPI Specification](#openapi)

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
        ├── Black Book Worker (nightly 2:00am, dev only for browser login)
        │     Puppeteer + stealth → admin.creditapp.ca (Auth0)
        │     POST /api/cbb/find with VIN + KM
        │     Trim matching: NHTSA VIN decode + token scoring
        │     Results → GCS object storage (shared dev/prod)
        │     Production reads from object storage only
        │
        ├── Carfax Cloud Worker (nightly 2:15am, dev only)
        │     Puppeteer + stealth → dealer.carfax.ca
        │     writes Carfax URL back to sheet via POST
        │
        ├── Inventory Cache (hourly refresh)
        │     fetches sheet data → enriches with Typesense prices
        │     overlays BB values from GCS object storage
        │
        ├── Google OAuth (Passport.js)
        │     roles: Owner / Viewer / Guest
        │
        └── REST API
              /api/inventory          — cached vehicle list (role-filtered)
              /api/cache-status       — poll for updates + BB status
              /api/vehicle-images     — photo gallery (Typesense CDN)
              /api/refresh-blackbook  — manual BB trigger (owner only)
              /api/refresh            — webhook for Apps Script
              /api/access             — user management (owner only)
              /api/audit-log          — change history (owner only)
              /api/carfax/test        — manual Carfax test (owner only)
              /api/carfax/run-batch   — manual Carfax batch (owner only)
              /api/carfax/batch-status — Carfax worker status

Inventory Portal  (same domain, path /)
        React + Vite SPA
        ├── Login page  → Google OAuth
        ├── Inventory   → table/cards, search, filters, photos, links
        │     Owner view mode toggle: Own / User / Cust
        │     Click-to-expand BB wholesale grades (X-Clean/Clean/Average/Rough)
        └── Admin       → access list, role management, audit log

GCS Object Storage (shared between dev and prod):
        bb-session.json   — CreditApp cookies (written by dev browser login)
        bb-values.json    — VIN → {avg, xclean, clean, average, rough} map

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
        CREDITAPP_EMAIL         — admin.creditapp.ca login email
        CREDITAPP_PASSWORD      — admin.creditapp.ca login password
        RESEND_API_KEY          — Resend.com key for invitation emails
        PORT                    — assigned automatically by Replit
```

---

## 2. DATABASE SCHEMA (Drizzle ORM) {#db-schema}

Separate PostgreSQL databases for dev and production. Schema managed via Drizzle ORM.

### lib/db/src/schema/access.ts

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const accessListTable = pgTable("access_list", {
  email:   text("email").primaryKey(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  addedBy: text("added_by").notNull(),
  role:    text("role").notNull().default("viewer"),
});

export type AccessListEntry = typeof accessListTable.$inferSelect;
```

### lib/db/src/schema/audit-log.ts

```typescript
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id:          serial("id").primaryKey(),
  action:      text("action").notNull(),
  targetEmail: text("target_email").notNull(),
  changedBy:   text("changed_by").notNull(),
  roleFrom:    text("role_from"),
  roleTo:      text("role_to"),
  timestamp:   timestamp("timestamp").defaultNow().notNull(),
});

export type AuditLogEntry = typeof auditLogTable.$inferSelect;
```

### lib/db/src/schema/bb-session.ts

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const bbSessionTable = pgTable("bb_session", {
  id:        text("id").primaryKey().default("singleton"),
  cookies:   text("cookies").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at"),
});
```

### lib/db/src/schema/inventory-cache.ts

```typescript
import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

export const inventoryCacheTable = pgTable("inventory_cache", {
  id:          integer("id").primaryKey(),
  data:        jsonb("data").notNull().default([]),
  lastUpdated: timestamp("last_updated").notNull(),
});
```

### lib/db/src/schema/index.ts

```typescript
export * from "./access";
export * from "./audit-log";
export * from "./bb-session";
export * from "./inventory-cache";
```

---

## 3. GOOGLE APPS SCRIPT — InventorySync_FINAL.gs {#apps-script}

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

function syncNowHeadless() {
  performSync(true);
}

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
// WEB APP BRIDGE (for Carfax automation script)
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
// WEBSITE LINK LOOKUP (Column K)
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
      var path = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
      return site.siteUrl + "/" + path + "/";
    }

    var id   = doc.id    || doc.post_id  || doc.vehicle_id || "";
    var slug = doc.slug  || doc.url_slug || "";

    if (!slug && doc.year && doc.make && doc.model) {
      slug = [doc.year, doc.make, doc.model, doc.trim || ""]
        .filter(function(part) { return String(part).trim() !== ""; })
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    if (!id || !slug) return null;
    return site.siteUrl + "/inventory/" + slug + "/" + id + "/";
  } catch (err) {
    return null;
  }
}

function fetchWebsiteLinks() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) {
    SpreadsheetApp.getUi().alert("My List tab not found.");
    return;
  }

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

    if (url) {
      sheet.getRange(i + 1, COL_WEBSITE + 1).setValue(url);
      found++;
    } else {
      sheet.getRange(i + 1, COL_WEBSITE + 1).setValue("NOT FOUND");
      missing++;
    }

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

## 4. API SERVER {#api-server}

### index.ts

```typescript
import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundRefresh } from "./lib/inventoryCache";
import { scheduleCarfaxWorker } from "./lib/carfaxWorker";
import { scheduleBlackBookWorker } from "./lib/blackBookWorker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";

startBackgroundRefresh().then(() => {
  if (isProduction) {
    logger.info("Production deployment — Carfax worker disabled");
  } else {
    scheduleCarfaxWorker();
  }

  scheduleBlackBookWorker();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}).catch((err) => {
  logger.error({ err }, "Failed to initialise inventory cache — starting anyway");
  if (!isProduction) scheduleCarfaxWorker();
  scheduleBlackBookWorker();
  app.listen(port, () => logger.info({ port }, "Server listening (cache init failed)"));
});
```

### app.ts

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

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  })
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: false }),
    secret: process.env["SESSION_SECRET"] ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env["NODE_ENV"] === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

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

### lib/logger.ts

```typescript
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
```

### lib/auth.ts

```typescript
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { logger } from "./logger.js";

const OWNER_EMAIL = (process.env["OWNER_EMAIL"] ?? "").toLowerCase().trim();
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

### lib/inventoryCache.ts

```typescript
import { db, inventoryCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export interface InventoryItem {
  location:       string;
  vehicle:        string;
  vin:            string;
  price:          string;
  km:             string;
  carfax:         string;
  website:        string;
  onlinePrice:    string;
  matrixPrice:    string;
  cost:           string;
  hasPhotos:      boolean;
  bbAvgWholesale?: string;
  bbValues?: {
    xclean: number;
    clean:  number;
    avg:    number;
    rough:  number;
  };
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

async function loadFromDb(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(inventoryCacheTable)
      .where(eq(inventoryCacheTable.id, 1));

    if (rows.length > 0) {
      const row = rows[0];
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

  try {
    const { loadBbValuesFromStore, parseBbEntry } = await import("./bbObjectStore.js");
    const blob = await loadBbValuesFromStore();
    if (blob?.values) {
      let patched = 0;
      for (const item of state.data) {
        const raw = blob.values[item.vin.toUpperCase()];
        if (!raw) continue;
        const entry = parseBbEntry(raw);
        if (entry) {
          if (!item.bbAvgWholesale) { item.bbAvgWholesale = entry.avg; patched++; }
          if (!item.bbValues && (entry.xclean || entry.clean || entry.average || entry.rough)) {
            item.bbValues = { xclean: entry.xclean, clean: entry.clean, avg: entry.average, rough: entry.rough };
            patched++;
          }
        }
      }
      if (patched > 0) {
        logger.info({ patched }, "Inventory: BB values patched from shared object storage at startup");
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "Inventory: could not load BB values from object storage at startup (non-fatal)");
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

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

const TYPESENSE_COLLECTIONS = [
  {
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.parkdalemotors.ca",
  },
  {
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.matrixmotorsyeg.ca",
  },
];

const PRICE_COLLECTIONS = TYPESENSE_COLLECTIONS;

function extractWebsiteUrl(doc: any, siteUrl: string): string | null {
  if (doc.page_url) {
    const path = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
    return `${siteUrl}/${path}/`;
  }
  const id   = doc.id || doc.post_id || doc.vehicle_id || "";
  let   slug = doc.slug || doc.url_slug || "";
  if (!slug && doc.year && doc.make && doc.model) {
    slug = [doc.year, doc.make, doc.model, doc.trim || ""]
      .filter((p: any) => String(p).trim() !== "")
      .join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  if (!id || !slug) return null;
  return `${siteUrl}/inventory/${slug}/${id}/`;
}

interface TypesenseMaps {
  prices:  Map<string, string>;
  website: Map<string, string>;
  photos:  Set<string>;
}

async function fetchFromTypesense(): Promise<TypesenseMaps> {
  const prices  = new Map<string, string>();
  const website = new Map<string, string>();
  const photos  = new Set<string>();

  for (const col of TYPESENSE_COLLECTIONS) {
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
          if (!vin) continue;

          if (!prices.has(vin)) {
            const specialOn    = Number(doc.special_price_on) === 1;
            const specialPrice = parseFloat(doc.special_price);
            const regularPrice = parseFloat(doc.price);
            const raw          = specialOn && specialPrice > 0 ? specialPrice : regularPrice;
            if (!isNaN(raw) && raw > 0) prices.set(vin, String(Math.round(raw)));
          }

          if (!website.has(vin)) {
            const resolved = extractWebsiteUrl(doc, col.siteUrl);
            if (resolved) website.set(vin, resolved);
          }

          if (doc.image_urls && doc.image_urls.toString().trim()) {
            photos.add(vin);
          }
        }

        if (hits.length < 250) break;
        page++;
      }
    } catch (err) {
      logger.warn({ err, collection: col.collection }, "Typesense fetch failed for collection");
    }
  }

  return { prices, website, photos };
}

async function fetchOnlinePricesFromTypesense(): Promise<Map<string, string>> {
  return (await fetchFromTypesense()).prices;
}

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

    const raw: any = await response.json();

    if (!Array.isArray(raw)) {
      logger.error({ type: typeof raw }, "Apps Script returned non-array — keeping stale cache");
      return;
    }
    if (raw.length === 0) {
      logger.warn("Apps Script returned empty array — keeping stale cache");
      return;
    }

    const existingBb = new Map<string, string>();
    const existingBbDetail = new Map<string, { xclean: number; clean: number; avg: number; rough: number }>();
    for (const old of state.data) {
      if (old.bbAvgWholesale) existingBb.set(old.vin.toUpperCase(), old.bbAvgWholesale);
      if (old.bbValues) existingBbDetail.set(old.vin.toUpperCase(), old.bbValues);
    }
    try {
      const { loadBbValuesFromStore, parseBbEntry } = await import("./bbObjectStore.js");
      const blob = await loadBbValuesFromStore();
      if (blob?.values) {
        for (const [vin, raw] of Object.entries(blob.values)) {
          if (!raw) continue;
          const entry = parseBbEntry(raw);
          if (entry) {
            existingBb.set(vin.toUpperCase(), entry.avg);
            if (entry.xclean || entry.clean || entry.average || entry.rough) {
              existingBbDetail.set(vin.toUpperCase(), { xclean: entry.xclean, clean: entry.clean, avg: entry.average, rough: entry.rough });
            }
          }
        }
        logger.info({ count: Object.keys(blob.values).length }, "Inventory: BB values loaded from shared object storage");
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Inventory: could not load BB values from object storage (non-fatal)");
    }

    const items: InventoryItem[] = [];
    for (const r of raw) {
      if (!r || typeof r !== "object") {
        logger.warn({ r }, "Skipping malformed inventory item");
        continue;
      }
      const vin = String(r.vin ?? "").trim().toUpperCase();
      items.push({
        location:       String(r.location    ?? "").trim(),
        vehicle:        String(r.vehicle     ?? "").trim(),
        vin,
        price:          String(r.price       ?? "").trim(),
        km:             String(r.km          ?? "").trim(),
        carfax:         String(r.carfax      ?? "").trim(),
        website:        String(r.website     ?? "").trim(),
        onlinePrice:    String(r.onlinePrice ?? "").trim(),
        matrixPrice:    String(r.matrixPrice ?? "").trim(),
        cost:           String(r.cost        ?? "").trim(),
        hasPhotos:      false,
        bbAvgWholesale: existingBb.get(vin),
        bbValues:       existingBbDetail.get(vin),
      });
    }

    const needEnrichment = items.some(
      (item) =>
        !item.onlinePrice || item.onlinePrice === "NOT FOUND" ||
        !item.website     || item.website     === "NOT FOUND",
    );

    if (needEnrichment) {
      const { prices, website, photos } = await fetchFromTypesense();

      for (const item of items) {
        if (!item.onlinePrice || item.onlinePrice === "NOT FOUND") {
          const fetched = prices.get(item.vin.toUpperCase());
          if (fetched) item.onlinePrice = fetched;
        }
        if (!item.website || item.website === "NOT FOUND") {
          const fetched = website.get(item.vin.toUpperCase());
          if (fetched) item.website = fetched;
        }
        item.hasPhotos = photos.has(item.vin.toUpperCase());
      }

      logger.info(
        { prices: prices.size, websiteUrls: website.size, total: items.length },
        "Typesense enrichment complete",
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

export async function applyBlackBookValues(
  bbMap: Map<string, string>,
  bbDetailMap?: Map<string, { xclean: number; clean: number; avg: number; rough: number }>,
): Promise<void> {
  if (bbMap.size === 0) return;
  if (!state.lastUpdated) {
    logger.warn("BB values received but inventory cache not yet loaded — skipping persist");
    return;
  }
  let updated = 0;
  for (const item of state.data) {
    const vinKey = item.vin.toUpperCase();
    const val = bbMap.get(vinKey);
    if (val !== undefined) {
      item.bbAvgWholesale = val;
      const detail = bbDetailMap?.get(vinKey);
      if (detail) item.bbValues = detail;
      updated++;
    }
  }
  if (updated > 0) {
    await persistToDb();
    logger.info({ updated, total: state.data.length }, "Black Book values applied to inventory");
  }
}

export async function startBackgroundRefresh(intervalMs = 60 * 60 * 1000): Promise<void> {
  await loadFromDb();

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

  setInterval(() => {
    refreshCache().catch((err) =>
      logger.error({ err }, "Background inventory cache refresh failed"),
    );
  }, intervalMs);
}
```

### lib/bbObjectStore.ts

```typescript
import { Storage } from "@google-cloud/storage";
import { logger } from "./logger.js";

const SIDECAR = "http://127.0.0.1:1106";

const gcs = new Storage({
  credentials: {
    audience:            "replit",
    subject_token_type:  "access_token",
    token_url:           `${SIDECAR}/token`,
    type:                "external_account",
    credential_source: {
      url:    `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

function bucket() {
  const id = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!id) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return gcs.bucket(id);
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    const [contents] = await bucket().file(name).download();
    return JSON.parse(contents.toString("utf8")) as T;
  } catch (err: any) {
    if (err.code === 404 || err.message?.includes("No such object")) return null;
    logger.warn({ err: err.message, name }, "bbObjectStore: read failed");
    return null;
  }
}

async function writeJson(name: string, data: unknown): Promise<void> {
  try {
    await bucket().file(name).save(JSON.stringify(data), {
      contentType: "application/json",
    });
  } catch (err: any) {
    logger.warn({ err: err.message, name }, "bbObjectStore: write failed");
  }
}

export interface BbSessionBlob {
  cookies:   any[];
  updatedAt: string;
}

export async function loadSessionFromStore(): Promise<BbSessionBlob | null> {
  return readJson<BbSessionBlob>("bb-session.json");
}

export async function saveSessionToStore(cookies: any[]): Promise<void> {
  await writeJson("bb-session.json", {
    cookies,
    updatedAt: new Date().toISOString(),
  });
}

export interface BbValueEntry {
  avg:     string;
  xclean:  number;
  clean:   number;
  average: number;
  rough:   number;
}

export interface BbValuesBlob {
  values:    Record<string, string | BbValueEntry>;
  updatedAt: string;
}

export function parseBbEntry(raw: string | BbValueEntry): BbValueEntry | null {
  if (typeof raw === "object" && raw !== null && "avg" in raw) return raw as BbValueEntry;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    if (!isNaN(n) && cleaned.length > 0) return { avg: raw, xclean: 0, clean: 0, average: n, rough: 0 };
  }
  return null;
}

export async function loadBbValuesFromStore(): Promise<BbValuesBlob | null> {
  return readJson<BbValuesBlob>("bb-values.json");
}

export async function saveBbValuesToStore(values: Record<string, BbValueEntry>): Promise<void> {
  await writeJson("bb-values.json", {
    values,
    updatedAt: new Date().toISOString(),
  });
}
```

### lib/blackBookWorker.ts

(This is the largest file — 880 lines. Contains CreditApp Auth0 login via Puppeteer,
CBB API calls, NHTSA VIN decode, trim token scoring, and nightly scheduling.)

See the full source in the codebase at: `artifacts/api-server/src/lib/blackBookWorker.ts`

Key sections:
- **Constants & Status** (lines 1–66): Config from env vars, status tracking
- **Session persistence** (lines 70–243): Object storage → DB → file → browser login cascade
- **Browser & anti-detection** (lines 245–340): Puppeteer stealth, Auth0 login flow
- **CBB API** (lines 410–433): `callCbbEndpoint()` — POST to `/api/cbb/find`
- **Health check** (lines 437–453): Validates session before batch
- **NHTSA decode** (lines 455–494): Free VIN lookup for trim/series/drivetrain
- **Trim matching** (lines 496–666): Token scoring algorithm:
  - `trimTokens()` strips make/model/year/colors/noise
  - Exact series match: 30pts
  - Token match: 20pts per token
  - NHTSA trim/series match: 25/20pts
  - Style tokens: 10pts
  - Drivetrain bonus/penalty: ±5pts
  - Cab style bonus: 5–8pts
  - Fallback: median value when score=0
- **Batch processing** (lines 668–759): Iterates all VINs, two CBB calls per VIN (KM-adjusted + unadjusted grades)
- **Self-healing retry** (lines 763–782): Exponential backoff, no notifications
- **Scheduler** (lines 848–879): Nightly 2:00am with startup catch-up, DB-persisted run date

### lib/emailService.ts

```typescript
import { Resend } from "resend";
import { logger } from "./logger.js";

const RESEND_API_KEY = process.env["RESEND_API_KEY"]?.trim() ?? "";
const APP_URL = (() => {
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  return domain ? `https://${domain}` : "https://script-reviewer.replit.app";
})();

export async function sendInvitationEmail(
  toEmail: string,
  role: string,
  invitedBy: string,
): Promise<void> {
  if (!RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — skipping invitation email");
    return;
  }

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
          <a href="${APP_URL}"
            style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;
                   text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
            Open Inventory Portal
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#888;">
            Sign in with the Google account associated with <strong>${toEmail}</strong>.
            If you don't have a Google account with this email, contact ${invitedBy}.
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

### lib/carfaxWorker.ts

(Large file — 880+ lines. Contains Carfax Canada dealer portal automation.)

See the full source in the codebase at: `artifacts/api-server/src/lib/carfaxWorker.ts`

Key sections:
- Puppeteer stealth with 11+ fingerprinting vector overrides
- Auth0 login to dealer.carfax.ca
- VIN search on dealer portal at `/MyReports`
- Session persistence to disk
- Apps Script bridge for reading pending VINs and writing results
- Nightly 2:15am schedule (dev only)
- Human-like mouse movement, typing, and click patterns

### types/passport.d.ts

```typescript
declare global {
  namespace Express {
    interface User {
      email:   string;
      name:    string;
      picture: string;
    }
  }
}

export {};
```

### scripts/testCarfax.ts

```typescript
/**
 * Quick Carfax test — run directly with:
 *   npx tsx src/scripts/testCarfax.ts 2C4RC1ZG7RR152266 5YFB4MDE3PP000858
 */
import { runCarfaxWorkerForVins } from "../lib/carfaxWorker.js";

const vins = process.argv.slice(2);

if (vins.length === 0) {
  console.error("Usage: npx tsx src/scripts/testCarfax.ts <VIN1> <VIN2> ...");
  process.exit(1);
}

console.log(`\nRunning Carfax test on ${vins.length} VIN(s): ${vins.join(", ")}\n`);

runCarfaxWorkerForVins(vins).then((results) => {
  console.log("\n========== RESULTS ==========");
  for (const r of results) {
    if (r.status === "found") {
      console.log(`✓ ${r.vin} — FOUND`);
      console.log(`  URL: ${r.url}`);
    } else if (r.status === "not_found") {
      console.log(`✗ ${r.vin} — NOT FOUND in Carfax`);
    } else if (r.status === "captcha") {
      console.log(`! ${r.vin} — CAPTCHA blocked`);
    } else {
      console.log(`✗ ${r.vin} — ERROR: ${r.error}`);
    }
  }
  console.log("=============================\n");
  process.exit(0);
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

### routes/index.ts

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

### routes/price-lookup.ts

(Not currently registered in routes/index.ts — exists as standalone file.)

```typescript
import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

const DEALERS: Record<string, { collection: string; apiKey: string }> = {
  "matrixmotorsyeg.ca": {
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey: "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
  "parkdalemotors.ca": {
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey: "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
};

function formatPrice(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

router.get("/price-lookup", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  res.set("Cache-Control", "no-store");

  const url = (req.query.url as string ?? "").trim();
  if (!url || !url.startsWith("http")) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const dealer = DEALERS[hostname];

    if (!dealer) {
      res.json({ price: null });
      return;
    }

    const idMatch = parsed.pathname.match(/\/(\d+)\/?$/);
    if (!idMatch) {
      res.json({ price: null });
      return;
    }
    const docId = idMatch[1];

    const params = new URLSearchParams({
      q: "*",
      filter_by: `id:=[${docId}]`,
      per_page: "1",
      "x-typesense-api-key": dealer.apiKey,
    });
    const tsUrl = `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search?${params}`;
    const tsRes = await fetch(tsUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!tsRes.ok) {
      logger.warn({ status: tsRes.status, url, docId }, "Typesense lookup failed");
      res.json({ price: null });
      return;
    }

    const body = await tsRes.json() as { hits?: Array<{ document: Record<string, unknown> }> };
    if (!body.hits || body.hits.length === 0) {
      res.json({ price: null });
      return;
    }
    const doc = body.hits[0].document;

    const specialOn = Number(doc.special_price_on) === 1;
    const specialPrice = Number(doc.special_price);
    const regularPrice = Number(doc.price);

    const rawPrice = specialOn && specialPrice > 0 ? specialPrice : regularPrice;

    if (!rawPrice || rawPrice <= 0) {
      res.json({ price: null });
      return;
    }

    res.json({ price: formatPrice(rawPrice) });
  } catch (err) {
    logger.warn({ err, url }, "price-lookup error");
    res.json({ price: null });
  }
});

export default router;
```

### routes/health.ts

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

### routes/auth.ts

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
  const callbackURL = domain
    ? `https://${domain}/api/auth/google/callback`
    : "http://localhost:8080/api/auth/google/callback";
  res.json({ callbackURL, REPLIT_DOMAINS: process.env["REPLIT_DOMAINS"] ?? "(not set)" });
});

router.get("/auth/google", passport.authenticate("google", { scope: ["email", "profile"] }));

router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/?auth_error=1" }),
  (_req, res) => {
    res.redirect("/");
  }
);

router.get("/auth/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

router.get("/me", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user  = req.user as { email: string; name: string; picture: string };
  const email = user.email.toLowerCase();
  const owner = isOwner(email);

  let role = "viewer";
  if (owner) {
    role = "owner";
  } else {
    const [entry] = await db
      .select()
      .from(accessListTable)
      .where(eq(accessListTable.email, email))
      .limit(1);
    if (entry) role = entry.role;
    else {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  res.json({
    email:   user.email,
    name:    user.name,
    picture: user.picture,
    isOwner: owner,
    role,
  });
});

export default router;
```

### routes/inventory.ts

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getCacheState, refreshCache } from "../lib/inventoryCache.js";
import { runBlackBookWorker, getBlackBookStatus } from "../lib/blackBookWorker.js";

const router = Router();

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";
const IMAGE_CDN_BASE = "https://zopsoftware-asset.b-cdn.net";

const DEALER_COLLECTIONS = [
  {
    name:       "Matrix",
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.matrixmotorsyeg.ca",
  },
  {
    name:       "Parkdale",
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.parkdalemotors.ca",
  },
];

function extractWebsiteUrl(doc: any, siteUrl: string): string | null {
  if (doc.page_url) {
    const path = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
    return `${siteUrl}/${path}/`;
  }
  const id   = doc.id || doc.post_id || doc.vehicle_id || "";
  let   slug = doc.slug || doc.url_slug || "";
  if (!slug && doc.year && doc.make && doc.model) {
    slug = [doc.year, doc.make, doc.model, doc.trim || ""]
      .filter((p: any) => String(p).trim() !== "")
      .join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  if (!id || !slug) return null;
  return `${siteUrl}/inventory/${slug}/${id}/`;
}

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

router.get("/inventory", requireAccess, async (req, res) => {
  const role = await getUserRole(req);
  const { data } = getCacheState();

  const items = data.map((item) => {
    if (role === "owner") return item;

    const { matrixPrice, cost, ...rest } = item;

    if (role === "viewer") return rest;

    const { bbAvgWholesale, bbValues, ...guestRest } = rest;
    if (role === "guest") return { ...guestRest, price: "" };

    return guestRest;
  });

  res.set("Cache-Control", "no-store");
  res.json(items);
});

router.get("/cache-status", requireAccess, (_req, res) => {
  const { lastUpdated, isRefreshing, data } = getCacheState();
  const bb = getBlackBookStatus();
  res.set("Cache-Control", "no-store");
  res.json({
    lastUpdated:    lastUpdated?.toISOString() ?? null,
    isRefreshing,
    count:          data.length,
    bbRunning:      bb.running,
    bbLastRun:      bb.lastRun,
    bbCount:        bb.lastCount,
  });
});

router.post("/refresh-blackbook", requireAccess, async (req, res) => {
  const role = await getUserRole(req);
  if (role !== "owner") {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  const { running } = getBlackBookStatus();
  if (running) {
    res.json({ ok: true, message: "Already running", running: true });
    return;
  }
  runBlackBookWorker().catch((err) =>
    logger.error({ err }, "Manual BB refresh error"),
  );
  res.json({ ok: true, message: "Black Book refresh started", running: true });
});

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

router.get("/vehicle-images", requireAccess, async (req, res) => {
  const vin = (req.query["vin"] as string ?? "").trim().toUpperCase();
  if (!vin || vin.length < 10) {
    res.json({ vin, urls: [] });
    return;
  }

  const urls: string[] = [];
  let websiteUrl: string | null = null;

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

      websiteUrl = extractWebsiteUrl(doc, dealer.siteUrl);

      break;
    } catch (_err) {
    }
  }

  res.set("Cache-Control", "public, max-age=300");
  res.json({ vin, urls, websiteUrl });
});

export default router;
```

### routes/access.ts

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import { accessListTable, auditLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";
import { sendInvitationEmail } from "../lib/emailService.js";

const router = Router();

function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as { email: string };
  if (!isOwner(user.email)) {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

async function writeAudit(
  action: string,
  targetEmail: string,
  changedBy: string,
  roleFrom?: string | null,
  roleTo?: string | null,
) {
  try {
    await db.insert(auditLogTable).values({
      action,
      targetEmail,
      changedBy,
      roleFrom:  roleFrom  ?? null,
      roleTo:    roleTo    ?? null,
    });
  } catch (_err) {
  }
}

router.get("/access", requireOwner, async (_req, res) => {
  const list = await db.select().from(accessListTable).orderBy(accessListTable.addedAt);
  res.json(list);
});

router.post("/access", requireOwner, async (req, res) => {
  const rawEmail = (req.body?.email ?? "").toString().trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes("@")) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  const role  = ["viewer", "guest"].includes(req.body?.role) ? req.body.role : "viewer";
  const owner = (req.user as { email: string }).email;

  const [entry] = await db
    .insert(accessListTable)
    .values({ email: rawEmail, addedBy: owner, role })
    .onConflictDoNothing()
    .returning();

  await writeAudit("add", rawEmail, owner, null, role);

  if (entry) {
    sendInvitationEmail(rawEmail, role, owner).catch(() => {});
  }

  res.json(entry ?? { email: rawEmail, addedBy: owner, addedAt: new Date().toISOString(), role });
});

router.patch("/access/:email", requireOwner, async (req, res) => {
  const email   = decodeURIComponent(req.params.email ?? "").toLowerCase();
  const newRole = (req.body?.role ?? "").toString().trim().toLowerCase();

  if (!["viewer", "guest"].includes(newRole)) {
    res.status(400).json({ error: "Role must be 'viewer' or 'guest'" });
    return;
  }

  const [existing] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [updated] = await db
    .update(accessListTable)
    .set({ role: newRole })
    .where(eq(accessListTable.email, email))
    .returning();

  const owner = (req.user as { email: string }).email;
  await writeAudit("role_change", email, owner, existing.role, newRole);

  res.json(updated);
});

router.delete("/access/:email", requireOwner, async (req, res) => {
  const email = decodeURIComponent(req.params.email ?? "").toLowerCase();
  const owner = (req.user as { email: string }).email;

  const [existing] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);

  await db.delete(accessListTable).where(eq(accessListTable.email, email));
  await writeAudit("remove", email, owner, existing?.role ?? null, null);

  res.json({ ok: true });
});

router.get("/audit-log", requireOwner, async (_req, res) => {
  const entries = await db
    .select()
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.timestamp))
    .limit(200);
  res.json(entries);
});

export default router;
```

### routes/carfax.ts

```typescript
import { Router } from "express";
import { isOwner } from "../lib/auth.js";
import { runCarfaxWorkerForVins, runCarfaxWorker, getCarfaxBatchStatus } from "../lib/carfaxWorker.js";
import { logger } from "../lib/logger.js";

const router = Router();

function requireOwner(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as { email: string };
  if (!isOwner(user.email)) {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

router.get("/carfax/batch-status", requireOwner, (_req, res) => {
  res.json(getCarfaxBatchStatus());
});

router.post("/carfax/run-batch", requireOwner, (req: any, res: any) => {
  const status = getCarfaxBatchStatus();
  if (status.running) {
    res.status(409).json({ ok: false, error: "A batch is already running", startedAt: status.startedAt });
    return;
  }
  logger.info({ requestedBy: (req.user as any)?.email }, "Manual Carfax batch triggered via API");
  runCarfaxWorker({ force: true }).catch((err) =>
    logger.error({ err }, "Manual Carfax batch failed")
  );
  res.json({ ok: true, message: "Carfax batch started. Check server logs for progress." });
});

router.post("/carfax/test", requireOwner, async (req: any, res: any) => {
  const { vins } = req.body as { vins?: string[] };

  if (!Array.isArray(vins) || vins.length === 0) {
    res.status(400).json({ error: "Provide an array of VINs in the request body: { vins: [...] }" });
    return;
  }

  if (vins.length > 10) {
    res.status(400).json({ error: "Maximum 10 VINs per test run" });
    return;
  }

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

### build.mjs

```javascript
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: [
      "*.node",
      "connect-pg-simple",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "puppeteer-extra",
      "puppeteer-extra-plugin-stealth",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
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

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### package.json (API Server)

```json
{
  "name": "@workspace/api-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "export NODE_ENV=development && pnpm run build && pnpm run start",
    "build": "node ./build.mjs",
    "start": "node --enable-source-maps ./dist/index.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@google-cloud/storage": "^7.19.0",
    "@workspace/api-zod": "workspace:*",
    "@workspace/db": "workspace:*",
    "connect-pg-simple": "^10.0.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2",
    "drizzle-orm": "catalog:",
    "express": "^5",
    "express-rate-limit": "^8.3.2",
    "express-session": "^1.19.0",
    "google-auth-library": "^10.6.2",
    "passport": "^0.7.0",
    "passport-google-oauth20": "^2.0.0",
    "pino": "^9",
    "pino-http": "^10",
    "puppeteer": "^24.40.0",
    "puppeteer-extra": "^3.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "resend": "^6.10.0"
  },
  "devDependencies": {
    "@types/connect-pg-simple": "^7.0.3",
    "@types/cookie-parser": "^1.4.10",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/express-session": "^1.18.2",
    "@types/node": "catalog:",
    "@types/passport": "^1.0.17",
    "@types/passport-google-oauth20": "^2.0.17",
    "esbuild": "^0.27.3",
    "esbuild-plugin-pino": "^2.3.3",
    "pino-pretty": "^13",
    "thread-stream": "3.1.0"
  }
}
```

---

## 5. INVENTORY PORTAL — React/Vite Frontend {#portal}

### main.tsx

```typescript
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
```

### App.tsx

```typescript
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
      <Route path="/login" component={Login} />
      <Route path="/denied" component={AccessDenied} />
      
      <Route path="/">
        <RequireAuth>
          <Layout>
            <Inventory />
          </Layout>
        </RequireAuth>
      </Route>
      
      <Route path="/admin">
        <RequireAuth>
          <Layout>
            <Admin />
          </Layout>
        </RequireAuth>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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

export default App;
```

### components/layout.tsx

```typescript
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
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
                  >
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline">Manage Access</span>
                  </Link>
                )}

                <div className="h-5 w-px bg-gray-200 hidden sm:block" />

                <div className="flex items-center gap-2.5">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-sm font-medium text-gray-800 leading-none">{user.name}</span>
                    <span className="text-xs text-gray-400 mt-0.5">{user.email}</span>
                  </div>
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-600">{user.name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <a
                    href="/api/auth/logout"
                    title="Sign Out"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
```

### pages/login.tsx

```typescript
import { Car, Lock } from "lucide-react";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-5">
          <Car className="w-6 h-6 text-white" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">Inventory Portal</h1>
        <p className="text-sm text-gray-500 mb-7">
          Access is restricted to authorized personnel. Sign in with your Google account to continue.
        </p>

        <a
          href="/api/auth/google"
          className="w-full inline-flex items-center justify-center gap-3 px-5 py-2.5 border border-gray-200 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </a>

        <p className="mt-6 flex items-center gap-1.5 text-xs text-gray-400">
          <Lock className="w-3 h-3" />
          Secure authentication via Google
        </p>
      </div>
    </div>
  );
}
```

### pages/denied.tsx

```typescript
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
        <p className="text-sm text-gray-500 mb-5">
          You don't have permission to view this portal. Contact the owner to request access.
        </p>

        {user && (
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 text-left">
            <p className="text-xs text-gray-400 mb-0.5">Signed in as</p>
            <p className="text-sm font-medium text-gray-800">{user.email}</p>
          </div>
        )}

        <a
          href="/api/auth/logout"
          className="w-full inline-flex items-center justify-center px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          Sign out and try another account
        </a>
      </div>
    </div>
  );
}
```

### pages/not-found.tsx

```typescript
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### pages/inventory.tsx

(698 lines — full source in codebase at `artifacts/inventory-portal/src/pages/inventory.tsx`)

Key features:
- **View mode toggle**: Own / User / Cust — persisted to localStorage
  - Own: shows matrixPrice, cost, bbAvgWholesale, BB expanded rows
  - User: shows PAC cost, online price, BB values (no matrixPrice/cost)
  - Cust: hides all pricing and BB values
- **BB expanded rows**: Click book avg value to expand inline purple row showing X-Clean/Clean/Average/Rough wholesale grades
- **Photo gallery modal**: Full-screen lightbox with keyboard navigation, thumbnail strip
- **Filters**: Year range, KM max, PAC cost range — with active filter chips
- **Sort**: Location, vehicle, VIN, KM, price — ascending/descending
- **Search**: Vehicle name, VIN, location
- **Mobile cards**: Responsive card layout under 768px width
- **Desktop table**: Full-width row layout with all columns
- **Deduplication**: By VIN — keeps lowest-priced entry
- **Auto-refresh**: Polls cache-status every 60s, refetches inventory on change
- **Manual BB refresh**: Owner-only "Book Avg" button triggers `/api/refresh-blackbook`

### pages/admin.tsx

(327 lines — full source in codebase at `artifacts/inventory-portal/src/pages/admin.tsx`)

Key features:
- **Grant Access form**: Email input + role selector (Viewer/Guest) + invitation email via Resend
- **Users tab**: Table of approved users with inline role selector dropdown and remove button
- **Audit Log tab**: Chronological table of all add/remove/role_change events
- **Role legend**: Viewer (sees all data) / Guest (prices hidden)

### vite.config.ts

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
```

### package.json (Inventory Portal)

```json
{
  "name": "@workspace/inventory-portal",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --config vite.config.ts --host 0.0.0.0",
    "build": "vite build --config vite.config.ts",
    "serve": "vite preview --config vite.config.ts --host 0.0.0.0",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@radix-ui/react-aspect-ratio": "^1.1.3",
    "@radix-ui/react-avatar": "^1.1.4",
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-collapsible": "^1.1.4",
    "@radix-ui/react-context-menu": "^2.2.7",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-hover-card": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-menubar": "^1.1.7",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-progress": "^1.1.3",
    "@radix-ui/react-radio-group": "^1.2.4",
    "@radix-ui/react-scroll-area": "^1.2.4",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.3",
    "@radix-ui/react-toggle-group": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@replit/vite-plugin-cartographer": "catalog:",
    "@replit/vite-plugin-dev-banner": "catalog:",
    "@replit/vite-plugin-runtime-error-modal": "catalog:",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "@workspace/api-client-react": "workspace:*",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "cmdk": "^1.1.1",
    "date-fns": "^3.6.0",
    "embla-carousel-react": "^8.6.0",
    "framer-motion": "catalog:",
    "input-otp": "^1.4.2",
    "lucide-react": "catalog:",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-day-picker": "^9.11.1",
    "react-dom": "catalog:",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "react-resizable-panels": "^2.1.7",
    "recharts": "^2.15.2",
    "sonner": "^2.0.7",
    "tailwind-merge": "catalog:",
    "tailwindcss": "catalog:",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "vite": "catalog:",
    "wouter": "^3.3.5",
    "zod": "catalog:"
  }
}
```

---

## 6. OPENAPI SPECIFICATION {#openapi}

```yaml
openapi: 3.1.0
info:
  title: Api
  version: 0.1.0
  description: API specification
servers:
  - url: /api
    description: Base API path
tags:
  - name: health
    description: Health operations
  - name: auth
    description: Authentication
  - name: inventory
    description: Inventory data
  - name: access
    description: Access list management
  - name: audit
    description: Audit log
paths:
  /healthz:
    get:
      operationId: healthCheck
      tags: [health]
      summary: Health check
      responses:
        "200":
          description: Healthy
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthStatus"

  /me:
    get:
      operationId: getMe
      tags: [auth]
      summary: Get current authenticated user
      responses:
        "200":
          description: Current user
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
        "401":
          description: Not authenticated

  /inventory:
    get:
      operationId: getInventory
      tags: [inventory]
      summary: Get all inventory items (role-filtered)
      responses:
        "200":
          description: List of inventory items
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/InventoryItem"
        "401":
          description: Not authenticated
        "403":
          description: Access denied

  /cache-status:
    get:
      operationId: getCacheStatus
      tags: [inventory]
      summary: Get cache refresh status and BB worker status
      responses:
        "200":
          description: Cache status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CacheStatus"

  /vehicle-images:
    get:
      operationId: getVehicleImages
      tags: [inventory]
      summary: Get photo gallery URLs for a vehicle by VIN
      parameters:
        - name: vin
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Vehicle image URLs

  /access:
    get:
      operationId: getAccessList
      tags: [access]
      summary: Get list of approved emails (owner only)
    post:
      operationId: addAccessEntry
      tags: [access]
      summary: Add an email to the access list (owner only)

  /access/{email}:
    patch:
      operationId: updateAccessRole
      tags: [access]
      summary: Update a user's role (owner only)
    delete:
      operationId: removeAccessEntry
      tags: [access]
      summary: Remove an email from the access list (owner only)

  /audit-log:
    get:
      operationId: getAuditLog
      tags: [audit]
      summary: Get audit log of access changes (owner only)

components:
  schemas:
    HealthStatus:
      type: object
      properties:
        status:
          type: string
      required: [status]

    User:
      type: object
      properties:
        email:
          type: string
        name:
          type: string
        picture:
          type: string
        isOwner:
          type: boolean
        role:
          type: string
      required: [email, name, isOwner, role]

    InventoryItem:
      type: object
      properties:
        location:
          type: string
        vehicle:
          type: string
        vin:
          type: string
        price:
          type: string
        km:
          type: string
        carfax:
          type: string
        website:
          type: string
        onlinePrice:
          type: string
        matrixPrice:
          type: string
          nullable: true
        cost:
          type: string
          nullable: true
        bbAvgWholesale:
          type: string
          nullable: true
      required: [location, vehicle, vin, price]

    CacheStatus:
      type: object
      properties:
        lastUpdated:
          type: string
          nullable: true
        isRefreshing:
          type: boolean
        count:
          type: integer
      required: [isRefreshing, count]

    VehicleImages:
      type: object
      properties:
        vin:
          type: string
        urls:
          type: array
          items:
            type: string
      required: [vin, urls]

    AccessEntry:
      type: object
      properties:
        email:
          type: string
        addedAt:
          type: string
        addedBy:
          type: string
        role:
          type: string
      required: [email, addedAt, addedBy, role]

    AddAccessRequest:
      type: object
      properties:
        email:
          type: string
        role:
          type: string
      required: [email]

    UpdateAccessRoleRequest:
      type: object
      properties:
        role:
          type: string
      required: [role]

    AuditLogEntry:
      type: object
      properties:
        id:
          type: integer
        action:
          type: string
        targetEmail:
          type: string
        changedBy:
          type: string
        roleFrom:
          type: string
          nullable: true
        roleTo:
          type: string
          nullable: true
        timestamp:
          type: string
      required: [id, action, targetEmail, changedBy, timestamp]

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
      required: [error]

    SuccessResponse:
      type: object
      properties:
        ok:
          type: boolean
      required: [ok]
```

---

*Document generated April 11, 2026. Covers all source code as of latest deployment to script-reviewer.replit.app.*
*The blackBookWorker.ts (880 lines) and carfaxWorker.ts (880+ lines) are summarized with key section references — full source is in the codebase.*
