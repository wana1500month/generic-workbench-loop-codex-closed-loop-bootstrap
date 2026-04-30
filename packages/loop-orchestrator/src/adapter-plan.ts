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

const apiPrimaryTargetFamilies = new Set<TargetFamily>([
  "api-service",
  "crud-api",
  "chat-agent"
]);

const browserPrimaryTargetFamilies = new Set<TargetFamily>([
  "browser-app",
  "browser-editor",
  "editor-app",
  "fullstack-app",
  "dashboard"
]);

export const normalizeVerificationSurfacesForFamily = (
  targetFamily: TargetFamily,
  surfaces: readonly VerificationSurface[] | undefined
): VerificationSurface[] => {
  const uniqueSurfaces = [
    ...new Set(
      surfaces && surfaces.length > 0
        ? surfaces
        : defaultVerificationSurfacesForFamily(targetFamily)
    )
  ];
  const primarySurface = apiPrimaryTargetFamilies.has(targetFamily)
    ? "api"
    : browserPrimaryTargetFamilies.has(targetFamily)
      ? "browser"
      : undefined;

  if (!primarySurface) {
    return uniqueSurfaces;
  }

  return [
    primarySurface,
    ...uniqueSurfaces.filter((surface) => surface !== primarySurface)
  ];
};

const defaultRuntimeStrategyForFamily = (
  targetFamily: TargetFamily
): SessionAdapterPlan["runtime_strategy"] => {
  if (
    targetFamily === "api-service" ||
    targetFamily === "crud-api" ||
    targetFamily === "chat-agent"
  ) {
    return {
      run_command: "npm run dev",
      check_command: "npm test",
      ready_url: "http://127.0.0.1:3000/health",
      api_base_url: "http://127.0.0.1:3000"
    };
  }

  return {
    run_command: "npm run dev -- --host 127.0.0.1 --port 3000 --strictPort",
    check_command: "npm test",
    ready_url: "http://127.0.0.1:3000/"
  };
};

export const selectorHintsForWorkflow = (
  index: number
): NonNullable<SessionWorkflowCheck["selector_hints"]> => ({
  root: `[data-testid='feature-${index + 1}']`,
  action: `[data-testid='feature-${index + 1}-action']`,
  result: `[data-testid='feature-${index + 1}-result']`
});

export const normalizeWorkflowName = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{Letter}\p{Number}]/gu, "")
    .replace(
      /(?:\uBCF4\uAE30|\uD655\uC778|\uAD00\uB9AC|\uAE30\uB2A5|\uC791\uC5C5|\uD750\uB984)/g,
      ""
    );

