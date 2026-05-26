import { evidenceSurfacesForProjectKind, isCommandFirstProjectKind } from "./evaluation-policy.js";
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
    if (targetFamily === "cli-tool") {
        return ["cli"];
    }
    if (targetFamily === "command-artifact") {
        return ["shell", "file", "test"];
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
const commandPrimaryTargetFamilies = new Set([
    "cli-tool",
    "command-artifact"
]);
const browserPrimaryTargetFamilies = new Set([
    "browser-app",
    "browser-editor",
    "editor-app",
    "fullstack-app",
    "dashboard"
]);
const browserLikeSurfaces = new Set([
    "browser",
    "screenshot"
]);
const commandLikeSurfaces = new Set([
    "cli",
    "shell",
    "test",
    "package_import"
]);
export const normalizeVerificationSurfacesForFamily = (targetFamily, surfaces) => {
    if (surfaces && surfaces.length > 0) {
        return [...new Set(surfaces)];
    }
    const uniqueSurfaces = [
        ...new Set(defaultVerificationSurfacesForFamily(targetFamily))
    ];
    const primarySurface = apiPrimaryTargetFamilies.has(targetFamily)
        ? "api"
        : commandPrimaryTargetFamilies.has(targetFamily)
            ? targetFamily === "cli-tool"
                ? "cli"
                : "shell"
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
    if (commandPrimaryTargetFamilies.has(targetFamily)) {
        return targetFamily === "cli-tool"
            ? {
                run_command: "npm run start -- --help",
                check_command: "npm test"
            }
            : {
                check_command: "npm test"
            };
    }
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
const toVerificationSurface = (surface) => surface;
const surfacesFromIntake = (intake) => {
    if (intake.verification_surfaces?.length) {
        return intake.verification_surfaces;
    }
    if (intake.evidence_surfaces?.length) {
        return intake.evidence_surfaces.map(toVerificationSurface);
    }
    if (intake.project_kind && intake.project_kind !== "generic") {
        return evidenceSurfacesForProjectKind(intake.project_kind).map(toVerificationSurface);
    }
    return undefined;
};
const hasBrowserRuntimeSurface = (surfaces) => surfaces.some((surface) => surface === "browser" || surface === "screenshot");
const hasApiRuntimeSurface = (surfaces) => surfaces.includes("api");
const shouldUseCommandRuntime = (projectKind, targetFamily, surfaces) => commandPrimaryTargetFamilies.has(targetFamily) ||
    isCommandFirstProjectKind(projectKind) ||
    (surfaces.length > 0 &&
        !hasBrowserRuntimeSurface(surfaces) &&
        !hasApiRuntimeSurface(surfaces));
const defaultRuntimeStrategyForPlan = (input) => {
    if (shouldUseCommandRuntime(input.projectKind, input.targetFamily, input.verificationSurfaces)) {
        if (input.projectKind === "cli_tool" || input.targetFamily === "cli-tool") {
            return {
                run_command: "npm run start -- --help",
                check_command: "npm test"
            };
        }
        return {
            check_command: "npm test"
        };
    }
    return defaultRuntimeStrategyForFamily(input.targetFamily);
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
    return coreFeatures.slice(0, 3).map((workflow, index) => {
        const check = {
            workflow,
            surface,
            trigger: `${workflow} action`,
            expected_result: surface === "browser" || surface === "screenshot"
                ? `${workflow} succeeds visibly.`
                : `${workflow} succeeds with inspectable evidence.`
        };
        if (browserLikeSurfaces.has(surface)) {
            check.selector_hints = selectorHintsForWorkflow(index);
        }
        if (surface === "api") {
            check.api_hint = {
                method: "GET",
                path: `quality/features/feature-${index + 1}`,
                expected_status: 200,
                expected_json_path: "status",
                expected_value: "ready"
            };
        }
        if (commandLikeSurfaces.has(surface)) {
            check.command_hint = {
                command: "npm test",
                expected_output: workflow
            };
        }
        return check;
    });
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
            expected_result: `${feature} succeeds with inspectable evidence.`,
            ...(browserLikeSurfaces.has(fallbackSurface)
                ? { selector_hints: selectorHintsForWorkflow(index) }
                : {})
        };
        if (!matched) {
            return fallback;
        }
        return {
            ...matched,
            workflow: feature,
            surface: fallbackSurface,
            trigger: matched.trigger ?? feature,
            ...(browserLikeSurfaces.has(fallbackSurface)
                ? { selector_hints: matched.selector_hints ?? selectorHintsForWorkflow(index) }
                : { selector_hints: undefined })
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
    if (/(?:browser|\bui\b|\uD654\uBA74|\uBE0C\uB77C\uC6B0\uC800|\uC6F9\uC571|\uD504\uB860\uD2B8\uC5D4\uB4DC)/u.test(normalized)) {
        surfaces.push("browser");
    }
    if (/(?:screenshot|screen capture|캡처|스크린샷|screen)/u.test(normalized)) {
        surfaces.push("screenshot");
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
    if (/(?:shell|bash|powershell|sh\b|셸)/.test(normalized)) {
        surfaces.push("shell");
    }
    if (/(?:\uD30C\uC77C|file)/.test(normalized)) {
        surfaces.push("file");
    }
    if (/(?:db|database|\uB370\uC774\uD130\uBCA0\uC774\uC2A4|sqlite|postgres|mysql)/.test(normalized)) {
        surfaces.push("db");
    }
    if (/(?:agent conversation|conversation|sample conversation|대화|에이전트 응답)/u.test(normalized)) {
        surfaces.push("agent_conversation");
    }
    if (/(?:document|markdown|report|문서|보고서|기획서)/u.test(normalized)) {
        surfaces.push("document");
    }
    if (/(?:package import|import test|library import|패키지 import|라이브러리)/u.test(normalized)) {
        surfaces.push("package_import");
    }
    if (/(?:manual review|human review|수동 검토|사람 검토)/u.test(normalized)) {
        surfaces.push("manual_review");
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
const commandForWorkflowSurface = (surface, runtimeStrategy) => {
    if (surface === "test" || surface === "package_import") {
        return runtimeStrategy.check_command ?? runtimeStrategy.run_command;
    }
    return runtimeStrategy.run_command ?? runtimeStrategy.check_command;
};
const enrichCommandWorkflowChecks = (checks, runtimeStrategy) => checks.map((check) => {
    if (!commandLikeSurfaces.has(check.surface)) {
        return check;
    }
    const command = commandForWorkflowSurface(check.surface, runtimeStrategy);
    if (!command) {
        return check;
    }
    return {
        ...check,
        command_hint: {
            ...(check.command_hint ?? {}),
            command
        }
    };
});
export const buildAdapterPlanFromIntake = (input) => {
    const surfaceInput = surfacesFromIntake(input.intake);
    const verificationSurfaces = normalizeVerificationSurfacesForFamily(input.targetFamily, surfaceInput);
    const defaultRuntime = defaultRuntimeStrategyForPlan({
        targetFamily: input.targetFamily,
        projectKind: input.intake.project_kind,
        verificationSurfaces
    });
    const runtimeStrategy = {
        run_command: input.intake.run_command ?? defaultRuntime.run_command,
        check_command: input.intake.check_command ?? defaultRuntime.check_command
    };
    const commandRuntime = shouldUseCommandRuntime(input.intake.project_kind, input.targetFamily, verificationSurfaces);
    if (!commandRuntime) {
        runtimeStrategy.ready_url = input.intake.ready_url ?? defaultRuntime.ready_url;
        runtimeStrategy.app_url = input.intake.app_url ?? defaultRuntime.app_url;
        runtimeStrategy.api_base_url =
            input.intake.api_base_url ?? defaultRuntime.api_base_url;
        runtimeStrategy.health_url = input.intake.health_url ?? defaultRuntime.health_url;
    }
    const rawWorkflowChecks = input.intake.workflow_checks?.length
        ? input.intake.core_features?.length
            ? alignWorkflowChecksToCoreFeatures(input.intake.core_features, input.intake.workflow_checks, verificationSurfaces)
            : input.intake.workflow_checks
        : defaultWorkflowChecksFromCoreFeatures(input.intake.core_features ?? [], verificationSurfaces);
    const workflowChecks = enrichCommandWorkflowChecks(rawWorkflowChecks, runtimeStrategy);
    return {
        target_family: input.targetFamily,
        verification_surfaces: verificationSurfaces,
        runtime_strategy: runtimeStrategy,
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