# Codex Session-Supervised Closed Loop

## Goal

For product-build requests, the front door should be a question gate and the
execution engine should stay on the same Codex thread. The user should not be
forced to bounce between separate "intake", "planner", and "executor" sessions
just to build one app.

The intended flow is:

1. User asks for an app, tool, dashboard, service, or agent.
2. Codex asks only the missing high-value questions.
3. Once the request is concrete enough, Codex freezes the request into session
   artifacts.
4. The same thread stops at `ready_to_start` and waits for an explicit
   `루프 시작` or `start loop`.
5. After start, the same thread becomes the foreground execution loop.
6. Mid-run human input is handled as steering or review, not as a full reset.

This document defines the session-level artifacts that should exist before the
runtime derives per-attempt `round-###/round-contract.json` files.

## Session States

These are the operator-visible labels for the session-level loop:

- `asking`
- `preparing`
- `ready_to_start`
- `running`
- `needs_steering`
- `blocked_externally`
- `ready_for_review`
- `done`

These labels belong to the session layer. They do not replace controller phase
names such as `planning`, `negotiation`, or `evaluation`.

## Artifact Roles

The session-supervised foreground flow should prepare these artifacts before
heavy implementation starts, then hold at `ready_to_start` until the operator
opens the explicit start gate:

- `runtime/build-brief.json`
- `runtime/run-contract.json`
- `runtime/operator-surface.json`
- `runtime/open-questions.json`
- `runtime/session-status.json`
- `runtime/session-status-events.jsonl`
- `runtime/session-stream.json`
- `docs/EXECUTION_PLAN.md`

The split is intentional:

- `runtime/build-brief.json` is the normalized product brief.
- `runtime/run-contract.json` is the session-level execution contract.
- `runtime/session-status.json` is the normalized session readiness/status
  surface.
- `round-###/round-contract.json` remains the attempt-level contract derived
  from the session contract and current controller state.

## `runtime/build-brief.json`

Purpose:
Normalize the user's product request and accepted defaults into one durable
session brief before large implementation work starts.

Exact field set:

- `brief_id`
- `source_request`
- `created_at`
- `updated_at`
- `product`
- `surface`
- `delivery`
- `execution_context`
- `constraints`
- `defaults_accepted`
- `unresolved_questions`
- `operator_status_vocabulary`

Field details:

- `product.title`: working title for the build.
- `product.summary`: one-paragraph description of what is being built.
- `product.target_users`: who the product is for.
- `product.core_workflows`: top workflows the first version must support.
- `product.success_definition`: what counts as "good enough" for this run.
- `product.references`: reference products or visual signals.
- `surface.primary_surface`: one of `web`, `mobile`, `desktop`, `api`,
  `dashboard`, `editor`, or `agent`.
- `surface.secondary_surfaces`: optional additional surfaces.
- `surface.auth_mode`: `required`, `optional`, `none`, or `unknown`.
- `delivery.level`: `prototype`, `mvp`, `usable`, `production-like`, or
  `custom`.
- `delivery.execution_preference`: `speed`, `balanced`, or `correctness`.
- `execution_context.project_mode`: `new` or `existing`.
- `execution_context.target_root`: working directory for the build.
- `execution_context.workspace_mode_preference`: `local` or `worktree`.
- `execution_context.run_command`: optional run command for an existing app.
- `execution_context.check_command`: optional validation command.
- `execution_context.target_manifest_hints`: optional `app_url`, `health_url`,
  or `api_base_url` hints.
- `constraints.stack_preferences`: preferred stack or framework choices.
- `constraints.data_mode`: `mock`, `seeded`, `real`, `hybrid`, or `unknown`.
- `constraints.integrations`: APIs, MCPs, internal systems, or services.
- `constraints.non_goals`: explicit exclusions for the current run.
- `constraints.repo_constraints`: harness-side repo rules that must stay true.
- `defaults_accepted`: defaults Codex chose instead of asking a low-value
  question.
- `unresolved_questions`: non-blocking questions deferred for later steering.
- `operator_status_vocabulary`: the session state labels listed above.

Example:

