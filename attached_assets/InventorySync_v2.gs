// =============================================================================
// MATRIX INVENTORY SYNC — v3.0
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
//   H  Notes           (user-editable — never overwritten by script)
//   I  Price Changed   (timestamp of last price change — auto-written)
//
// Rows are sorted by column I descending — most recently changed at the top.
//
// Setup instructions:
//   1. Paste this entire file into Apps Script, replacing any old code.
//   2. Run: Inventory Sync > ⚙ First-Time Setup
//   3. Fill in the "Settings" tab (source URL, emails, etc.)
//   4. Run: Inventory Sync > ⚙ Setup Auto-Notifications
// =============================================================================


// ─── COLUMN LAYOUT (0-based for array access) ─────────────────────────────────
const COL_LOCATION      = 0;  // A
const COL_VIN           = 1;  // B
const COL_YEAR_MAKE     = 2;  // C
const COL_MODEL         = 3;  // D
const COL_MILEAGE       = 4;  // E
const COL_PRICE         = 5;  // F
const COL_PREV_PRICE    = 6;  // G
const COL_NOTES         = 7;  // H  — never touched by script
const COL_PRICE_CHANGED = 8;  // I  — last price change timestamp
const TOTAL_COLS        = 9;  // A–I

// ─── TAB NAME CONSTANTS ───────────────────────────────────────────────────────
const TAB_MY_LIST  = "My List";
const TAB_SETTINGS = "Settings";
const TAB_LOG      = "Sync Log";

// ─── SETTINGS KEYS ────────────────────────────────────────────────────────────
const SET_SOURCE_URL       = "SOURCE_SHEET_URL";
const SET_SOURCE_TAB       = "SOURCE_TAB_NAME";
const SET_EMAILS           = "NOTIFICATION_EMAILS";
const SET_INTERVAL_HOURS   = "CHECK_INTERVAL_HOURS";
const SET_LAST_SYNCED      = "LAST_SYNCED";
const SET_LAST_SYNC_RESULT = "LAST_SYNC_RESULT";

// ─── SCRIPT PROPERTY KEY ──────────────────────────────────────────────────────
const PROP_STATE = "MATRIX_INVENTORY_STATE_V3";


// =============================================================================
// MENU
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Inventory Sync")
    .addItem("▶ Sync Now",                    "syncNow")
    .addSeparator()
    .addItem("⚙ First-Time Setup",            "firstTimeSetup")
    .addItem("⚙ Setup Auto-Notifications",    "setupNotificationTrigger")
    .addToUi();
}


// =============================================================================
// SETTINGS HELPERS
// =============================================================================

function getSettings() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TAB_SETTINGS);

  const defaults = {
    [SET_SOURCE_URL]:     "",
    [SET_SOURCE_TAB]:     "Sheet1",
    [SET_EMAILS]:         "",
    [SET_INTERVAL_HOURS]: "1",
  };

  if (!sheet) return defaults;

  const data     = sheet.getDataRange().getValues();
  const settings = Object.assign({}, defaults);

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0] ? data[i][0].toString().trim() : "";
    const val = (data[i][1] !== undefined && data[i][1] !== null)
      ? data[i][1].toString().trim() : "";
    if (key) settings[key] = val;
  }

  return settings;
}

