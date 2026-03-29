// =============================================================================
// MATRIX INVENTORY SYNC — v2.0
// =============================================================================
// Setup instructions:
//   1. Paste this entire file into your Google Apps Script editor.
//   2. From the spreadsheet menu, run: Inventory Sync > ⚙ First-Time Setup
//      This creates a "Settings" tab and a "Sync Log" tab automatically.
//   3. Fill in your settings in the "Settings" tab (source URL, email, etc.).
//   4. Run: Inventory Sync > ⚙ Setup Auto-Notifications to activate the trigger.
//
// Required tabs in your spreadsheet:
//   - "My List"    — your working inventory
//   - "Source List" — auto-managed by Import step (do not edit manually)
//   - "Settings"   — created by First-Time Setup
//   - "Sync Log"   — created by First-Time Setup
// =============================================================================


// ─── TAB NAME CONSTANTS ───────────────────────────────────────────────────────
const TAB_MY_LIST     = "My List";
const TAB_SOURCE      = "Source List";
const TAB_SETTINGS    = "Settings";
const TAB_LOG         = "Sync Log";

// Settings row keys (must match column A of the Settings tab exactly)
const SET_SOURCE_URL       = "SOURCE_SHEET_URL";
const SET_SOURCE_TAB       = "SOURCE_TAB_NAME";
const SET_EMAILS           = "NOTIFICATION_EMAILS";
const SET_INTERVAL_HOURS   = "CHECK_INTERVAL_HOURS";
const SET_LAST_SYNCED      = "LAST_SYNCED";
const SET_LAST_SYNC_RESULT = "LAST_SYNC_RESULT";

// Script property key for inventory state snapshot
const PROP_STATE = "MATRIX_INVENTORY_STATE_V2";


// =============================================================================
// MENU
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Inventory Sync")
    .addItem("1. Import Matrix Units",  "importMatrixUnits")
    .addItem("2. Sync My List",         "syncMatrixInventoryUI")
    .addSeparator()
    .addItem("▶ Run Full Sync",         "masterSync")
    .addSeparator()
    .addItem("⚙ First-Time Setup",      "firstTimeSetup")
    .addItem("⚙ Setup Auto-Notifications", "setupNotificationTrigger")
    .addToUi();
}


// =============================================================================
// SETTINGS HELPERS
// =============================================================================

/**
 * Read all settings from the Settings tab into a plain object.
 * Returns defaults if the Settings tab doesn't exist or a key is missing.
 */
function getSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TAB_SETTINGS);

  const defaults = {
    [SET_SOURCE_URL]:     "",
    [SET_SOURCE_TAB]:     "Sheet1",
    [SET_EMAILS]:         "",
    [SET_INTERVAL_HOURS]: "1",
  };

  if (!sheet) return defaults;

  const data = sheet.getDataRange().getValues();
  const settings = Object.assign({}, defaults);

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0] ? data[i][0].toString().trim() : "";
    const val = data[i][1] !== undefined && data[i][1] !== null
      ? data[i][1].toString().trim()
      : "";
    if (key) settings[key] = val;
  }

  return settings;
}

/**
 * Write a single setting value back to the Settings tab.
 */
function writeSetting(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TAB_SETTINGS);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  // Key not found — append it
  sheet.appendRow([key, value, "Auto-written by script"]);
}


// =============================================================================
// FIRST-TIME SETUP
// =============================================================================

/**
 * Creates the Settings and Sync Log tabs if they don't exist.
 * Safe to re-run — will not overwrite existing data.
 */
