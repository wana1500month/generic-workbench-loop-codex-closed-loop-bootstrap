# Progress

## Current State

- Status: control_plane_prototype
- Latest decision: the release-gate path is green for supervised beta, and live Codex readiness is now separated into a real binary preflight plus fake auth semantics before strict Codex/App Server smoke.
- Rounds executed: control-plane validations only; `build`, `validate:codex-timeout`, `validate:process`, `validate:fast`, `validate:resume-smoke`, `validate:attached-resume-smoke`, `validate:smoke-clean`, `release:zip`, `validate:core`, `validate:release-gate`, and `validate:codex-live` are green with pinned Node/npm on this host.

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
- Use `npm run validate:release-gate` for local pre-release validation, including source archive reproduction, and run `npm run validate:codex-binary-preflight` / `npm run validate:codex-live` only on a trusted Codex runner.

## Latest Blocker

- No active local release-gate blocker. Remaining risk is broader trusted-runner coverage across Codex CLI versions and external adapters.

- Live Codex and App Server strict smoke passed on the local authenticated runner; repeat on additional trusted runners before broader external beta claims.