function writeSetting(key, value) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TAB_SETTINGS);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
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
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const ui      = SpreadsheetApp.getUi();
  const created = [];

  // ── Settings tab ──────────────────────────────────────────────────────────
  if (!ss.getSheetByName(TAB_SETTINGS)) {
    const s = ss.insertSheet(TAB_SETTINGS);
    s.getRange("A1:C1").setValues([["Setting", "Value", "Notes"]]).setFontWeight("bold");

    const rows = [
      [SET_SOURCE_URL,       "",       "Full URL of the shared Matrix spreadsheet"],
      [SET_SOURCE_TAB,       "Sheet1", "Tab name inside the shared spreadsheet"],
      [SET_EMAILS,           "",       "Comma-separated email addresses for notifications"],
      [SET_INTERVAL_HOURS,   "1",      "How often auto-check runs (hours). Re-run Setup Auto-Notifications to apply."],
      [SET_LAST_SYNCED,      "",       "Auto-written by script — do not edit"],
      [SET_LAST_SYNC_RESULT, "",       "Auto-written by script — do not edit"],
    ];
    s.getRange(2, 1, rows.length, 3).setValues(rows);
    s.setColumnWidth(1, 200);
    s.setColumnWidth(2, 350);
    s.setColumnWidth(3, 380);
    created.push(TAB_SETTINGS);
  }

  // ── Sync Log tab ──────────────────────────────────────────────────────────
  if (!ss.getSheetByName(TAB_LOG)) {
    const l       = ss.insertSheet(TAB_LOG);
    const headers = [
      "Timestamp", "Trigger", "New Units", "Updated",
      "Removed", "Price Changes", "Result", "Notes"
    ];
    l.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    l.setFrozenRows(1);
    created.push(TAB_LOG);
  }

  // ── My List tab ───────────────────────────────────────────────────────────
  if (!ss.getSheetByName(TAB_MY_LIST)) {
    const m       = ss.insertSheet(TAB_MY_LIST);
    const headers = [
      "Location", "VIN", "Year/Make", "Model",
      "Mileage", "Price", "Prev Price", "Notes", "Price Changed"
    ];
    m.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    m.setFrozenRows(1);
    m.setColumnWidth(COL_PRICE_CHANGED + 1, 145);
    created.push(TAB_MY_LIST);
  }

  if (created.length > 0) {
    ui.alert(
      "Setup Complete!\n\nCreated tabs: " + created.join(", ") +
      "\n\nNext step: Fill in your settings in the \"" + TAB_SETTINGS + "\" tab,\n" +
      "then run \"Setup Auto-Notifications\" from the menu."
    );
  } else {
    ui.alert("Setup already complete. All required tabs exist.");
  }
}


// =============================================================================
// FETCH MATRIX DATA (shared by all sync paths)
// =============================================================================

/**
 * Opens the shared spreadsheet and returns all Matrix rows as a VIN map.
 * @returns {{ vinMap: object, rawRows: Array }} or throws on failure.
 */
function fetchMatrixData() {
  const settings  = getSettings();
  const sourceUrl = settings[SET_SOURCE_URL];
  const sourceTab = settings[SET_SOURCE_TAB];

  if (!sourceUrl) throw new Error(
    "SOURCE_SHEET_URL is not configured. Fill it in on the \"" + TAB_SETTINGS + "\" tab."
  );

  const sharedSS    = SpreadsheetApp.openByUrl(sourceUrl);
  const sharedSheet = sharedSS.getSheetByName(sourceTab);

  if (!sharedSheet) throw new Error(
    "Cannot find tab \"" + sourceTab + "\" in the shared spreadsheet."
  );

  const allData = sharedSheet.getDataRange().getValues();
  if (allData.length < 2) throw new Error("The shared Matrix sheet appears to be empty.");

  const vinMap  = {};
  const rawRows = [];

  for (let i = 1; i < allData.length; i++) {
    const dealer = allData[i][0] ? allData[i][0].toString().trim().toLowerCase() : "";
    if (dealer !== "matrix") continue;

    const vin = allData[i][1] ? allData[i][1].toString().trim().toLowerCase() : "";
    if (vin === "" || vinMap[vin]) continue; // skip blank or duplicate VINs

    vinMap[vin] = {
      vin:   allData[i][1],
      col3:  allData[i][2],
      col4:  allData[i][3],
      col5:  allData[i][4],
      price: allData[i][5],
    };
    rawRows.push(allData[i]);
  }

  return { vinMap, rawRows };
}


// =============================================================================
// CORE SYNC LOGIC
// =============================================================================

