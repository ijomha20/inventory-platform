// =============================================================================
// MATRIX INVENTORY SYNC v3.2
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
//   F  Price
//   G  Prev Price      (auto-written when price changes)
//   H  Notes/Your Cost (user-editable -- triggers portal visibility when filled)
//   I  Price Changed   (timestamp of last price change, auto-written)
//   J  Carfax          (populated by Replit cloud worker)
//   K  Website         (inventory URL; Parkdale preferred, Matrix fallback)
//   L  Online Price    (current retail price from dealer website via Typesense)
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

var SET_SOURCE_URL          = "SOURCE_SHEET_URL";
var SET_SOURCE_TAB          = "SOURCE_TAB_NAME";
var SET_EMAILS              = "NOTIFICATION_EMAILS";
var SET_INTERVAL_HOURS      = "CHECK_INTERVAL_HOURS";
var SET_LAST_SYNCED         = "LAST_SYNCED";
var SET_LAST_SYNC_RESULT    = "LAST_SYNC_RESULT";
var SET_REPLIT_REFRESH_URL  = "REPLIT_REFRESH_URL";
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
      [SET_REPLIT_REFRESH_URL,    "", "Your Replit server URL + /api/refresh (e.g. https://your-domain.replit.dev/api/refresh)"],
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
    ui.alert("Setup already complete. All tabs exist.\n\nRemember to fill in REPLIT_REFRESH_URL and REPLIT_REFRESH_SECRET in Settings.");
  }
}

// =============================================================================
// ARCHIVE HELPER (called before deleting a row)
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
      method:           "post",
      headers:          { "x-refresh-secret": secret, "Content-Type": "application/json" },
      payload:          JSON.stringify({ source: "apps-script" }),
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
  ui.alert("Auto-Sync Activated!\n\nRunning every " + hours + " hour(s).\nNotifications: " + (settings[SET_EMAILS] || "(not configured)") + "\nReplit URL: " + (settings[SET_REPLIT_REFRESH_URL] || "(not configured)"));
}

// Backwards compatibility alias
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

// Backwards compatibility alias
function autoCheckForChanges() { autoSync(); }

// =============================================================================
// DAILY BACKUP (run this from menu or add a daily trigger)
// =============================================================================

function createDailyBackup() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var mySheet = ss.getSheetByName(TAB_MY_LIST);
  if (!mySheet) return;

  var today       = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var backupName  = "Backup " + today;
  var existing    = ss.getSheetByName(backupName);
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

  // Default: return pending Carfax VINs for the cloud worker
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

    var vin        = data[i][COL_VIN]          ? data[i][COL_VIN].toString().trim()          : "";
    var yearMake   = data[i][COL_YEAR_MAKE]     ? data[i][COL_YEAR_MAKE].toString().trim()    : "";
    var model      = data[i][COL_MODEL]         ? data[i][COL_MODEL].toString().trim()        : "";
    var vehicle    = (yearMake + " " + model).trim();
    var mileage    = data[i][COL_MILEAGE]       ? data[i][COL_MILEAGE].toString().trim()      : "";
    var carfax     = data[i][COL_CARFAX]        ? data[i][COL_CARFAX].toString().trim()       : "";
    var website    = data[i][COL_WEBSITE]       ? data[i][COL_WEBSITE].toString().trim()      : "";
    var onlinePrice = data[i][COL_ONLINE_PRICE] ? data[i][COL_ONLINE_PRICE].toString().trim() : "";

    if (!vin) continue;

    result.push({
      location:    data[i][COL_LOCATION] ? data[i][COL_LOCATION].toString().trim() : "",
      vehicle:     vehicle,
      vin:         vin,
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

  // Handle alert notifications from the Replit Carfax worker
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

  // Default: write Carfax result to a row
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

  // Notify Replit to refresh after a Carfax batch completes
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

// Internal helper -- only processes a subset of VINs (for auto-sync new vehicles)
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
