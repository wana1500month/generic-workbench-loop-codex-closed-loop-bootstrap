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

## Front Door Commands

```bash
npm run loop:intent -- --json "Build a dashboard app for operators"
npm run loop:intake -- --json "Build a dashboard app for operators"
npm run loop:discover -- --thread-id thread-123 --message "Build a dashboard app for operators" --json
npm run loop:prepare -- --front-door-session evals/front-door-sessions/session-thread-123.json --json
npm run loop:start:codex -- --json
npm run loop:status -- --json
```

`loop:intake` stays a stateless staged gate. `loop:discover` is the file-backed discovery surface that accumulates intake answers per thread under `evals/front-door-sessions/`. Once that session reaches `ready_for_prepare`, `loop:prepare -- --front-door-session <path>` materializes the snapshot into run-owned artifacts and leaves the run at `ready_to_start`.

`loop:intent`, `loop:intake`, `loop:discover`, and `loop:prepare` rebuild only when the compiled front-door dist is missing or stale.

## Validation Suites

- `npm test`: adapter-free core checks
- `npm run smoke`: short smoke checks
- `npm run validate:product-front-door`: front-door routing and preparation checks
- `npm run validate:external`: requires an external adapter contract and environment

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
