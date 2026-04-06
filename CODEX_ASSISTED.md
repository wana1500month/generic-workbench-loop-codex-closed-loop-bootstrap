# Codex-Assisted Loop

This repository is designed to hand work back to Codex through run artifacts.

## Intended flow

1. Edit `IDEA.md`.
2. Run:
   - `npm run loop:single`
   - or `npm run loop:run -- 3`
3. Open the latest run under `evals/runs/run-###`.
4. Read `codex-handoff.md`, `round-contract.json`, `generator-plan.json`, `evaluator-verdict.json`, `patch-request.json`, and `eval_report.json` first. On initial build attempts or blocked remediation attempts, also read `contract-review.json` and `contract-agreement.json` when they are present. For adapter-backed runs, inspect `core_probe_results`, confirm the evaluator profile came from the core trust domain, then inspect the profile's release assertions, witness assertion coverage, and any `run_target` `target_manifest` values before trusting `target_reached`.
5. Use `patch-request.json.must_fix[].target_check_ids` as the structural continuation list, not just the prose text.
6. Continue improving the harness itself.

## Important boundary

- This repo does not contain a bundled adapter.
- Real target proof belongs to an external adapter repository or plugin.

## Artifact entry points

- `planner-brief.md`
- `planned-scenario.json`
- `plan.json`
- `round-###/round-contract.json`
- `round-###/generator-plan.json`
- `round-###/evaluator-verdict.json`
- `round-###/patch-request.json`
- `round-###/eval_report.json`
- `controller-summary.md`

`round-###/contract-review.json` and `round-###/contract-agreement.json` are guaranteed on the initial build attempt and may be omitted on clean remediation attempts.
