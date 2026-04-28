import { strict as assert } from "node:assert";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

const candidates =
  process.platform === "win32"
    ? [
        "msedge.exe",
        "chrome.exe",
        "chromium.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      ]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "chromium"
        ]
      : [
          "google-chrome",
          "chromium",
          "chromium-browser",
          "microsoft-edge",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/microsoft-edge"
        ];

const canExecute = async (path) => {
  try {
    await access(path, process.platform === "win32" ? 0 : 0o111);
    return true;
  } catch {
    return false;
  }
};

const findOnPath = async (name) => {
  if (isAbsolute(name) || name.includes("\\") || name.includes("/")) {
    return (await canExecute(name)) ? name : undefined;
  }

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = join(directory, name);
    if (await canExecute(candidate)) {
      return candidate;
    }
    if (process.platform === "win32" && !candidate.toLowerCase().endsWith(".exe")) {
      const exeCandidate = `${candidate}.exe`;
      if (await canExecute(exeCandidate)) {
        return exeCandidate;
      }
    }
  }

  return undefined;
};

const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
const found =
  explicit && (await canExecute(explicit))
    ? explicit
    : await candidates.reduce(
        async (previous, candidate) => (await previous) ?? findOnPath(candidate),
        Promise.resolve(undefined)
      );

assert.ok(
  found,
  "No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or install Chromium."
);

console.log(`validate:browser-preflight passed (${found})`);
