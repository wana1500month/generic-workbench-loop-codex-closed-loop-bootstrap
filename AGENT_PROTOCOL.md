# Agent Protocol

This document defines the V2 file protocol for the harness core. The protocol still writes `round-###` directories, but those directories now represent build attempts and remediation attempts rather than a fixed sprint playbook. The controller keeps one active contract frame from the last agreed negotiation surface, defaults remediation to patch-only carry-forward work, and reopens contract negotiation only on explicit fallback conditions such as missing patch authority, release-gate regression, scope drift, manifest-contract breakage, repeated unresolved signatures, or plateau without progress. Those reopen signals now flow through `failure-lineage.json.policy_snapshot` as the first-class recommendation surface, so plateau and repeated-signature escalation no longer depend on separate legacy override branches. Adapter-free runs now default to the neutral `generic-core` evaluator bundle so the protocol stays harness-centric even when no external target is attached. Resume identity is now file-bound as well: adapter contract, evaluator bundle, rubric fingerprint, target family, and validation lane must match when a run is reopened unless the operator explicitly accepts a migration override, and each run persists that state in `resume-identity.json`. Runs that already ended with `target_reached`, `contract_completed`, `environment_blocked`, or `adapter_contract_invalid` stay closed on default resume unless the operator explicitly forces a reopen.

## Goals

- Keep planner, generator, evaluator, controller, and Codex communication file-based.
- Keep every round resumable from repo files alone.
- Keep `patch-request.json` authoritative for follow-up work.
- Stay honest about adapter-free mode.

## Core files per attempt

- `round-contract.json`
- `round-contract.md`
- `generator-plan.json`
- `generator-plan.md`
- `evaluator-verdict.json`
- `evaluator-verdict.md`
- `patch-request.json`
- `patch-request.md`
- `quality-critique.json`
- `quality-critique.md`
- `trajectory-decision.json`
- `trajectory-decision.md`
- `round-result.json`
- `round_summary.json`
- `eval_report.json`
- `failure-lineage.json`

Initial build attempts and explicit recontract attempts treat `round-contract`, `contract-review`, `contract-agreement`, and `generator-plan` as the load-bearing negotiation surface. Patch-only remediation attempts stay centered on `patch-request.json` plus QA feedback; clean remediation attempts may omit `contract-review.*` and `contract-agreement.*` on disk, and when those artifacts are rewritten they should mirror carried scope rather than reintroduce sprint decomposition.

## Lifecycle

1. Planner defines the draft objective and checks in `round-contract.*`.
2. Evaluator performs full pre-build negotiation on the initial build attempt, and on later rounds only when the controller escalates to recontract.
3. Controller either blocks or locks the negotiated contract in `contract-agreement.*`, then keeps the agreed frame active across patch-only repairs.
4. Generator commits to a concrete implementation plan for the current attempt in `generator-plan.*`.
5. Adapter capabilities run only after the in-memory contract reaches agreement. On patch-only remediation attempts that agreement may stay synthetic and unpersisted unless carried checks explicitly require the review/agreement files.
6. Evaluator writes a verdict and eval report in `evaluator-verdict.*` and `eval_report.json`.
7. Evaluator writes the next-step request in `patch-request.*`.
8. Controller records the attempt outcome in `round-result.json`.

When an adapter is attached, skeptical evaluation now also expects criterion-level proof manifests, a core-owned evaluator profile selected by the rubric, CLI, or `--target-family`, an independent verification provider, verifier provenance attestation, at least one live interaction artifact, at least one structured `verification-witness` manifest that points back to that live proof, and evaluator-owned core probe results before `target_reached` can be claimed. Those core probes now split into `release_gate` and `supporting` roles. Supporting probes may point at target-root files, target JSON, `http`, `browser`, or `shell_command` diagnostics. Required `release_gate` probes must use `http_json` or `browser_journey`, carry `assertion_id`, may carry `assertion_tags`, stay at `semantic_level: "feature"` or `"workflow"`, and resolve through `target_manifest_key`. Verification profiles may also require a minimum number of distinct passing release assertions, tagged coverage counts, and bundle-owned `score_policy` weights before `target_reached` is eligible. Adapter-authored `verification_profile_path` remains schema-only compatibility metadata and is ignored by the runtime, but it now triggers a runtime warning so compatibility fields do not masquerade as authoritative policy. `run_target` may publish `target_manifest` URLs so the core can resolve those release-gate probes without trusting adapter-authored status text. `run_checks` and `grade_round` should describe which criteria passed or failed, which evidence grounded those claims, which `observed_value` was measured, whether the round-level threshold actually passed, and which release assertions their witnesses covered.