function firstTimeSetup() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const ui  = SpreadsheetApp.getUi();
  let created = [];

  // ── Settings tab ──────────────────────────────────────────────────────────
  if (!ss.getSheetByName(TAB_SETTINGS)) {
    const s = ss.insertSheet(TAB_SETTINGS);
    s.getRange("A1:C1").setValues([["Setting", "Value", "Notes"]]);
    s.getRange("A1:C1").setFontWeight("bold");

    const rows = [
      [SET_SOURCE_URL,     "",    "Full URL of the shared Matrix spreadsheet"],
      [SET_SOURCE_TAB,     "Sheet1", "Tab name inside the shared spreadsheet"],
      [SET_EMAILS,         "",    "Comma-separated email addresses for notifications"],
      [SET_INTERVAL_HOURS, "1",   "How often the auto-check runs (hours). Re-run Setup Auto-Notifications to apply."],
      [SET_LAST_SYNCED,    "",    "Auto-written by script — do not edit"],
      [SET_LAST_SYNC_RESULT, "", "Auto-written by script — do not edit"],
    ];
    s.getRange(2, 1, rows.length, 3).setValues(rows);
    s.setColumnWidth(1, 200);
    s.setColumnWidth(2, 350);
    s.setColumnWidth(3, 380);
    created.push(TAB_SETTINGS);
  }

  // ── Sync Log tab ──────────────────────────────────────────────────────────
  if (!ss.getSheetByName(TAB_LOG)) {
    const l = ss.insertSheet(TAB_LOG);
    const headers = [
      "Timestamp", "Trigger", "Imported", "New Units",
      "Updated", "Removed", "Price Changes", "Result", "Notes"
    ];
    l.getRange(1, 1, 1, headers.length).setValues([headers]);
    l.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    l.setFrozenRows(1);
    created.push(TAB_LOG);
  }

  // ── Source List tab ───────────────────────────────────────────────────────
  if (!ss.getSheetByName(TAB_SOURCE)) {
    ss.insertSheet(TAB_SOURCE);
    created.push(TAB_SOURCE);
  }

  // ── My List tab ───────────────────────────────────────────────────────────
  if (!ss.getSheetByName(TAB_MY_LIST)) {
    const m = ss.insertSheet(TAB_MY_LIST);
    const headers = ["Location", "VIN", "Year/Make", "Model", "Mileage", "Price", "Prev Price", "Notes"];
    m.getRange(1, 1, 1, headers.length).setValues([headers]);
    m.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    m.setFrozenRows(1);
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
// IMPORT MATRIX UNITS
// =============================================================================

/**
 * Pulls rows from the shared Matrix spreadsheet where dealer column = "matrix".
 * Validates column headers, backs up the existing Source List before overwriting,
 * and logs the result.
 */
function importMatrixUnits() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const ui       = SpreadsheetApp.getUi();
  const settings = getSettings();

  const sourceUrl = settings[SET_SOURCE_URL];
  const sourceTab = settings[SET_SOURCE_TAB];

  if (!sourceUrl) {
    ui.alert(
      "Missing Configuration",
      "Please fill in SOURCE_SHEET_URL in the \"" + TAB_SETTINGS + "\" tab first.",
      ui.ButtonSet.OK
    );
    return { success: false, count: 0 };
  }

  const sourceSheet = ss.getSheetByName(TAB_SOURCE);
  if (!sourceSheet) {
    ui.alert("Error: \"" + TAB_SOURCE + "\" tab not found. Run First-Time Setup first.");
    return { success: false, count: 0 };
  }

  let sharedSheet;
  try {
    const sharedSS = SpreadsheetApp.openByUrl(sourceUrl);
    sharedSheet = sharedSS.getSheetByName(sourceTab);
    if (!sharedSheet) {
      ui.alert("Error: Cannot find tab \"" + sourceTab + "\" in the shared spreadsheet.");
      return { success: false, count: 0 };
    }
  } catch (e) {
    ui.alert("Error opening shared spreadsheet:\n" + e.message +
      "\n\nCheck that the URL in Settings is correct and you have access.");
    return { success: false, count: 0 };
  }

  const allData = sharedSheet.getDataRange().getValues();
  if (allData.length < 1) {
    ui.alert("The shared sheet appears to be empty.");
    return { success: false, count: 0 };
  }

  const header = allData[0];

  // ── Backup existing Source List before clearing ────────────────────────────
  const existingData = sourceSheet.getDataRange().getValues();

  // ── Filter for Matrix rows ─────────────────────────────────────────────────
  const matrixRows  = [];
  const seenVins    = {};
  const dupVins     = [];

  for (let i = 1; i < allData.length; i++) {
    const dealer = allData[i][0] ? allData[i][0].toString().trim().toLowerCase() : "";
    if (dealer !== "matrix") continue;

    const vin = allData[i][1] ? allData[i][1].toString().trim().toLowerCase() : "";
    if (vin === "") continue;

    if (seenVins[vin]) {
      dupVins.push(vin.toUpperCase());
      continue; // Skip duplicates — keep first occurrence
    }
    seenVins[vin] = true;
    matrixRows.push(allData[i]);
  }

  // ── Write to Source List ───────────────────────────────────────────────────
  try {
    sourceSheet.clearContents();

    const writeData = [header].concat(matrixRows);
    sourceSheet.getRange(1, 1, writeData.length, header.length).setValues(writeData);

  } catch (writeErr) {
    // Restore backup on failure
    try {
      sourceSheet.clearContents();
      if (existingData.length > 0) {
        sourceSheet.getRange(1, 1, existingData.length, existingData[0].length)
          .setValues(existingData);
      }
    } catch (_) {}
    ui.alert("Write failed — Source List has been restored to its previous state.\n\nError: " + writeErr.message);
    return { success: false, count: 0 };
  }

  let notes = "";
  if (dupVins.length > 0) {
    notes = "Duplicate VINs skipped (kept first): " + dupVins.join(", ");
  }

  appendLog("Import", matrixRows.length, 0, 0, 0, 0, "OK", notes);

  return { success: true, count: matrixRows.length, duplicates: dupVins };
}


