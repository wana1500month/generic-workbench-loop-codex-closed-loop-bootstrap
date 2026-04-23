export const captureEvidenceTemplate = (): string => `import {
  finalize,
  readConfig,
  waitForUrl,
  writeArtifact
} from "./runtime-helpers.mjs";

const main = async () => {
  const config = await readConfig();
  const probe = await waitForUrl(config.ready_url, 15000);
  const reportPath = await writeArtifact(
    "capture-evidence.md",
    [
      "# Live evidence",
      "",
      "Ready URL: " + config.ready_url,
      "HTTP status: " + probe.status,
      "Reachable: " + String(probe.ok),
      "",
      probe.body || "No response body captured."
    ].join("\\n")
  );

  await finalize({
    capability: "capture_evidence",
    ok: probe.ok,
    summary: probe.ok
      ? "Captured live evidence from " + config.ready_url + "."
      : "Could not capture live evidence from " + config.ready_url + ".",
    findings: probe.ok ? [] : ["Failed to capture evidence from " + config.ready_url + "."],
    evidence_paths: [reportPath],
    evidence_items: [
      {
        path: reportPath,
        kind: "report",
        description: "Bootstrap-generated live evidence capture."
      }
    ]
  });

  if (!probe.ok) {
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  await finalize({
    capability: "capture_evidence",
    ok: false,
    summary: "capture_evidence failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;