export const workflowNameMatches = (left: string, right: string): boolean => {
  const normalizedLeft = normalizeWorkflowName(left);
  const normalizedRight = normalizeWorkflowName(right);
  return (
    normalizedLeft.length > 0 &&
    normalizedRight.length > 0 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
};

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

export const alignWorkflowChecksToCoreFeatures = (
  coreFeatures: readonly string[],
  checks: readonly SessionWorkflowCheck[],
  surfaces: readonly VerificationSurface[]
): SessionWorkflowCheck[] => {
  const fallbackSurface = surfaces[0] ?? "browser";
  const fallbackChecks = defaultWorkflowChecksFromCoreFeatures(
    coreFeatures,
    surfaces
  );

  return coreFeatures.slice(0, 5).map((feature, index) => {
    const matched =
      checks.find((check) => workflowNameMatches(check.workflow, feature)) ??
      checks[index];
    const fallback = fallbackChecks[index] ?? {
      workflow: feature,
      surface: fallbackSurface,
      trigger: `${feature} action`,
      expected_result: `${feature} succeeds visibly.`,
      selector_hints: selectorHintsForWorkflow(index)
    };

    if (!matched) {
      return fallback;
    }

    return {
      ...matched,
      workflow: feature,
      surface: fallbackSurface,
      trigger: matched.trigger ?? feature,
      selector_hints: matched.selector_hints ?? selectorHintsForWorkflow(index)
    };
  });
};

const stripPathLikeTokens = (value: string): string =>
  value
    .replace(/(?:^|[\s:=])https?:\/\/[^\s,;]+/gi, " ")
    .replace(/(?:^|[\s:=])(?:\/|\.\/|\.\.\/|[A-Za-z]:\\)[^\s,;]+/g, " ");

export const parseVerificationSurfacesAnswer = (
  value: string
): VerificationSurface[] => {
  const normalized = stripPathLikeTokens(value).toLowerCase();
  const surfaces: VerificationSurface[] = [];

  if (
    /(?:browser|screen|\bui\b|\uD654\uBA74|\uBE0C\uB77C\uC6B0\uC800)/.test(
      normalized
    )
  ) {
    surfaces.push("browser");
  }
  if (
    /(?:api|http|endpoint|\uC5D4\uB4DC\uD3EC\uC778\uD2B8|\uC751\uB2F5|json)/.test(
      normalized
    )
  ) {
    surfaces.push("api");
  }
  if (
    /(?:\uD14C\uC2A4\uD2B8|\btests?\b|npm\s+test|pnpm\s+test|yarn\s+test|check\s+command)/.test(
      normalized
    )
  ) {
    surfaces.push("test");
  }
  if (/(?:cli|command|\uBA85\uB839|\uCEE4\uB9E8\uB4DC)/.test(normalized)) {
    surfaces.push("cli");
  }
  if (/(?:\uD30C\uC77C|file)/.test(normalized)) {
    surfaces.push("file");
  }
  if (
    /(?:db|database|\uB370\uC774\uD130\uBCA0\uC774\uC2A4|sqlite|postgres|mysql)/.test(
      normalized
    )
  ) {
    surfaces.push("db");
  }

  return [...new Set(surfaces)];
};

export const parseWorkflowChecksAnswer = (
  value: string,
  defaultSurface: VerificationSurface = "browser"
): SessionWorkflowCheck[] => {
  const workflowDelimiter = /\s*(?:->|=>|\u2192|:|\uFF1A)\s*/;
  const metadataLabelPattern =
    /\b(?:product title|product summary|target users?|primary users?|core workflows?|core features?|references?|good enough|finish line|target root|target score|max rounds?|run command|check command|ready url|app url|health url|api base url|verification surfaces?)\b/i;
  const lines = value
    .split(/\r?\n|\\n/)
    .flatMap((line) =>
      line.split(
        /(?<=[.!?])\s+(?=[^.!?\n]+(?:->|=>|\u2192|:|\uFF1A))/u
      )
    )
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  return lines
    .filter((line) => workflowDelimiter.test(line))
    .map((line, index): SessionWorkflowCheck | undefined => {
      const parts = line.split(workflowDelimiter);
      const workflow = parts[0]?.trim();
      const expectedResult = parts.slice(1).join(" -> ").trim();
      if (!workflow || !expectedResult) {
        return undefined;
      }
      if (
        metadataLabelPattern.test(workflow) ||
        metadataLabelPattern.test(line.slice(0, 120))
      ) {
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
  const verificationSurfaces = normalizeVerificationSurfacesForFamily(
    input.targetFamily,
    input.intake.verification_surfaces
  );
  const workflowChecks =
    input.intake.workflow_checks?.length
      ? input.intake.core_features?.length
        ? alignWorkflowChecksToCoreFeatures(
            input.intake.core_features,
            input.intake.workflow_checks,
            verificationSurfaces
          )
        : input.intake.workflow_checks
      : defaultWorkflowChecksFromCoreFeatures(
          input.intake.core_features ?? [],
          verificationSurfaces
        );
  const defaultRuntime = defaultRuntimeStrategyForFamily(input.targetFamily);

  return {
    target_family: input.targetFamily,
    verification_surfaces: verificationSurfaces,
    runtime_strategy: {
      run_command: input.intake.run_command ?? defaultRuntime.run_command,
      check_command: input.intake.check_command ?? defaultRuntime.check_command,
      ready_url: input.intake.ready_url ?? defaultRuntime.ready_url,
      app_url: input.intake.app_url ?? defaultRuntime.app_url,
      api_base_url: input.intake.api_base_url ?? defaultRuntime.api_base_url,
      health_url: input.intake.health_url ?? defaultRuntime.health_url
    },
    workflow_checks: workflowChecks,
    generated_files: [...generatedAdapterFiles],
    ...(input.intake.adapter_plan?.notes?.length
      ? { notes: input.intake.adapter_plan.notes }
      : {})
  };
};

export const adapterPlanPreviewLines = (
  plan: SessionAdapterPlan,
  locale: "en" | "ko" = "en"
): string[] => {
  const heading =
    locale === "ko"
      ? "\uB2EB\uD78C \uB8E8\uD504 adapter \uC124\uACC4:"
      : "Closed-loop adapter plan:";
  const workflowHeading =
    locale === "ko" ? "- workflow probes:" : "- Workflow probes:";
  const generatedHeading =
    locale === "ko"
      ? "- \uC0DD\uC131 \uC608\uC815 adapter \uD30C\uC77C:"
      : "- Generated adapter files:";

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
    ...Object.entries(plan.runtime_strategy)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Workflow Checks",
    "",
    ...plan.workflow_checks.map((check, index) =>
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