/**
 * Pulls fresh Matrix data and applies all changes to "My List".
 * @param {boolean} isHeadless - When true, no ui.alert calls are made.
 * @returns {object|null} Change summary, or null on fatal error.
 */
function performSync(isHeadless) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const mySheet = ss.getSheetByName(TAB_MY_LIST);

  if (!mySheet) {
    const msg = "\"" + TAB_MY_LIST + "\" tab not found. Run First-Time Setup first.";
    if (!isHeadless) SpreadsheetApp.getUi().alert(msg);
    appendLog("Sync", 0, 0, 0, 0, "ERROR", msg);
    return null;
  }

  // ── Fetch live Matrix data ─────────────────────────────────────────────────
  let vinMap, rawRows;
  try {
    ({ vinMap, rawRows } = fetchMatrixData());
  } catch (e) {
    if (!isHeadless) SpreadsheetApp.getUi().alert("Error fetching Matrix data:\n\n" + e.message);
    appendLog("Sync", 0, 0, 0, 0, "ERROR", e.message);
    return null;
  }

  const now    = new Date();
  const tz     = ss.getSpreadsheetTimeZone();
  const myData = mySheet.getDataRange().getValues();

  // ── Step 1: Delete MM rows no longer in Matrix feed ───────────────────────
  const removedVins = [];
  for (let i = myData.length - 1; i >= 1; i--) {
    const loc = myData[i][COL_LOCATION] ? myData[i][COL_LOCATION].toString().trim().toUpperCase() : "";
    const vin = myData[i][COL_VIN]      ? myData[i][COL_VIN].toString().trim().toLowerCase()      : "";
    if (loc === "MM" && vin !== "" && !vinMap[vin]) {
      mySheet.deleteRow(i + 1);
      removedVins.push(vin.toUpperCase());
    }
  }

  // ── Step 2: Update existing MM rows ───────────────────────────────────────
  const currentData      = mySheet.getDataRange().getValues();
  const currentVinSet    = {}; // vin → sheet row (1-indexed)
  const priceChangedVins = [];
  const dataUpdateQueue  = [];
  const priceChangedRows = [];

  for (let i = 1; i < currentData.length; i++) {
    const loc = currentData[i][COL_LOCATION] ? currentData[i][COL_LOCATION].toString().trim().toUpperCase() : "";
    const vin = currentData[i][COL_VIN]      ? currentData[i][COL_VIN].toString().trim().toLowerCase()      : "";
    if (vin !== "") currentVinSet[vin] = i + 1;

    if (loc !== "MM" || vin === "" || !vinMap[vin]) continue;

    const oldPriceRaw = currentData[i][COL_PRICE];
    const oldPrice    = typeof oldPriceRaw === "number" ? oldPriceRaw : parseFloat(oldPriceRaw);
    const newPriceRaw = vinMap[vin].price;
    const newPrice    = typeof newPriceRaw === "number" ? newPriceRaw : parseFloat(newPriceRaw);
    const changed     = !isNaN(oldPrice) && !isNaN(newPrice) && oldPrice !== newPrice;

    if (changed) {
      priceChangedVins.push(vin);
      priceChangedRows.push(i + 1);
    }

    dataUpdateQueue.push({
      rowNum: i + 1,
      values: [
        vinMap[vin].vin,                                          // B
        vinMap[vin].col3,                                         // C
        vinMap[vin].col4,                                         // D
        vinMap[vin].col5,                                         // E
        newPriceRaw,                                              // F
        changed ? oldPrice : currentData[i][COL_PREV_PRICE],     // G
      ],
    });
  }

  // Batch-write data updates (cols B–G, H=Notes is skipped)
  dataUpdateQueue.forEach(u => {
    mySheet.getRange(u.rowNum, 2, 1, 6).setValues([u.values]);
  });

  // Write Price Changed timestamps (col I) for rows with a price change
  if (priceChangedRows.length > 0) {
    const ts = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm");
    priceChangedRows.forEach(rowNum => {
      mySheet.getRange(rowNum, COL_PRICE_CHANGED + 1).setValue(ts);
    });
  }

  // ── Step 3: Append new VINs (batch) ───────────────────────────────────────
  const newVins = [];
  const newRows = [];

  rawRows.forEach(row => {
    const sVin = row[1] ? row[1].toString().trim().toLowerCase() : "";
    if (sVin === "" || currentVinSet[sVin]) return;
    newRows.push([
      "MM", row[1], row[2], row[3], row[4], row[5], "", "", ""
      //  A     B     C      D      E      F      G    H    I
    ]);
    newVins.push(sVin);
  });

  if (newRows.length > 0) {
    const lastRow = mySheet.getLastRow();
    mySheet.getRange(lastRow + 1, 1, newRows.length, TOTAL_COLS).setValues(newRows);
  }

  // ── Step 4: Format ─────────────────────────────────────────────────────────
  const lastRow = mySheet.getLastRow();
  if (lastRow > 1) {
    const dataRows  = lastRow - 1;
    const dataRange = mySheet.getRange(2, 1, dataRows, TOTAL_COLS);

    // Sort by Price Changed (col I) descending — most recent at top
    dataRange.sort({ column: COL_PRICE_CHANGED + 1, ascending: false });

    dataRange.setFontFamily("Arial").setFontSize(12);
    mySheet.getRange(2, COL_LOCATION + 1,      dataRows, 1).setFontWeight("bold").setHorizontalAlignment("center");
    mySheet.getRange(2, COL_VIN + 1,           dataRows, 3).setHorizontalAlignment("left");
    mySheet.getRange(2, COL_MILEAGE + 1,       dataRows, 1).setNumberFormat("#,##0").setHorizontalAlignment("left");
    mySheet.getRange(2, COL_PRICE + 1,         dataRows, 2).setNumberFormat("$#,##0.00");
    mySheet.getRange(2, COL_PRICE_CHANGED + 1, dataRows, 1).setNumberFormat("yyyy-MM-dd HH:mm").setHorizontalAlignment("center");
    dataRange.setBackground(null);
  }

  // ── Step 5: Highlight changed rows (re-read after sort) ───────────────────
  if (newVins.length > 0 || priceChangedVins.length > 0) {
    const finalData      = mySheet.getDataRange().getValues();
    const newVinSet      = {};
    const changedVinSet  = {};
    newVins.forEach(v          => newVinSet[v]     = true);
    priceChangedVins.forEach(v => changedVinSet[v] = true);

    const cyanRanges   = [];
    const yellowRanges = [];

    for (let i = 1; i < finalData.length; i++) {
      const loc = finalData[i][COL_LOCATION] ? finalData[i][COL_LOCATION].toString().trim().toUpperCase() : "";
      const vin = finalData[i][COL_VIN]      ? finalData[i][COL_VIN].toString().trim().toLowerCase()      : "";
      if (loc !== "MM" || vin === "") continue;

      if (newVinSet[vin])     cyanRanges.push("A" + (i + 1) + ":I" + (i + 1));
      else if (changedVinSet[vin]) yellowRanges.push("A" + (i + 1) + ":I" + (i + 1));
    }

    if (cyanRanges.length > 0)   mySheet.getRangeList(cyanRanges).setBackground("#00FFFF");
    if (yellowRanges.length > 0) mySheet.getRangeList(yellowRanges).setBackground("#FFFF00");
  }

  // ── Step 6: Record sync time in Settings ──────────────────────────────────
  const timestamp     = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
  const resultSummary =
    newVins.length + " new, " +
    dataUpdateQueue.length + " updated, " +
    removedVins.length + " removed, " +
    priceChangedVins.length + " price changes";

  writeSetting(SET_LAST_SYNCED,      timestamp);
  writeSetting(SET_LAST_SYNC_RESULT, resultSummary);
  appendLog("Sync", newVins.length, dataUpdateQueue.length, removedVins.length, priceChangedVins.length, "OK", "");

  return {
    newVins,
    updatedCount:     dataUpdateQueue.length,
    removedVins,
    priceChangedVins,
    timestamp,
  };
}


