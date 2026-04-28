import type {
  SessionAdapterPlan,
  SessionIntakeSnapshot,
  SessionWorkflowCheck,
  VerificationSurface
} from "./intake-schema.js";
import type { TargetFamily } from "./types.js";

export const generatedAdapterFiles = [
  "adapter.generated.json",
  ".generated/codex-adapter/runtime-config.json",
  ".generated/codex-adapter/scripts/prepare-target.mjs",
  ".generated/codex-adapter/scripts/apply-change.mjs",
  ".generated/codex-adapter/scripts/run-target.mjs",
  ".generated/codex-adapter/scripts/capture-evidence.mjs",
  ".generated/codex-adapter/scripts/run-checks.mjs",
  ".generated/codex-adapter/scripts/grade-round.mjs"
] as const;

export const defaultVerificationSurfacesForFamily = (
  targetFamily: TargetFamily
): VerificationSurface[] => {
  if (
    targetFamily === "api-service" ||
    targetFamily === "crud-api" ||
    targetFamily === "chat-agent"
  ) {
    return ["api"];
  }

  return ["browser"];
};

export const selectorHintsForWorkflow = (
  index: number
): NonNullable<SessionWorkflowCheck["selector_hints"]> => ({
  root: `[data-testid='feature-${index + 1}']`,
  action: `[data-testid='feature-${index + 1}-action']`,
  result: `[data-testid='feature-${index + 1}-result']`
});

export const defaultWorkflowChecksFromCoreFeatures = (
  coreFeatures: readonly string[],
  surfaces: readonly VerificationSurface[]
): SessionWorkflowCheck[] => {
  const surface = surfaces[0] ?? "browser";
  return coreFeatures.slice(0, 3).map((workflow, index) => ({
    workflow,
    surface,
    trigger: `${workflow} action`,
    expected_result: `${workflow} succeeds visibly.`,
    selector_hints: selectorHintsForWorkflow(index),
    ...(surface === "api"
      ? {
          api_hint: {
            method: "GET" as const,
            path: `quality/features/feature-${index + 1}`,
            expected_status: 200,
            expected_json_path: "status",
            expected_value: "ready"
          }
        }
      : {})
  }));
};

export const parseVerificationSurfacesAnswer = (
  value: string
): VerificationSurface[] => {
  const normalized = value.toLowerCase();
  const surfaces: VerificationSurface[] = [];

  if (/화면|브라우저|browser|screen/.test(normalized)) {
    surfaces.push("browser");
  }
  if (/api|http|endpoint|엔드포인트|응답|json/.test(normalized)) {
    surfaces.push("api");
  }
  if (/테스트|test|npm test|pnpm test|check command/.test(normalized)) {
    surfaces.push("test");
  }
  if (/cli|명령|command|터미널/.test(normalized)) {
    surfaces.push("cli");
  }
  if (/파일|file/.test(normalized)) {
    surfaces.push("file");
  }
  if (/db|database|데이터베이스|sqlite|postgres|mysql/.test(normalized)) {
    surfaces.push("db");
  }

  return [...new Set(surfaces)];
};

export const parseWorkflowChecksAnswer = (
  value: string,
  defaultSurface: VerificationSurface = "browser"
): SessionWorkflowCheck[] => {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  return lines
    .filter((line) => /\s*(?:->|→|=>)\s*/.test(line))
    .map((line, index): SessionWorkflowCheck | undefined => {
      const parts = line.split(/\s*(?:->|→|=>)\s*/);

      const workflow = parts[0]?.trim();
      const expectedResult = parts.slice(1).join(" -> ").trim();
      if (!workflow || !expectedResult) {
        return undefined;
      }

      return {
        workflow,
        surface: defaultSurface,
        trigger: workflow,
        expected_result: expectedResult,
        selector_hints: selectorHintsForWorkflow(index)
      };
    })
    .filter((check): check is SessionWorkflowCheck => Boolean(check));
};

