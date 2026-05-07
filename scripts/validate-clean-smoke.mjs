import { spawn } from "node:child_process";

import {
  cleanSemanticValidationRuntimeState,
  ensureSemanticValidationFixtures
} from "./testing/semantic-fixtures.mjs";

await ensureSemanticValidationFixtures();
await cleanSemanticValidationRuntimeState();

const invocation = process.env.npm_execpath
  ? {
      command: process.execPath,
      args: [process.env.npm_execpath, "run", "smoke"],
      shell: false
    }
  : {
      command: "npm",
      args: ["run", "smoke"],
      shell: process.platform === "win32"
    };

const child = spawn(invocation.command, invocation.args, {
  stdio: "inherit",
  shell: invocation.shell,
  windowsHide: true
});

child.on("close", (code) => {
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
