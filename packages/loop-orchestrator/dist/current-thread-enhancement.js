import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { resolvedAdapterTargetRoot } from "./adapter-paths.js";
import { buildExecutorModePrompt } from "./codex-agent-manifest.js";
import { loadJsonIfExists, repoRoot, writeJson, writeText } from "./file-system.js";
const validFocusAreas = new Set([
    "planner_clarity",
    "contract_testability",
    "artifact_handoff",
    "patch_authority",
    "qa_rigor",
    "runtime_portability"
]);
const verdictSeverity = {
    advance: 0,
    revise: 1,
    hold: 2
};
const rel = (path) => relative(repoRoot, path);
const unique = (values) => [...new Set(values)];
const checkpointSeqForNewTask = () => Date.now();
const buildCheckpointId = (input) => [
    input.runId,
    `r${input.round ?? 0}`,
    input.phase,
    input.stage,
    String(input.checkpointSeq)
].join(":");
const trimString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
const stringList = (value, limit = 12) => Array.isArray(value)
    ? unique(value
        .map((entry) => trimString(entry))
        .filter((entry) => Boolean(entry))).slice(0, limit)
    : [];
const extractJsonText = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.startsWith("```")) {
        const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        if (fenced.trim()) {
            return fenced.trim();
        }
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
};
const parseJsonResponse = (raw) => {
    try {
        return JSON.parse(raw);
    }
    catch {
        const candidate = extractJsonText(raw);
        if (!candidate) {
            return undefined;
        }
        try {
            return JSON.parse(candidate);
        }
        catch {
            return undefined;
        }
    }
};
const strictestVerdict = (base, candidate) => {
    if (!candidate) {
        return base;
    }
    return verdictSeverity[candidate] > verdictSeverity[base] ? candidate : base;
};
const readTextIfExists = async (path) => {
    try {
        return await readFile(path, "utf8");
    }
    catch (error) {
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")) {
            return undefined;
        }
        throw error;
    }
};
const promptText = (input) => [
    "# Current-Thread Enhancement Task",
    "",
    `Run id: ${input.task.run_id}`,
    `Round: ${input.task.round ?? "bootstrap"}`,
    `Phase: ${input.task.phase}`,
    `Stage: ${input.task.stage}`,
    `Checkpoint id: ${input.task.checkpoint_id}`,
    `Prompt path: ${rel(input.task.prompt_path)}`,
    `Response path: ${rel(input.task.response_path)}`,
    "",
    "Keep this work on the same current-thread operator surface.",
    "Do not call nested `codex exec` or `codex exec resume`.",
    `Write JSON only to ${rel(input.task.response_path)}.`,
    `Echo "checkpoint_id": "${input.task.checkpoint_id}" in the JSON response.`,
    "If no changes are needed, write an empty patch object plus the checkpoint_id.",
    "",
    "## Summary",
    input.task.summary,
    "",
    "## Context paths",
    ...Object.entries(input.task.context_paths).map(([label, path]) => `- ${label}: ${rel(path)}`),
    "",
    "## Notes",
    ...(input.task.notes?.length ? input.task.notes.map((note) => `- ${note}`) : ["- none"]),
    "",
    "## Enhancement prompt",
    input.preparedPrompt.prompt
].join("\n");
const writeCurrentThreadEnhancementTask = async (input) => {
    const checkpointSeq = input.checkpointSeq ?? checkpointSeqForNewTask();
    const checkpointId = input.checkpointId ??
        buildCheckpointId({
            runId: input.runId,
            round: input.round,
            phase: input.phase,
            stage: input.stage,
            checkpointSeq
        });
    const task = {
        run_id: input.runId,
        ...(input.round !== undefined ? { round: input.round } : {}),
        phase: input.phase,
        stage: input.stage,
        controller_mode: "attached",
        transport_mode: "current-thread",
        checkpoint_id: checkpointId,
        checkpoint_seq: checkpointSeq,
        prompt_path: input.promptPath,
        response_path: input.responsePath,
        ...(input.transportProtocolPath
            ? { transport_protocol_path: input.transportProtocolPath }
            : {}),
        summary: input.summary,
        context_paths: input.contextPaths,
        ...(input.notes?.length ? { notes: input.notes } : {}),
        created_at: new Date().toISOString()
    };
    await Promise.all([
        writeJson(input.taskPath, task),
        writeText(input.promptPath, promptText({
            task,
            preparedPrompt: input.preparedPrompt
        }))
    ]);
    return task;
};
const invalidCheckpointResponseWarnings = (input) => [
    ...(input.warning ? [input.warning] : []),
    input.reason === "missing"
        ? `Current-thread ${input.stageLabel} response omitted checkpoint_id${input.expectedCheckpointId ? `; expected '${input.expectedCheckpointId}'.` : "."}`
        : `Current-thread ${input.stageLabel} response checkpoint_id '${input.actualCheckpointId ?? "missing"}' did not match '${input.expectedCheckpointId ?? "missing"}'.`,
    input.fallbackMessage
];
const buildPlannerEnhancementPrompt = async (input) => {
    const basePrompt = [
        "You are the planner for a generic Codex workbench with a closed-loop harness engine.",
        "Do not modify files or run commands. Read the input and return JSON only.",
        "Keep the response concise and specific.",
        "",
        "Return JSON with this shape:",
        "{",
        '  "scenario_title": "optional string",',
        '  "scenario_description": "optional string",',
        '  "user_goals": ["optional strings"],',
        '  "acceptance_highlights": ["optional strings"],',
        '  "planner_focus_areas": ["planner_clarity|contract_testability|artifact_handoff|patch_authority|qa_rigor|runtime_portability"],',
        '  "north_star": "optional string",',
        '  "attempt_strategy": "optional string",',
        '  "planner_notes": ["optional strings"],',
        '  "remediation_policy": ["optional strings"]',
        "}",
        "",
        "# Idea brief",
        JSON.stringify(input.idea, null, 2),
        "",
        "# Existing scenario",
        JSON.stringify(input.scenario, null, 2),
        "",
        "# Existing plan",
        JSON.stringify(input.plan, null, 2),
        "",
        "# Rubric",
        JSON.stringify(input.rubric, null, 2)
    ].join("\n");
    return buildExecutorModePrompt({
        executorMode: input.executorMode,
        role: "planner",
        prompt: basePrompt
    });
};
const applyPlannerEnhancementResponse = (input) => {
    const parsed = parseJsonResponse(input.responseText);
    if (!parsed) {
        return {
            value: {
                scenario: input.scenario,
                plan: input.plan
            },
            runtimeWarnings: [
                ...(input.warning ? [input.warning] : []),
                "Current-thread planner enhancement response was not valid JSON; deterministic planner output remains active."
            ],
            usedResponse: false
        };
    }
    if (input.expectedCheckpointId && trimString(parsed.checkpoint_id) !== input.expectedCheckpointId) {
        return {
            value: {
                scenario: input.scenario,
                plan: input.plan
            },
            runtimeWarnings: invalidCheckpointResponseWarnings({
                warning: input.warning,
                stageLabel: "planner enhancement",
                expectedCheckpointId: input.expectedCheckpointId,
                actualCheckpointId: trimString(parsed.checkpoint_id),
                reason: trimString(parsed.checkpoint_id) ? "mismatch" : "missing",
                fallbackMessage: "Deterministic planner output remains active until the matching checkpoint response is written."
            }),
            usedResponse: false
        };
    }
    const focusAreas = Array.isArray(parsed.planner_focus_areas)
        ? unique(parsed.planner_focus_areas.filter((focus) => validFocusAreas.has(focus)))
        : [];
    return {
        value: {
            scenario: {
                ...input.scenario,
                ...(trimString(parsed.scenario_title) ? { title: trimString(parsed.scenario_title) } : {}),
                ...(trimString(parsed.scenario_description)
                    ? { description: trimString(parsed.scenario_description) }
                    : {}),
                ...(stringList(parsed.user_goals).length > 0
                    ? { user_goals: stringList(parsed.user_goals) }
                    : {}),
                ...(stringList(parsed.acceptance_highlights).length > 0
                    ? { acceptance_highlights: stringList(parsed.acceptance_highlights) }
                    : {})
            },
            plan: {
                ...input.plan,
                ...(trimString(parsed.north_star) ? { north_star: trimString(parsed.north_star) } : {}),
                ...(trimString(parsed.attempt_strategy)
                    ? { attempt_strategy: trimString(parsed.attempt_strategy) }
                    : {}),
                ...(focusAreas.length > 0 ? { planner_focus_areas: focusAreas } : {}),
                ...(stringList(parsed.planner_notes).length > 0
                    ? {
                        planner_notes: unique([
                            ...stringList(parsed.planner_notes),
                            ...input.plan.planner_notes
                        ]).slice(0, 12)
                    }
                    : {}),
                ...(stringList(parsed.remediation_policy).length > 0
                    ? {
                        remediation_policy: unique([
                            ...stringList(parsed.remediation_policy),
                            ...input.plan.remediation_policy
                        ]).slice(0, 12)
                    }
                    : {})
            }
        },
        runtimeWarnings: input.warning ? [input.warning] : [],
        usedResponse: true
    };
};
const buildContractReviewEnhancementPrompt = async (input) => {
    const basePrompt = [
        "You are the evaluator reviewing a round contract for a generic Codex workbench harness.",
        "Do not modify files or run commands. Return JSON only.",
        "Be conservative. Reject unclear or untestable contracts.",
        "",
        "Return JSON with this shape:",
        "{",
        '  "decision": "accept|revise",',
        '  "concerns": ["optional strings"],',
        '  "required_changes": ["optional strings"],',
        '  "approved_checks": ["optional check ids from the contract"],',
        '  "adapter_ready": true,',
        '  "static_blockers": ["optional strings"]',
        "}",
        "",
        "# Contract artifact",
        JSON.stringify(input.contractArtifact, null, 2),
        "",
        "# Current deterministic review",
        JSON.stringify(input.contractReviewArtifact, null, 2),
        "",
        "# Adapter summary",
        JSON.stringify(input.loadedAdapter
            ? {
                adapter_id: input.loadedAdapter.contract.adapter_id,
                verifier_id: input.loadedAdapter.contract.verification_provider?.provider_id,
                target_root: resolvedAdapterTargetRoot(input.loadedAdapter),
                target_family: input.loadedAdapter.verification_profile?.profile.target_family,
                validation_lane: input.loadedAdapter.verification_profile?.profile.validation_lane
            }
            : { adapter_attached: false }, null, 2)
    ].join("\n");
    return buildExecutorModePrompt({
        executorMode: input.executorMode,
        role: "evaluator",
        prompt: basePrompt
    });
};
const applyContractReviewEnhancementResponse = (input) => {
    const parsed = parseJsonResponse(input.responseText);
    if (!parsed) {
        return {
            value: input.contractReviewArtifact,
            runtimeWarnings: [
                ...(input.warning ? [input.warning] : []),
                "Current-thread contract-review enhancement response was not valid JSON; deterministic contract review remains active."
            ],
            usedResponse: false
        };
    }
    if (input.expectedCheckpointId && trimString(parsed.checkpoint_id) !== input.expectedCheckpointId) {
        return {
            value: input.contractReviewArtifact,
            runtimeWarnings: invalidCheckpointResponseWarnings({
                warning: input.warning,
                stageLabel: "contract-review enhancement",
                expectedCheckpointId: input.expectedCheckpointId,
                actualCheckpointId: trimString(parsed.checkpoint_id),
                reason: trimString(parsed.checkpoint_id) ? "mismatch" : "missing",
                fallbackMessage: "Deterministic contract review remains active until the matching checkpoint response is written."
            }),
            usedResponse: false
        };
    }
    const approvedChecks = stringList(parsed.approved_checks).filter((checkId) => input.contractArtifact.acceptance_checks.includes(checkId));
    const concerns = unique([
        ...input.contractReviewArtifact.concerns,
        ...stringList(parsed.concerns)
    ]).slice(0, 12);
    const requiredChanges = unique([
        ...input.contractReviewArtifact.required_changes,
        ...stringList(parsed.required_changes)
    ]).slice(0, 12);
    const staticBlockers = unique([
        ...input.contractReviewArtifact.static_blockers,
        ...stringList(parsed.static_blockers)
    ]).slice(0, 12);
    const mergedDecision = requiredChanges.length > 0 ||
        staticBlockers.length > 0 ||
        parsed.decision === "revise" ||
        input.contractReviewArtifact.decision === "revise"
        ? "revise"
        : "accept";
    return {
        value: {
            ...input.contractReviewArtifact,
            decision: mergedDecision,
            concerns,
            required_changes: requiredChanges,
            approved_checks: approvedChecks.length > 0
                ? approvedChecks
                : input.contractReviewArtifact.approved_checks,
            adapter_ready: input.contractReviewArtifact.adapter_ready &&
                (typeof parsed.adapter_ready === "boolean" ? parsed.adapter_ready : true),
            static_blockers: staticBlockers
        },
        runtimeWarnings: input.warning ? [input.warning] : [],
        usedResponse: true
    };
};
const buildGeneratorPlanEnhancementPrompt = async (input) => {
    const basePrompt = [
        "You are the generator planner for a generic Codex workbench harness.",
        "Do not edit files or run commands. Return JSON only.",
        "Focus on the smallest coherent implementation plan for the current round.",
        "",
        "Return JSON with this shape:",
        "{",
        '  "implementation_intent": "optional string",',
        '  "files_to_touch": ["optional strings"],',
        '  "expected_proof": ["optional strings"],',
        '  "risk_notes": ["optional strings"],',
        '  "out_of_scope": ["optional strings"],',
        '  "adapter_actions": ["optional strings"]',
        "}",
        "",
        "# Idea brief",
        JSON.stringify(input.idea, null, 2),
        "",
        "# Round contract",
        JSON.stringify(input.contractArtifact, null, 2),
        "",
        "# Contract agreement",
        JSON.stringify(input.contractAgreementArtifact, null, 2),
        "",
        "# Current generator plan",
        JSON.stringify(input.generatorPlanArtifact, null, 2),
        "",
        "# Previous patch request",
        JSON.stringify(input.previousPatchRequest ?? null, null, 2)
    ].join("\n");
    return buildExecutorModePrompt({
        executorMode: input.executorMode,
        role: "generator",
        prompt: basePrompt
    });
};
const applyGeneratorPlanEnhancementResponse = (input) => {
    const parsed = parseJsonResponse(input.responseText);
    if (!parsed) {
        return {
            value: input.generatorPlanArtifact,
            runtimeWarnings: [
                ...(input.warning ? [input.warning] : []),
                "Current-thread generator-plan enhancement response was not valid JSON; deterministic generator plan remains active."
            ],
            usedResponse: false
        };
    }
    if (input.expectedCheckpointId && trimString(parsed.checkpoint_id) !== input.expectedCheckpointId) {
        return {
            value: input.generatorPlanArtifact,
            runtimeWarnings: invalidCheckpointResponseWarnings({
                warning: input.warning,
                stageLabel: "generator-plan enhancement",
                expectedCheckpointId: input.expectedCheckpointId,
                actualCheckpointId: trimString(parsed.checkpoint_id),
                reason: trimString(parsed.checkpoint_id) ? "mismatch" : "missing",
                fallbackMessage: "Deterministic generator plan remains active until the matching checkpoint response is written."
            }),
            usedResponse: false
        };
    }
    return {
        value: {
            ...input.generatorPlanArtifact,
            ...(trimString(parsed.implementation_intent)
                ? { implementation_intent: trimString(parsed.implementation_intent) }
                : {}),
            files_to_touch: unique([
                ...input.generatorPlanArtifact.files_to_touch,
                ...stringList(parsed.files_to_touch, 20)
            ]).slice(0, 20),
            expected_proof: unique([
                ...input.generatorPlanArtifact.expected_proof,
                ...stringList(parsed.expected_proof, 20)
            ]).slice(0, 20),
            risk_notes: unique([
                ...stringList(parsed.risk_notes, 12),
                ...input.generatorPlanArtifact.risk_notes
            ]).slice(0, 12),
            out_of_scope: unique([
                ...input.generatorPlanArtifact.out_of_scope,
                ...stringList(parsed.out_of_scope, 12)
            ]).slice(0, 12),
            adapter_actions: unique([
                ...input.generatorPlanArtifact.adapter_actions,
                ...stringList(parsed.adapter_actions, 12)
            ]).slice(0, 12)
        },
        runtimeWarnings: input.warning ? [input.warning] : [],
        usedResponse: true
    };
};
const buildEvalEnhancementPrompt = async (input) => {
    const basePrompt = [
        "You are a fresh independent evaluator for a generic Codex workbench harness.",
        "Do not modify files or run commands. Return JSON only.",
        "Blind mode is mandatory: judge only the current round inputs in this prompt.",
        "Do not use, request, infer, or compare against any previous round evaluator response, scorecard, eval_report, patch_request, or quality_critique.",
        "Do not consider earlier round scores, verdicts, unresolved ids, or quality judgments when choosing this round verdict.",
        "Previous patch-request resolution is computed separately by carry_forward_gate, not by evaluator scoring.",
        "Be conservative. If uncertain, prefer revise over advance and hold over revise when the evidence looks fundamentally blocked.",
        "",
        "Return JSON with this shape:",
        "{",
        '  "overall_verdict": "advance|revise|hold",',
        '  "strengths": ["optional strings"],',
        '  "blockers": ["optional strings"],',
        '  "next_actions": ["optional strings"]',
        "}",
        "",
        "# Idea brief",
        JSON.stringify({
            title: input.idea.title,
            summary: input.idea.summary,
            user_goals: input.idea.user_goals,
            constraints: input.idea.constraints,
            quality_bar: input.idea.quality_bar
        }, null, 2),
        "",
        "# Round contract",
        JSON.stringify(input.contractArtifact, null, 2),
        "",
        "# Generator plan",
        JSON.stringify(input.generatorPlanArtifact, null, 2),
        "",
        "# Deterministic eval report",
        JSON.stringify({
            total_score: input.evalReport.total_score,
            control_plane_score: input.evalReport.control_plane_score,
            proof_score: input.evalReport.proof_score,
            release_score: input.evalReport.release_score,
            overall_verdict: input.evalReport.overall_verdict,
            blockers: input.evalReport.blockers,
            next_actions: input.evalReport.next_actions,
            threshold_gap_details: input.evalReport.threshold_gap_details,
            unresolved_check_ids: input.evalReport.unresolved_check_ids
        }, null, 2),
        "",
        "# Adapter execution summary",
        JSON.stringify(input.adapterExecutions.map((execution) => ({
            capability: execution.capability,
            ok: execution.result.ok,
            provider_role: execution.provider_role,
            summary: execution.result.summary,
            findings: execution.result.findings,
            verified_evidence_paths: execution.verified_evidence_paths,
            criteria_results: execution.verified_criteria_results.map((criterion) => ({
                criterion_id: criterion.criterion_id,
                status: criterion.status,
                summary: criterion.summary
            }))
        })), null, 2),
        "",
        "# Core probe summary",
        JSON.stringify(input.coreProbeResults.map((probe) => ({
            probe_id: probe.probe_id,
            ok: probe.ok,
            role: probe.role,
            mode: probe.mode,
            summary: probe.summary,
            observed_value: probe.observed_value,
            evidence_paths: probe.evidence_paths
        })), null, 2),
        "",
        "# Target manifest",
        JSON.stringify(input.targetManifest ?? null, null, 2)
    ].join("\n");
    return buildExecutorModePrompt({
        executorMode: input.executorMode,
        role: "evaluator",
        prompt: basePrompt
    });
};
const applyEvalEnhancementResponse = (input) => {
    const parsed = parseJsonResponse(input.responseText);
    if (!parsed) {
        return {
            value: input.evalReport,
            runtimeWarnings: [
                ...(input.warning ? [input.warning] : []),
                "Current-thread evaluator enhancement response was not valid JSON; deterministic evaluator report remains active."
            ],
            usedResponse: false
        };
    }
    if (input.expectedCheckpointId && trimString(parsed.checkpoint_id) !== input.expectedCheckpointId) {
        return {
            value: input.evalReport,
            runtimeWarnings: invalidCheckpointResponseWarnings({
                warning: input.warning,
                stageLabel: "evaluator enhancement",
                expectedCheckpointId: input.expectedCheckpointId,
                actualCheckpointId: trimString(parsed.checkpoint_id),
                reason: trimString(parsed.checkpoint_id) ? "mismatch" : "missing",
                fallbackMessage: "Deterministic evaluator report remains active until the matching checkpoint response is written."
            }),
            usedResponse: false
        };
    }
    const mergedVerdict = strictestVerdict(input.evalReport.overall_verdict, parsed.overall_verdict);
    const thresholdResults = mergedVerdict === input.evalReport.overall_verdict
        ? input.evalReport.threshold_results
        : {
            ...input.evalReport.threshold_results,
            contract_completed: false,
            target_reached_eligible: false
        };
    return {
        value: {
            ...input.evalReport,
            overall_verdict: mergedVerdict,
            strengths: unique([
                ...input.evalReport.strengths,
                ...stringList(parsed.strengths, 10)
            ]).slice(0, 10),
            blockers: unique([
                ...input.evalReport.blockers,
                ...stringList(parsed.blockers, 10)
            ]).slice(0, 10),
            next_actions: unique([
                ...stringList(parsed.next_actions, 10),
                ...input.evalReport.next_actions
            ]).slice(0, 10),
            threshold_results: thresholdResults
        },
        runtimeWarnings: input.warning ? [input.warning] : [],
        usedResponse: true
    };
};
const checkpointNotesFor = (input) => input.invalidResponse
    ? [
        `Current-thread ${input.stageLabel} response is invalid${input.round !== undefined ? ` for round ${input.round}` : ""}.`,
        `Rewrite ${input.responsePath} with JSON only after reviewing ${input.promptPath} on the current Codex thread and echoing checkpoint_id '${input.checkpointId}'.`,
        "Then continue the same-thread autocontinue chain with $loop-control or recover through $attached-loop if the foreground thread was interrupted."
    ]
    : [
        `Current-thread ${input.stageLabel} checkpoint is ready${input.round !== undefined ? ` for round ${input.round}` : ""}.`,
        `The same Codex thread should review ${input.promptPath}, write ${input.responsePath}, and echo checkpoint_id '${input.checkpointId}'.`,
        "This is a same-thread Codex checkpoint, not a human decision stop."
    ];