## Surface authority

| Surface | Role | Runtime authority | Notes |
|---|---|---|---|
| `round-contract.json` | attempt boundary | core | always authoritative |
| `patch-request.json` | remediation authority | evaluator/core | default continuation surface |
| `quality-critique.json` | evaluator-owned quality steering | evaluator/core | explains refine vs tighten vs pivot |
| `trajectory-decision.json` | controller-owned trajectory policy | controller/core | decides restart anchor and pivot-vs-parallel-pivot execution |
| `eval_report.json` | evidence and threshold rationale | evaluator/core | load-bearing for reopen decisions |
| `failure-lineage.json` | persisted failure explanation | evaluator/core | drives recontract, environment, and regression interpretation |
| `contract-review.json` | negotiation diagnostic | evaluator | omitted in clean patch-only rounds |
| `contract-agreement.json` | negotiated authority | evaluator | initial and recontract rounds only |
| `generator-plan.json` | compatibility and handoff artifact | controller/generator | retained for resumability |
| adapter `verification_profile_path` | compatibility metadata | none | deprecated, ignored, warning-only |

## `round-contract.json`

Purpose:
The authoritative round contract.

Example:

```json
{
  "contract_id": "generic-harness-core-contract-round-01",
  "round": 1,
  "negotiation_mode": "full_negotiation",
  "continuation_authority": "planner_contract",
  "objective": "Write a harness-only scaffold round without assuming a bundled adapter.",
  "rewrite_scope": "structural",
  "focus_areas": ["planner_clarity", "artifact_handoff", "patch_authority"],
  "acceptance_checks": [
    "planner_brief_written",
    "round_contract_written",
    "patch_request_surface_reserved"
  ],
  "required_artifacts": [
    "round-contract.json",
    "generator-plan.json",
    "evaluator-verdict.json",
    "patch-request.json"
  ],
  "non_goals": [
    "Do not reintroduce a bundled product surface."
  ],
  "carry_over_context": []
}
```

## `contract-review.json`

Purpose:
The evaluator's pre-build review of the draft contract.

The review is allowed to return `decision: "revise"` when:

- the contract uses unknown check ids
- the contract contains only artifact-write checks
- the contract drops unresolved carried checks from the previous patch request

## `contract-agreement.json`

Purpose:
The negotiated agreement the generator must implement and the evaluator must verify. When the review asks for revision, the agreement becomes `status: "blocked"` and the next remediation attempt must close the required changes before normal build continuation.

## `generator-plan.json`

Purpose:
The generator's concrete promise for the round.

Example:

```json
{
  "contract_id": "generic-harness-core-contract-round-01",
  "agreement_id": "generic-harness-core-contract-round-01-agreement",
  "generator_plan_id": "generic-harness-core-contract-round-01-generator-plan",
  "implementation_intent": "Close carried checks before expanding scope: round_contract_is_testable, agreement_matches_review.",
  "target_check_ids": [
    "round_contract_is_testable",
    "agreement_matches_review"
  ],
  "files_to_touch": [
    "IDEA.md",
    "SPEC.md",
    "RUNBOOK.md",
    "AGENT_PROTOCOL.md",
    "packages/loop-orchestrator/src"
  ],
  "expected_proof": [
    "planner_brief_written",
    "round_contract_written",
    "patch_request_surface_reserved"
  ],
  "risk_notes": [
    "Do not pretend this repo contains end-to-end proof."
  ],
  "out_of_scope": [
    "Bundled product code"
  ],
  "adapter_actions": [
    "Prepare the target through the adapter boundary.",
    "Run checks and evidence capture through adapter capabilities."
  ]
}
```

## `evaluator-verdict.json`

Purpose:
The evaluator's round verdict.

Example:

