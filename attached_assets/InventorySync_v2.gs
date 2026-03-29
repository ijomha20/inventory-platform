===================================================================
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


// =============================================================================
// WEB APP BRIDGE (for Carfax automation script)
// Deploy this as a Web App so the local Node.js Carfax script can read
// VINs from and write results back to this spreadsheet without needing
// Google Cloud Console or any OAuth setup.
//
// How to deploy:
//   1. Click "Deploy" > "New deployment" in Apps Script.
//   2. Click the gear icon next to "Type" and choose "Web app".
//   3. Execute as: Me
//   4. Who has access: Anyone
//   5. Click Deploy. Copy the Web App URL into your .env file.
// =============================================================================

function doGet(e) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_MY_LIST);
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "My List tab not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data   = sheet.getDataRange().getValues();
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var vin    = data[i][COL_VIN]    ? data[i][COL_VIN].toString().trim()    : "";
    var carfax = data[i][COL_CARFAX] ? data[i][COL_CARFAX].toString().trim() : "";
    if (vin && vin.length > 5 && !carfax) {
      result.push({ rowIndex: i + 1, vin: vin });
    }
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName(TAB_MY_LIST);

  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "My List tab not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (!payload.rowIndex || !payload.value) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Missing rowIndex or value" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  sheet.getRange(payload.rowIndex, COL_CARFAX + 1).setValue(payload.value);

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