// =============================================================================
// SYNC — SHARED CORE LOGIC
// =============================================================================

/**
 * Core sync logic. Works in both UI and headless (trigger) contexts.
 * @param {boolean} isHeadless - If true, skip all ui.alert calls.
 * @returns {object} Summary of what changed.
 */
function syncCore(isHeadless) {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const mySheet     = ss.getSheetByName(TAB_MY_LIST);
  const sourceSheet = ss.getSheetByName(TAB_SOURCE);

  if (!mySheet || !sourceSheet) {
    const msg = "Error: \"" + TAB_MY_LIST + "\" or \"" + TAB_SOURCE + "\" tab not found.";
    if (!isHeadless) SpreadsheetApp.getUi().alert(msg);
    appendLog("Sync", 0, 0, 0, 0, 0, "ERROR", msg);
    return null;
  }

  const sourceData = sourceSheet.getDataRange().getValues();
  const myData     = mySheet.getDataRange().getValues();

  // ── Build source VIN map ───────────────────────────────────────────────────
  const sourceVinMap = {};
  for (let i = 1; i < sourceData.length; i++) {
    const vin = sourceData[i][1] ? sourceData[i][1].toString().trim().toLowerCase() : "";
    if (vin === "") continue;
    sourceVinMap[vin] = {
      vin:   sourceData[i][1],
      col3:  sourceData[i][2],
      col4:  sourceData[i][3],
      col5:  sourceData[i][4],
      price: sourceData[i][5],
    };
  }

  // ── Step 1: Collect rows to delete (MM rows not in source) ────────────────
  const rowsToDelete = [];
  const removedVins  = [];

  for (let i = myData.length - 1; i >= 1; i--) {
    const loc = myData[i][0] ? myData[i][0].toString().trim().toUpperCase() : "";
    const vin = myData[i][1] ? myData[i][1].toString().trim().toLowerCase() : "";
    if (loc === "MM" && vin !== "" && !sourceVinMap[vin]) {
      rowsToDelete.push(i + 1); // 1-indexed sheet row
      removedVins.push(vin.toUpperCase());
    }
  }

  // Delete rows (already in reverse order since we iterated backward)
  rowsToDelete.forEach(rowNum => mySheet.deleteRow(rowNum));

  // ── Step 2: Re-read after deletions, then batch-update existing MM rows ───
  const currentData = mySheet.getDataRange().getValues();
  const newVins          = [];
  const priceChangedVins = [];
  const updateQueue      = []; // { rowNum, values, oldPrice, newPrice, vin }

  const currentVinSet = {};
  for (let i = 1; i < currentData.length; i++) {
    const loc = currentData[i][0] ? currentData[i][0].toString().trim().toUpperCase() : "";
    const vin = currentData[i][1] ? currentData[i][1].toString().trim().toLowerCase() : "";
    if (vin !== "") currentVinSet[vin] = i + 1; // track sheet row

    if (loc !== "MM" || vin === "" || !sourceVinMap[vin]) continue;

    const oldPrice    = currentData[i][5];
    const oldPriceNum = typeof oldPrice === "number" ? oldPrice : parseFloat(oldPrice);
    const newPrice    = sourceVinMap[vin].price;
    const newPriceNum = typeof newPrice === "number" ? newPrice : parseFloat(newPrice);

    const priceChanged = !isNaN(oldPriceNum) && !isNaN(newPriceNum) && oldPriceNum !== newPriceNum;
    if (priceChanged) priceChangedVins.push(vin);

    updateQueue.push({
      rowNum:    i + 1,
      vin:       vin,
      oldPrice:  oldPriceNum,
      newPrice:  newPriceNum,
      // Columns B–G: vin, col3, col4, col5, price, prevPrice
      values: [
        sourceVinMap[vin].vin,
        sourceVinMap[vin].col3,
        sourceVinMap[vin].col4,
        sourceVinMap[vin].col5,
        newPrice,
        priceChanged ? oldPriceNum : currentData[i][6], // preserve prev price if unchanged
      ],
    });
  }

  // Batch-write all updates (columns B–G = cols 2–7, 6 columns)
  updateQueue.forEach(u => {
    mySheet.getRange(u.rowNum, 2, 1, 6).setValues([u.values]);
  });

  // ── Step 3: Append new VINs (batch) ───────────────────────────────────────
  const newRows = [];
  for (let i = 1; i < sourceData.length; i++) {
    const sVin = sourceData[i][1] ? sourceData[i][1].toString().trim().toLowerCase() : "";
    if (sVin === "" || currentVinSet[sVin]) continue;
    newRows.push([
      "MM",
      sourceData[i][1],
      sourceData[i][2],
      sourceData[i][3],
      sourceData[i][4],
      sourceData[i][5],
      "",  // Prev Price — empty on first add
      "",  // Notes
    ]);
    newVins.push(sVin);
  }

  if (newRows.length > 0) {
    const lastRowBefore = mySheet.getLastRow();
    mySheet.getRange(lastRowBefore + 1, 1, newRows.length, 8).setValues(newRows);
  }

  // ── Step 4: Formatting (single range reads, batched formatting) ────────────
  const lastRow = mySheet.getLastRow();
  const lastCol = 8;

  if (lastRow > 1) {
    const dataRange = mySheet.getRange(2, 1, lastRow - 1, lastCol);
    dataRange.sort({ column: 1, ascending: true });
    dataRange.setFontFamily("Arial").setFontSize(12);
    mySheet.getRange(2, 1, lastRow - 1, 1).setFontWeight("bold").setHorizontalAlignment("center");
    mySheet.getRange(2, 2, lastRow - 1, 3).setHorizontalAlignment("left");
    mySheet.getRange(2, 5, lastRow - 1, 1).setNumberFormat("#,##0").setHorizontalAlignment("left");
    mySheet.getRange(2, 6, lastRow - 1, 2).setNumberFormat("$#,##0.00"); // price + prev price
    mySheet.getRange(2, 1, lastRow - 1, lastCol).setBackground(null);
  }

  // ── Step 5: Batch highlighting ─────────────────────────────────────────────
  if (newVins.length > 0 || priceChangedVins.length > 0) {
    const finalData = mySheet.getDataRange().getValues();
    const newVinSet          = {};
    const priceChangedVinSet = {};
    newVins.forEach(v          => newVinSet[v]          = true);
    priceChangedVins.forEach(v => priceChangedVinSet[v] = true);

    const cyanRanges   = [];
    const yellowRanges = [];

    for (let i = 1; i < finalData.length; i++) {
      const loc = finalData[i][0] ? finalData[i][0].toString().trim().toUpperCase() : "";
      const vin = finalData[i][1] ? finalData[i][1].toString().trim().toLowerCase() : "";
      if (loc !== "MM" || vin === "") continue;

      if (newVinSet[vin]) {
        cyanRanges.push(i + 1);
      } else if (priceChangedVinSet[vin]) {
        yellowRanges.push(i + 1);
      }
    }

    // Apply highlights using RangeList for efficiency
    if (cyanRanges.length > 0) {
      const rl = mySheet.getRangeList(cyanRanges.map(r => `A${r}:H${r}`));
      rl.setBackground("#00FFFF");
    }
    if (yellowRanges.length > 0) {
      const rl = mySheet.getRangeList(yellowRanges.map(r => `A${r}:H${r}`));
      rl.setBackground("#FFFF00");
    }
  }

  // ── Step 6: Write last synced timestamp ───────────────────────────────────
  const now        = new Date();
  const timestamp  = Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const resultSummary =
    newVins.length + " new, " +
    updateQueue.length + " updated, " +
    removedVins.length + " removed, " +
    priceChangedVins.length + " price changes";

  writeSetting(SET_LAST_SYNCED,      timestamp);
  writeSetting(SET_LAST_SYNC_RESULT, resultSummary);

  appendLog(
    "Sync",
    sourceData.length - 1,
    newVins.length,
    updateQueue.length,
    removedVins.length,
    priceChangedVins.length,
    "OK",
    ""
  );

  return {
    newVins:          newVins,
    updatedCount:     updateQueue.length,
    removedVins:      removedVins,
    priceChangedVins: priceChangedVins,
    timestamp:        timestamp,
  };
}


