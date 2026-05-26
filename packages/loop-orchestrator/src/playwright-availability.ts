import { spawn } from "node:child_process";

export type PlaywrightImportProbeResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: string;
    };

const outputLimit = 4000;
const probeTimeoutMs = () => {
  const parsed = Number(process.env.HARNESS_PLAYWRIGHT_IMPORT_PROBE_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5000;
};

let cachedProbeResult: Promise<PlaywrightImportProbeResult> | undefined;

const appendLimited = (current: string, chunk: Buffer): string =>
  (current + chunk.toString()).slice(-outputLimit);

export const probePlaywrightCoreImport = async (): Promise<PlaywrightImportProbeResult> => {
  if (cachedProbeResult) {
    return cachedProbeResult;
  }

  cachedProbeResult = new Promise((resolve) => {
    const timeoutMs = probeTimeoutMs();
    const child = spawn(
      process.execPath,
      [
        "-e",
        [
          "try {",
          "  require('playwright-core');",
          "  process.stdout.write('ok');",
          "} catch (error) {",
          "  console.error(error && error.stack ? error.stack : String(error));",
          "  process.exitCode = 1;",
          "}"
        ].join("\n")
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        shell: false,
        windowsHide: true
      }
    );
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: PlaywrightImportProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        reason: `playwright-core import probe timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        reason: `playwright-core import probe failed to start: ${error.message}`
      });
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish({ ok: true });
        return;
      }
      const detail = stderr.trim() || stdout.trim();
      finish({
        ok: false,
        reason: [
          "playwright-core import probe failed",
          `exit_code=${code ?? "null"}`,
          signal ? `signal=${signal}` : "",
          detail
        ]
          .filter(Boolean)
          .join("; ")
      });
    });
  });

  return cachedProbeResult;
};

export const assertPlaywrightCoreImportAvailable = async (): Promise<void> => {
  const result = await probePlaywrightCoreImport();
  if (!result.ok) {
    throw new Error(result.reason);
  }
};
