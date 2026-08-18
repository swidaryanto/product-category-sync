import { executeTool } from "./composio.js";

const CAT_TREE_SPREADSHEET_ID = "1AaY9aJL_rPQ9qmPCW9XG9jZufgHFjw0FUPOS-x1BBm8";
const CAT_TREE_SHEET_NAME = "Cat Tree RM";
// Header is Lv0..Lv5 + Concat in columns A-G. Data starts row 2.
const CAT_TREE_RANGE = `'${CAT_TREE_SHEET_NAME}'!A2:E5000`;

// Levels we treat as "categories" (matches what the Product Category sheet
// models: Lv0-Lv4). Lv5 (Description) is SKU-level detail, not a category node.
const CATEGORY_LEVELS = 5; // indices 0..4 -> Lv0..Lv4
const KEY_SEP = ""; // unlikely-to-appear separator, avoids ambiguous concatenation

/**
 * Reads the Cat Tree RM sheet and derives the unique set of category nodes
 * across Lv0-Lv4, each as { name, parentPath } where parentPath is the
 * "A / B / C" joined ancestor chain (or "" for Lv0 root nodes).
 *
 * Cat Tree RM has heavy row-level duplication by design (it's a per-SKU leaf
 * list, not a deduped tree) - we dedupe on the (Lv0..Lv4) tuple here.
 */
export async function getCategoryNodes() {
  const data = await executeTool("GOOGLESHEETS_VALUES_GET", {
    spreadsheet_id: CAT_TREE_SPREADSHEET_ID,
    range: CAT_TREE_RANGE,
  });

  const rows = data.values || [];
  const seen = new Set();
  const nodes = [];

  for (const row of rows) {
    const levels = row.slice(0, CATEGORY_LEVELS).map((v) => (v || "").trim());
    if (!levels[0]) continue; // blank/short row

    for (let depth = 0; depth < CATEGORY_LEVELS; depth++) {
      const name = levels[depth];
      if (!name) break; // no deeper levels on this row past this point

      const ancestors = levels.slice(0, depth);
      const key = ancestors.concat(name).join(KEY_SEP);
      if (seen.has(key)) continue;
      seen.add(key);

      nodes.push({
        name,
        parentPath: ancestors.join(" / "),
      });
    }
  }

  return nodes;
}
