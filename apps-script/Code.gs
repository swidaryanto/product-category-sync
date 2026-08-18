/**
 * Product Category Sync — Apps Script backend.
 *
 * Bound to the "Master Data Import Templates" spreadsheet. Compares the
 * "Product Category" tab against the "Cat Tree RM" tab (a separate
 * spreadsheet, maintained by Retail Ops) and can write missing rows.
 *
 * Setup: Extensions > Apps Script > paste this file's contents, plus
 * appsscript.json's manifest settings > Deploy > New deployment > Web app
 * (Execute as: Me, Access: Anyone) > authorize > copy the Web App URL into
 * docs/index.html.
 */

const CAT_TREE_SPREADSHEET_ID = "1AaY9aJL_rPQ9qmPCW9XG9jZufgHFjw0FUPOS-x1BBm8";
const CAT_TREE_SHEET_NAME = "Cat Tree RM";
const CATEGORY_LEVELS = 5; // Lv0..Lv4 are category nodes; Lv5 is SKU-level detail.

const PRODUCT_CATEGORY_SPREADSHEET_ID =
  "1WNGKMwUgqVNv1PBMjXMq02Effzs5x7-X0cXRPkPUHf4";
const PRODUCT_CATEGORY_SHEET_NAME = "Product Category";
const PRODUCT_CATEGORY_HEADER_ROW = 1;

const KEY_SEP = ""; // unlikely-to-appear separator for dedupe keys
const STATUS_PROPERTY_KEY = "PRODUCT_CATEGORY_SYNC_STATUS";

/**
 * Reads Cat Tree RM and derives the unique set of category nodes across
 * Lv0-Lv4, each as { name, parentPath }. Cat Tree RM has heavy row-level
 * duplication by design (a per-SKU leaf list, not a deduped tree) - we
 * dedupe on the full (Lv0..Lv4) tuple here.
 */
function getCategoryNodes_() {
  const sheet = SpreadsheetApp.openById(CAT_TREE_SPREADSHEET_ID).getSheetByName(
    CAT_TREE_SHEET_NAME
  );
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1); // drop header row

  const seen = {};
  const nodes = [];

  rows.forEach(function (row) {
    const levels = row
      .slice(0, CATEGORY_LEVELS)
      .map(function (v) {
        return String(v || "").trim();
      });
    if (!levels[0]) return; // blank/short row

    for (let depth = 0; depth < CATEGORY_LEVELS; depth++) {
      const name = levels[depth];
      if (!name) break; // no deeper levels on this row past this point

      const ancestors = levels.slice(0, depth);
      const key = ancestors.concat(name).join(KEY_SEP);
      if (seen[key]) continue;
      seen[key] = true;

      nodes.push({ name: name, parentPath: ancestors.join(" / ") });
    }
  });

  return nodes;
}

function nodeKey_(name, parentPath) {
  return name + KEY_SEP + parentPath;
}

/**
 * Reads existing Product Category rows as a set of "name<sep>parentPath"
 * keys, plus the next empty row number to append at.
 */
function getExistingNodes_() {
  const sheet = SpreadsheetApp.openById(
    PRODUCT_CATEGORY_SPREADSHEET_ID
  ).getSheetByName(PRODUCT_CATEGORY_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1); // drop header row

  const existing = {};
  rows.forEach(function (row) {
    const name = String(row[0] || "").trim();
    if (!name) return;
    const parentPath = String(row[1] || "").trim();
    existing[nodeKey_(name, parentPath)] = true;
  });

  const nextRow = PRODUCT_CATEGORY_HEADER_ROW + 1 + rows.length;
  return { existing: existing, nextRow: nextRow };
}

function diffMissing_(nodes, existing) {
  return nodes.filter(function (n) {
    return !existing[nodeKey_(n.name, n.parentPath)];
  });
}

function missingByLevel_(missing) {
  const byLevel = {};
  missing.forEach(function (n) {
    const level = n.parentPath ? n.parentPath.split(" / ").length : 0;
    byLevel[level] = (byLevel[level] || 0) + 1;
  });
  return byLevel;
}

