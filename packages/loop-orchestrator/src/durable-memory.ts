import { dirname, join } from "node:path";

import { loadJsonIfExists, pathExists, writeJson, writeText } from "./file-system.js";
import type { IdeaBrief } from "./types.js";

type DurableMemoryIntakeSnapshot = {
  product_title?: string;
  product_summary?: string;
  target_users?: string[];
  core_features?: string[];
  finish_line?: string;
  quality_bar?: string[];
  constraints?: string[];
  target_score?: number;
  max_rounds?: number;
  must_not_break?: string[];
};

export interface DurableMemoryPaths {
  feature_list_path: string;
  progress_path: string;
  progress_log_path: string;
  done_when_path: string;
  init_script_path: string;
}

export interface DurableMemoryContext {
  title: string;
  summary: string;
  finishLine?: string;
  targetUsers: string[];
  coreFeatures: string[];
  qualityBar: string[];
  constraints: string[];
  mustNotBreak: string[];
  targetScore?: number;
  maxRounds?: number;
}

type DurableFeatureItem = {
  feature_id: string;
  label: string;
  kind: "core_workflow" | "quality_bar" | "finish_line";
  status: "planned";
  source: "intake" | "idea";
  done_when: string[];
};

const uniqueList = (values: readonly string[]): string[] => [...new Set(values.filter(Boolean))];

const slugifyIdentifier = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const featureIdFor = (prefix: string, index: number, label: string): string =>
  `${prefix}-${slugifyIdentifier(label) || String(index + 1).padStart(2, "0")}`;

export const createDurableMemoryPaths = (rootDirectory: string): DurableMemoryPaths => ({
  feature_list_path: join(rootDirectory, "feature_list.generated.json"),
  progress_path: join(rootDirectory, "progress.md"),
  progress_log_path: join(rootDirectory, "progress.jsonl"),
  done_when_path: join(rootDirectory, "done_when.md"),
  init_script_path: join(rootDirectory, "init.sh")
});

const buildFeatureItems = (input: DurableMemoryContext): DurableFeatureItem[] => {
  const workflowItems = input.coreFeatures.map((feature, index) => ({
    feature_id: featureIdFor("workflow", index, feature),
    label: feature,
    kind: "core_workflow" as const,
    status: "planned" as const,
    source: "intake" as const,
    done_when: input.finishLine ? [input.finishLine] : ["The workflow works in the intended product path."]
  }));

  const qualityItems = input.qualityBar
    .slice(0, 4)
    .map((entry, index) => ({
      feature_id: featureIdFor("quality", index, entry),
      label: entry,
      kind: "quality_bar" as const,
      status: "planned" as const,
      source: "intake" as const,
      done_when: [entry]
    }));

  const finishLineItem = input.finishLine
    ? [
        {
          feature_id: "finish-line",
          label: "Reach the first-version finish line",
          kind: "finish_line" as const,
          status: "planned" as const,
          source: "intake" as const,
          done_when: [input.finishLine]
        }
      ]
    : [];

  return [...workflowItems, ...qualityItems, ...finishLineItem];
};

export const buildFeatureLedger = (input: DurableMemoryContext): Record<string, unknown> => ({
  format_version: "feature-ledger.v1",
  product_title: input.title,
  summary: input.summary,
  finish_line: input.finishLine ?? null,
  ledger_policy: {
    update_mode: "status-only",
    guidance: "Update item statuses and notes without rewriting the full history."
  },
  items: buildFeatureItems(input)
});

export const buildProgressMarkdown = (input: DurableMemoryContext): string =>
  [
    "# Progress",
    "",
    "## Current State",
    "",
    "- Status: bootstrapped",
    "- Latest decision: planner should start from the current intake and durable memory files, and the workbench identity should stay aligned across them.",
    "- Rounds executed: 0",
    "",
    "## Recent Decisions",
    "",
    `- Product: ${input.title}`,
    `- Summary: ${input.summary}`,
    ...(input.finishLine ? [`- Finish line: ${input.finishLine}`] : []),
    ...(input.targetScore !== undefined ? [`- Target score: ${input.targetScore}`] : []),
    ...(input.maxRounds !== undefined ? [`- Max rounds: ${input.maxRounds}`] : []),
    "",
    "## Next Actions",
    "",
    "- Keep `feature_list.generated.json` updated as workflows move from planned to done or blocked.",
    "- Append the latest blocker, failed check, or next action after each round in `progress.md` and `progress.jsonl`.",
    "- Keep `done_when.md` aligned with the actual stop condition before closeout.",
    "- Keep the workbench identity sentence aligned across `AGENTS.md`, `IDEA.md`, `SPEC.md`, and the durable memory files.",
    "- Use `init.sh` to rehydrate the workbench before assuming the environment drifted.",
    "",
    "## Latest Blocker",
    "",
    "- none yet",
    ""
  ].join("\n");

export const buildProgressJsonl = (input: DurableMemoryContext): string =>
  `${JSON.stringify({
    timestamp: "bootstrap",
    event: "memory_scaffolded",
    status: "bootstrapped",
    product_title: input.title,
    summary: input.summary,
    target_score: input.targetScore ?? null,
    max_rounds: input.maxRounds ?? null,
    next_actions: [
      "Keep feature_list.generated.json aligned with real completion state and the workbench identity.",
      "Append the latest blocker, decision, or next step after each run.",
      "Keep done_when.md honest before closeout.",
      "Keep the workbench identity sentence aligned across the durable memory files."
    ]
  })}\n`;

