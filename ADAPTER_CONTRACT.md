# Adapter Contract

This repository does not bundle a target application. Real build and QA execution must cross an external adapter boundary.

## Purpose

The adapter boundary lets the harness core stay generic while a separate repository or plugin provides target-specific behavior.

## Required capabilities

- `prepare_target`
- `apply_change`
- `run_target`
- `capture_evidence`
- `run_checks`
- `grade_round`

Each capability is configured as a shell command in an external adapter JSON file. The harness writes an input packet and expects the capability to write a result JSON back.

## Adapter contract file

The adapter contract should carry execution wiring only. The harness core selects the evaluator profile through `rubric.evaluator_profile_path` or `--evaluator-profile`.

```json
{
  "adapter_id": "external-target-example",
  "label": "External Target Example",
  "contract_version": "1",
  "target_root": "../external-target-repo",
  "capabilities": {
    "prepare_target": {
      "command": "node scripts/prepare-target.js"
    },
    "apply_change": {
      "command": "node scripts/apply-change.js"
    },
    "run_target": {
      "command": "node scripts/run-target.js"
    }
  },
  "verification_provider": {
    "provider_id": "external-target-verifier",
    "capabilities": {
      "capture_evidence": {
        "command": "node scripts/capture-evidence.js"
      },
      "run_checks": {
        "command": "node scripts/run-checks.js"
      },
      "grade_round": {
        "command": "node scripts/grade-round.js"
      }
    }
  }
}
```

The evaluator profile now lives in the harness trust domain, for example under `evals/verification-profiles/fullstack-app.profile.json`, `evals/verification-profiles/api-service.profile.json`, or `evals/verification-profiles/browser-app.profile.json`. The verification provider keeps proof execution in a separate trust domain from target mutation. The adapter should publish `observed_value` fields, and the harness core compares them against the core-owned profile. That profile may also declare evaluator-owned `core_probes`, which the core executes itself before it will emit `target_reached`. Core probes now split into `release_gate` and `supporting` roles. Supporting probes may use `http`, `browser`, `file_contains`, `json_value`, or `shell_command` for liveness and diagnostics, but they cannot open `target_reached`. Required `release_gate` probes must use mode `http_json` or `browser_journey`, declare an `assertion_id`, may carry `assertion_tags`, stay at `semantic_level: "feature"` or `"workflow"`, and resolve target surfaces through `target_manifest` URLs published by `run_target` instead of run-local harness artifacts. Profiles may also set `minimum_feature_release_assertions`, `minimum_assertion_tag_counts`, and optional metadata such as `target_family`, `validation_lane`, and `bundle_label`, so explicit `--evaluator-profile` launches still report the correct family/lane in `summary.json`, `round_summary.json`, and round handoff text. Before the adapter runs, the harness now also writes a round-local `round-contract.json` that names the current implementation slice, release-gate checks, release-gate probe ids, and pivot triggers. Adapter-side tooling should treat that round contract as the authoritative round scope and should not widen beyond it on its own.

Target-family selection can now happen directly at runtime through `--target-family`, which resolves bundled profiles such as `api-service`, `crud-api`, `chat-agent`, `browser-app`, `browser-editor`, `fullstack-app`, or `dashboard` without delegating bundle choice back to the adapter. Adapter-free runs now default to the neutral `generic-core` bundle; that family is for harness-core structural closure and should not be used as the target-quality story for a real external adapter.

Run identity now also binds the adapter contract path and hash. If a resumed run points at a different adapter contract, bundle, rubric, target family, or validation lane, the harness rejects that resume unless `--allow-resume-migration` is supplied explicitly.
That fail-closed identity is persisted per run in `resume-identity.json`.
If the run already ended with `target_reached`, `contract_completed`, `environment_blocked`, or `adapter_contract_invalid`, default resume now stays closed unless `--force-reopen-terminal` is supplied explicitly. `--allow-resume-migration` records an identity override, but it does not reopen a terminal run by itself. Resumed invocations also persist `resume-decision.json` plus machine-readable `runtime_events[]`, so operators can tell whether a run continued, reopened, or stayed closed without depending on warning prose.

## Environment variables

The harness runtime sets:

- `HARNESS_INPUT_PATH`
- `HARNESS_OUTPUT_PATH`
- `HARNESS_TARGET_ROOT`
- `HARNESS_RUN_DIRECTORY`
- `HARNESS_ROUND_DIRECTORY`
- `HARNESS_CAPABILITY`
- `HARNESS_PROVIDER_ID`
- `HARNESS_PROVIDER_ROLE`
- `HARNESS_ROUND_CONTRACT_PATH` (when the round has a scoped round contract artifact)

