// =============================================================================
// MATRIX INVENTORY SYNC v3.0
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
//
// Rows are sorted by column I descending (most recently changed at the top).
//
// Setup instructions:
//   1. Paste this entire file into Apps Script, replacing any old code.
//   2. Run firstTimeSetup from the function dropdown.
//   3. Fill in the Settings tab (source URL, emails, etc.)
//   4. Run setupNotificationTrigger to activate the hourly auto-check.
// =============================================================================


// Column indices (0-based for array access, add 1 for getRange)
var COL_LOCATION      = 0;
var COL_VIN           = 1;
var COL_YEAR_MAKE     = 2;
var COL_MODEL         = 3;
var COL_MILEAGE       = 4;
var COL_PRICE         = 5;
var COL_PREV_PRICE    = 6;
var COL_NOTES         = 7;
var COL_PRICE_CHANGED = 8;
var TOTAL_COLS        = 9;

// Tab names
var TAB_MY_LIST  = "My List";
var TAB_SETTINGS = "Settings";
var TAB_LOG      = "Sync Log";

// Settings keys
var SET_SOURCE_URL       = "SOURCE_SHEET_URL";
var SET_SOURCE_TAB       = "SOURCE_TAB_NAME";
var SET_EMAILS           = "NOTIFICATION_EMAILS";
var SET_INTERVAL_HOURS   = "CHECK_INTERVAL_HOURS";
var SET_LAST_SYNCED      = "LAST_SYNCED";
var SET_LAST_SYNC_RESULT = "LAST_SYNC_RESULT";

// Script property key
var PROP_STATE = "MATRIX_INVENTORY_STATE_V3";


// =============================================================================
// MENU
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Inventory Sync")
    .addItem("Sync Now", "syncNow")
    .addSeparator()
    .addItem("First-Time Setup", "firstTimeSetup")
    .addItem("Setup Auto-Notifications", "setupNotificationTrigger")
    .addToUi();
}


