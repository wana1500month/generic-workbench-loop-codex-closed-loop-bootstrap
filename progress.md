# Progress

## Current State

- Status: control_plane_prototype
- Latest decision: P0 operational hardening now treats timeout/stale-output classification as a release-blocking process gate, with timeout state settled before process-tree cleanup to avoid `close` races.
- Rounds executed: control-plane validations only; `build`, `validate:codex-timeout`, `validate:process`, `validate:fast`, `validate:resume-smoke`, `validate:attached-resume-smoke`, `validate:smoke-clean`, `release:zip`, and `validate:core` are green with pinned Node/npm.

## Recent Decisions

- Product: Generic Codex Workbench
- Summary: This repository is a generic Codex workbench for closed-loop harness work. The closed-loop harness is the runtime engine, and `product_build` is only one routed lane.
- Finish line: The generic front door routes product_build, harness_design, run_resume, and evaluator_tuning reliably, durable memory stays identity-coherent, and control-plane validations pass without bundling a product surface.

## Next Actions

- Keep `feature_list.generated.json` honest as validated control-plane items move from planned to done or in_progress.
- Append the latest blocker, failed check, or next action after each round in `progress.md` and `progress.jsonl`.
- Keep `done_when.md` aligned with the actual stop condition before closeout.
- Keep the workbench identity sentence stable across `AGENTS.md`, `IDEA.md`, `SPEC.md`, and the durable memory files.
- Use `init.sh` to rehydrate the workbench before assuming the environment drifted.
- Use `npm run validate:release-gate` for local pre-release validation and `npm run validate:codex-live` only on a trusted Codex runner.

## Latest Blocker

- Live Codex and App Server strict smoke remain trusted-runner gates; deterministic validation now stays green without depending on live Codex CLI execution.
