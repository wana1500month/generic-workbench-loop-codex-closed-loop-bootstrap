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

## Quick Start

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

If `packages/loop-orchestrator/dist` is missing after unzip, you are not using the installable release ZIP. Prefer installing the generated release ZIP. Run `bash ./init.sh` from a source archive only when the operator explicitly accepts a local `npm ci`/build bootstrap. Skill and npm front-door helpers fail closed by default in this state; set `HARNESS_ALLOW_SOURCE_BOOTSTRAP=1` only when you intentionally want them to invoke bootstrap.

## Front Door Commands

```bash
npm run loop:intent -- --json "Build a dashboard app for operators"
npm run loop:intake -- --json "Build a dashboard app for operators"
npm run loop:discover -- --message "Build a dashboard app for operators" --json
npm run loop:prepare -- --front-door-session evals/front-door-sessions/session-thread-123.json --json
npm run loop:start:codex -- --json
npm run loop:status -- --json
```

`loop:intake` stays a stateless staged gate. `loop:discover` is the file-backed discovery surface that accumulates intake answers per thread under `evals/front-door-sessions/`. Once that session reaches `ready_for_prepare`, `loop:prepare -- --front-door-session <path>` materializes the snapshot into run-owned artifacts and leaves the run at `ready_to_start`.

Product-build discovery collects product, execution, and adapter-design intake. The prepare step generates `adapter-plan.generated.json`, `adapter-plan.generated.md`, `.generated/codex-adapter/runtime-config.json`, `.generated/codex-adapter/scripts/*`, and `.generated/codex-adapter/adapter-review-task.md` so the operator can inspect the generated adapter before saying `루프 시작`.

`loop:intent`, `loop:intake`, `loop:discover`, `loop:prepare`, and the `loop-runner` start/resume/phase surfaces use bundled dist first. Use `HARNESS_FORCE_BUILD=1` only for intentional developer rebuilds.

## Validation Suites

- `npm run validate:core`: adapter-free deterministic core gate
- `npm run validate:smoke-clean`: clears semantic fixture runtime state and proves smoke is self-contained against tracked fixtures
- `npm run release:zip`: builds the installable Codex app ZIP and validates release startup
- `npm run validate:codex:real-smoke:strict`: trusted-runner-only live Codex gate

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