// =============================================================================
// SETTINGS HELPERS
// =============================================================================

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
    var val = (data[i][1] !== undefined && data[i][1] !== null)
      ? data[i][1].toString().trim() : "";
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

  // Settings tab
  if (!ss.getSheetByName(TAB_SETTINGS)) {
    var s = ss.insertSheet(TAB_SETTINGS);
    s.getRange("A1:C1").setValues([["Setting", "Value", "Notes"]]).setFontWeight("bold");
    var rows = [
      [SET_SOURCE_URL,       "",       "Full URL of the shared Matrix spreadsheet"],
      [SET_SOURCE_TAB,       "Sheet1", "Tab name inside the shared spreadsheet"],
      [SET_EMAILS,           "",       "Comma-separated email addresses for notifications"],
      [SET_INTERVAL_HOURS,   "1",      "How often auto-check runs in hours. Re-run Setup Auto-Notifications to apply."],
      [SET_LAST_SYNCED,      "",       "Auto-written by script, do not edit"],
      [SET_LAST_SYNC_RESULT, "",       "Auto-written by script, do not edit"]
    ];
    s.getRange(2, 1, rows.length, 3).setValues(rows);
    s.setColumnWidth(1, 200);
    s.setColumnWidth(2, 350);
    s.setColumnWidth(3, 380);
    created.push(TAB_SETTINGS);
  }

  // Sync Log tab
  if (!ss.getSheetByName(TAB_LOG)) {
    var l       = ss.insertSheet(TAB_LOG);
    var headers = ["Timestamp", "Trigger", "New Units", "Updated", "Removed", "Price Changes", "Result", "Notes"];
    l.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    l.setFrozenRows(1);
    created.push(TAB_LOG);
  }

  // My List tab
  if (!ss.getSheetByName(TAB_MY_LIST)) {
    var m       = ss.insertSheet(TAB_MY_LIST);
    var mh      = ["Location", "VIN", "Year/Make", "Model", "Mileage", "Price", "Prev Price", "Notes", "Price Changed"];
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


// =============================================================================
// FETCH MATRIX DATA
// =============================================================================

function fetchMatrixData() {
  var settings  = getSettings();
  var sourceUrl = settings[SET_SOURCE_URL];
  var sourceTab = settings[SET_SOURCE_TAB];

  if (!sourceUrl) {
    throw new Error("SOURCE_SHEET_URL is not set. Fill it in on the Settings tab.");
  }

  var sharedSS    = SpreadsheetApp.openByUrl(sourceUrl);
  var sharedSheet = sharedSS.getSheetByName(sourceTab);

  if (!sharedSheet) {
    throw new Error("Cannot find tab \"" + sourceTab + "\" in the shared spreadsheet.");
  }

  var allData = sharedSheet.getDataRange().getValues();
  if (allData.length < 2) {
    throw new Error("The shared Matrix sheet appears to be empty.");
  }

  var vinMap  = {};
  var rawRows = [];

  for (var i = 1; i < allData.length; i++) {
    var dealer = allData[i][0] ? allData[i][0].toString().trim().toLowerCase() : "";
    if (dealer !== "matrix") continue;

    var vin = allData[i][1] ? allData[i][1].toString().trim().toLowerCase() : "";
    if (vin === "" || vinMap[vin]) continue;

    vinMap[vin] = {
      vin:   allData[i][1],
      col3:  allData[i][2],
      col4:  allData[i][3],
      col5:  allData[i][4],
      price: allData[i][5]
    };
    rawRows.push(allData[i]);
  }

  return { vinMap: vinMap, rawRows: rawRows };
}


// =============================================================================
// CORE SYNC LOGIC
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

  // Step 1: Delete MM rows no longer in Matrix feed
  var removedVins = [];
  for (var i = myData.length - 1; i >= 1; i--) {
    var loc = myData[i][COL_LOCATION] ? myData[i][COL_LOCATION].toString().trim().toUpperCase() : "";
    var vin = myData[i][COL_VIN]      ? myData[i][COL_VIN].toString().trim().toLowerCase()      : "";
    if (loc === "MM" && vin !== "" && !vinMap[vin]) {
      mySheet.deleteRow(i + 1);
      removedVins.push(vin.toUpperCase());
    }
  }

  // Step 2: Update existing MM rows
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

    if (changed) {
      priceChangedVins.push(cvin);
      priceChangedRows.push(j + 1);
    }

    dataUpdateQueue.push({
      rowNum: j + 1,
      values: [
        vinMap[cvin].vin,
        vinMap[cvin].col3,
        vinMap[cvin].col4,
        vinMap[cvin].col5,
        newPriceRaw,
        changed ? oldPrice : currentData[j][COL_PREV_PRICE]
      ]
    });
  }

  // Batch write updates (columns B-G, skipping H=Notes)
  for (var u = 0; u < dataUpdateQueue.length; u++) {
    mySheet.getRange(dataUpdateQueue[u].rowNum, 2, 1, 6).setValues([dataUpdateQueue[u].values]);
  }

  // Write Price Changed timestamp (column I) for changed rows
  if (priceChangedRows.length > 0) {
    var ts = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm");
    for (var p = 0; p < priceChangedRows.length; p++) {
      mySheet.getRange(priceChangedRows[p], COL_PRICE_CHANGED + 1).setValue(ts);
    }
  }

  // Step 3: Append new VINs in one batch
  var newVins = [];
  var newRows = [];

  for (var r = 0; r < rawRows.length; r++) {
    var sVin = rawRows[r][1] ? rawRows[r][1].toString().trim().toLowerCase() : "";
    if (sVin === "" || currentVinSet[sVin]) continue;
    newRows.push(["MM", rawRows[r][1], rawRows[r][2], rawRows[r][3], rawRows[r][4], rawRows[r][5], "", "", ""]);
    newVins.push(sVin);
  }

  if (newRows.length > 0) {
    var lastRow = mySheet.getLastRow();
    mySheet.getRange(lastRow + 1, 1, newRows.length, TOTAL_COLS).setValues(newRows);
  }

  // Step 4: Format
  var finalLastRow = mySheet.getLastRow();
  if (finalLastRow > 1) {
    var dataRows  = finalLastRow - 1;
    var dataRange = mySheet.getRange(2, 1, dataRows, TOTAL_COLS);

    // Sort by Price Changed (col I) descending
    dataRange.sort({ column: COL_PRICE_CHANGED + 1, ascending: false });

    dataRange.setFontFamily("Arial").setFontSize(12);
    mySheet.getRange(2, COL_LOCATION + 1,      dataRows, 1).setFontWeight("bold").setHorizontalAlignment("center");
    mySheet.getRange(2, COL_VIN + 1,           dataRows, 3).setHorizontalAlignment("left");
    mySheet.getRange(2, COL_MILEAGE + 1,       dataRows, 1).setNumberFormat("#,##0").setHorizontalAlignment("left");
    mySheet.getRange(2, COL_PRICE + 1,         dataRows, 2).setNumberFormat("$#,##0.00");
    mySheet.getRange(2, COL_PRICE_CHANGED + 1, dataRows, 1).setNumberFormat("yyyy-MM-dd HH:mm").setHorizontalAlignment("center");
    dataRange.setBackground(null);
  }

  // Step 5: Highlight new and price-changed rows (re-read after sort)
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
      if (newVinSet[fvin])      cyanRanges.push("A" + (f + 1) + ":I" + (f + 1));
      else if (changedVinSet[fvin]) yellowRanges.push("A" + (f + 1) + ":I" + (f + 1));
    }

    if (cyanRanges.length > 0)   mySheet.getRangeList(cyanRanges).setBackground("#00FFFF");
    if (yellowRanges.length > 0) mySheet.getRangeList(yellowRanges).setBackground("#FFFF00");
  }

  // Step 6: Record sync time
  var timestamp     = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
  var resultSummary = newVins.length + " new, " + dataUpdateQueue.length + " updated, " +
    removedVins.length + " removed, " + priceChangedVins.length + " price changes";

  writeSetting(SET_LAST_SYNCED,      timestamp);
  writeSetting(SET_LAST_SYNC_RESULT, resultSummary);
  appendLog("Sync", newVins.length, dataUpdateQueue.length, removedVins.length, priceChangedVins.length, "OK", "");

  return {
    newVins:          newVins,
    updatedCount:     dataUpdateQueue.length,
    removedVins:      removedVins,
    priceChangedVins: priceChangedVins,
    timestamp:        timestamp
  };
}