// =============================================================================
// SYNC — UI ENTRY POINT
// =============================================================================

function syncNow() {
  const result = performSync(false);
  if (!result) return;

  let msg = "Sync Complete! (" + result.timestamp + ")";
  if (result.newVins.length > 0)
    msg += "\n\n🆕 " + result.newVins.length + " new unit(s) — highlighted in cyan";
  if (result.priceChangedVins.length > 0)
    msg += "\n💰 " + result.priceChangedVins.length + " price change(s) — highlighted in yellow, timestamp in col I";
  if (result.removedVins.length > 0)
    msg += "\n🗑 " + result.removedVins.length + " unit(s) removed from Matrix feed";
  if (result.updatedCount > 0)
    msg += "\n✏️  " + result.updatedCount + " existing unit(s) refreshed";
  if (result.newVins.length === 0 && result.priceChangedVins.length === 0 &&
      result.removedVins.length === 0 && result.updatedCount === 0)
    msg += "\n\nNo changes — your list is already up to date.";

  SpreadsheetApp.getUi().alert(msg);
}


// =============================================================================
// SYNC — HEADLESS ENTRY POINT (trigger-safe, no UI calls)
// =============================================================================

function syncNowHeadless() {
  performSync(true);
}


// =============================================================================
// TRIGGER SETUP
// =============================================================================

