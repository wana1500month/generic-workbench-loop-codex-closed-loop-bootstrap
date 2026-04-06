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

console.log("[validate-family-browser-preflight] browser realism preflight");
const result = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/browser-success/adapter.json",
  "--evaluator-profile",
  "./.tmp/semantic-validation/verification-profile-browser.json",
  "--max-rounds",
  "1"
]);
if (result.code !== 0) {
  throw new Error("Browser realism preflight command failed.");
}

const runDirectory = extractRunDirectory(result.stdout);
const summary = await readSummary(runDirectory);
assertTargetFamily(summary, "browser-app");
assertValidationLane(summary, "environment_integration");
const checklist = environmentPreflightChecklist("browser-app");
const latestRound = latestRoundSummary(summary);

if (summary.stop_reason === "environment_blocked") {
  assertRoundStopReason(latestRound, "environment_blocked", "browser preflight round");
  const artifactPath = await writeEnvironmentPreflightArtifact({
    runDirectory,
    artifactName: "browser-preflight.json",
    targetFamily: "browser-app",
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
      "Browser realism preflight is blocked by the current host environment.",
      `run=${runDirectory}`,
      `round=${latestRound?.round ?? "unknown"}`,
      `artifact=${artifactPath}`,
      "Checklist:",
      ...checklist.map((item, index) => `${index + 1}. ${item}`)
    ].join("\n")
  );
}

assertStopReason(summary, "target_reached");
assertRoundStopReason(latestRound, "target_reached", "browser preflight round");
const artifactPath = await writeEnvironmentPreflightArtifact({
  runDirectory,
  artifactName: "browser-preflight.json",
  targetFamily: "browser-app",
  validationLane: "environment_integration",
  stopReason: summary.stop_reason,
  ready: true,
  checklist,
  notes: ["The current host satisfied browser realism preflight requirements."]
});
console.log(`[validate-family-browser-preflight] artifact=${artifactPath}`);
console.log("[validate-family-browser-preflight] environment is browser-ready");