```json
{
  "brief_id": "brief_customer-support-saas",
  "source_request": "Build a customer support SaaS app for SMB teams.",
  "created_at": "2026-04-15T09:00:00.000Z",
  "updated_at": "2026-04-15T09:03:00.000Z",
  "product": {
    "title": "SupportHub",
    "summary": "A browser-based support workspace for SMB support teams.",
    "target_users": ["support managers", "support agents"],
    "core_workflows": [
      "triage incoming tickets",
      "respond with internal notes and status changes",
      "track SLA and queue health"
    ],
    "success_definition": [
      "usable inbox flow",
      "agent response workflow",
      "basic queue analytics"
    ],
    "references": ["Linear", "Zendesk", "Plain"]
  },
  "surface": {
    "primary_surface": "dashboard",
    "auth_mode": "required"
  },
  "delivery": {
    "level": "mvp",
    "execution_preference": "balanced"
  },
  "execution_context": {
    "project_mode": "new",
    "target_root": "./supporthub",
    "workspace_mode_preference": "worktree"
  },
  "constraints": {
    "stack_preferences": ["Next.js", "TypeScript", "Postgres"],
    "data_mode": "seeded",
    "integrations": ["email ingest later"],
    "non_goals": ["full billing", "multi-org permissions"],
    "repo_constraints": [
      "keep decisions file-backed",
      "stay compatible with same-thread Codex supervision"
    ]
  },
  "defaults_accepted": [
    "default to worktree for a large new app build",
    "seed data instead of requiring a production data source"
  ],
  "unresolved_questions": ["Whether SLA timers must be editable in the UI"],
  "operator_status_vocabulary": [
    "asking",
    "preparing",
    "ready_to_start",
    "running",
    "needs_steering",
    "blocked_externally",
    "ready_for_review",
    "done"
  ]
}
```

## `runtime/run-contract.json`

Purpose:
Define the session-level execution contract that governs the same-thread
foreground loop. This is not a replacement for `round-###/round-contract.json`.
It is the higher-level contract from which attempt-level contracts are derived.

Exact field set:

- `contract_id`
- `brief_id`
- `created_at`
- `updated_at`
- `run_mode`
- `current_thread_required`
- `start_gate`
- `workspace_mode`
- `objective`
- `non_goals`
- `discovery_policy`
- `execution_controls`
- `validation_strategy`
- `review_boundaries`
- `approval_boundaries`
- `steering_triggers`
- `required_prepare_artifacts`
- `derived_attempt_artifacts`
- `operator_surface_path`
- `open_questions_path`
- `execution_plan_path`
- `stop_rule`

Field details:

- `run_mode`: currently `foreground_same_thread`.
- `current_thread_required`: whether the loop must stay on the same Codex
  thread.
- `start_gate.required`: whether an explicit operator start is required before
  the session can enter `running`.
- `start_gate.authorized`: whether the operator has already opened that start
  gate for the current session.
- `start_gate.authorized_at`: timestamp of the recorded start authorization, or
  `null` before start.
- `start_gate.authorized_by`: actor that opened the start gate, or `null`
  before start.
- `workspace_mode`: `local` or `worktree` for the current session.
- `objective`: one sentence describing the current build objective.
- `non_goals`: session-wide exclusions.
- `discovery_policy.max_questions_per_turn`: should stay at `1` to `3`.
- `discovery_policy.ask_only_missing_high_impact_questions`: fail-closed
  discovery rule.
- `discovery_policy.prefer_defaults_over_low_value_questions`: avoid wasting
  turns on low-value intake.
- `execution_controls.project_mode`: `new` or `existing`.
- `execution_controls.target_root`: the build root for the session.
- `execution_controls.target_score`: the target quality score.
- `execution_controls.max_rounds`: maximum controller rounds budgeted.
- `execution_controls.run_command`: optional run command for an existing app.
- `execution_controls.check_command`: optional validation command.
- `execution_controls.target_manifest_hints`: optional `app_url`, `health_url`,
  or `api_base_url` hints.