// =============================================================================
// SYNC - UI ENTRY POINT
// =============================================================================

function syncNow() {
  var result = performSync(false);
  if (!result) return;

  var msg = "Sync Complete! (" + result.timestamp + ")";
  if (result.newVins.length > 0)
    msg += "\n\nNEW: " + result.newVins.length + " new unit(s) highlighted in cyan";
  if (result.priceChangedVins.length > 0)
    msg += "\nPRICE CHANGES: " + result.priceChangedVins.length + " unit(s) highlighted in yellow, timestamp in col I";
  if (result.removedVins.length > 0)
    msg += "\nREMOVED: " + result.removedVins.length + " unit(s) no longer in Matrix feed";
  if (result.updatedCount > 0)
    msg += "\nUPDATED: " + result.updatedCount + " existing unit(s) refreshed";
  if (result.newVins.length === 0 && result.priceChangedVins.length === 0 &&
      result.removedVins.length === 0 && result.updatedCount === 0)
    msg += "\n\nNo changes. Your list is already up to date.";

  SpreadsheetApp.getUi().alert(msg);
}


// =============================================================================
// SYNC - HEADLESS ENTRY POINT (trigger-safe, no UI calls)
// =============================================================================

function syncNowHeadless() {
  performSync(true);
}


// =============================================================================
// TRIGGER SETUP
// =============================================================================

function setupNotificationTrigger() {
  var ui       = SpreadsheetApp.getUi();
  var settings = getSettings();
  var hours    = parseInt(settings[SET_INTERVAL_HOURS], 10) || 1;

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "autoCheckForChanges") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger("autoCheckForChanges").timeBased().everyHours(hours).create();

  ui.alert("Auto-Notifications Activated!\n\nChecking every " + hours + " hour(s).\n" +
    "Notifications sent to: " + (settings[SET_EMAILS] || "(not configured)"));
}


