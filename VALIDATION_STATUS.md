# Validation Status

Generated at: 2026-05-09T06:23:59+09:00

Validation scope: current working tree after source archive reproducibility hardening, semantic fixture relocation, TypeScript incremental metadata exclusion, source/install ZIP fail-fast messaging, process validation gating, and live Codex gate clarification.

Git SHA at validation start: `ffb610caea1c42e60afb7039291807fa5765ebeb`

Runtime:

- Host Node: `v22.12.0`
- Validation Node: `v22.16.0` via `npx -p node@22.16.0 -p npm@10.9.2`
- Validation npm: `10.9.2`
- Note: host Node `v22.12.0` crashed while loading the local TypeScript CLI on this machine, so build and validation commands were executed through the pinned `node@22.16.0` runtime.

Current validation state:

- Green locally after this update: `build`, `validate:process`, `npm test`, `validate:smoke-clean`, `validate:release`, `validate:source-archive-repro`, `validate:release-gate`, and `validate:codex-live`.
- Requires trusted runner: `validate:codex-live` for real Codex strict smoke and App Server live smoke.
- Live Codex gate structure: `validate:codex-binary-preflight` -> `validate:codex-auth-preflight:fake` -> `validate:codex:real-smoke:strict` -> `validate:app-server:real-smoke:strict`.
- Local live runner: `codex-cli 0.128.0`, ChatGPT auth, file-backed auth with refresh token.
- Environment note: hosts without an executable `codex` binary fail at `validate:codex-binary-preflight` with `HARNESS_CODEX_BIN` guidance rather than reaching strict smoke.

Artifact scope:

- `validated_artifact_type`: `git_checkout`, `source_archive_candidate`, `install_zip`
- `source_archive_candidate_sha256`: `530B838854A47492CE67D5D3197B6BFD7ED92498AF8199333819AAF7300F079D`
- `source_archive_candidate_files`: `336`
- `source_archive_commands_reproduced`: `npm ci`, `npm run build`, `npm test`, `npm run validate:smoke-clean`, `npm run validate:release`
- `fixtures_included_in_source_archive`: true, under `scripts/testing/fixtures/semantic-validation`
- `semantic_runtime_in_source_archive`: false, `.tmp/semantic-validation` is recreated during validation
- `typescript_incremental_metadata_in_source_archive`: false
- `validation_status_in_source_archive`: false, `VALIDATION_STATUS.md` is export-ignored to avoid stale or self-referential validation claims inside source archives
- `dist_included_in_install_zip`: true
- `typescript_incremental_metadata_in_install_zip`: false

Release artifact:

- Path: `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`
- Size: `1432339` bytes
- SHA-256: `BD84E8D3A9709E8AD363D32E9C5845EEC897DCB251BA42599F5D618255D0474E`

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
- `npm run validate:release-gate`
- `npm run validate:codex-live`

Release proof:

- `release:zip` rebuilt the workspace, packaged `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`, validated the installable ZIP, and validated product discovery -> prepare -> prepared `loop:start:codex` consumption without `node_modules`.
- `release:zip` ran `validate:release-zip` and `validate:release-product-start` against `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`.
- `validate:smoke-clean` hydrates `.tmp/semantic-validation` from tracked source fixtures in `scripts/testing/fixtures/semantic-validation`, clears only runtime state such as `target-state` / `.reference-state`, and then runs the full smoke suite.
- `validate:source-archive-repro` stages a source archive candidate without `.tmp/semantic-validation`, compiled dist, TypeScript incremental metadata, or install markers, then force-builds and proves `npm ci`, `build`, `npm test`, `smoke-clean`, and `release` from that clean copy.
- `build` now validates required loop-orchestrator `dist` sentinels after TypeScript exits, so stale `*.tsbuildinfo` cannot mask missing runtime imports.
- `validate:source-archive-repro` rejects npm candidates older than npm 7 before running nested `npm ci`, avoiding lifecycle `npm_execpath` contamination from old npm installations.
- `validate:codex-live` now fails fast at `validate:codex-binary-preflight` when the real Codex binary is missing, keeps fake auth semantics under `validate:codex-auth-preflight:fake`, and then runs strict real `codex exec` plus App Server smoke.
- App Server live smoke now starts directly with the task turn to avoid racing an initial status turn, and App Server interrupt cleanup tolerates `no active turn to interrupt` as a no-op race.
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
- `.gitattributes` marks `.tmp/`, `node_modules/`, `evals/runs/`, bundled dist, `VALIDATION_STATUS.md`, and `*.tsbuildinfo` as `export-ignore` for source archives generated through `git archive`.
