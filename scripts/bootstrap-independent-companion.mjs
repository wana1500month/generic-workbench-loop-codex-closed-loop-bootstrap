import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  scaffoldReferenceAdapter,
  supportedTemplates
} from "./reference-adapter-template.mjs";
import { installReferenceAdapterCi } from "./install-reference-adapter-ci.mjs";

const args = process.argv.slice(2);
const outputDirectory = args.find((value) => !value.startsWith("--"));
const valueForFlag = (flag, fallback) => {
  const index = args.findIndex((value) => value === flag);
  return index >= 0 ? args[index + 1] : fallback;
};

const template = valueForFlag("--template", "canonical-crud");
const workflowName = valueForFlag(
  "--workflow-name",
  "harness-reference-adapter.yml"
);
const harnessRepo = valueForFlag("--harness-repo", undefined);
const harnessRef = valueForFlag("--harness-ref", undefined);
const gitInit = args.includes("--git-init");

const templateTargetFamily = {
  "canonical-api": "api-service",
  "canonical-api-patch-only": "api-service",
  "canonical-api-recontract": "api-service",
  "canonical-crud": "crud-api",
  "canonical-crud-patch-only": "crud-api",
  "canonical-crud-recontract": "crud-api",
  "canonical-chat": "chat-agent",
  "canonical-chat-patch-only": "chat-agent",
  "canonical-chat-recontract": "chat-agent"
};

if (!outputDirectory) {
  console.error(
    `Usage: node ./scripts/bootstrap-independent-companion.mjs <output-dir> [--template ${supportedTemplates.join("|")}] [--workflow-name harness-reference-adapter.yml] [--harness-repo owner/repo] [--harness-ref main] [--git-init]`
  );
  process.exit(1);
}

if (!supportedTemplates.includes(template) || template === "placeholder") {
  console.error(
    `Unsupported independent companion template '${template}'. Expected one of ${supportedTemplates.filter((value) => value !== "placeholder").join(", ")}.`
  );
  process.exit(1);
}

const targetFamily = templateTargetFamily[template];
if (!targetFamily) {
  console.error(
    `Template '${template}' does not map to a supported target family for independent companion bootstrap.`
  );
  process.exit(1);
}

const root = resolve(outputDirectory);
await scaffoldReferenceAdapter({
  outputDirectory: root,
  template
});
const ciInstall = await installReferenceAdapterCi({
  outputDirectory: root,
  adapterPath: "adapter.json",
  targetFamily,
  harnessRepo,
  harnessRef,
  workflowName
});

const bootstrapMetadataPath = join(root, "harness-bootstrap.json");
await mkdir(dirname(bootstrapMetadataPath), { recursive: true });
await writeFile(
  bootstrapMetadataPath,
  `${JSON.stringify(
    {
      created_at: new Date().toISOString(),
      template,
      target_family: targetFamily,
      harness_repo: ciInstall.harnessRepo,
      harness_ref: ciInstall.harnessRef,
      workflow_path: ciInstall.workflowPath
    },
    null,
    2
  )}\n`,
  "utf8"
);

if (gitInit) {
  execFileSync("git", ["init", "-b", "main"], {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"]
  });
}

console.log(
  `[reference-adapter:bootstrap-independent] created ${template} companion at ${root}`
);
console.log(
  `[reference-adapter:bootstrap-independent] installed CI workflow at ${ciInstall.workflowPath}`
);
