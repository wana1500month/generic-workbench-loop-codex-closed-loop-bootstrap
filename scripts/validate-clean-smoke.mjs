import { spawn } from "node:child_process";

import {
  cleanSemanticValidationRuntimeState,
  ensureSemanticValidationFixtures
} from "./testing/semantic-fixtures.mjs";

await ensureSemanticValidationFixtures();
await cleanSemanticValidationRuntimeState();

const child = spawn(process.execPath, ["./scripts/run-validation-batch.mjs", "smoke"], {
  stdio: "inherit",
  shell: false,
  windowsHide: true
});

child.on("close", (code) => {
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