function setupNotificationTrigger() {
  const ui       = SpreadsheetApp.getUi();
  const settings = getSettings();
  const hours    = parseInt(settings[SET_INTERVAL_HOURS], 10) || 1;

  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "autoCheckForChanges") ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("autoCheckForChanges").timeBased().everyHours(hours).create();

  ui.alert(
    "Auto-Notifications Activated!\n\n" +
    "Checking every " + hours + " hour(s).\n" +
    "Notifications will be sent to: " + (settings[SET_EMAILS] || "(not configured)")
  );
}


// =============================================================================
// AUTO CHECK — HEADLESS (runs from time-based trigger)
// =============================================================================

function autoCheckForChanges() {
  const props = PropertiesService.getScriptProperties();

  // Fetch current Matrix data
  let vinMap, rawRows;
  try {
    ({ vinMap, rawRows } = fetchMatrixData());
  } catch (e) {
    appendLog("Auto-Check", 0, 0, 0, 0, "ERROR", e.message);
    return;
  }

  // Build current state
  const currentState = {};
  rawRows.forEach(row => {
    const vin = row[1] ? row[1].toString().trim().toLowerCase() : "";
    if (!vin) return;
    currentState[vin] = {
      vin:         row[1],
      description: ((row[2] || "") + " " + (row[3] || "")).trim(),
      mileage:     row[4],
      price:       row[5],
    };
  });

  // Compare against saved snapshot
  const newVehicles     = [];
  const priceChanges    = [];
  const removedVehicles = [];

  let previousState = null;
  const rawPrev = props.getProperty(PROP_STATE);
  if (rawPrev) {
    try { previousState = JSON.parse(rawPrev); } catch (_) {}
  }

  if (previousState) {
    Object.keys(currentState).forEach(vin => {
      if (!previousState[vin]) {
        newVehicles.push(currentState[vin]);
      } else {
        const oldP = parseFloat(previousState[vin].price);
        const newP = parseFloat(currentState[vin].price);
        if (!isNaN(oldP) && !isNaN(newP) && oldP !== newP) {
          priceChanges.push({ vehicle: currentState[vin], oldPrice: oldP, newPrice: newP, delta: newP - oldP });
        }
      }
    });
    Object.keys(previousState).forEach(vin => {
      if (!currentState[vin]) removedVehicles.push(previousState[vin]);
    });
  }

  // Save compact snapshot (VIN → price) to stay under 9KB property limit
  const snapshot = {};
  Object.keys(currentState).forEach(vin => { snapshot[vin] = { price: currentState[vin].price }; });
  try {
    props.setProperty(PROP_STATE, JSON.stringify(snapshot));
  } catch (_) {
    const tiny = {};
    Object.keys(currentState).forEach(vin => { tiny[vin] = currentState[vin].price; });
    try { props.setProperty(PROP_STATE, JSON.stringify(tiny)); } catch (_) {}
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
  const settings = getSettings();
  const emailStr = settings[SET_EMAILS];

  if (!emailStr) {
    appendLog("Email", 0, 0, 0, 0, "SKIPPED", "No email addresses configured in Settings");
    return;
  }

  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MMMM dd, yyyy 'at' HH:mm");

  const parts = [];
  if (newVehicles.length > 0)     parts.push(newVehicles.length + " new");
  if (priceChanges.length > 0)    parts.push(priceChanges.length + " price change" + (priceChanges.length > 1 ? "s" : ""));
  if (removedVehicles.length > 0) parts.push(removedVehicles.length + " removed");

  const subject = "Matrix Inventory Update — " + now +
    (parts.length > 0 ? " (" + parts.join(", ") + ")" : "");

  let body = "Matrix Inventory Changes — " + now + "\n" + "=".repeat(50) + "\n\n";

  if (newVehicles.length > 0) {
    body += "NEW VEHICLES (" + newVehicles.length + ")\n" + "-".repeat(40) + "\n";
    newVehicles.forEach(v => {
      body += "Vehicle  : " + v.description + "\n";
      body += "VIN      : " + v.vin + "\n";
      body += "Mileage  : " + formatNumber(v.mileage) + " km\n";
      body += "Price    : " + formatCurrency(v.price) + "\n\n";
    });
  }

  if (priceChanges.length > 0) {
    body += "PRICE CHANGES (" + priceChanges.length + ")\n" + "-".repeat(40) + "\n";
    priceChanges.forEach(c => {
      const dir    = c.delta > 0 ? "▲ UP" : "▼ DOWN";
      const pct    = c.oldPrice > 0
        ? " (" + Math.abs(Math.round((c.delta / c.oldPrice) * 1000) / 10) + "%)" : "";
      body += "Vehicle  : " + c.vehicle.description + "\n";
      body += "VIN      : " + c.vehicle.vin + "\n";
      body += "Mileage  : " + formatNumber(c.vehicle.mileage) + " km\n";
      body += "Change   : " + dir + " " + formatCurrency(Math.abs(c.delta)) + pct + "\n";
      body += "Old Price: " + formatCurrency(c.oldPrice) + "\n";
      body += "New Price: " + formatCurrency(c.newPrice) + "\n\n";
    });
  }

  if (removedVehicles.length > 0) {
    body += "REMOVED FROM FEED (" + removedVehicles.length + ")\n";
    body += "(These have been removed from your My List)\n" + "-".repeat(40) + "\n";
    removedVehicles.forEach(v => {
      body += "Vehicle  : " + (v.description || "").trim() + "\n";
      body += "VIN      : " + v.vin + "\n\n";
    });
  }

  body += "=".repeat(50) + "\n";
  body += "View spreadsheet: " + ss.getUrl() + "\n";

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
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName(TAB_LOG);
    if (!logSheet) return;
    const ts = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
    logSheet.appendRow([ts, trigger, newUnits, updated, removed, priceChanges, result, notes || ""]);
  } catch (_) {}
}


// =============================================================================
// FORMAT HELPERS
// =============================================================================

function formatCurrency(value) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(n)) return String(value);
  return "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(n)) return String(value);
  return n.toLocaleString("en-CA");
}