- `validation_strategy.iteration_mode`: currently `patch_oriented`.
- `validation_strategy.evaluator_mode`: currently `risk_triggered`.
- `validation_strategy.review_surface`: currently `codex_review_pane`.
- `review_boundaries`: when to ask the user for review.
- `approval_boundaries`: when explicit approval is required.
- `steering_triggers`: when the same thread should ask for steering.
- `required_prepare_artifacts`: session artifacts that must exist before heavy
  implementation.
- `derived_attempt_artifacts`: attempt-level artifacts expected later, usually
  including `round-contract.json`, `generator-plan.json`, and
  `patch-request.json`.
- `operator_surface_path`: expected location of the session-facing operator
  surface.
- `open_questions_path`: expected location of deferred questions.
- `execution_plan_path`: expected location of the markdown execution plan.
- `stop_rule.done_when`: conditions for ending the session successfully.
- `stop_rule.stop_on`: conditions that should stop or pause the session.

Example:

```json
{
  "contract_id": "run_contract_customer-support-saas",
  "brief_id": "brief_customer-support-saas",
  "created_at": "2026-04-15T09:03:00.000Z",
  "updated_at": "2026-04-15T09:03:00.000Z",
  "run_mode": "foreground_same_thread",
  "current_thread_required": true,
  "start_gate": {
    "required": true,
    "authorized": false,
    "authorized_at": null,
    "authorized_by": null
  },
  "workspace_mode": "worktree",
  "objective": "Ship a reviewable MVP support dashboard without leaving the current Codex thread.",
  "non_goals": ["full billing", "multi-org permissions"],
  "discovery_policy": {
    "max_questions_per_turn": 3,
    "ask_only_missing_high_impact_questions": true,
    "prefer_defaults_over_low_value_questions": true
  },
  "execution_controls": {
    "project_mode": "new",
    "target_root": "./supporthub",
    "target_score": 0.8,
    "max_rounds": 4
  },
  "validation_strategy": {
    "iteration_mode": "patch_oriented",
    "evaluator_mode": "risk_triggered",
    "review_surface": "codex_review_pane"
  },
  "review_boundaries": [
    "diff_ready",
    "milestone_scope_complete",
    "release_candidate"
  ],
  "approval_boundaries": [
    "scope_change",
    "external_access",
    "deploy"
  ],
  "steering_triggers": [
    "product_ambiguity",
    "priority_conflict",
    "blocked_external",
    "review_feedback",
    "risk_gate_failure"
  ],
  "required_prepare_artifacts": [
    "runtime/build-brief.json",
    "runtime/run-contract.json",
    "runtime/operator-surface.json",
    "runtime/open-questions.json",
    "runtime/session-status.json",
    "runtime/session-status-events.jsonl",
    "runtime/session-stream.json",
    "docs/EXECUTION_PLAN.md"
  ],
  "derived_attempt_artifacts": [
    "round-contract.json",
    "generator-plan.json",
    "patch-request.json",
    "eval_report.json"
  ],
  "operator_surface_path": "runtime/operator-surface.json",
  "open_questions_path": "runtime/open-questions.json",
  "execution_plan_path": "docs/EXECUTION_PLAN.md",
  "stop_rule": {
    "done_when": [
      "the MVP workflows are implemented and reviewable",
      "the latest diff is ready for user acceptance"
    ],
    "stop_on": [
      "explicit user stop",
      "external blocker that needs human resolution",
      "new run required for a boundary change"
    ]
  }
}
```

## Relationship To Existing Harness Artifacts

These session-level surfaces should coexist with the current harness protocol:

- `runtime/build-brief.json` and `runtime/run-contract.json` are session-level.
- `runtime/session-status.json` is the normalized session-layer state for UI and
  steering surfaces.
- `planned-scenario.json` and `plan.json` remain planner/controller artifacts.
- `round-###/round-contract.json` remains the attempt-level contract.
- `runtime/operator-surface.json` remains the operator-facing state projection
  and should carry a projection of `runtime/session-status.json`.
- `patch-request.json` remains the continuation surface after a round executes.

The design intent is not to reintroduce sprint scaffolding. It is to let one
foreground Codex thread ask the minimum necessary questions, freeze the result
into durable artifacts, and then stay in control through execution, steering,
and review.
