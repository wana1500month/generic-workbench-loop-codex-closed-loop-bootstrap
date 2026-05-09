# Progress

## Current State

- Status: control_plane_prototype
- Latest decision: Generated browser-only verification contracts now preserve product scope by filtering API, draft/persistence, and error-recovery probes unless the intake asks for those surfaces or behaviors.
- Rounds executed: control-plane validations only; build, generated verification contract, app prepare isolation, front-door session, loop prepare, prepared-session consumption, transport mode, and release ZIP/product-start checks are green on the Codex-bundled Node runtime.

## Recent Decisions

- Product: Generic Codex Workbench
- Summary: This repository is a generic Codex workbench for closed-loop harness work. The closed-loop harness is the runtime engine, and `product_build` is only one routed lane.
- Finish line: The generic front door routes product_build, harness_design, run_resume, and evaluator_tuning reliably, durable memory stays identity-coherent, and control-plane validations pass without bundling a product surface.
- App gate: `validate:app` is now the lightweight app batch for build plus intent/intake/front-door/transport/generated-contract/run-local/prepare-start checks without requiring a local `codex` binary.
- App release gate: `validate:app-release` / `validate:release-gate` build and validate the install ZIP without requiring a local `codex` binary.
- Product contract: browser-only generated profiles now keep `expected_target_surfaces` and live modes to `browser`, semantic `data-workflow-*` selectors are primary, and legacy `data-testid` selectors remain fallbacks.

## Next Actions

- Keep `feature_list.generated.json` honest as validated control-plane items move from planned to done or in_progress.
- Append the latest blocker, failed check, or next action after each round in `progress.md` and `progress.jsonl`.
- Keep `done_when.md` aligned with the actual stop condition before closeout.
- Keep the workbench identity sentence stable across `AGENTS.md`, `IDEA.md`, `SPEC.md`, and the durable memory files.
- Keep trusted Codex CLI/App Server live checks on `validate:transport:*` lanes and external adapters separate from app install proof.
- Run the full app batch through the normal `npm run validate:app` path on hosts whose default Node runtime does not crash CommonJS `require()`.

## Latest Blocker

- No active app-contract blocker. This host's default Node 22.12 crashes CommonJS `require()`, so local validation used the Codex-bundled Node 24.14 runtime directly.
