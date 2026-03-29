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
// Deploy this as a Web App so the local Node.js Carfax script can read
// VINs from and write results back to this spreadsheet without needing
// any Google Cloud setup.
//
// How to deploy:
//   1. Click "Deploy" > "New deployment" in Apps Script.
//   2. Click the gear icon, choose "Web app".
//   3. Execute as: Me
//   4. Who has access: Anyone
//   5. Click Deploy. Copy the Web App URL into your .env file.
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
// Queries each dealer's Typesense index directly — no browser required.
// Parkdale is tried first; Matrix used if not found there.
// Runs blank + "NOT FOUND" rows on every call (same retry logic as Carfax).
// =============================================================================

/**
 * Searches one dealer's Typesense collection for a VIN.
 * Returns the full inventory URL string, or null if not found.
 */
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

    // Verify the VIN actually matches (Typesense fuzzy search can return near-misses)
    var docVin = doc.vin ? doc.vin.toString().trim().toUpperCase() : "";
    if (docVin !== vin.toUpperCase()) return null;

    // Build the URL slug from the document fields
    var id   = doc.id        || doc.post_id    || doc.vehicle_id || "";
    var slug = doc.slug      || doc.url_slug   || doc.page_url   || "";

    // If no pre-built slug, construct one from year/make/model/trim
    if (!slug && doc.year && doc.make && doc.model) {
      slug = [doc.year, doc.make, doc.model, doc.trim || ""]
        .filter(function(part) { return String(part).trim() !== ""; })
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    if (!id || !slug) return null;
    return site.siteUrl + "/inventory/" + slug + "/" + id;
  } catch (err) {
    return null;
  }
}

/**
 * Fetches website inventory links for all rows in My List that are blank or
 * "NOT FOUND" in column K.  Parkdale is tried first; falls back to Matrix.
 * Run this from the "Inventory Sync" menu: Fetch Website Links.
 */
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
    // Skip rows that already have a valid URL
    if (existing && existing !== "NOT FOUND") { skipped++; continue; }

    var url = null;
    // Try each site in order: Parkdale first, Matrix second
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

    // Brief pause to avoid hammering the Typesense API
    Utilities.sleep(400);
  }

  SpreadsheetApp.getUi().alert(
    "Website link lookup complete.\n\n" +
    "  Links found : " + found    + "\n" +
    "  Not found   : " + missing  + "\n" +
    "  Skipped     : " + skipped
  );
}