// =============================================================================
// AUTO CHECK - HEADLESS (runs from time-based trigger)
// =============================================================================

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
      vin:         rawRows[i][1],
      description: ((rawRows[i][2] || "") + " " + (rawRows[i][3] || "")).trim(),
      mileage:     rawRows[i][4],
      price:       rawRows[i][5]
    };
  }

  var newVehicles     = [];
  var priceChanges    = [];
  var removedVehicles = [];
  var previousState   = null;

  var rawPrev = props.getProperty(PROP_STATE);
  if (rawPrev) {
    try { previousState = JSON.parse(rawPrev); } catch (e) {}
  }

  if (previousState) {
    var cvins = Object.keys(currentState);
    for (var c = 0; c < cvins.length; c++) {
      var cvin = cvins[c];
      if (!previousState[cvin]) {
        newVehicles.push(currentState[cvin]);
      } else {
        var oldP = parseFloat(previousState[cvin].price);
        var newP = parseFloat(currentState[cvin].price);
        if (!isNaN(oldP) && !isNaN(newP) && oldP !== newP) {
          priceChanges.push({ vehicle: currentState[cvin], oldPrice: oldP, newPrice: newP, delta: newP - oldP });
        }
      }
    }
    var pvins = Object.keys(previousState);
    for (var pv = 0; pv < pvins.length; pv++) {
      if (!currentState[pvins[pv]]) removedVehicles.push(previousState[pvins[pv]]);
    }
  }

  // Save compact snapshot (VIN -> price) to stay under 9KB property limit
  var snapshot = {};
  var svins = Object.keys(currentState);
  for (var sv = 0; sv < svins.length; sv++) {
    snapshot[svins[sv]] = { price: currentState[svins[sv]].price };
  }
  try {
    props.setProperty(PROP_STATE, JSON.stringify(snapshot));
  } catch (e) {
    var tiny = {};
    for (var tv = 0; tv < svins.length; tv++) { tiny[svins[tv]] = currentState[svins[tv]].price; }
    try { props.setProperty(PROP_STATE, JSON.stringify(tiny)); } catch (e2) {}
  }

  if (newVehicles.length > 0 || priceChanges.length > 0 || removedVehicles.length > 0) {
    sendChangeNotification(newVehicles, priceChanges, removedVehicles);
    performSync(true);
  } else {
    appendLog("Auto-Check", 0, 0, 0, 0, "No changes", "");
  }
}


// =============================================================================
// EMAIL NOTIFICATION
// =============================================================================

function sendChangeNotification(newVehicles, priceChanges, removedVehicles) {
  var settings = getSettings();
  var emailStr = settings[SET_EMAILS];

  if (!emailStr) {
    appendLog("Email", 0, 0, 0, 0, "SKIPPED", "No email addresses configured in Settings");
    return;
  }

  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MMMM dd, yyyy 'at' HH:mm");

  var parts = [];
  if (newVehicles.length > 0)     parts.push(newVehicles.length + " new");
  if (priceChanges.length > 0)    parts.push(priceChanges.length + " price change" + (priceChanges.length > 1 ? "s" : ""));
  if (removedVehicles.length > 0) parts.push(removedVehicles.length + " removed");

  var subject = "Matrix Inventory Update - " + now + (parts.length > 0 ? " (" + parts.join(", ") + ")" : "");
  var body    = "Matrix Inventory Changes - " + now + "\n" + "==================================================\n\n";

  if (newVehicles.length > 0) {
    body += "NEW VEHICLES (" + newVehicles.length + ")\n----------------------------------------\n";
    for (var nv = 0; nv < newVehicles.length; nv++) {
      var v = newVehicles[nv];
      body += "Vehicle  : " + v.description + "\nVIN      : " + v.vin +
        "\nMileage  : " + formatNumber(v.mileage) + " km\nPrice    : " + formatCurrency(v.price) + "\n\n";
    }
  }

  if (priceChanges.length > 0) {
    body += "PRICE CHANGES (" + priceChanges.length + ")\n----------------------------------------\n";
    for (var pc = 0; pc < priceChanges.length; pc++) {
      var ch  = priceChanges[pc];
      var dir = ch.delta > 0 ? "UP" : "DOWN";
      var pct = ch.oldPrice > 0 ? " (" + Math.abs(Math.round((ch.delta / ch.oldPrice) * 1000) / 10) + "%)" : "";
      body += "Vehicle  : " + ch.vehicle.description + "\nVIN      : " + ch.vehicle.vin +
        "\nMileage  : " + formatNumber(ch.vehicle.mileage) + " km\n" +
        "Change   : " + dir + " " + formatCurrency(Math.abs(ch.delta)) + pct + "\n" +
        "Old Price: " + formatCurrency(ch.oldPrice) + "\nNew Price: " + formatCurrency(ch.newPrice) + "\n\n";
    }
  }

  if (removedVehicles.length > 0) {
    body += "REMOVED FROM FEED (" + removedVehicles.length + ")\n(Removed from your My List)\n----------------------------------------\n";
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
// SYNC LOG
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


// =============================================================================
// FORMAT HELPERS
// =============================================================================

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