// =============================================================================
// SYNC — UI ENTRY POINT (called from menu)
// =============================================================================

function syncMatrixInventoryUI() {
  const ui     = SpreadsheetApp.getUi();
  const result = syncCore(false);
  if (!result) return;

  let msg = "Sync Complete! (" + result.timestamp + ")";
  if (result.newVins.length > 0)          msg += "\n\n🆕 " + result.newVins.length          + " new unit(s) — highlighted in cyan";
  if (result.priceChangedVins.length > 0) msg += "\n💰 " + result.priceChangedVins.length + " price change(s) — highlighted in yellow";
  if (result.removedVins.length > 0)      msg += "\n🗑 "  + result.removedVins.length       + " unit(s) removed from Matrix feed";
  if (result.updatedCount > 0)            msg += "\n✏️  " + result.updatedCount             + " existing unit(s) refreshed";

  ui.alert(msg);
}


// =============================================================================
// SYNC — HEADLESS ENTRY POINT (called from trigger, no UI)
// =============================================================================

function syncMatrixInventoryHeadless() {
  syncCore(true);
}


// =============================================================================
// MASTER SYNC (UI — runs import then sync)
// =============================================================================

function masterSync() {
  const ui     = SpreadsheetApp.getUi();
  const imp    = importMatrixUnits();

  if (!imp.success) return; // importMatrixUnits already showed an error

  SpreadsheetApp.flush();

  const result = syncCore(false);
  if (!result) return;

  let msg = "Full Sync Complete! (" + result.timestamp + ")";
  msg += "\n\n📥 " + imp.count + " unit(s) imported from Matrix feed";
  if (imp.duplicates && imp.duplicates.length > 0)
    msg += "\n⚠️  " + imp.duplicates.length + " duplicate VIN(s) in source were skipped";
  if (result.newVins.length > 0)          msg += "\n🆕 " + result.newVins.length          + " new unit(s)";
  if (result.priceChangedVins.length > 0) msg += "\n💰 " + result.priceChangedVins.length + " price change(s)";
  if (result.removedVins.length > 0)      msg += "\n🗑 "  + result.removedVins.length       + " unit(s) removed";
  if (result.updatedCount > 0)            msg += "\n✏️  " + result.updatedCount             + " unit(s) refreshed";

  ui.alert(msg);
}


