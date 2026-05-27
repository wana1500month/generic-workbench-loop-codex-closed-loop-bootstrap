# Generic Codex Workbench

A generic Codex workbench for closed-loop harness work. The harness engine is the core product of this repository, and `product_build` is one routed lane rather than the repository identity.

## What This Repo Is

- A file-based closed-loop harness runtime
- A generic front door for `product_build`, `harness_design`, `run_control`, `run_resume`, and `evaluator_tuning`
- A reusable adapter boundary for attaching real proof outside this repository

## What This Repo Is Not

- Not a bundled demo app
- Not an end-to-end product proof by itself
- Not a reference adapter repository

## Operational Status

This workbench is a supervised alpha / early beta harness. For Codex app installation, use the app gate (`npm run validate:app-release` or `npm run validate:release-gate`) and keep CLI/App Server live checks on trusted transport lanes. Do not use it for long-running unattended closed-loop operation, CI auto-fix, or auto-PR workflows until `npm test`, `npm run validate:smoke-clean`, `npm run validate:source-archive-repro`, and trusted-runner `npm run validate:transport:cli` are all green for the target environment.

## Quick Start

Use Node `22.16.0` or newer for local validation on Windows.

```bash
npm ci
npm run build
npm test
```

## Installable ZIP vs Source ZIP

Use the generated release ZIP for Codex app installation:

```bash
npm run release:zip
```

Install `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`, not a repository source archive. The release ZIP includes `packages/loop-orchestrator/dist` so product-build front-door and `loop:start:codex` commands can run without `npm ci`; it excludes `node_modules`, `.tmp`, persisted run artifacts, and `SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL.md`.

If `packages/loop-orchestrator/dist` is missing after unzip or `SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL.md` is present, you are not using the installable release ZIP. Prefer installing the generated release ZIP. Run `bash ./init.sh` from a source archive only when the operator explicitly accepts a local `npm ci`/build bootstrap. Skill and npm front-door helpers fail closed by default in this state; set `HARNESS_ALLOW_SOURCE_BOOTSTRAP=1` only when you intentionally want them to invoke bootstrap.

## Front Door Commands

Canonical operator flow:

```bash
npm run loop:intent -- --json "Build a dashboard app for operators"
npm run loop:discover -- --message "Build a dashboard app for operators" --json
npm run loop:prepare -- --front-door-session evals/front-door-sessions/session-thread-123.json --json
npm run loop:start:codex -- --json
npm run loop:continue -- --run-dir evals/runs/run-001 --json
npm run loop:status -- --json
```

`loop:intake`, `loop:resume`, `loop:phase`, `loop:run`, `loop:single`, and family/reference-adapter commands are internal, recovery, validation, or compatibility surfaces. `loop:intake` stays a stateless staged parser behind `loop:discover`; new operator flows should not start there. `loop:discover` is the file-backed discovery surface that accumulates intake answers per thread under `evals/front-door-sessions/`. Once that session reaches `ready_for_prepare`, `loop:prepare -- --front-door-session <path>` materializes the snapshot into run-owned artifacts and leaves the run at `ready_to_start`.

Product-build discovery collects product, execution, and adapter-design intake. The prepare step generates run-owned adapter artifacts under `evals/runs/<run-id>/generated-adapter/`, including `adapter.generated.json`, `adapter-plan.generated.json`, `adapter-plan.generated.md`, `rubric.generated.json`, `verification-profile.generated.json`, and `codex-adapter/*`, so the operator can inspect the generated adapter before saying `루프 시작` or `start loop`.

`loop:intent`, `loop:intake`, `loop:discover`, `loop:prepare`, and the `loop-runner` start/resume/phase surfaces use bundled dist first. Use `HARNESS_FORCE_BUILD=1` only for intentional developer rebuilds.

## Validation Suites

- `npm run validate:fast`: short deterministic commit gate
- `npm run validate:app`: Codex app foreground gate; builds, runs fast checks, and validates product front-door surfaces without requiring a `codex` binary
- `npm run validate:app-release` / `npm run validate:release-gate`: Codex app install ZIP gate; packages the release ZIP and validates release startup without requiring a `codex` binary
- `npm run validate:process`: process timeout, stale-output, and supervisor cleanup gate
- `npm run validate:core`: adapter-free deterministic integration gate
- `npm run validate:core-long`: longer lifecycle, quality-lift, continuation, and durable-memory integration gate
- `npm run validate:smoke-clean`: hydrates `.tmp/semantic-validation` from `scripts/testing/fixtures/semantic-validation`, clears runtime state, and proves smoke is self-contained
- `npm run validate:semantic-target-server-cleanup`: runs quality-lift, productization, and smoke-clean, then asserts no semantic `target-server.cjs` Node process remains
- `npm run validate:release`: builds the installable Codex app ZIP and validates release startup
- `npm run release:zip`: builds and packages the installable ZIP without running release validators
- `npm run validate:source-archive-repro`: stages a clean source archive candidate without `.tmp`, compiled `dist`, or `*.tsbuildinfo`, then force-builds and runs `npm ci`, `build`, `npm test`, `smoke-clean`, and `release`
- `npm run validate:nightly`: heavier deterministic core plus smoke-clean lane
- `npm run validate:transport:cli`: trusted-runner Codex CLI transport lane
- `npm run validate:transport:app-server`: optional App Server transport lane
- `npm run validate:codex-binary-preflight`: trusted-runner check that fails fast when `codex` is not executable; install Codex CLI or set `HARNESS_CODEX_BIN`
- `npm run validate:codex-auth-preflight:fake`: deterministic fake-Codex auth semantics check; `validate:codex-auth-preflight` remains a compatibility alias
- `npm run validate:codex-live`: trusted-runner-only live Codex and App Server gate, starting with the real binary preflight
- `npm run validate:live-smoke-results`: checks the persisted live smoke artifacts under `.tmp/codex-real-smoke/`

Trusted live smoke sequence:

```bash
npm run validate:release
npm run validate:codex-binary-preflight
npm run validate:transport:cli
npm run validate:transport:app-server
npm run release:preflight-live
npm run validate:live-smoke-results
```

Run the live sequence only on a host with an authenticated Codex CLI/App Server environment. Treat auth or host preflight failures as environment blockers, not deterministic harness regressions. A live smoke pass must leave `.tmp/codex-real-smoke/live-smoke-summary.json`.

`validate:reference-adapter:check` expects `REFERENCE_ADAPTER_CONTRACT` to be set. Without an attached adapter, external validation should fail closed.

## Adapter Boundary

See [ADAPTER_CONTRACT.md](./ADAPTER_CONTRACT.md).

## Main Docs

- [docs/OPERATOR_QUICKSTART.md](./docs/OPERATOR_QUICKSTART.md)
- [RUNBOOK.md](./RUNBOOK.md)
- [SPEC.md](./SPEC.md)
- [AGENT_PROTOCOL.md](./AGENT_PROTOCOL.md)
- [INTAKE_PROTOCOL.md](./INTAKE_PROTOCOL.md)
- [STATUS.md](./STATUS.md)
