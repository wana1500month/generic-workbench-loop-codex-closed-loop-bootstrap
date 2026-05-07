# Validation Status

Generated at: 2026-05-08T06:08:33+09:00

Validation scope: current working tree after operational hardening for bounded Codex child execution, deterministic smoke cleanup, run-control resume phrase routing, real-smoke result persistence, and install ZIP/source archive separation, before commit.

Git SHA at validation start: `8262fa4`

Runtime:

- Host Node: `v22.12.0`
- Validation Node: `v22.16.0` via `npx -p node@22.16.0 -p npm@10.9.2`
- Validation npm: `10.9.2`
- Note: host Node `v22.12.0` crashed while loading the local TypeScript CLI on this machine, so build and validation commands were executed through the pinned `node@22.16.0` runtime.

Current validation state:

- Green locally after this update: deterministic core gate, clean smoke runtime-state cleanup, Codex timeout coverage, and release ZIP marker validation.
- Requires trusted runner: real Codex strict smoke and App Server live smoke.

Release artifact:

- Path: `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`
- Size: `1377002` bytes
- SHA-256: `F3D1DA0FFB081ADDB66A677E7256D9567F5266AE101959FFB409A8A49FF4B168`

Release ZIP contents checked:

- `packages/loop-orchestrator/dist/cli.js`: present
- `packages/loop-orchestrator/dist/intent-gate-cli.js`: present
- `packages/loop-orchestrator/dist/front-door-session-cli.js`: present
- `packages/loop-orchestrator/dist/bootstrap/generated-adapter.js`: present
- `CODEX_APP_INSTALL.md`: present
- `release-manifest.json`: present
- `SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL.md`: absent
- `VALIDATION_STATUS.md`: external proof file, intentionally not embedded in the ZIP because the archive checksum is computed after packaging
- `node_modules/`: absent
- `.tmp/`: absent

Passed commands:

- `npm run build`
- `npm run validate:intent-gate`
- `npm run validate:codex-timeout`
- `npm run validate:resume-smoke`
- `npm run validate:attached-resume-smoke`
- `npm run validate:smoke-clean`
- `npm run release:zip`
- `npm run validate:core`

Release proof:

- `release:zip` rebuilt the workspace, packaged `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`, validated the installable ZIP, and validated product discovery -> prepare -> prepared `loop:start:codex` consumption without `node_modules`.
- `release:zip` ran `validate:release-zip` and `validate:release-product-start` against `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`.
- `validate:smoke-clean` verifies tracked `.tmp/semantic-validation` fixtures, clears only fixture runtime state such as `target-state` / `.reference-state`, and then runs the full smoke suite.
- `validation-utils.runLoop` defaults `HARNESS_DISABLE_CODEX_AGENTS=1`, so deterministic validators do not depend on live Codex CLI availability; trusted live Codex/App Server gates remain separate.
- `validate:codex-timeout` proves Codex wall-clock timeout, stale-output timeout, auth preflight timeout, process-tree cleanup, and timeout metadata persistence through the fake Codex harness.
- Verification surface parsing strips path-like tokens before detecting surfaces, so paths such as `/tmp/harness_latest/review-budget-app` no longer mark the session as `test`.
- Browser-like target families normalize workflow verification to browser-primary surfaces even when users mention test or CLI checks, preserving workflow release-gate probes through prepare.
- `validate:source-bootstrap-guard` now creates `.tmp` before `mkdtemp`, so the clean source archive path no longer fails before checking source-bootstrap policy.
- Generated adapters now persist an adapter review task, adapter-plan-aware evidence, workflow-level check findings, and an `adapter_contract_fulfillment` subjective metric.
- Operator surfaces expose adapter plan, adapter contract, evaluator profile, and adapter review task paths before `ready_to_start`.
- Front-door discovery includes an adapter-design checkpoint before `ready_for_prepare`; release validation covers the additional adapter answer turn and verifies workflow selectors in the attached generator prompt.
- Natural Korean product answers can fill target users, core workflows, and finish line from one paragraph.
- Korean labeled natural answers such as labeled user, core-workflow, and finish-line forms are normalized into snapshot fields.
- Front-door discovery rechecks the saved intake snapshot before allowing `ready_for_prepare`; missing core product fields force product questions instead of failing later in prepare.
- Korean ready output uses localized summary and next-step labels.
- Workflow checks are aligned back to core workflow names before prepare, so aliases such as "monthly stats" vs. "view monthly stats" do not block integrity validation.
- Adapter plan previews and generated markdown include completed run command and ready URL defaults.
- `.gitattributes` marks `.tmp/`, `node_modules/`, `evals/runs/`, and bundled dist as `export-ignore` for source archives generated through `git archive`.
