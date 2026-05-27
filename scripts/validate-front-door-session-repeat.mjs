import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  runCommand
} from "./testing/bootstrap-validator-helpers.mjs";

const tempRoot = await createTempRoot("validate-front-door-session-repeat");

try {
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    const env = {
      ...process.env,
      HARNESS_RUNS_DIRECTORY: join(tempRoot, `runs-${iteration}`),
      HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY: join(
        tempRoot,
        `front-door-sessions-${iteration}`
      )
    };
    delete env.CODEX_THREAD_ID;
    delete env.HARNESS_THREAD_BINDING_STATE;
    delete env.HARNESS_LAUNCH_ORIGIN;

    const result = await runCommand(
      "npm",
      ["run", "validate:front-door-session", "--silent"],
      { env }
    );
    if (result.code !== 0) {
      throw new Error(
        [
          `validate:front-door-session failed on repeat iteration ${iteration}.`,
          result.stdout,
          result.stderr
        ].join("\n")
      );
    }
  }
} finally {
  await cleanupTempRoot(tempRoot);
}

console.log("validate:front-door-session-repeat passed");
