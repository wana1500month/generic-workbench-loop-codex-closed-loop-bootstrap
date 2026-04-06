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

console.log("[validate-family-fullstack-preflight] fullstack realism preflight");
const result = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/fullstack-success/adapter.json",
  "--target-family",
  "fullstack-app",
  "--max-rounds",
  "1"
]);
if (result.code !== 0) {
  throw new Error("Fullstack realism preflight command failed.");
}

const runDirectory = extractRunDirectory(result.stdout);
const summary = await readSummary(runDirectory);
assertTargetFamily(summary, "fullstack-app");
assertValidationLane(summary, "environment_integration");
const checklist = environmentPreflightChecklist("fullstack-app");
const latestRound = latestRoundSummary(summary);

if (summary.stop_reason === "environment_blocked") {
  assertRoundStopReason(latestRound, "environment_blocked", "fullstack preflight round");
  const artifactPath = await writeEnvironmentPreflightArtifact({
    runDirectory,
    artifactName: "fullstack-preflight.json",
    targetFamily: "fullstack-app",
    validationLane: "environment_integration",
    stopReason: summary.stop_reason,
    ready: false,
    checklist,
    notes: [
      "Use the deterministic semantic lane for controller regressions when the host blocks realism probes."
    ]
  });
  throw new Error(
    [
      "Fullstack realism preflight is blocked by the current host environment.",
      `run=${runDirectory}`,
      `round=${latestRound?.round ?? "unknown"}`,
      `artifact=${artifactPath}`,
      "Checklist:",
      ...checklist.map((item, index) => `${index + 1}. ${item}`)
    ].join("\n")
  );
}

assertStopReason(summary, "target_reached");
assertRoundStopReason(latestRound, "target_reached", "fullstack preflight round");
const artifactPath = await writeEnvironmentPreflightArtifact({
  runDirectory,
  artifactName: "fullstack-preflight.json",
  targetFamily: "fullstack-app",
  validationLane: "environment_integration",
  stopReason: summary.stop_reason,
  ready: true,
  checklist,
  notes: ["The current host satisfied fullstack realism preflight requirements."]
});
console.log(`[validate-family-fullstack-preflight] artifact=${artifactPath}`);
console.log("[validate-family-fullstack-preflight] environment is fullstack-ready");
