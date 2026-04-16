# Progress

## Current State

- Status: control_plane_prototype
- Latest decision: product-build requests now route toward app-builder-loop, while loop:intake remains the staged gate and bootstrap generator resume is wired to the stored Codex session when target_root matches.
- Rounds executed: control-plane validations only (live Codex smoke still environment-blocked here)

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

## Latest Blocker

- Live Codex and App Server smoke are still environment-blocked in this workspace because the `codex` binary is not available on PATH.
