import {
  assertRoundStopReason,
  assertStopReason,
  assertTargetFamily,
  assertValidationLane,
  environmentPreflightChecklist,
  extractRunDirectory,
  latestRoundSummary,
  readSummary,
  runLoop,
  writeEnvironmentPreflightArtifact
} from "./validation-utils.mjs";

console.log("[validate-family-editor-preflight] editor realism preflight");
const result = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/editor-success/adapter.json",
  "--target-family",
  "browser-editor",
  "--max-rounds",
  "1"
]);
if (result.code !== 0) {
  throw new Error("Editor realism preflight command failed.");
}

const runDirectory = extractRunDirectory(result.stdout);
const summary = await readSummary(runDirectory);
assertTargetFamily(summary, "browser-editor");
assertValidationLane(summary, "environment_integration");
const checklist = environmentPreflightChecklist("browser-editor");
const latestRound = latestRoundSummary(summary);

if (summary.stop_reason === "environment_blocked") {
  assertRoundStopReason(latestRound, "environment_blocked", "editor preflight round");
  const artifactPath = await writeEnvironmentPreflightArtifact({
    runDirectory,
    artifactName: "editor-preflight.json",
    targetFamily: "browser-editor",
    validationLane: "environment_integration",
    stopReason: summary.stop_reason,
    ready: false,
    checklist,
    notes: [
      "Use the deterministic semantic lane for controller regressions when the host blocks editor realism probes."
    ]
  });
  throw new Error(
    [
      "Editor realism preflight is blocked by the current host environment.",
      `run=${runDirectory}`,
      `round=${latestRound?.round ?? "unknown"}`,
      `artifact=${artifactPath}`,
      "Checklist:",
      ...checklist.map((item, index) => `${index + 1}. ${item}`)
    ].join("\n")
  );
}

assertStopReason(summary, "target_reached");
assertRoundStopReason(latestRound, "target_reached", "editor preflight round");
const artifactPath = await writeEnvironmentPreflightArtifact({
  runDirectory,
  artifactName: "editor-preflight.json",
  targetFamily: "browser-editor",
  validationLane: "environment_integration",
  stopReason: summary.stop_reason,
  ready: true,
  checklist,
  notes: ["The current host satisfied editor realism preflight requirements."]
});
console.log(`[validate-family-editor-preflight] artifact=${artifactPath}`);
console.log("[validate-family-editor-preflight] environment is editor-ready");
