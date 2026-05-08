const fs = require("node:fs");
const path = require("node:path");

const targetRoot = process.env.HARNESS_TARGET_ROOT;
if (!targetRoot) {
  console.error("HARNESS_TARGET_ROOT is not set.");
  process.exit(1);
}

const markerPath = path.join(targetRoot, "target-state", "run_target.txt");
if (!fs.existsSync(markerPath)) {
  console.error(`Missing run target marker: ${markerPath}`);
  process.exit(1);
}

process.stdout.write(fs.readFileSync(markerPath, "utf8"));