```json
{
  "contract_id": "generic-harness-core-contract-round-01",
  "verdict_id": "generic-harness-core-contract-round-01-verdict",
  "overall_verdict": "hold",
  "findings": [
    "No external adapter is attached.",
    "No build or browser proof exists in this repository."
  ],
  "release_blockers": [
    "adapter boundary missing"
  ],
  "contract_completed": false
}
```

## `patch-request.json`

Purpose:
The evaluator's direct request for the next pass.

Notes:

- adapter capability failures are normalized into evaluator-known continuation checks such as `adapter_execution_healthy`
- terminal success uses `next_action: "complete"` instead of pretending another patch round is needed
- terminal `complete` closes the negotiated contract, but `target_reached` is emitted only when the release thresholds also pass
- when the attempt closes structurally but target thresholds stay open, `patch-request.json` now carries `target_signal_thresholds_met` forward instead of ending the run as a fake success
- when no adapter is attached, `target_signal_thresholds_met` should be recorded as `not_applicable` rather than a passing release claim, and it should stay out of resolved/unresolved carry-forward math
- when the initial build-attempt budget is exhausted but target thresholds still stay open, the controller may spend the rubric's remediation budget on additional `revise` attempts before stopping with `max_rounds_reached`
- patch-only remediation is the default once an active contract frame exists and the previous patch request provides actionable `target_check_ids`
- the controller reopens negotiation only when no active contract frame exists, the patch request is not actionable, release-gate regressions reopen closed checks, target-manifest requirements remain broken, scope drifts beyond the active contract frame, unresolved signatures repeat, or remediation plateaus
- `environment_blockers` should be populated when the failure lineage shows that browser or live-target probes were blocked by the host environment rather than the product under test
- pure `environment_blocked` patch requests should use `next_action: "hold"` and let the run stop with `stop_reason = "environment_blocked"` instead of opening more product remediation rounds
- static adapter contract invalidation is not a recontract trigger inside the same run; it should terminate the run immediately with `adapter_contract_invalid`

Example:

```json
{
  "request_id": "generic-harness-core-contract-round-01-verdict-patch",
  "derived_from_verdict_id": "generic-harness-core-contract-round-01-verdict",
  "next_action": "revise",
  "priority": "blocking",
  "must_fix": [
    {
      "id": "close-round-contract-is-testable-1",
      "why": "The draft contract still relies only on artifact-write checks.",
      "expected_change": "Make 'round_contract_is_testable' pass in the next remediation attempt.",
      "target_check_ids": ["round_contract_is_testable"],
      "source_round": 1
    }
  ],
  "must_preserve": [
    "Keep the harness generic.",
    "Keep protocol files authoritative."
  ],
  "forbidden_scope_expansion": [
    "Do not add bundled product UI back into this repo."
  ],
  "promotion_rule": "Only leave scaffold mode when an external adapter exists."
}
```

## `failure-lineage.json`

Purpose:
The controller's persisted explanation of why the latest attempt stayed open, why recontract was necessary, or why a realism lane was blocked by the host environment.

Notes:

- clean successful rounds should record `failure_classification: "none"` rather than reusing a failure label
- round handoff files and `round_summary.json` should render the resolved `target_family` and `validation_lane` that actually governed the attempt
- round handoff files and `round_summary.json` should also render `decision_source`, so weighted-policy decisions, hard rules, and default patch authority stay machine-auditable
- `policy_snapshot` should persist structured trigger metadata such as `trigger_codes`, `trigger_scores`, `dominant_trigger_code`, `patch_authority_state`, `escalation_confidence`, and `recommendation_source`, so reopen policy stays machine-auditable even when controller wording changes

Example:

