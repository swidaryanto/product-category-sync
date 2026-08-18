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
const CATEGORY_LEVELS = 6; // Lv0..Lv5, full Cat Tree RM depth.

const PRODUCT_CATEGORY_SPREADSHEET_ID =
  "1WNGKMwUgqVNv1PBMjXMq02Effzs5x7-X0cXRPkPUHf4";
const PRODUCT_CATEGORY_SHEET_NAME = "Product Category";
const PRODUCT_CATEGORY_HEADER_ROW = 1;

const KEY_SEP = ""; // unlikely-to-appear separator for dedupe keys
const STATUS_PROPERTY_KEY = "PRODUCT_CATEGORY_SYNC_STATUS";

/**
 * Reads Cat Tree RM and derives the unique set of category nodes across
 * Lv0-Lv5, each as { name, parentPath }. Cat Tree RM has heavy row-level
 * duplication by design (a per-SKU leaf list, not a deduped tree) - we
 * dedupe on the full (Lv0..Lv5) tuple here.
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
    .addItem("Check for Gaps", "menuRunCheck_")
    .addItem("Fill in Gaps", "menuRunSync_")
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

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Product Category Sync</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 20px; }
    .status { padding: 12px; border-radius: 6px; margin: 16px 0; }
    .ok { background: #e6f7ed; color: #1a7f37; }
    .warn { background: #fff3e0; color: #b7791f; }
    .unknown { background: #eee; color: #555; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 13px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background: #f5f5f5; }
    code { background: #f5f5f5; padding: 2px 5px; border-radius: 3px; }
    .meta { color: #666; font-size: 13px; }
    button {
      margin-top: 12px; margin-right: 8px; padding: 8px 14px;
      background: #24292f; color: white; border: none; border-radius: 6px; cursor: pointer;
      font-size: 14px;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    button.secondary { background: #57606a; }
  </style>
</head>
<body>
  <h1>Product Category Sync</h1>
  <p class="meta">
    Compares the <code>Product Category</code> sheet against <code>Cat Tree RM</code>.
  </p>

  <div id="statusBox" class="status unknown">Loading...</div>

  <p>
    <button id="checkBtn">Check for Gaps</button>
    <button id="syncBtn" class="secondary">Fill in Gaps</button>
  </p>
  <p class="meta">
    <strong>Check for Gaps</strong> — read-only, just recomputes the diff.
    <strong>Fill in Gaps</strong> — writes any missing categories into the sheet.
  </p>

  <div id="detail"></div>

  <script>
    const statusBox = document.getElementById("statusBox");
    const detail = document.getElementById("detail");
    const checkBtn = document.getElementById("checkBtn");
    const syncBtn = document.getElementById("syncBtn");

    // google.script.run is Apps Script's client<->server bridge for
    // HtmlService pages - avoids fetch() entirely, which bounces through a
    // separate googleusercontent.com origin and re-triggers Google sign-in.
    function callServer(fnName) {
      return new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          [fnName]();
      });
    }

    function load(fnName) {
      return callServer(fnName)
        .then(render)
        .catch((err) => {
          statusBox.className = "status warn";
          statusBox.textContent = "Failed to load status: " + err;
        });
    }

    function withLoading(btn, label, fnName) {
      btn.disabled = true;
      checkBtn.disabled = true;
      syncBtn.disabled = true;
      statusBox.className = "status unknown";
      statusBox.textContent = "Running " + label + "...";
      load(fnName).finally(() => {
        checkBtn.disabled = false;
        syncBtn.disabled = false;
      });
    }

    checkBtn.addEventListener("click", () =>
      withLoading(checkBtn, "check", "clientRunCheck")
    );
    syncBtn.addEventListener("click", () =>
      withLoading(syncBtn, "sync", "clientRunSync")
    );

    function render(s) {
      if (s.error) {
        statusBox.className = "status warn";
        statusBox.textContent = "Error: " + s.error;
        return;
      }

      if (s.lastCheckedAt === null) {
        statusBox.className = "status unknown";
        statusBox.textContent = 'No check has run yet. Click "Check for Gaps".';
        return;
      }

      statusBox.className = "status " + (s.inSync ? "ok" : "warn");
      statusBox.textContent = s.inSync
        ? \`In sync as of \${formatDate(s.lastCheckedAt)}\`
        : \`\${s.missingCount} node(s) missing as of \${formatDate(s.lastCheckedAt)}\`;

      let html = \`<p class="meta">Cat Tree RM nodes: \${s.totalCatTreeNodes} · Product Category rows: \${s.totalExisting}</p>\`;
      if (s.lastSyncAt) {
        html += \`<p class="meta">Last sync: \${formatDate(s.lastSyncAt)} · wrote \${s.lastSyncWrote} row(s)</p>\`;
      }

      if (s.missing && s.missing.length > 0) {
        html += "<table><tr><th>Name</th><th>Parent</th></tr>";
        for (const n of s.missing) {
          html += \`<tr><td>\${escapeHtml(n.name)}</td><td>\${escapeHtml(n.parentPath)}</td></tr>\`;
        }
        html += "</table>";
      }
      detail.innerHTML = html;
    }

    function formatDate(iso) {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    }

    function escapeHtml(s) {
      const d = document.createElement("div");
      d.textContent = s ?? "";
      return d.innerHTML;
    }

    load("clientLoadStatus");
  </script>
</body>
</html>
`;

// Public wrappers callable from the client via google.script.run. Plain
// (non-underscore) names since that's just an Apps-Script-menu-visibility
// convention, not a real access restriction - kept separate from the
// underscore-suffixed internals anyway for a clear client/server boundary.
function clientLoadStatus() {
  return loadStatus_();
}
function clientRunCheck() {
  return runCheck_();
}
function clientRunSync() {
  return runSync_();
}

/** Web app entrypoint: always serves the HTML dashboard. */
function doGet(e) {
  return HtmlService.createHtmlOutput(DASHBOARD_HTML).setTitle(
    "Product Category Sync"
  );
}
