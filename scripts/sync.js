import { writeFileSync } from "node:fs";
import { getCategoryNodes } from "./lib/cattree.js";
import {
  getExistingNodes,
  diffMissing,
  appendMissingNodes,
} from "./lib/productcategory.js";

async function main() {
  const nodes = await getCategoryNodes();
  const { existing, nextRow } = await getExistingNodes();
  const missing = diffMissing(nodes, existing);

  let writeResult = null;
  if (missing.length > 0) {
    writeResult = await appendMissingNodes(missing, nextRow);
    console.log(
      `Wrote ${writeResult.count} rows to ${writeResult.range}.`
    );
  } else {
    console.log("Nothing to sync, already up to date.");
  }

  // Re-derive status after the write so the dashboard reflects the new state.
  const { existing: existingAfter } = await getExistingNodes();
  const missingAfter = diffMissing(nodes, existingAfter);

  const byLevel = {};
  for (const n of missingAfter) {
    const level = n.parentPath ? n.parentPath.split(" / ").length : 0;
    byLevel[level] = (byLevel[level] || 0) + 1;
  }

  const status = {
    lastCheckedAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    lastSyncWrote: writeResult ? writeResult.count : 0,
    totalCatTreeNodes: nodes.length,
    totalExisting: existingAfter.size,
    missingCount: missingAfter.length,
    missingByLevel: byLevel,
    missing: missingAfter.slice(0, 500),
    inSync: missingAfter.length === 0,
  };

  writeFileSync("docs/status.json", JSON.stringify(status, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