function buildStatus_(nodes, existingCount, missing, extra) {
  const status = {
    lastCheckedAt: new Date().toISOString(),
    totalCatTreeNodes: nodes.length,
    totalExisting: existingCount,
    missingCount: missing.length,
    missingByLevel: missingByLevel_(missing),
    missing: missing.slice(0, 500),
    inSync: missing.length === 0,
  };
  return Object.assign(status, extra || {});
}

function saveStatus_(status) {
  PropertiesService.getScriptProperties().setProperty(
    STATUS_PROPERTY_KEY,
    JSON.stringify(status)
  );
}

function loadStatus_() {
  const raw = PropertiesService.getScriptProperties().getProperty(
    STATUS_PROPERTY_KEY
  );
  if (!raw) {
    return {
      lastCheckedAt: null,
      totalCatTreeNodes: 0,
      totalExisting: 0,
      missingCount: 0,
      missingByLevel: {},
      missing: [],
      inSync: null,
    };
  }
  return JSON.parse(raw);
}

/**
 * Writes missing nodes starting at `startRow`, then applies the same
 * formatting used for the manually-added rows (Calibri 10pt, non-bold,
 * white background).
 */
function appendMissingNodes_(missing, startRow) {
  if (missing.length === 0) return null;

  const sheet = SpreadsheetApp.openById(
    PRODUCT_CATEGORY_SPREADSHEET_ID
  ).getSheetByName(PRODUCT_CATEGORY_SHEET_NAME);

  const values = missing.map(function (n) {
    return [n.name, n.parentPath, "", ""];
  });

  const range = sheet.getRange(startRow, 1, values.length, 4);
  range.setValues(values);
  range
    .setFontFamily("Calibri")
    .setFontSize(10)
    .setFontWeight("normal")
    .setBackground("#ffffff");

  return { row: startRow, count: missing.length };
}

/** Recomputes the diff without writing anything. */
function runCheck_() {
  const nodes = getCategoryNodes_();
  const existingData = getExistingNodes_();
  const missing = diffMissing_(nodes, existingData.existing);
  const status = buildStatus_(
    nodes,
    Object.keys(existingData.existing).length,
    missing
  );
  saveStatus_(status);
  return status;
}

/** Recomputes the diff and writes any missing rows, then refreshes status. */
function runSync_() {
  const nodes = getCategoryNodes_();
  const existingData = getExistingNodes_();
  const missing = diffMissing_(nodes, existingData.existing);

  let writeResult = null;
  if (missing.length > 0) {
    writeResult = appendMissingNodes_(missing, existingData.nextRow);
  }

  const afterData = getExistingNodes_();
  const missingAfter = diffMissing_(nodes, afterData.existing);
  const status = buildStatus_(
    nodes,
    Object.keys(afterData.existing).length,
    missingAfter,
    {
      lastSyncAt: new Date().toISOString(),
      lastSyncWrote: writeResult ? writeResult.count : 0,
    }
  );
  saveStatus_(status);
  return status;
}

/** Time-driven trigger entrypoint — set up under Triggers (clock icon). */
function dailyCheck() {
  runCheck_();
}

/** Custom spreadsheet menu, so anyone with the sheet open can trigger a sync. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Product Category Sync")
    .addItem("Run Check Now", "menuRunCheck_")
    .addItem("Run Sync Now", "menuRunSync_")
    .addToUi();
}

function menuRunCheck_() {
  const status = runCheck_();
  SpreadsheetApp.getUi().alert(
    status.inSync
      ? "In sync — nothing missing."
      : status.missingCount + " node(s) missing. Check the dashboard for details."
  );
}

function menuRunSync_() {
  const status = runSync_();
  SpreadsheetApp.getUi().alert(
    "Sync complete. Wrote " +
      status.lastSyncWrote +
      " row(s). " +
      (status.inSync ? "Now in sync." : status.missingCount + " still missing.")
  );
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** Web app entrypoint: GET returns cached status; ?action=check or ?action=sync recompute. */
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  try {
    if (action === "check") return jsonOutput_(runCheck_());
    if (action === "sync") return jsonOutput_(runSync_());
    return jsonOutput_(loadStatus_());
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}
