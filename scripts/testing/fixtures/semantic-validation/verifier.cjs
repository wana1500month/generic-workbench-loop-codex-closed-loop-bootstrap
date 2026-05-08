const fs = require("node:fs");
const path = require("node:path");

const scriptPath = path.join(__dirname, "adapter.cjs");
const source = fs.readFileSync(scriptPath, "utf8");
const semanticModule = { exports: {} };
const execute = new Function(
  "require",
  "module",
  "exports",
  "__filename",
  "__dirname",
  "process",
  "console",
  "Buffer",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  source
);

process.argv = [process.argv[0], scriptPath, ...process.argv.slice(2)];
execute(
  require,
  semanticModule,
  semanticModule.exports,
  scriptPath,
  __dirname,
  process,
  console,
  Buffer,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
);