// =============================================================================
// AUTO NOTIFICATIONS — TRIGGER SETUP
// =============================================================================

function setupNotificationTrigger() {
  const ui       = SpreadsheetApp.getUi();
  const settings = getSettings();
  const hours    = parseInt(settings[SET_INTERVAL_HOURS], 10) || 1;

  // Remove any existing autoCheckForChanges triggers
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "autoCheckForChanges") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("autoCheckForChanges")
    .timeBased()
    .everyHours(hours)
    .create();

  const emails = settings[SET_EMAILS] || "(not configured)";
  ui.alert(
    "Auto-Notifications Activated!\n\n" +
    "Checking every " + hours + " hour(s).\n" +
    "Notifications will be sent to: " + emails
  );
}


// =============================================================================
// AUTO CHECK — HEADLESS (runs from time trigger)
// =============================================================================

/**
 * Called automatically by the time-based trigger.
 * Fully headless — no UI calls anywhere in the call chain.
 */
function autoCheckForChanges() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  // Import fresh data from the shared sheet (headless — errors go to log only)
  let importOk = false;
  try {
    const imp = importMatrixUnitsHeadless();
    importOk  = imp.success;
  } catch (e) {
    appendLog("Auto-Import", 0, 0, 0, 0, 0, "ERROR", e.message);
    return;
  }

  if (!importOk) {
    appendLog("Auto-Import", 0, 0, 0, 0, 0, "ERROR", "Import returned failure");
    return;
  }

  SpreadsheetApp.flush();

  // Build current state snapshot (VIN → { price })
  const sourceSheet = ss.getSheetByName(TAB_SOURCE);
  if (!sourceSheet) return;

  const sourceData   = sourceSheet.getDataRange().getValues();
  const currentState = {};

  for (let i = 1; i < sourceData.length; i++) {
    const vin = sourceData[i][1] ? sourceData[i][1].toString().trim().toLowerCase() : "";
    if (vin === "") continue;
    currentState[vin] = {
      vin:         sourceData[i][1],
      description: (sourceData[i][2] || "") + " " + (sourceData[i][3] || ""),
      mileage:     sourceData[i][4],
      price:       sourceData[i][5],
    };
  }

  // Compare against previous snapshot
  const newVehicles   = [];
  const priceChanges  = [];
  const removedVehicles = [];
  let   previousState = null;

  const rawPrev = props.getProperty(PROP_STATE);
  if (rawPrev) {
    try {
      previousState = JSON.parse(rawPrev);
    } catch (_) {
      previousState = null;
    }
  }

  if (previousState) {
    // Detect new and price-changed
    Object.keys(currentState).forEach(vin => {
      if (!previousState[vin]) {
        newVehicles.push(currentState[vin]);
      } else {
        const oldP = parseFloat(previousState[vin].price);
        const newP = parseFloat(currentState[vin].price);
        if (!isNaN(oldP) && !isNaN(newP) && oldP !== newP) {
          priceChanges.push({
            vehicle:  currentState[vin],
            oldPrice: oldP,
            newPrice: newP,
            delta:    newP - oldP,
          });
        }
      }
    });

    // Detect removed
    Object.keys(previousState).forEach(vin => {
      if (!currentState[vin]) {
        removedVehicles.push(previousState[vin]);
      }
    });
  }

  // Save new snapshot — store only VIN + price to stay under the 9KB property limit
  const compactState = {};
  Object.keys(currentState).forEach(vin => {
    compactState[vin] = { price: currentState[vin].price };
  });

  try {
    props.setProperty(PROP_STATE, JSON.stringify(compactState));
  } catch (e) {
    // State too large — trim further to just VIN keys with price as value
    const minState = {};
    Object.keys(currentState).forEach(vin => { minState[vin] = currentState[vin].price; });
    try { props.setProperty(PROP_STATE, JSON.stringify(minState)); } catch (_) {}
  }

  // If changes found: send email then sync the sheet
  if (newVehicles.length > 0 || priceChanges.length > 0 || removedVehicles.length > 0) {
    sendChangeNotification(newVehicles, priceChanges, removedVehicles);
    syncMatrixInventoryHeadless();
  } else {
    appendLog("Auto-Check", sourceData.length - 1, 0, 0, 0, 0, "No changes", "");
  }
}


