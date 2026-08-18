import { writeFileSync } from "node:fs";
import { getCategoryNodes } from "./lib/cattree.js";
import { getExistingNodes, diffMissing } from "./lib/productcategory.js";

async function main() {
  const [nodes, { existing }] = await Promise.all([
    getCategoryNodes(),
    getExistingNodes(),
  ]);

  const missing = diffMissing(nodes, existing);

  const byLevel = {};
  for (const n of missing) {
    const level = n.parentPath ? n.parentPath.split(" / ").length : 0;
    byLevel[level] = (byLevel[level] || 0) + 1;
  }

  const status = {
    lastCheckedAt: new Date().toISOString(),
    totalCatTreeNodes: nodes.length,
    totalExisting: existing.size,
    missingCount: missing.length,
    missingByLevel: byLevel,
    missing: missing.slice(0, 500), // cap payload size; log full count separately
    inSync: missing.length === 0,
  };

  writeFileSync("docs/status.json", JSON.stringify(status, null, 2));
  console.log(
    `Checked ${nodes.length} Cat Tree RM nodes vs ${existing.size} existing rows: ${missing.length} missing.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