## Result format

Each capability result should follow this shape:

```json
{
  "capability": "run_checks",
  "ok": true,
  "summary": "Deterministic target checks passed.",
  "findings": [],
  "evidence_paths": ["artifacts/desktop.png"],
  "evidence_items": [
    {
      "path": "artifacts/desktop.png",
      "kind": "screenshot",
      "description": "Post-change desktop view.",
      "supports_check_ids": ["ui_shell_renders"],
      "supports_criterion_ids": ["ui_shell_renders"]
    },
    {
      "path": "artifacts/live-verification.log",
      "kind": "interaction-log",
      "description": "Verifier-owned interaction transcript showing the target was opened and inspected.",
      "supports_check_ids": ["live_verification_present"],
      "supports_criterion_ids": ["ui_shell_renders"]
    },
    {
      "path": "artifacts/live-verification-witness.json",
      "kind": "verification-witness",
      "description": "Structured verifier witness that links the interaction log to grounded target checks.",
      "supports_check_ids": ["live_verification_present"],
      "supports_criterion_ids": ["ui_shell_renders"]
    }
  ],
  "criteria_results": [
    {
      "criterion_id": "ui_shell_renders",
      "status": "pass",
      "summary": "The captured shell renders without missing regions.",
      "hard": true,
      "threshold": "Required layout must be visible in the captured shell.",
      "observed_value": "Desktop shell screenshot contains the expected frame.",
      "evidence_paths": ["artifacts/desktop.png"]
    }
  ],
  "metadata": {
    "check_count": 8
  }
}
```

Successful `run_target` results may also publish a target manifest that gives the core stable URLs for release-gate probing:

```json
{
  "capability": "run_target",
  "ok": true,
  "summary": "Started the target and published live URLs for core QA.",
  "evidence_paths": ["artifacts/run-target.log"],
  "target_manifest": {
    "health_url": "http://127.0.0.1:4173/healthz",
    "app_url": "http://127.0.0.1:4173/",
    "api_base_url": "http://127.0.0.1:4173/api/"
  }
}
```

`grade_round` may also return:

```json
{
  "score": 0.84,
  "overall_verdict": "advance",
  "threshold_verdict": "pass",
  "blocking_criterion_ids": [],
  "evidence_paths": [
    "artifacts/grade-summary.md",
    "artifacts/check-results.json",
    "artifacts/desktop.png"
  ],
  "evidence_items": [
    {
      "path": "artifacts/grade-summary.md",
      "kind": "report",
      "description": "Round grading summary derived from checks and captured evidence.",
      "derived_from_capabilities": ["run_checks", "capture_evidence"],
      "derived_from_evidence_paths": [
        "artifacts/check-results.json",
        "artifacts/desktop.png",
        "artifacts/live-verification.log"
      ]
    },
    {
      "path": "artifacts/check-results.json",
      "kind": "json",
      "description": "Structured check output used by round grading."
    },
    {
      "path": "artifacts/desktop.png",
      "kind": "screenshot",
      "description": "Captured shell reused as grading proof."
    },
    {
      "path": "artifacts/live-verification.log",
      "kind": "interaction-log",
      "description": "Verifier-owned interaction transcript reused as grading proof."
    }
  ],
  "criteria_results": [
    {
      "criterion_id": "ui_shell_renders",
      "status": "pass",
      "summary": "The shell-level criterion stayed satisfied after grading review.",
      "hard": true,
      "threshold": "Required layout must be visible in the captured shell.",
      "observed_value": "Runtime proof and grading summary agree on the visible shell.",
      "evidence_paths": [
        "artifacts/check-results.json",
        "artifacts/desktop.png",
        "artifacts/live-verification.log"
      ]
    }
  ]
}
```

The core validates adapter result payloads before trusting them. In particular:

- `capability`, `ok`, `summary`, `findings`, and `evidence_paths` must stay schema-consistent
- every cited `evidence_paths` entry must resolve to a real file
- empty evidence files do not count as proof
- successful proof claims must provide evidence item `kind` and `description` fields
- successful `capture_evidence`, `run_checks`, and `grade_round` results must include at least one non-empty verifiable evidence file
- when `evidence_items` are present, they must stay consistent with `evidence_paths`
- evidence files are content-checked generically, so empty JSON objects, too-short text, undersized images, and tiny binary blobs do not count as proof
- successful `run_checks` results should use `evidence_items[].supports_check_ids` to identify which checks the evidence supports
- successful `run_checks` and `grade_round` results must provide grounded `criteria_results` entries that cite concrete evidence paths
- successful `run_checks` evidence should use `evidence_items[].supports_criterion_ids` so each criterion can be traced back to concrete proof
- when a verification profile is attached, successful `run_checks` and `grade_round` criteria must provide `observed_value` so the core can judge them against evaluator-owned expectations
- successful `grade_round` results should use both `evidence_items[].derived_from_capabilities` and `evidence_items[].derived_from_evidence_paths` to point back to `run_checks` or `capture_evidence`
- successful target-facing proof must include at least one verifier-produced `interaction-log`, trace, transcript, or equivalent live verification artifact that is linked into criteria or grading
- successful target-facing proof must also include at least one structured `verification-witness` artifact that cites the verifier provider, proof capability, live verification mode, interaction log path, and grounded verification steps
- successful `run_target` results may publish `target_manifest.health_url`, `target_manifest.app_url`, and `target_manifest.api_base_url`, and those values must be absolute `http` or `https` URLs when present
- adapter-attached target rounds should receive a core-owned evaluator profile through the rubric or CLI so the core can independently verify the target before claiming `target_reached`
- supporting probes may use `http`, `browser`, target-root file probes, target JSON probes, or `shell_command`, but required release-gate probes must use `role: "release_gate"` with mode `http_json` or `browser_journey`
- required release-gate probes must declare `assertion_id`, use `semantic_level: "feature"` or `"workflow"`, and resolve their target through `target_manifest_key`
- `target_reached` requires the configured minimum number of distinct release-gate assertions to pass; when `minimum_feature_release_assertions` is omitted, the harness defaults that minimum to `2`
- `target_reached` may also require tagged release coverage such as `persistence` or `error_path` when the core-owned bundle sets `minimum_assertion_tag_counts`
- hard release assertions must be covered both by verifier-owned `verification-witness.assertion_ids` and by passing core-owned release-gate probe results
- adapter-authored `verification_profile_path` remains deprecated schema compatibility metadata and is ignored by the runtime
- adapters that still publish `verification_profile_path` now trigger a runtime warning in stdout, `summary.json`, `controller-summary.md`, and `codex-handoff.md`
- adapters should migrate off `verification_profile_path` by selecting a core-owned bundle at launch time with `--target-family <family>` for bundled packs or `--evaluator-profile <path>` for explicit bundle files
- the harness records command, stdout, stderr, result, and evidence hashes for executed proof capabilities, so adapters should expect proof provenance to be reviewed after execution
- successful `grade_round` results must provide `threshold_verdict`, and any `blocking_criterion_ids` must correspond to failed criteria
- successful `grade_round` results cannot upgrade a failed `run_checks` criterion to pass without new grounded proof
- successful `grade_round` results must provide at least a `score` or an `overall_verdict`
- adapter-attached target rounds must configure `verification_provider.provider_id` separately from `adapter_id`
- adapter-attached target rounds must route `capture_evidence`, `run_checks`, and `grade_round` through `verification_provider.capabilities`

## Boundary rule

The core repo owns the protocol, controller, evaluator-owned verification semantics, evaluator profile selection, the requirement that proof run in an independent verifier boundary, and the execution of evaluator-owned release-gate probes against target-facing `http_json` or `browser_journey` surfaces. The adapter owns target mutation commands, verifier-owned observations, and publication of target-manifest URLs that let the core hit the live target independently.

## Authoritative versus compatibility

| Surface | Role | Runtime authority | Notes |
|---|---|---|---|
| adapter capability commands | execution wiring | adapter | load-bearing for execution only |
| `verification_provider` | proof trust boundary | adapter | load-bearing for skeptical QA |
| `target_manifest` | live target locator | adapter | load-bearing only after `run_target` succeeds |
| `--evaluator-profile` / `--target-family` / rubric bundle | evaluator policy | core | authoritative |
| `validation_lane` | lane classification | core | derived from the selected evaluator bundle |
| adapter `verification_profile_path` | compatibility metadata | none | deprecated and ignored |

## Companion adapter smoke

This repo intentionally does not ship a reference target. To validate a real external adapter from a companion repository, first check the external wiring:

```powershell
npm run validate:reference-adapter:check
```

If you do not yet have a companion adapter shell, bootstrap one outside this repository. The default scaffold is a working canonical API companion that is expected to pass the strict validator; canonical CRUD and canonical chat variants are also available, along with deterministic `patch-only` and `recontract` multi-round templates for each family. Use `--template placeholder` only when you intentionally want a wiring shell:

```powershell
npm run reference-adapter:scaffold -- ../reference-adapter-template
npm run reference-adapter:scaffold -- ../reference-adapter-api-patch-only --template canonical-api-patch-only
npm run reference-adapter:scaffold -- ../reference-adapter-api-recontract --template canonical-api-recontract
npm run reference-adapter:scaffold -- ../reference-adapter-crud --template canonical-crud
npm run reference-adapter:scaffold -- ../reference-adapter-crud-patch-only --template canonical-crud-patch-only
npm run reference-adapter:scaffold -- ../reference-adapter-crud-recontract --template canonical-crud-recontract
npm run reference-adapter:scaffold -- ../reference-adapter-chat --template canonical-chat
npm run reference-adapter:scaffold -- ../reference-adapter-chat-patch-only --template canonical-chat-patch-only
npm run reference-adapter:scaffold -- ../reference-adapter-chat-recontract --template canonical-chat-recontract
npm run reference-adapter:scaffold -- ../reference-adapter-placeholder --template placeholder
npm run reference-adapter:bootstrap-independent -- ../independent-crud-companion --template canonical-crud
```

Then set `REFERENCE_ADAPTER_CONTRACT` plus either `REFERENCE_TARGET_FAMILY` or `REFERENCE_EVALUATOR_PROFILE`, and run the strict validator:

```powershell
npm run validate:reference-adapter
```

Use `npm run smoke:reference-adapter` when you only want a wiring-oriented seed/resume smoke, and use `npm run validate:reference-adapter:canonical`, `:canonical:patch-only`, `:canonical:recontract`, `:canonical:crud`, `:canonical:crud:patch-only`, `:canonical:crud:recontract`, `:canonical:chat`, `:canonical:chat:patch-only`, or `:canonical:chat:recontract` for fully reproducible external companion paths generated on demand by the harness repository itself.

To install the same strict validator into a real companion repository CI workflow, use:

```powershell
npm run reference-adapter:install-ci -- ../external-companion --adapter adapter.json --target-family crud-api
```

`reference-adapter:install-ci` now derives the harness repository and branch from the current git remote and checked-out branch by default. If derivation is unavailable or you need to point at a different harness fork, pass `--harness-repo <owner/repo>` and optionally `--harness-ref <branch-or-tag>`.

`reference-adapter:bootstrap-independent` is the boring handoff path for a real sibling companion repo: it scaffolds the external companion outside this repository and installs the strict CI workflow into that new repo in one command, without bundling the target into the harness repo.

The canonical companions are no longer shallow liveness shells. API and CRUD templates exercise stale-write rejection plus pagination consistency. Chat exercises refusal fallback safety plus tool-trace persistence. Those same families are also available in deterministic `patch-only` and `recontract` forms so a real companion can prove one-round closure, bounded reopen, and recontract fallback under the same strict validator.

The check mode verifies that the contract exists, parses as JSON, and exposes the required executor and verification-provider capabilities before any run is attempted. The strict validator seeds one attempt with `loop:single`, resumes the same run in a fresh process with `--resume-run`, and fails if the terminal run does not honestly reach `target_reached`, publish proof, and close the core proof-health checks. Single-round canonical templates must stay terminal-noop on default resume, while patch-only and recontract templates must converge in two or three rounds respectively and record the expected negotiation modes. If the required env wiring is missing, the script fails with a setup checklist instead of a raw missing-env error or stack trace.

If the companion smoke intentionally changes bundle selection or target family between the seed and resume phases, add `--allow-resume-migration` to the resume invocation and expect the run to persist `resume-migration.json` for review.

`verification-witness` JSON should look like:

```json
{
  "witness_id": "external-target-verifier-run-checks-round-02",
  "provider_id": "external-target-verifier",
  "provider_role": "verifier",
  "capability": "run_checks",
  "mode": "browser",
  "target_root": "../external-target-repo",
  "target_reference": "app-shell",
  "interaction_log_path": "artifacts/live-verification.log",
  "assertion_ids": ["ui_shell_renders"],
  "steps": [
    {
      "action": "open target shell",
      "outcome": "pass",
      "artifact_paths": ["artifacts/live-verification.log"]
    },
    {
      "action": "inspect rendered shell",
      "outcome": "pass",
      "artifact_paths": [
        "artifacts/live-verification.log",
        "artifacts/desktop.png"
      ]
    }
  ]
}
```
