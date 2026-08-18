import { executeTool } from "./composio.js";

export const PRODUCT_CATEGORY_SPREADSHEET_ID =
  "1WNGKMwUgqVNv1PBMjXMq02Effzs5x7-X0cXRPkPUHf4";
const SHEET_NAME = "Product Category";
const HEADER_ROW = 1;
const DATA_RANGE = `'${SHEET_NAME}'!A2:D5000`;

const KEY_SEP = "";

function keyOf(name, parentPath) {
  return `${name}${KEY_SEP}${parentPath}`;
}

/**
 * Reads existing Product Category rows as a Set of "name|parentPath" keys,
 * plus the next empty row number to append at.
 */
export async function getExistingNodes() {
  const data = await executeTool("GOOGLESHEETS_VALUES_GET", {
    spreadsheet_id: PRODUCT_CATEGORY_SPREADSHEET_ID,
    range: DATA_RANGE,
  });

  const rows = data.values || [];
  const existing = new Set();

  for (const row of rows) {
    const name = (row[0] || "").trim();
    if (!name) continue;
    const parentPath = (row[1] || "").trim();
    existing.add(keyOf(name, parentPath));
  }

  const nextRow = HEADER_ROW + 1 + rows.length;
  return { existing, nextRow };
}

/**
 * Computes which of `nodes` (from cattree.js) are missing from the sheet.
 */
export function diffMissing(nodes, existing) {
  return nodes.filter((n) => !existing.has(keyOf(n.name, n.parentPath)));
}

/**
 * Writes missing nodes starting at `startRow`, then applies the same
 * formatting used for the manually-added rows (Calibri 10pt, non-bold,
 * white background).
 */
export async function appendMissingNodes(missing, startRow) {
  if (missing.length === 0) return null;

  const endRow = startRow + missing.length - 1;
  const range = `'${SHEET_NAME}'!A${startRow}:D${endRow}`;
  const values = missing.map((n) => [n.name, n.parentPath, "", ""]);

  await executeTool("GOOGLESHEETS_VALUES_UPDATE", {
    spreadsheet_id: PRODUCT_CATEGORY_SPREADSHEET_ID,
    range,
    value_input_option: "USER_ENTERED",
    values,
  });

  await executeTool("GOOGLESHEETS_FORMAT_CELL", {
    spreadsheet_id: PRODUCT_CATEGORY_SPREADSHEET_ID,
    sheet_name: SHEET_NAME,
    range: `A${startRow}:D${endRow}`,
    font_family: "Calibri",
    font_size: 10,
    bold: false,
    red: 1,
    green: 1,
    blue: 1,
  });

  return { range, count: missing.length };
}