// =============================================================================
// IMPORT — HEADLESS VERSION (no ui.alert calls)
// =============================================================================

function importMatrixUnitsHeadless() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getSettings();

  const sourceUrl = settings[SET_SOURCE_URL];
  const sourceTab = settings[SET_SOURCE_TAB];

  if (!sourceUrl) return { success: false, count: 0 };

  const sourceSheet = ss.getSheetByName(TAB_SOURCE);
  if (!sourceSheet) return { success: false, count: 0 };

  let sharedSheet;
  try {
    const sharedSS = SpreadsheetApp.openByUrl(sourceUrl);
    sharedSheet    = sharedSS.getSheetByName(sourceTab);
    if (!sharedSheet) return { success: false, count: 0 };
  } catch (e) {
    appendLog("Auto-Import", 0, 0, 0, 0, 0, "ERROR", "Cannot open shared sheet: " + e.message);
    return { success: false, count: 0 };
  }

  const allData  = sharedSheet.getDataRange().getValues();
  if (allData.length < 1) return { success: false, count: 0 };

  const header    = allData[0];
  const matrixRows = [];
  const seenVins   = {};

  for (let i = 1; i < allData.length; i++) {
    const dealer = allData[i][0] ? allData[i][0].toString().trim().toLowerCase() : "";
    if (dealer !== "matrix") continue;
    const vin = allData[i][1] ? allData[i][1].toString().trim().toLowerCase() : "";
    if (vin === "" || seenVins[vin]) continue;
    seenVins[vin] = true;
    matrixRows.push(allData[i]);
  }

  const backup = sourceSheet.getDataRange().getValues();

  try {
    sourceSheet.clearContents();
    const writeData = [header].concat(matrixRows);
    sourceSheet.getRange(1, 1, writeData.length, header.length).setValues(writeData);
  } catch (e) {
    // Restore on failure
    try {
      sourceSheet.clearContents();
      if (backup.length > 0)
        sourceSheet.getRange(1, 1, backup.length, backup[0].length).setValues(backup);
    } catch (_) {}
    appendLog("Auto-Import", 0, 0, 0, 0, 0, "ERROR", "Write failed: " + e.message);
    return { success: false, count: 0 };
  }

  return { success: true, count: matrixRows.length };
}


