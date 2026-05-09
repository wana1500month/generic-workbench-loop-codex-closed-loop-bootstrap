# Progress

## Current State

- Status: control_plane_prototype
- Latest decision: Codex app release gating is now separated from trusted transport gates, generated product adapters are run-local, and ready_to_start state is indexed by run/thread instead of a singleton marker.
- Rounds executed: control-plane validations only; `build`, `validate:app`, `validate:app-release`, `validate:generated-adapter-run-local`, `validate:front-door-session`, `validate:loop-prepare`, and `validate:cli-front-door` are green with pinned Node/npm on this host.

## Recent Decisions

- Product: Generic Codex Workbench
- Summary: This repository is a generic Codex workbench for closed-loop harness work. The closed-loop harness is the runtime engine, and `product_build` is only one routed lane.
- Finish line: The generic front door routes product_build, harness_design, run_resume, and evaluator_tuning reliably, durable memory stays identity-coherent, and control-plane validations pass without bundling a product surface.
- App gate: `validate:app` covers build, fast checks, and product front-door validation without requiring a local `codex` binary.
- App release gate: `validate:app-release` / `validate:release-gate` build and validate the install ZIP without requiring a local `codex` binary.

## Next Actions

- Keep `feature_list.generated.json` honest as validated control-plane items move from planned to done or in_progress.
- Append the latest blocker, failed check, or next action after each round in `progress.md` and `progress.jsonl`.
- Keep `done_when.md` aligned with the actual stop condition before closeout.
- Keep the workbench identity sentence stable across `AGENTS.md`, `IDEA.md`, `SPEC.md`, and the durable memory files.
- Keep trusted Codex CLI/App Server live checks on `validate:transport:*` lanes and external adapters separate from app install proof.

## Latest Blocker

- No active local app-gate blocker. Remaining risk is trusted transport coverage and real external-adapter proof outside this harness repository.