export const enhancePlanWithCurrentThread = async (input) => {
    const preparedPrompt = await buildPlannerEnhancementPrompt({
        idea: input.idea,
        rubric: input.rubric,
        scenario: input.scenario,
        plan: input.plan,
        executorMode: input.executorMode
    });
    await Promise.all([
        writeJson(input.plannedScenarioPath, input.scenario),
        writeJson(input.planPath, input.plan)
    ]);
    const existingTask = await loadJsonIfExists(input.runtimePaths.plannerEnhancementTaskPath);
    const rawResponse = await readTextIfExists(input.runtimePaths.plannerEnhancementResponsePath);
    if (rawResponse !== undefined) {
        const applied = applyPlannerEnhancementResponse({
            scenario: input.scenario,
            plan: input.plan,
            responseText: rawResponse,
            expectedCheckpointId: existingTask?.checkpoint_id,
            warning: preparedPrompt.warning
        });
        if (applied.usedResponse) {
            return {
                kind: "completed",
                value: applied.value,
                runtimeWarnings: [
                    ...applied.runtimeWarnings,
                    `Current-thread planner enhancement completed from ${input.runtimePaths.plannerEnhancementResponsePath}.`
                ]
            };
        }
    }
    const invalidResponse = rawResponse !== undefined;
    const checkpointId = existingTask?.checkpoint_id ??
        buildCheckpointId({
            runId: input.runId,
            phase: "planning",
            stage: "planner",
            checkpointSeq: existingTask?.checkpoint_seq ?? checkpointSeqForNewTask()
        });
    const checkpointSeq = existingTask?.checkpoint_seq ?? Number(checkpointId.split(":").at(-1));
    const notes = checkpointNotesFor({
        stageLabel: "planner enhancement",
        checkpointId,
        promptPath: rel(input.runtimePaths.plannerEnhancementPromptPath),
        responsePath: rel(input.runtimePaths.plannerEnhancementResponsePath),
        invalidResponse
    });
    await writeCurrentThreadEnhancementTask({
        runId: input.runId,
        phase: "planning",
        stage: "planner",
        checkpointId,
        checkpointSeq,
        taskPath: input.runtimePaths.plannerEnhancementTaskPath,
        promptPath: input.runtimePaths.plannerEnhancementPromptPath,
        responsePath: input.runtimePaths.plannerEnhancementResponsePath,
        preparedPrompt,
        transportProtocolPath: input.transportProtocolPath,
        summary: "Review the planner scenario and plan, then write a JSON patch response.",
        contextPaths: {
            planned_scenario_path: input.plannedScenarioPath,
            plan_path: input.planPath
        },
        notes
    });
    return {
        kind: "checkpoint",
        consumer: "codex",
        checkpointKind: "planner",
        autoResumeEligible: true,
        notes,
        artifacts: {
            planner_enhancement_task_path: input.runtimePaths.plannerEnhancementTaskPath,
            planner_enhancement_prompt_path: input.runtimePaths.plannerEnhancementPromptPath,
            planner_enhancement_response_path: input.runtimePaths.plannerEnhancementResponsePath
        }
    };
};
export const enhanceContractReviewWithCurrentThread = async (input) => {
    const preparedPrompt = await buildContractReviewEnhancementPrompt({
        contractArtifact: input.contractArtifact,
        contractReviewArtifact: input.contractReviewArtifact,
        loadedAdapter: input.loadedAdapter,
        executorMode: input.executorMode
    });
    const existingTask = await loadJsonIfExists(input.artifacts.contract_review_enhancement_task_path);
    const rawResponse = await readTextIfExists(input.artifacts.contract_review_enhancement_response_path);
    if (rawResponse !== undefined) {
        const applied = applyContractReviewEnhancementResponse({
            contractArtifact: input.contractArtifact,
            contractReviewArtifact: input.contractReviewArtifact,
            responseText: rawResponse,
            expectedCheckpointId: existingTask?.checkpoint_id,
            warning: preparedPrompt.warning
        });
        if (applied.usedResponse) {
            return {
                kind: "completed",
                value: applied.value,
                runtimeWarnings: [
                    ...applied.runtimeWarnings,
                    `Current-thread contract-review enhancement completed for round ${input.round} from ${input.artifacts.contract_review_enhancement_response_path}.`
                ]
            };
        }
    }
    const invalidResponse = rawResponse !== undefined;
    const checkpointId = existingTask?.checkpoint_id ??
        buildCheckpointId({
            runId: input.runId,
            round: input.round,
            phase: "negotiation",
            stage: "contract-review",
            checkpointSeq: existingTask?.checkpoint_seq ?? checkpointSeqForNewTask()
        });
    const checkpointSeq = existingTask?.checkpoint_seq ?? Number(checkpointId.split(":").at(-1));
    const notes = checkpointNotesFor({
        round: input.round,
        stageLabel: "contract-review enhancement",
        checkpointId,
        promptPath: rel(input.artifacts.contract_review_enhancement_prompt_path),
        responsePath: rel(input.artifacts.contract_review_enhancement_response_path),
        invalidResponse
    });
    await writeCurrentThreadEnhancementTask({
        runId: input.runId,
        round: input.round,
        phase: "negotiation",
        stage: "contract-review",
        checkpointId,
        checkpointSeq,
        taskPath: input.artifacts.contract_review_enhancement_task_path,
        promptPath: input.artifacts.contract_review_enhancement_prompt_path,
        responsePath: input.artifacts.contract_review_enhancement_response_path,
        preparedPrompt,
        transportProtocolPath: input.transportProtocolPath,
        summary: "Review the round contract and write a JSON patch response for the contract review.",
        contextPaths: {
            round_contract_path: input.artifacts.contract_json_path,
            contract_review_path: input.artifacts.contract_review_json_path
        },
        notes
    });
    return {
        kind: "checkpoint",
        consumer: "codex",
        checkpointKind: "contract-review",
        autoResumeEligible: true,
        notes,
        artifacts: {
            contract_review_enhancement_task_path: input.artifacts.contract_review_enhancement_task_path,
            contract_review_enhancement_prompt_path: input.artifacts.contract_review_enhancement_prompt_path,
            contract_review_enhancement_response_path: input.artifacts.contract_review_enhancement_response_path
        }
    };
};
export const enhanceGeneratorPlanWithCurrentThread = async (input) => {
    const preparedPrompt = await buildGeneratorPlanEnhancementPrompt({
        idea: input.idea,
        contractArtifact: input.contractArtifact,
        contractAgreementArtifact: input.contractAgreementArtifact,
        generatorPlanArtifact: input.generatorPlanArtifact,
        previousPatchRequest: input.previousPatchRequest,
        executorMode: input.executorMode
    });
    const existingTask = await loadJsonIfExists(input.artifacts.generator_plan_enhancement_task_path);
    const rawResponse = await readTextIfExists(input.artifacts.generator_plan_enhancement_response_path);
    if (rawResponse !== undefined) {
        const applied = applyGeneratorPlanEnhancementResponse({
            generatorPlanArtifact: input.generatorPlanArtifact,
            responseText: rawResponse,
            expectedCheckpointId: existingTask?.checkpoint_id,
            warning: preparedPrompt.warning
        });
        if (applied.usedResponse) {
            return {
                kind: "completed",
                value: applied.value,
                runtimeWarnings: [
                    ...applied.runtimeWarnings,
                    `Current-thread generator-plan enhancement completed for round ${input.round} from ${input.artifacts.generator_plan_enhancement_response_path}.`
                ]
            };
        }
    }
    const invalidResponse = rawResponse !== undefined;
    const checkpointId = existingTask?.checkpoint_id ??
        buildCheckpointId({
            runId: input.runId,
            round: input.round,
            phase: "negotiation",
            stage: "generator-plan",
            checkpointSeq: existingTask?.checkpoint_seq ?? checkpointSeqForNewTask()
        });
    const checkpointSeq = existingTask?.checkpoint_seq ?? Number(checkpointId.split(":").at(-1));
    const notes = checkpointNotesFor({
        round: input.round,
        stageLabel: "generator-plan enhancement",
        checkpointId,
        promptPath: rel(input.artifacts.generator_plan_enhancement_prompt_path),
        responsePath: rel(input.artifacts.generator_plan_enhancement_response_path),
        invalidResponse
    });
    await writeCurrentThreadEnhancementTask({
        runId: input.runId,
        round: input.round,
        phase: "negotiation",
        stage: "generator-plan",
        checkpointId,
        checkpointSeq,
        taskPath: input.artifacts.generator_plan_enhancement_task_path,
        promptPath: input.artifacts.generator_plan_enhancement_prompt_path,
        responsePath: input.artifacts.generator_plan_enhancement_response_path,
        preparedPrompt,
        transportProtocolPath: input.transportProtocolPath,
        summary: "Review the generator plan and write a JSON patch response for the current round.",
        contextPaths: {
            round_contract_path: input.artifacts.contract_json_path,
            contract_agreement_path: input.artifacts.contract_agreement_json_path,
            generator_plan_path: input.artifacts.generator_plan_json_path
        },
        notes
    });
    return {
        kind: "checkpoint",
        consumer: "codex",
        checkpointKind: "generator-plan",
        autoResumeEligible: true,
        notes,
        artifacts: {
            generator_plan_enhancement_task_path: input.artifacts.generator_plan_enhancement_task_path,
            generator_plan_enhancement_prompt_path: input.artifacts.generator_plan_enhancement_prompt_path,
            generator_plan_enhancement_response_path: input.artifacts.generator_plan_enhancement_response_path
        }
    };
};
export const enhanceEvalReportWithCurrentThread = async (input) => {
    return {
        kind: "completed",
        value: input.evalReport,
        runtimeWarnings: [
            `Current-thread evaluator enhancement is disabled in per-round blind evaluator mode for round ${input.round}; use the fresh read-only judge path instead.`
        ]
    };
};
//# sourceMappingURL=current-thread-enhancement.js.map