```json
{
  "failing_check_ids": ["target_signal_thresholds_met"],
  "failing_assertion_ids": ["editor_shell_renders"],
  "failing_probe_ids": ["editor-shell-browser"],
  "missing_target_manifest_keys": [],
  "contradictory_witness_assertion_ids": [],
  "release_regression_ids": ["editor_shell_renders"],
  "environment_blocked_probe_ids": ["editor-shell-browser"],
  "failure_classification": "environment_blocked",
  "unresolved_signature": "target_signal_thresholds_met|editor_shell_renders|editor-shell-browser",
  "policy_snapshot": {
    "recommended_action": "stop",
    "reasons": [
      "All remaining blockers are environmental, so another product remediation round would only waste budget."
    ],
    "trigger_codes": [
      "environment_blocked",
      "stable_patch_authority"
    ],
    "trigger_scores": {
      "environment_blocked": 1,
      "stable_patch_authority": 0.2
    },
    "dominant_trigger_code": "environment_blocked",
    "patch_authority_state": "collapsed",
    "escalation_confidence": 1,
    "recommendation_source": "hard_rule",
    "repeated_failure_signature_count": 1,
    "repeated_failure_classification_count": 1,
    "unresolved_check_count": 1,
    "contradiction_count": 0,
    "regression_count": 0,
    "missing_manifest_count": 0,
    "plateau_delta_window": [],
    "plateau_without_progress": false,
    "projected_plateau_count": 0,
    "plateau_limit": 2,
    "plateau_limit_reached": false,
    "environment_blocked": true,
    "scope_drift_detected": false
  }
}
```

## `trajectory-decision.json`

Purpose:
The controller's explicit continuation policy for the next attempt.

Notes:

- `mode` is the executed policy, not commentary; `pivot` and `parallel_pivot` should reopen through `decision_source = "trajectory_policy"` on the next round
- `restart_from` names the anchor the next attempt should treat as its baseline: `current_head`, `last_stable`, or `best_passing`
- `preserve_signals` and `discardable_surface` should be carried into the next generator attempt alongside `patch-request.json` and `quality-critique.json`

Example:

```json
{
  "trajectory_id": "generic-harness-core-contract-round-02-trajectory-decision",
  "contract_id": "generic-harness-core-contract-round-02",
  "round": 2,
  "mode": "parallel_pivot",
  "restart_from": "best_passing",
  "preserve_signals": [
    "Keep the repository focused on core harness mechanics."
  ],
  "discardable_surface": [
    "Raise the contract and proof surface until this dimension clears its minimum score."
  ],
  "novelty_target": 0.9,
  "reason": "Score improvement plateaued for consecutive rounds, so the current line should not keep patching the same head.",
  "decision_source": "failure_policy",
  "selected_round": 1,
  "frontier": {
    "current_head": 2,
    "last_stable": 1,
    "best_passing": 1
  },
  "anchor_reason": "Restart from round 1, the strongest contract-complete baseline recorded so far."
}
```

## `round_summary.json`

Purpose:
The machine-readable per-attempt summary that is later copied into run-level `summary.json.round_history[]`.

Notes:

- persist the resolved `target_family` and `validation_lane` for the attempt, even when the run was launched via `--evaluator-profile`
- persist `decision_source` for the attempt, so reviewers can see whether the controller followed `policy_snapshot`, a hard rule, or default patch authority
- keep success semantics honest by carrying `failure_lineage.failure_classification: "none"` on clean closures
- align this file with the controller-decision handoff so automated validators can compare prose and machine-readable bundle semantics

Example:

```json
{
  "round": 2,
  "attempt_kind": "remediation",
  "negotiation_mode": "patch_only",
  "continuation_authority": "patch_request",
  "label": "patch-only repair attempt 1",
  "controller_reason": "Patch request still carries actionable target_check_ids.",
  "decision_source": "policy_snapshot",
  "objective": "Repair the carried release checks without reopening the whole contract.",
  "target_family": "browser-app",
  "validation_lane": "deterministic_semantic",
  "total_score": 0.92,
  "control_plane_score": 1,
  "proof_score": 0.9,
  "release_score": 0.92,
  "overall_verdict": "advance",
  "failure_lineage": {
    "failing_check_ids": [],
    "failing_assertion_ids": [],
    "failing_probe_ids": [],
    "missing_target_manifest_keys": [],
    "contradictory_witness_assertion_ids": [],
    "release_regression_ids": [],
    "environment_blocked_probe_ids": [],
    "failure_classification": "none"
  }
}
```

## `round-result.json`

Purpose:
The controller summary of the current attempt.

Example:

```json
{
  "round": 1,
  "contract_id": "generic-harness-core-contract-round-01",
  "agreement_id": "generic-harness-core-contract-round-01-agreement",
  "generator_plan_id": "generic-harness-core-contract-round-01-generator-plan",
  "verdict_id": "generic-harness-core-contract-round-01-verdict",
  "request_id": "generic-harness-core-contract-round-01-verdict-patch",
  "total_score": 0.55,
  "control_plane_score": 0.9,
  "proof_score": 0.2,
  "release_score": 0.55,
  "overall_verdict": "revise",
  "selected_for_run": true,
  "status": "revised",
  "eval_report_path": "eval_report.json",
  "check_pass_rate": 0.667,
  "previous_patch_request_addressed": true,
  "previous_patch_request_resolved": false,
  "resolved_check_ids": [
    "round_contract_written",
    "contract_review_written"
  ],
  "unresolved_check_ids": [
    "round_contract_is_testable"
  ],
  "threshold_results": {
    "contract_completed": false,
    "minimum_control_plane_score_met": false,
    "minimum_proof_score_met": false,
    "minimum_release_score_met": false,
    "adapter_required_met": true,
    "grade_score_required_met": true,
    "core_probe_required_met": false,
    "target_reached_eligible": false
  }
}
```

## Control-plane rule

The protocol is healthy when these files are not just written, but treated as the main continuation surface:

- `round-contract.json` defines the current attempt boundary.
- `contract-review.json`, `contract-agreement.json`, and `generator-plan.json` are load-bearing on the initial build attempt and on explicit recontract attempts.
- remediation attempts should treat `patch-request.json`, `eval_report.json`, and the generator brief as the primary carry-forward surface, even when compatibility artifacts are rewritten.
- `evaluator-verdict.json` records what happened.
- `patch-request.json` drives the next follow-up through explicit `target_check_ids`.
- `eval_report.json` is the richer evidence and rationale bundle.
- adapter-specific runtime failures should be normalized into evaluator-known continuation checks before they are carried into the next contract.
- adapter result payloads should be schema-valid and point at evidence files that actually exist before the evaluator trusts them.
- proof capabilities should execute through a verification provider whose trust domain is distinct from the target-mutating adapter boundary.
- proof capabilities should leave at least one `verification-witness` artifact that records the verifier provider, proof capability, live mode, interaction log, and grounded verification steps.
- adapter-backed target closure should also depend on at least one passing required `release_gate` probe result so `target_reached` requires target-facing evidence generated by the harness runtime itself.
- `failure-lineage.json` should explain why the current attempt stayed in `patch_only`, why the controller escalated to `recontract`, and whether blocked browser/live-target probes were environmental or product-level failures.
- `round_summary.json` and run-level `summary.json.round_history[]` should persist the resolved `target_family`, `validation_lane`, `round_stop_reason`, and `decision_source` for every attempt so reviewers can audit bundle semantics, controller precedence, and terminal outcomes without parsing prose handoff files.
- core-owned evaluator profiles may now declare `expected_target_surfaces`, and those declarations alone should decide when browser/API witnesses and `browser_journey`/`http_json` release assertions are required.
- adapter-backed target closure should fail when `run_target` does not publish the `target_manifest` URLs required by those core-owned surface declarations.
- core-owned evaluator bundles may now also require tagged release assertions such as `persistence` or `error_path`, so bundle strength can be tuned by target family without trusting adapter-authored policy.
- adapter evidence should preserve meaning links, so successful checks identify supported criteria and successful grading points back to upstream runtime proof by capability and by file path.
- adapter criterion manifests should stay internally consistent, so successful `run_checks` and `grade_round` claims identify grounded criteria and successful `grade_round` claims cannot silently upgrade failed hard criteria without new proof.
- adapter-owned criteria should also match a core-owned evaluator profile, so the core can compare observed values against external expectations instead of trusting adapter-authored status strings.
- `contract_completed` and `target_reached` are different controller outcomes: the first closes the current attempt honestly, the second also clears rubric thresholds.
- run-level summaries should use the terminal round as the top-level state and keep best-scoring data in separate fields so downstream tooling does not confuse the final state with the earliest high score.
- round-result and handoff artifacts should record previous-patch addressed/resolved state explicitly rather than inferring failure from missing checks.

Checks ending in `_surface_reserved` only prove that the placeholder-or-final output path exists. They do not claim that final evaluator or controller content was already written at evaluation time.

The protocol is also unhealthy if:

- adapter commands run before the negotiated contract files exist
- a blocked agreement still triggers adapter execution
- placeholder-backed checks pretend to prove final content instead of reserved output surfaces
