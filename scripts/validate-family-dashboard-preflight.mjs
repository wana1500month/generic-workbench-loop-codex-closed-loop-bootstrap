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

console.log("[validate-family-dashboard-preflight] dashboard realism preflight");
const result = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/dashboard-success/adapter.json",
  "--target-family",
  "dashboard",
  "--max-rounds",
  "1"
]);
if (result.code !== 0) {
  throw new Error("Dashboard realism preflight command failed.");
}

const runDirectory = extractRunDirectory(result.stdout);
const summary = await readSummary(runDirectory);
assertTargetFamily(summary, "dashboard");
assertValidationLane(summary, "environment_integration");
const checklist = environmentPreflightChecklist("dashboard");
const latestRound = latestRoundSummary(summary);

if (summary.stop_reason === "environment_blocked") {
  assertRoundStopReason(
    latestRound,
    "environment_blocked",
    "dashboard preflight round"
  );
  const artifactPath = await writeEnvironmentPreflightArtifact({
    runDirectory,
    artifactName: "dashboard-preflight.json",
    targetFamily: "dashboard",
    validationLane: "environment_integration",
    stopReason: summary.stop_reason,
    ready: false,
    checklist,
    notes: [
      "Use the deterministic semantic lane for controller regressions when the host blocks dashboard realism probes."
    ]
  });
  throw new Error(
    [
      "Dashboard realism preflight is blocked by the current host environment.",
      `run=${runDirectory}`,
      `round=${latestRound?.round ?? "unknown"}`,
      `artifact=${artifactPath}`,
      "Checklist:",
      ...checklist.map((item, index) => `${index + 1}. ${item}`)
    ].join("\n")
  );
}

assertStopReason(summary, "target_reached");
assertRoundStopReason(latestRound, "target_reached", "dashboard preflight round");
const artifactPath = await writeEnvironmentPreflightArtifact({
  runDirectory,
  artifactName: "dashboard-preflight.json",
  targetFamily: "dashboard",
  validationLane: "environment_integration",
  stopReason: summary.stop_reason,
  ready: true,
  checklist,
  notes: ["The current host satisfied dashboard realism preflight requirements."]
});
console.log(`[validate-family-dashboard-preflight] artifact=${artifactPath}`);
console.log("[validate-family-dashboard-preflight] environment is dashboard-ready");
