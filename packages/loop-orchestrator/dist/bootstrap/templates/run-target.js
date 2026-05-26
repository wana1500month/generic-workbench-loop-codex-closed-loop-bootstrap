export const runTargetTemplate = () => `import { join } from "node:path";

import {
  finalize,
  isProcessAlive,
  readConfig,
  readJsonIfExists,
  runtimePaths,
  spawnCommand,
  startDetachedCommand,
  stopProcessTree,
  waitForUrl,
  writeArtifact,
  writeRuntimeJson
} from "./runtime-helpers.mjs";

const main = async () => {
  const config = await readConfig();
  const processStatePath = runtimePaths.runtimeDirectory + "/server-process.json";
  const previousState = await readJsonIfExists(processStatePath);
  const logPath = join(runtimePaths.artifactsDirectory, "run-target.log");
  const previousPid =
    typeof previousState?.pid === "number" && previousState.pid > 0
      ? previousState.pid
      : null;
  const trackedProcessAlive = previousPid !== null && isProcessAlive(previousPid);

  if (!config.ready_url) {
    const execution = config.run_command
      ? await spawnCommand(config.run_command, { cwd: runtimePaths.targetRoot })
      : { code: 0, stdout: "", stderr: "" };
    const commandLogPath = await writeArtifact(
      "run-target-command.log",
      [execution.stdout, execution.stderr].filter(Boolean).join("\\n\\n")
    );
    await writeRuntimeJson("server-process.json", {
      pid: null,
      command: config.run_command,
      reused: false,
      command_only: true
    });
    await finalize({
      capability: "run_target",
      ok: execution.code === 0,
      summary: config.run_command
        ? "Ran command-first target command."
        : "No live target runtime configured.",
      findings: execution.code === 0 ? [] : ["Run command failed."],
      evidence_paths: config.run_command ? [commandLogPath] : [],
      target_manifest: {}
    });
    if (execution.code !== 0) {
      process.exitCode = 1;
    }
    return;
  }

  const existingProbe = await waitForUrl(config.ready_url, 1500);
  if (existingProbe.ok) {
    await writeRuntimeJson("server-process.json", {
      pid: trackedProcessAlive ? previousPid : null,
      command: config.run_command,
      reused: true,
      adopted_existing_server: !trackedProcessAlive
    });

    const probePath = await writeArtifact(
      "run-target-probe.log",
      [
        "ready_url=" + config.ready_url,
        "status=" + existingProbe.status,
        "ok=" + String(existingProbe.ok),
        "reused=true",
        "",
        existingProbe.body
      ].join("\\n")
    );

    await finalize({
      capability: "run_target",
      ok: true,
      summary: "Reused existing target at " + config.ready_url + ".",
      findings: [],
      evidence_paths: [probePath],
      target_manifest: {
        ...(config.app_url ? { app_url: config.app_url } : {}),
        ...(config.health_url ? { health_url: config.health_url } : {}),
        ...(config.api_base_url ? { api_base_url: config.api_base_url } : {})
      }
    });
    return;
  }

  if (previousPid) {
    await stopProcessTree(previousPid);
  }

  if (config.run_command) {
    const started = await startDetachedCommand(config.run_command, logPath, runtimePaths.targetRoot);
    await writeRuntimeJson("server-process.json", {
      pid: started.pid,
      command: config.run_command,
      reused: false
    });
  }

  const probe = await waitForUrl(config.ready_url, 90000);
  const probePath = await writeArtifact(
    "run-target-probe.log",
    [
      "ready_url=" + config.ready_url,
      "status=" + probe.status,
      "ok=" + String(probe.ok),
      "",
      probe.body
    ].join("\\n")
  );

  await finalize({
    capability: "run_target",
    ok: probe.ok,
    summary: probe.ok
      ? "Target responded at " + config.ready_url + "."
      : "Target did not become ready at " + config.ready_url + ".",
    findings: probe.ok ? [] : ["Failed to reach " + config.ready_url + "."],
    evidence_paths: [
      ...(config.run_command ? ["artifacts/run-target.log"] : []),
      probePath
    ],
    target_manifest: {
      ...(config.app_url ? { app_url: config.app_url } : {}),
      ...(config.health_url ? { health_url: config.health_url } : {}),
      ...(config.api_base_url ? { api_base_url: config.api_base_url } : {})
    }
  });

  if (!probe.ok) {
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  await finalize({
    capability: "run_target",
    ok: false,
    summary: "run_target failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;
//# sourceMappingURL=run-target.js.map