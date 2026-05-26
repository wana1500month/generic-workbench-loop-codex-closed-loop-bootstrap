export const generatedAdapterFiles = [
    "generated-adapter/adapter.generated.json",
    "generated-adapter/adapter-plan.generated.json",
    "generated-adapter/adapter-plan.generated.md",
    "generated-adapter/rubric.generated.json",
    "generated-adapter/verification-profile.generated.json",
    "generated-adapter/codex-adapter/runtime-config.json",
    "generated-adapter/codex-adapter/scripts/prepare-target.mjs",
    "generated-adapter/codex-adapter/scripts/apply-change.mjs",
    "generated-adapter/codex-adapter/scripts/run-target.mjs",
    "generated-adapter/codex-adapter/scripts/capture-evidence.mjs",
    "generated-adapter/codex-adapter/scripts/run-checks.mjs",
    "generated-adapter/codex-adapter/scripts/grade-round.mjs"
];
export const defaultVerificationSurfacesForFamily = (targetFamily) => {
    if (targetFamily === "api-service" ||
        targetFamily === "crud-api" ||
        targetFamily === "chat-agent") {
        return ["api"];
    }
    if (targetFamily === "fullstack-app" ||
        targetFamily === "browser-editor" ||
        targetFamily === "dashboard") {
        return ["browser", "api"];
    }
    return ["browser"];
};
const apiPrimaryTargetFamilies = new Set([
    "api-service",
    "crud-api",
    "chat-agent"
]);
const browserPrimaryTargetFamilies = new Set([
    "browser-app",
    "browser-editor",
    "editor-app",
    "fullstack-app",
    "dashboard"
]);
export const normalizeVerificationSurfacesForFamily = (targetFamily, surfaces) => {
    const uniqueSurfaces = [
        ...new Set(surfaces && surfaces.length > 0
            ? surfaces
            : defaultVerificationSurfacesForFamily(targetFamily))
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
const defaultRuntimeStrategyForFamily = (targetFamily) => {
    if (targetFamily === "api-service" ||
        targetFamily === "crud-api" ||
        targetFamily === "chat-agent") {
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
export const selectorHintsForWorkflow = (index) => ({
    root: `[data-workflow-id='workflow-${index + 1}'], [data-testid='feature-${index + 1}']`,
    action: `[data-workflow-id='workflow-${index + 1}'] [data-workflow-action='primary'], [data-testid='feature-${index + 1}-action']`,
    result: `[data-workflow-id='workflow-${index + 1}'] [data-workflow-result='primary'], [data-testid='feature-${index + 1}-result']`
});
export const normalizeWorkflowName = (value) => value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{Letter}\p{Number}]/gu, "")
    .replace(/(?:\uBCF4\uAE30|\uD655\uC778|\uAD00\uB9AC|\uAE30\uB2A5|\uC791\uC5C5|\uD750\uB984)/g, "");
export const workflowNameMatches = (left, right) => {
    const normalizedLeft = normalizeWorkflowName(left);
    const normalizedRight = normalizeWorkflowName(right);
    return (normalizedLeft.length > 0 &&
        normalizedRight.length > 0 &&
        (normalizedLeft.includes(normalizedRight) ||
            normalizedRight.includes(normalizedLeft)));
};
export const defaultWorkflowChecksFromCoreFeatures = (coreFeatures, surfaces) => {
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
                    method: "GET",
                    path: `quality/features/feature-${index + 1}`,
                    expected_status: 200,
                    expected_json_path: "status",
                    expected_value: "ready"
                }
            }
            : {})
    }));
};
export const alignWorkflowChecksToCoreFeatures = (coreFeatures, checks, surfaces) => {
    const fallbackSurface = surfaces[0] ?? "browser";
    const fallbackChecks = defaultWorkflowChecksFromCoreFeatures(coreFeatures, surfaces);
    return coreFeatures.slice(0, 5).map((feature, index) => {
        const matched = checks.find((check) => workflowNameMatches(check.workflow, feature)) ??
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
const stripPathLikeTokens = (value) => value
    .replace(/(?:^|[\s:=])https?:\/\/[^\s,;]+/gi, " ")
    .replace(/(?:^|[\s:=])(?:\/|\.\/|\.\.\/|[A-Za-z]:\\)[^\s,;]+/g, " ");
export const hasExplicitApiNegation = (value) => {
    const normalized = value.normalize("NFKC").toLowerCase();
    const apiTerm = String.raw `(?:api|http|endpoint|\uC5D4\uB4DC\uD3EC\uC778\uD2B8)`;
    const apiNegativeAfterPattern = new RegExp(String.raw `${apiTerm}\s*(?:\uB294|\uC740|is|are)?\s*(?:\uD544\uC694\s*\uC5C6|\uBD88\uD544\uC694|\uB9CC\uB4E4\uC9C0\s*\uB9C8|\uB9CC\uB4E4\s*\uD544\uC694\s*\uC5C6|\uC5C6\uC774|\uC81C\uC678|\uAE08\uC9C0|no|not|not\s*(?:needed|required)|unneeded|unnecessary|required\s*false|do\s*not|don't|dont)`, "iu");
    const negativeApiBeforePattern = new RegExp(String.raw `(?:no|not|without|do\s*not|don't|dont|\uD544\uC694\s*\uC5C6|\uBD88\uD544\uC694|\uC5C6\uC774|\uC81C\uC678|\uAE08\uC9C0|\uB9CC\uB4E4\uC9C0\s*\uB9C8)[^.!?\n]{0,48}${apiTerm}`, "iu");
    return (apiNegativeAfterPattern.test(normalized) ||
        negativeApiBeforePattern.test(normalized));
};
export const parseVerificationSurfacesAnswer = (value) => {
    const normalized = stripPathLikeTokens(value).normalize("NFKC").toLowerCase();
    const surfaces = [];
    const apiExplicitlyNegated = hasExplicitApiNegation(normalized);
    if (/(?:browser|screen|\bui\b|\uD654\uBA74|\uBE0C\uB77C\uC6B0\uC800|\uC6F9\uC571|\uD504\uB860\uD2B8\uC5D4\uB4DC)/u.test(normalized)) {
        surfaces.push("browser");
    }
    if (!apiExplicitlyNegated &&
        /(?:api|http|endpoint|\uC5D4\uB4DC\uD3EC\uC778\uD2B8|\uC751\uB2F5|json)/u.test(normalized)) {
        surfaces.push("api");
    }
    if (/(?:\uD14C\uC2A4\uD2B8|\btests?\b|npm\s+test|pnpm\s+test|yarn\s+test|check\s+command)/.test(normalized)) {
        surfaces.push("test");
    }
    if (/(?:cli|command|\uBA85\uB839|\uCEE4\uB9E8\uB4DC)/.test(normalized)) {
        surfaces.push("cli");
    }
    if (/(?:\uD30C\uC77C|file)/.test(normalized)) {
        surfaces.push("file");
    }
    if (/(?:db|database|\uB370\uC774\uD130\uBCA0\uC774\uC2A4|sqlite|postgres|mysql)/.test(normalized)) {
        surfaces.push("db");
    }
    return [...new Set(surfaces)];
};
export const parseWorkflowChecksAnswer = (value, defaultSurface = "browser") => {
    const workflowDelimiter = /\s*(?:->|=>|\u2192|:|\uFF1A)\s*/;
    const metadataLabelPattern = /(?:\b(?:product title|product summary|target users?|primary users?|core workflows?|core features?|references?|good enough|finish line|target root|target score|max rounds?|run command|check command|ready url|app url|health url|api base url|verification surfaces?)\b|\uC81C\uD488\s*\uC81C\uBAA9|\uC81C\uD488\s*\uC694\uC57D|\uB300\uC0C1\s*\uC0AC\uC6A9\uC790|\uC8FC\s*\uC0AC\uC6A9\uC790|\uD575\uC2EC\s*\uC791\uC5C5|\uD575\uC2EC\s*\uC791\uC5C5\uBCC4\s*\uC2E4\uC81C\s*\uB3D9\uC791|\uC791\uC5C5\uBCC4\s*\uC2E4\uC81C\s*\uB3D9\uC791|\uC6CC\uD06C\uD50C\uB85C|\uC131\uACF5\s*\uAE30\uC900|\uC644\uB8CC\s*\uAE30\uC900|\uC791\uC5C5\s*\uD3F4\uB354|\uB300\uC0C1\s*\uD3F4\uB354|\uAC80\uC99D\s*\uBC29\uC2DD|\uAC80\uC99D\s*\uD45C\uBA74)/iu;
    const workflowHeaderOnlyPattern = /^(?:\uD575\uC2EC\s*)?(?:\uC791\uC5C5|\uC6CC\uD06C\uD50C\uB85C)(?:\uBCC4)?\s*(?:\uC2E4\uC81C\s*)?(?:\uB3D9\uC791|\uAC80\uC99D|\uC131\uACF5\s*\uC870\uAC74)?\s*[:\uFF1A]?$/u;
    const candidateLines = value
        .split(/\r?\n|\\n/)
        .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[^.!?\n]+(?:->|=>|\u2192|:|\uFF1A))/u))
        .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
        .filter(Boolean)
        .filter((line) => !workflowHeaderOnlyPattern.test(line))
        .filter((line) => workflowDelimiter.test(line))
        .filter((line) => !metadataLabelPattern.test(line.slice(0, 120)));
    return candidateLines
        .map((line, index) => {
        const parts = line.split(workflowDelimiter);
        const workflow = parts[0]?.trim();
        const expectedResult = parts.slice(1).join(" -> ").trim();
        if (!workflow || !expectedResult) {
            return undefined;
        }
        if (workflowHeaderOnlyPattern.test(workflow)) {
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
        .filter((check) => Boolean(check));
};
export const buildAdapterPlanFromIntake = (input) => {
    const verificationSurfaces = normalizeVerificationSurfacesForFamily(input.targetFamily, input.intake.verification_surfaces);
    const workflowChecks = input.intake.workflow_checks?.length
        ? input.intake.core_features?.length
            ? alignWorkflowChecksToCoreFeatures(input.intake.core_features, input.intake.workflow_checks, verificationSurfaces)
            : input.intake.workflow_checks
        : defaultWorkflowChecksFromCoreFeatures(input.intake.core_features ?? [], verificationSurfaces);
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
export const adapterPlanPreviewLines = (plan, locale = "en") => {
    const heading = locale === "ko"
        ? "\uB2EB\uD78C \uB8E8\uD504 adapter \uC124\uACC4:"
        : "Closed-loop adapter plan:";
    const workflowHeading = locale === "ko" ? "- workflow probes:" : "- Workflow probes:";
    const generatedHeading = locale === "ko"
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
        ...plan.workflow_checks.map((check, index) => `  ${index + 1}. ${check.workflow} -> ${check.expected_result}`),
        generatedHeading,
        ...plan.generated_files.map((file) => `  - ${file}`)
    ];
};
export const adapterPlanMarkdown = (plan) => [
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
    ...plan.workflow_checks.map((check, index) => [
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
    ].join("\n")),
    "",
    "## Generated Files",
    "",
    ...plan.generated_files.map((file) => `- ${file}`)
].join("\n");
//# sourceMappingURL=adapter-plan.js.map