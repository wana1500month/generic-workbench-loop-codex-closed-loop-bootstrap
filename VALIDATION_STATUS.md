# Validation Status

Generated at: 2026-05-08T14:36:21+09:00

Validation scope: current working tree after source archive reproducibility hardening, semantic fixture relocation, source/install ZIP fail-fast messaging, and process validation gating.

Git SHA at validation start: `a5535047e72c12d36147db041fb51cb798a2a412`

Runtime:

- Host Node: `v22.12.0`
- Validation Node: `v22.16.0` via `npx -p node@22.16.0 -p npm@10.9.2`
- Validation npm: `10.9.2`
- Note: host Node `v22.12.0` crashed while loading the local TypeScript CLI on this machine, so build and validation commands were executed through the pinned `node@22.16.0` runtime.

Current validation state:

- Green locally after this update: `build`, `validate:process`, `npm test`, `validate:smoke-clean`, `validate:release`, and `validate:source-archive-repro`.
- Requires trusted runner: `validate:codex-live` for real Codex strict smoke and App Server live smoke.

Artifact scope:

- `validated_artifact_type`: `git_checkout`, `source_archive_candidate`, `install_zip`
- `source_archive_candidate_sha256`: `13B271E92A269E087F32D87FA56E0A11B108BCA432D127716B61A70E7114701D`
- `source_archive_candidate_files`: `335`
- `source_archive_commands_reproduced`: `npm ci`, `npm run build`, `npm test`, `npm run validate:smoke-clean`, `npm run validate:release`
- `fixtures_included_in_source_archive`: true, under `scripts/testing/fixtures/semantic-validation`
- `semantic_runtime_in_source_archive`: false, `.tmp/semantic-validation` is recreated during validation
- `validation_status_in_source_archive`: false, `VALIDATION_STATUS.md` is export-ignored to avoid stale or self-referential validation claims inside source archives
- `dist_included_in_install_zip`: true

Release artifact:

- Path: `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`
- Size: `1429266` bytes
- SHA-256: `5CFFA130AEA25DE4271E7CCC98FB76AF78FE8BAEC1C6C1C3917170777B64B1EF`

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
- `npm run validate:codex-timeout`
- `npm run validate:process`
- `npm run validate:fast`
- `npm test`
- `npm run validate:smoke-clean`
- `npm run validate:release`
- `npm run validate:source-archive-repro`

Release proof:

- `release:zip` rebuilt the workspace, packaged `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`, validated the installable ZIP, and validated product discovery -> prepare -> prepared `loop:start:codex` consumption without `node_modules`.
- `release:zip` ran `validate:release-zip` and `validate:release-product-start` against `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`.
- `validate:smoke-clean` hydrates `.tmp/semantic-validation` from tracked source fixtures in `scripts/testing/fixtures/semantic-validation`, clears only runtime state such as `target-state` / `.reference-state`, and then runs the full smoke suite.
- `validate:source-archive-repro` stages a source archive candidate without `.tmp/semantic-validation`, compiled dist, or install markers, then proves `npm ci`, `build`, `npm test`, `smoke-clean`, and `release` from that clean copy.
- `validation-utils.runLoop` defaults `HARNESS_DISABLE_CODEX_AGENTS=1`, so deterministic validators do not depend on live Codex CLI availability; trusted live Codex/App Server gates remain separate.
- `validate:codex-timeout` proves Codex wall-clock timeout, stale-output timeout, auth preflight timeout, process-tree cleanup, and timeout metadata persistence through the fake Codex harness.
- Timeout state now settles before process-tree cleanup finishes, so child `close` / `error` races preserve exit code `124` and the exact timeout reason.
- `npm test` now runs `validate:process` before `validate:core`, making process timeout/stale-output semantics a release-blocking local gate.
- `round-contract.json` now includes `schema_version`, `artifact_type`, `run_id`, `created_at`, and `producer`, and `validate:release-product-start` asserts those fields in the install ZIP path.
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
- `.gitattributes` marks `.tmp/`, `node_modules/`, `evals/runs/`, bundled dist, and `VALIDATION_STATUS.md` as `export-ignore` for source archives generated through `git archive`.