export const buildAdapterPlanFromIntake = (input: {
  intake: SessionIntakeSnapshot;
  targetFamily: TargetFamily;
}): SessionAdapterPlan => {
  const verificationSurfaces =
    input.intake.verification_surfaces?.length
      ? input.intake.verification_surfaces
      : defaultVerificationSurfacesForFamily(input.targetFamily);
  const workflowChecks =
    input.intake.workflow_checks?.length
      ? input.intake.workflow_checks
      : defaultWorkflowChecksFromCoreFeatures(
          input.intake.core_features ?? [],
          verificationSurfaces
        );

  return {
    target_family: input.targetFamily,
    verification_surfaces: verificationSurfaces,
    runtime_strategy: {
      ...(input.intake.run_command ? { run_command: input.intake.run_command } : {}),
      ...(input.intake.check_command ? { check_command: input.intake.check_command } : {}),
      ...(input.intake.ready_url ? { ready_url: input.intake.ready_url } : {}),
      ...(input.intake.app_url ? { app_url: input.intake.app_url } : {}),
      ...(input.intake.api_base_url ? { api_base_url: input.intake.api_base_url } : {}),
      ...(input.intake.health_url ? { health_url: input.intake.health_url } : {})
    },
    workflow_checks: workflowChecks,
    generated_files: [...generatedAdapterFiles]
  };
};

export const adapterPlanPreviewLines = (
  plan: SessionAdapterPlan,
  locale: "en" | "ko" = "en"
): string[] => {
  const heading =
    locale === "ko" ? "Closed-loop adapter plan:" : "Closed-loop adapter plan:";
  const workflowHeading = locale === "ko" ? "- Workflow probes:" : "- Workflow probes:";
  const generatedHeading =
    locale === "ko" ? "- Generated adapter files:" : "- Generated adapter files:";

  return [
    heading,
    `- target family: ${plan.target_family}`,
    `- verification surfaces: ${plan.verification_surfaces.join(", ") || "none"}`,
    ...(plan.runtime_strategy.run_command
      ? [`- run command: ${plan.runtime_strategy.run_command}`]
      : []),
    ...(plan.runtime_strategy.ready_url
      ? [`- ready URL: ${plan.runtime_strategy.ready_url}`]
      : []),
    workflowHeading,
    ...plan.workflow_checks.map(
      (check, index) =>
        `  ${index + 1}. ${check.workflow} -> ${check.expected_result}`
    ),
    generatedHeading,
    ...plan.generated_files.map((file) => `  - ${file}`)
  ];
};

export const adapterPlanMarkdown = (plan: SessionAdapterPlan): string =>
  [
    "# Generated Adapter Plan",
    "",
    `Target family: ${plan.target_family}`,
    `Verification surfaces: ${plan.verification_surfaces.join(", ") || "none"}`,
    "",
    "## Runtime Strategy",
    "",
    ...Object.entries(plan.runtime_strategy).map(
      ([key, value]) => `- ${key}: ${value}`
    ),
    "",
    "## Workflow Checks",
    "",
    ...plan.workflow_checks.map(
      (check, index) =>
        [
          `${index + 1}. ${check.workflow}`,
          `   - surface: ${check.surface}`,
          ...(check.trigger ? [`   - trigger: ${check.trigger}`] : []),
          `   - expected result: ${check.expected_result}`,
          ...(check.selector_hints?.root
            ? [`   - root selector: ${check.selector_hints.root}`]
            : []),
          ...(check.selector_hints?.action
            ? [`   - action selector: ${check.selector_hints.action}`]
            : []),
          ...(check.selector_hints?.result
            ? [`   - result selector: ${check.selector_hints.result}`]
            : [])
        ].join("\n")
    ),
    "",
    "## Generated Files",
    "",
    ...plan.generated_files.map((file) => `- ${file}`)
  ].join("\n");