export const buildDoneWhenMarkdown = (input: DurableMemoryContext): string =>
  [
    "# Done When",
    "",
    "## Product Stop Condition",
    "",
    ...(input.finishLine ? [`- ${input.finishLine}`] : ["- The first-version stop condition has not been written yet."]),
    "",
    "## Core Workflows",
    "",
    ...(input.coreFeatures.length > 0
      ? input.coreFeatures.map((feature) => `- ${feature}`)
      : ["- No core workflows were captured yet."]),
    "",
    "## Quality Bar",
    "",
    ...(input.qualityBar.length > 0
      ? input.qualityBar.map((entry) => `- ${entry}`)
      : ["- No explicit quality bar was captured yet."]),
    "",
    "## Must Not Break",
    "",
    ...(input.mustNotBreak.length > 0
      ? input.mustNotBreak.map((entry) => `- ${entry}`)
      : ["- none recorded"]),
    "",
    "## Runtime Bounds",
    "",
    ...(input.targetScore !== undefined ? [`- Target score: ${input.targetScore}`] : []),
    ...(input.maxRounds !== undefined ? [`- Max rounds: ${input.maxRounds}`] : []),
    "- Keep the generic front door lane-oriented; `product_build` is one route, not the repository identity.",
    "- If no adapter is attached, do not overclaim end-to-end product proof.",
    ""
  ].join("\n");

export const buildInitScript = (): string =>
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "if [ ! -d node_modules ]; then",
    "  npm install",
    "fi",
    "",
    "if ! npm run build; then",
    "  npx -p typescript@5.8.3 tsc -b --force --pretty false",
    "fi",
    "",
    "cat <<'EOF'",
    "Workbench identity: generic Codex workbench with a closed-loop harness engine.",
    "Ready commands:",
    "  npm run loop:intent -- --json \"<request>\"",
    "  npm run loop:intake -- --json \"<product request>\"",
    "  npm run loop:run -- --resume-run evals/runs/run-###",
    "EOF",
    ""
  ].join("\n");

const mergeDurableMemoryContext = (
  idea: IdeaBrief,
  intake: DurableMemoryIntakeSnapshot | undefined
): DurableMemoryContext => ({
  title: intake?.product_title ?? idea.title,
  summary: intake?.product_summary ?? idea.summary,
  finishLine: intake?.finish_line,
  targetUsers: uniqueList(intake?.target_users ?? []),
  coreFeatures: uniqueList(
    (intake?.core_features?.length ?? 0) > 0
      ? intake?.core_features ?? []
      : idea.user_goals.length > 0
        ? idea.user_goals
        : [idea.summary]
  ),
  qualityBar: uniqueList(
    (intake?.quality_bar?.length ?? 0) > 0 ? intake?.quality_bar ?? [] : idea.quality_bar
  ),
  constraints: uniqueList(
    (intake?.constraints?.length ?? 0) > 0 ? intake?.constraints ?? [] : idea.constraints
  ),
  mustNotBreak: uniqueList(intake?.must_not_break ?? []),
  targetScore: intake?.target_score,
  maxRounds: intake?.max_rounds
});

export const loadDurableMemoryContext = async (
  idea: IdeaBrief
): Promise<{ rootDirectory: string; context: DurableMemoryContext }> => {
  const rootDirectory = dirname(idea.source_path);
  const intake = await loadJsonIfExists<DurableMemoryIntakeSnapshot>(join(rootDirectory, "intake.json"));
  return {
    rootDirectory,
    context: mergeDurableMemoryContext(idea, intake)
  };
};

export const scaffoldDurableMemoryArtifacts = async (
  rootDirectory: string,
  context: DurableMemoryContext
): Promise<DurableMemoryPaths> => {
  const paths = createDurableMemoryPaths(rootDirectory);
  await Promise.all([
    writeJson(paths.feature_list_path, buildFeatureLedger(context)),
    writeText(paths.progress_path, buildProgressMarkdown(context)),
    writeText(paths.progress_log_path, buildProgressJsonl(context)),
    writeText(paths.done_when_path, buildDoneWhenMarkdown(context)),
    writeText(paths.init_script_path, buildInitScript())
  ]);
  return paths;
};

export const ensureDurableMemoryArtifacts = async (
  rootDirectory: string,
  context: DurableMemoryContext
): Promise<DurableMemoryPaths> => {
  const paths = createDurableMemoryPaths(rootDirectory);
  if (!(await pathExists(paths.feature_list_path))) {
    await writeJson(paths.feature_list_path, buildFeatureLedger(context));
  }
  if (!(await pathExists(paths.progress_path))) {
    await writeText(paths.progress_path, buildProgressMarkdown(context));
  }
  if (!(await pathExists(paths.progress_log_path))) {
    await writeText(paths.progress_log_path, buildProgressJsonl(context));
  }
  if (!(await pathExists(paths.done_when_path))) {
    await writeText(paths.done_when_path, buildDoneWhenMarkdown(context));
  }
  if (!(await pathExists(paths.init_script_path))) {
    await writeText(paths.init_script_path, buildInitScript());
  }
  return paths;
};

export const detectDurableMemoryPaths = async (
  rootDirectory: string
): Promise<Partial<DurableMemoryPaths>> => {
  const paths = createDurableMemoryPaths(rootDirectory);
  return {
    ...(await pathExists(paths.feature_list_path)
      ? { feature_list_path: paths.feature_list_path }
      : {}),
    ...(await pathExists(paths.progress_path) ? { progress_path: paths.progress_path } : {}),
    ...(await pathExists(paths.progress_log_path)
      ? { progress_log_path: paths.progress_log_path }
      : {}),
    ...(await pathExists(paths.done_when_path) ? { done_when_path: paths.done_when_path } : {})
    ,
    ...(await pathExists(paths.init_script_path)
      ? { init_script_path: paths.init_script_path }
      : {})
  };
};