// =============================================================================
// EMAIL NOTIFICATION
// =============================================================================

/**
 * Sends a detailed change notification email to all configured recipients.
 * Includes new vehicles, price changes (with direction), and removed units.
 */
function sendChangeNotification(newVehicles, priceChanges, removedVehicles) {
  const settings = getSettings();
  const emailStr = settings[SET_EMAILS];

  if (!emailStr) {
    appendLog("Email", 0, 0, 0, 0, 0, "SKIPPED", "No email addresses configured in Settings");
    return;
  }

  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const sheetUrl = ss.getUrl();
  const now      = Utilities.formatDate(
    new Date(), ss.getSpreadsheetTimeZone(), "MMMM dd, yyyy 'at' HH:mm"
  );

  let subject = "Matrix Inventory Update — " + now;
  const parts = [];
  if (newVehicles.length > 0)    parts.push(newVehicles.length    + " new");
  if (priceChanges.length > 0)   parts.push(priceChanges.length   + " price change" + (priceChanges.length > 1 ? "s" : ""));
  if (removedVehicles.length > 0) parts.push(removedVehicles.length + " removed");
  if (parts.length > 0) subject += " (" + parts.join(", ") + ")";

  let body = "Matrix Inventory Changes — " + now + "\n";
  body += "=".repeat(50) + "\n\n";

  // ── New vehicles ─────────────────────────────────────────────────────────
  if (newVehicles.length > 0) {
    body += "NEW VEHICLES (" + newVehicles.length + ")\n";
    body += "-".repeat(40) + "\n";
    newVehicles.forEach(v => {
      body += "Vehicle  : " + v.description.trim() + "\n";
      body += "VIN      : " + v.vin + "\n";
      body += "Mileage  : " + formatNumber(v.mileage) + " km\n";
      body += "Price    : " + formatCurrency(v.price) + "\n\n";
    });
  }

  // ── Price changes ─────────────────────────────────────────────────────────
  if (priceChanges.length > 0) {
    body += "PRICE CHANGES (" + priceChanges.length + ")\n";
    body += "-".repeat(40) + "\n";
    priceChanges.forEach(c => {
      const direction = c.delta > 0 ? "▲ UP" : "▼ DOWN";
      const absDelta  = Math.abs(c.delta);
      const pct       = c.oldPrice > 0
        ? " (" + Math.abs(Math.round((c.delta / c.oldPrice) * 1000) / 10) + "%)"
        : "";

      body += "Vehicle  : " + c.vehicle.description.trim() + "\n";
      body += "VIN      : " + c.vehicle.vin + "\n";
      body += "Mileage  : " + formatNumber(c.vehicle.mileage) + " km\n";
      body += "Change   : " + direction + " " + formatCurrency(absDelta) + pct + "\n";
      body += "Old Price: " + formatCurrency(c.oldPrice) + "\n";
      body += "New Price: " + formatCurrency(c.newPrice) + "\n\n";
    });
  }

  // ── Removed vehicles ──────────────────────────────────────────────────────
  if (removedVehicles.length > 0) {
    body += "REMOVED FROM FEED (" + removedVehicles.length + ")\n";
    body += "(These have been deleted from your My List)\n";
    body += "-".repeat(40) + "\n";
    removedVehicles.forEach(v => {
      body += "Vehicle  : " + (v.description || "").trim() + "\n";
      body += "VIN      : " + v.vin + "\n\n";
    });
  }

  body += "=".repeat(50) + "\n";
  body += "View spreadsheet: " + sheetUrl + "\n";
  body += "This is an automated notification. Reply to this email if you have questions.\n";

  try {
    MailApp.sendEmail(emailStr, subject, body);
    appendLog(
      "Email",
      0,
      newVehicles.length,
      0,
      removedVehicles.length,
      priceChanges.length,
      "Sent",
      "To: " + emailStr
    );
  } catch (e) {
    appendLog("Email", 0, 0, 0, 0, 0, "ERROR", "Send failed: " + e.message);
  }
}


// =============================================================================
// SYNC LOG
// =============================================================================

/**
 * Appends a row to the Sync Log tab.
 * All parameters are optional — pass 0 or "" for unused fields.
 */
function appendLog(trigger, imported, newUnits, updated, removed, priceChanges, result, notes) {
  try {
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName(TAB_LOG);
    if (!logSheet) return;

    const ts = Utilities.formatDate(
      new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss"
    );

    logSheet.appendRow([
      ts, trigger, imported, newUnits, updated, removed, priceChanges, result, notes || ""
    ]);
  } catch (_) {
    // Logging must never crash the main flow
  }
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
