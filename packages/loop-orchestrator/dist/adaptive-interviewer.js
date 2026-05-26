import { evidenceSurfacesForProjectKind, inferProjectKindFromText } from "./evaluation-policy.js";
const unique = (values) => [...new Set(values)];
const workflowQuestionFor = (projectKind) => {
    switch (projectKind) {
        case "cli_tool":
            return "Give the top CLI workflow as command -> expected stdout/file result.";
        case "library_package":
            return "Give the top package workflow as import/API call -> expected result.";
        case "agent_workflow":
            return "Give one representative user prompt -> expected agent response outcome.";
        case "document_artifact":
            return "Give the required document artifact -> expected sections or quality outcome.";
        case "data_pipeline":
            return "Give the top data workflow as input file -> transformed output or report.";
        case "automation":
            return "Give the scheduled or shell workflow as trigger -> observable result.";
        case "api_service":
            return "Give the top API workflow as request -> status/body assertion.";
        case "browser_ui":
        case "mobile_ui":
            return "Give the top user workflow as action -> visible screen result.";
        case "generic":
            return "For each core workflow, what action and result prove success?";
    }
};
const verificationQuestionFor = (projectKind, evidenceSurfaces) => {
    const surfaceList = evidenceSurfaces.join(", ");
    switch (projectKind) {
        case "cli_tool":
        case "data_pipeline":
            return `This looks command/file oriented. Should success be proven with ${surfaceList}, and what command or output file matters most?`;
        case "library_package":
            return `This looks like a library/package. Should success be proven with ${surfaceList}, and what import example matters most?`;
        case "api_service":
            return `This looks API oriented. Which endpoint response, status code, or API test should prove success?`;
        case "agent_workflow":
            return `This looks agent oriented. Which sample conversation or task transcript should prove success?`;
        case "document_artifact":
            return `This looks document oriented. What file, section structure, or review evidence should prove success?`;
        case "automation":
            return `This looks automation oriented. What shell result, file, or test evidence should prove the automation ran?`;
        case "browser_ui":
        case "mobile_ui":
            return "This looks visual. Should the loop verify it with browser, screenshot, or test evidence?";
        case "generic":
            return "How should the loop verify this result: browser, API, CLI, test, file, DB, agent conversation, document, package import, or manual review?";
    }
};
const qualityQuestionFor = (projectKind) => {
    switch (projectKind) {
        case "browser_ui":
        case "mobile_ui":
            return "Which visual quality dimensions should be scored as required, such as cleanliness, no noisy text, or app-like feel?";
        case "cli_tool":
        case "data_pipeline":
            return "Which output-quality dimensions should be scored as required, such as stable format, clear errors, or useful summaries?";
        case "library_package":
            return "Which package-quality dimensions should be scored as required, such as API ergonomics, examples, or import stability?";
        case "agent_workflow":
            return "Which agent-quality dimensions should be scored as required, such as grounding, consistency, or tool-use safety?";
        case "document_artifact":
            return "Which document-quality dimensions should be scored as required, such as structure, completeness, or consistency?";
        default:
            return "Which extra quality dimensions should be scored as required?";
    }
};
const failureQuestionFor = (projectKind) => {
    switch (projectKind) {
        case "cli_tool":
            return "What failure case should the CLI handle, such as missing files, empty input, or malformed lines?";
        case "api_service":
            return "What failure case should the API handle, such as invalid input, missing records, or stale writes?";
        case "library_package":
            return "What failure case should package users see, such as invalid arguments or unsupported input?";
        case "agent_workflow":
            return "What bad response should fail evaluation, such as hallucination, unsafe tool use, or missing citations?";
        case "document_artifact":
            return "What document defect should fail review, such as missing required sections or inconsistent claims?";
        default:
            return "What failure case should be tested before the loop can pass?";
    }
};
export const buildAdaptiveQuestionSet = (input) => {
    const projectKind = input.projectKind ??
        (() => {
            const inferred = inferProjectKindFromText(input.request);
            return inferred === "generic" ? "generic" : inferred;
        })();
    const evidenceSurfaces = unique([
        ...(input.explicitEvidenceSurfaces ?? []),
        ...evidenceSurfacesForProjectKind(projectKind)
    ]);
    const candidates = [
        {
            id: "verification_surface",
            question: verificationQuestionFor(projectKind, evidenceSurfaces),
            why_it_matters: "The evaluator needs an evidence surface before it can judge real behavior instead of prose.",
            value_score: input.hasVerificationSurface ? 0 : 100,
            project_kind: projectKind,
            evidence_surfaces: evidenceSurfaces
        },
        {
            id: "workflow_checks",
            question: workflowQuestionFor(projectKind),
            why_it_matters: "A loop cannot prove completion without at least one concrete action and expected result.",
            value_score: input.hasWorkflowChecks ? 0 : 95,
            project_kind: projectKind,
            evidence_surfaces: evidenceSurfaces
        },
        {
            id: "quality_metrics",
            question: qualityQuestionFor(projectKind),
            why_it_matters: "User-authored quality dimensions decide whether a high total score is actually acceptable.",
            value_score: input.hasCustomQualityMetrics ? 0 : 55,
            project_kind: projectKind,
            evidence_surfaces: evidenceSurfaces
        },
        {
            id: "failure_expectations",
            question: failureQuestionFor(projectKind),
            why_it_matters: "The highest-risk failure case helps the harness avoid passing a shallow happy-path implementation.",
            value_score: input.hasFailureExpectations ? 0 : 45,
            project_kind: projectKind,
            evidence_surfaces: evidenceSurfaces
        }
    ];
    const selectedQuestions = candidates
        .filter((candidate) => candidate.value_score > 0)
        .sort((left, right) => right.value_score - left.value_score)
        .slice(0, input.maxQuestions ?? 3);
    return {
        project_kind: projectKind,
        evidence_surfaces: evidenceSurfaces,
        selected_questions: selectedQuestions,
        by_field: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate]))
    };
};
//# sourceMappingURL=adaptive-interviewer.js.map