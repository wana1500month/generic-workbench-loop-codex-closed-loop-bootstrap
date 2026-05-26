import { readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { repoRoot, loadJsonIfExists, writeJson, writeText } from "./file-system.js";
import { approvalSemanticsForAdapterMigrationProposal } from "./adapter-migration.js";
const generatedLocalAuthoringPaths = [
    "adapter.generated.json",
    ".generated/codex-adapter/runtime-config.json",
    ".generated/codex-adapter/scripts"
];
const rel = (path) => relative(repoRoot, path);
const trimString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
const stringList = (value, limit = 16) => Array.isArray(value)
    ? [...new Set(value
            .map((entry) => trimString(entry))
            .filter((entry) => Boolean(entry)))].slice(0, limit)
    : [];
const normalizeRelativePath = (value) => value.replaceAll("\\", "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
const unique = (values) => [...new Set(values)];
const expectedIdentityLines = (identity) => [
    `- adapter_contract_path: ${identity.adapter_contract_path ?? "unchanged"}`,
    `- target_root: ${identity.target_root ?? "unchanged"}`,
    `- adapter_id: ${identity.adapter_id ?? "unchanged"}`,
    `- provider_id: ${identity.provider_id ?? "unchanged"}`
];
const authoringModeForProposal = (proposal) => proposal.same_run_eligible && proposal.apply_mode === "same_run_in_place"
    ? "same_run_apply"
    : "proposal_bundle";
const allowedPathsForProposal = (proposal, loadedAdapter) => {
    if (proposal.adapter_origin === "generated_local") {
        return [...generatedLocalAuthoringPaths];
    }
    const adapterRoot = dirname(loadedAdapter.contract_path);
    const dynamicPaths = proposal.affected_files
        .map((path) => resolve(path))
        .filter((path) => {
        const relativePath = relative(adapterRoot, path);
        return (relativePath.length > 0 &&
            !relativePath.startsWith("..\\") &&
            !relativePath.startsWith("../") &&
            relativePath !== "..");
    })
        .map((path) => normalizeRelativePath(relative(adapterRoot, path)))
        .filter((path) => path.length > 0);
    return unique([
        basename(loadedAdapter.contract_path),
        ...dynamicPaths
    ]);
};
const promptText = (input) => [
    "# Adapter Migration Authoring Task",
    "",
    `Run id: ${input.task.run_id}`,
    `Round: ${input.task.round}`,
    `Checkpoint id: ${input.task.checkpoint_id}`,
    `Target root: ${input.task.target_root}`,
    `Adapter root: ${dirname(input.task.adapter_contract_path)}`,
    `Adapter contract: ${input.task.adapter_contract_path}`,
    `Proposal path: ${rel(input.task.proposal_path)}`,
    `Patch bundle path: ${rel(input.task.patch_path)}`,
    `Response path: ${rel(input.task.response_path)}`,
    "",
    "Keep this work on the same current-thread operator surface.",
    "Do not edit the target adapter files directly for this checkpoint.",
    "Author a unified diff patch bundle and write JSON only to the response path.",
    `Echo "checkpoint_id": "${input.task.checkpoint_id}" in the JSON response.`,
    "",
    "## Scope guard",
    ...input.task.allowed_paths.map((item) => `- ${item}`),
    "",
    "## Proposal summary",
    input.proposal.summary,
    "",
    "## Reasons",
    ...(input.proposal.reasons.length > 0
        ? input.proposal.reasons.map((reason) => `- ${reason}`)
        : ["- none"]),
    "",
    "## Expected post-apply identity",
    ...expectedIdentityLines(input.task.expected_post_apply_identity),
    "",
    "## Approval semantics",
    ...Object.entries(approvalSemanticsForAdapterMigrationProposal(input.proposal)).map(([decision, summary]) => `- ${decision}: ${summary}`),
    "",
    "## Authoring contract",
    "- Write a standard unified diff to the patch bundle path.",
    '- Use patch paths exactly relative to the adapter root, for example `adapter.generated.json` or `.generated/codex-adapter/scripts/run-checks.mjs`.',
    "- Do not use absolute Windows paths or before/after scratch directories in diff headers.",
    input.task.authoring_mode === "same_run_apply"
        ? "- Keep all touched files inside the generated adapter write surface listed above because this bundle can apply on the same run."
        : "- Keep all touched files inside the external adapter surface listed above. This bundle is advisory only and will be applied outside the current run.",
    "- Ensure the contract wiring reflects the intended post-migration identity.",
    "",
    "## Response schema",
    '{"checkpoint_id":"string","status":"authored|blocked|noop","summary":"string","patch_bundle_path":"optional string","changed_files":["relative/path"],"notes":["string"],"generated_at":"ISO-8601"}',
    "",
    "## Notes",
    ...(input.task.notes?.length ? input.task.notes.map((note) => `- ${note}`) : ["- none"])
].join("\n");
export const writeAdapterMigrationAuthoringTask = async (input) => {
    const checkpointSeq = input.checkpointSeq ?? Date.now();
    const checkpointId = input.checkpointId ??
        [
            input.runId,
            `r${input.round}`,
            "negotiation",
            "adapter-migration-authoring",
            String(checkpointSeq)
        ].join(":");
    const targetRoot = resolve(input.loadedAdapter.base_directory, input.loadedAdapter.contract.target_root);
    const task = {
        run_id: input.runId,
        round: input.round,
        controller_mode: "attached",
        transport_mode: "current-thread",
        authoring_mode: authoringModeForProposal(input.proposal),
        checkpoint_id: checkpointId,
        checkpoint_seq: checkpointSeq,
        prompt_path: input.artifacts.adapter_migration_authoring_prompt_path,
        response_path: input.artifacts.adapter_migration_authoring_response_path,
        proposal_path: input.artifacts.adapter_migration_proposal_json_path,
        patch_path: input.artifacts.adapter_migration_patch_path,
        instructions_path: input.artifacts.adapter_migration_instructions_path,
        adapter_contract_path: input.loadedAdapter.contract_path,
        target_root: targetRoot,
        writable_roots: [targetRoot, input.artifacts.round_directory],
        ...(input.transportProtocolPath
            ? { transport_protocol_path: input.transportProtocolPath }
            : {}),
        summary: input.proposal.summary,
        expected_post_apply_identity: input.proposal.expected_post_apply_identity,
        allowed_paths: allowedPathsForProposal(input.proposal, input.loadedAdapter),
        ...(input.notes?.length ? { notes: input.notes } : {}),
        created_at: new Date().toISOString()
    };
    await Promise.all([
        writeJson(input.artifacts.adapter_migration_authoring_task_path, task),
        writeText(input.artifacts.adapter_migration_authoring_prompt_path, promptText({
            task,
            proposal: input.proposal
        }))
    ]);
    return task;
};
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
const parseJsonResponse = async (path) => {
    const raw = await readFile(path, "utf8").catch(() => undefined);
    if (!raw) {
        return undefined;
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        const extracted = extractJsonText(raw);
        if (!extracted) {
            return undefined;
        }
        try {
            return JSON.parse(extracted);
        }
        catch {
            return undefined;
        }
    }
};
export const readAdapterMigrationAuthoringResponse = async (path, expectedCheckpointId) => {
    const parsed = (await parseJsonResponse(path)) ??
        (await loadJsonIfExists(path));
    if (!parsed || typeof parsed !== "object") {
        return undefined;
    }
    if (parsed.status !== "authored" &&
        parsed.status !== "blocked" &&
        parsed.status !== "noop") {
        return undefined;
    }
    if (!trimString(parsed.summary)) {
        return undefined;
    }
    if (expectedCheckpointId &&
        trimString(parsed.checkpoint_id) !== expectedCheckpointId) {
        return undefined;
    }
    return {
        ...(trimString(parsed.checkpoint_id)
            ? { checkpoint_id: trimString(parsed.checkpoint_id) }
            : {}),
        status: parsed.status,
        summary: trimString(parsed.summary),
        ...(trimString(parsed.patch_bundle_path)
            ? { patch_bundle_path: trimString(parsed.patch_bundle_path) }
            : {}),
        ...(stringList(parsed.changed_files).length > 0
            ? { changed_files: stringList(parsed.changed_files) }
            : {}),
        ...(stringList(parsed.notes).length > 0 ? { notes: stringList(parsed.notes) } : {}),
        generated_at: trimString(parsed.generated_at) ?? new Date().toISOString()
    };
};
//# sourceMappingURL=adapter-migration-authoring.js.map