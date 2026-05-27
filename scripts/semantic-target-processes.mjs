import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stopProcessTree } from "./process-tree.mjs";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const normalizeCommand = (value) => String(value ?? "").replace(/\\/g, "/");
const repoRootMarker = normalizeCommand(repoRoot).toLowerCase();

const isSemanticTargetServerCommand = (commandLine) => {
  const normalized = normalizeCommand(commandLine).toLowerCase();
  return (
    normalized.includes("target-server.cjs") &&
    normalized.includes("semantic-validation") &&
    normalized.includes(repoRootMarker)
  );
};

const runProcessListing = (command, args) =>
  new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      {
        cwd: repoRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout) => {
        if (error) {
          resolvePromise("");
          return;
        }
        resolvePromise(stdout);
      }
    );
  });

const listWindowsNodeProcesses = async () => {
  const stdout = await runProcessListing("powershell.exe", [
    "-NoProfile",
    "-Command",
    [
      "$processes = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" |",
      "Select-Object ProcessId,CommandLine;",
      "$processes | ConvertTo-Json -Compress"
    ].join(" ")
  ]);
  if (!stdout.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(stdout);
    const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return items
      .map((item) => ({
        pid: Number(item.ProcessId),
        commandLine: String(item.CommandLine ?? "")
      }))
      .filter((item) => Number.isInteger(item.pid) && item.pid > 0);
  } catch {
    return [];
  }
};

const listPosixNodeProcesses = async () => {
  const stdout = await runProcessListing("ps", ["-axo", "pid=,command="]);
  return stdout
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match
        ? { pid: Number(match[1]), commandLine: match[2] }
        : undefined;
    })
    .filter(Boolean)
    .filter((item) => item.commandLine.includes("node"));
};

export const listSemanticTargetServers = async () => {
  const processes =
    process.platform === "win32"
      ? await listWindowsNodeProcesses()
      : await listPosixNodeProcesses();
  return processes.filter((item) =>
    isSemanticTargetServerCommand(item.commandLine)
  );
};

export const stopSemanticTargetServers = async () => {
  const processes = await listSemanticTargetServers();
  const stopped = [];
  for (const processInfo of processes) {
    if (await stopProcessTree(processInfo.pid)) {
      stopped.push(processInfo);
    }
  }
  return stopped;
};
