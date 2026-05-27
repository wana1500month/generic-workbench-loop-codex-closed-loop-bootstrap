import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const readText = (relativePath) => readFile(join(repoRoot, relativePath), "utf8");

const main = async () => {
  assert.ok(
    existsSync(join(repoRoot, "SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL.md")),
    "source checkout must include SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL.md"
  );
  assert.ok(
    !existsSync(join(repoRoot, "CODEX_APP_INSTALL.md")),
    "source checkout must not include CODEX_APP_INSTALL.md"
  );
  assert.ok(
    !existsSync(join(repoRoot, "release-manifest.json")),
    "source checkout must not include release-manifest.json"
  );

  const attributes = await readText(".gitattributes");
  assert.match(
    attributes,
    /^CODEX_APP_INSTALL\.md\s+export-ignore$/m,
    "CODEX_APP_INSTALL.md must be export-ignored from source archives"
  );
  assert.match(
    attributes,
    /^release-manifest\.json\s+export-ignore$/m,
    "release-manifest.json must be export-ignored from source archives"
  );

  const releaseScript = await readText("scripts/package-release.mjs");
  assert.match(
    releaseScript,
    /relativePath === "CODEX_APP_INSTALL\.md"/,
    "release package script must exclude source-tree CODEX_APP_INSTALL.md and create it only inside the install image"
  );
  assert.match(
    releaseScript,
    /relativePath === "release-manifest\.json"/,
    "release package script must exclude source-tree release-manifest.json and create it only inside the install image"
  );
  assert.match(
    releaseScript,
    /relativePath === "SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL\.md"/,
    "release package script must exclude the source archive marker"
  );
  assert.match(
    releaseScript,
    /join\(stageRoot, "CODEX_APP_INSTALL\.md"\)/,
    "release package script must create CODEX_APP_INSTALL.md inside the install image"
  );
  assert.match(
    releaseScript,
    /join\(stageRoot, "release-manifest\.json"\)/,
    "release package script must create release-manifest.json inside the install image"
  );
};

await main();
console.log("validate:source-release-identity passed");
