# Validation Reliability

This repository has two validation modes.

## Deterministic Validation

Deterministic validation runs local Node scripts against fixture inputs and
file-backed harness state. These scripts must not depend on a live Codex thread,
network timing, a shared default front-door session directory, or a previous
run's persisted artifacts.

Rules:

- Use an isolated `HARNESS_RUNS_DIRECTORY` and `HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY`.
- Clear `CODEX_THREAD_ID`, `HARNESS_THREAD_BINDING_STATE`, and `HARNESS_LAUNCH_ORIGIN` unless the test is explicitly about those values.
- Keep outputs comparable across standalone and batch execution.
- Prefer explicit JSON assertions over chat transcript expectations.

Primary deterministic suites:

- `validate:quick`: fast routing, intake, front-door, readiness, scorecard, and project-kind checks.
- `validate:fast`: `quick` plus lightweight loop preparation and scorecard regressions.
- `validate:core`: heavier lifecycle, repeatability, batch isolation, continuation, and durable-memory checks.
- `validate:product-front-door`: front-door/product routing only. It intentionally excludes release ZIP packaging, prepare consumption, and generated adapter run-local checks.
- `validate:productization`: readiness, evaluation, strictness, scorecard, adaptive intake, and non-web loop closure checks.
- `validate:release`: install ZIP packaging and release startup checks.

## Live Codex Validation

Live Codex validation checks integration with an installed Codex binary or the
Codex app transport. It can be affected by authentication, model availability,
thread ownership, and external timing, so it is kept separate from the
deterministic suites.

Examples:

- `validate:transport:cli`
- `validate:transport:app-server`
- `validate:codex-live`
- `release:preflight-live`

Live checks may prove transport compatibility, but they are not required to make
a deterministic front-door or loop-state regression reproducible.

## Live Smoke Checklist

Run live smoke only on a trusted host that is expected to have Codex installed
and authenticated.

Checklist:

- Resolve the binary with `npm run validate:codex-binary-preflight` or set `HARNESS_CODEX_BIN`.
- Keep deterministic auth semantics separate with `npm run validate:codex-auth-preflight:fake`.
- Run CLI transport smoke with `npm run validate:transport:cli`.
- Run App Server smoke with `npm run validate:transport:app-server` when the host supports it.
- For operational release confidence, run `npm run release:preflight-live` after `npm run validate:release`.
- Record environment-blocked results as host preflight outcomes, not deterministic regressions.

## Front-Door Isolation Checks

`validate:front-door-session-repeat` runs `validate:front-door-session` at least
three times with separate temp roots. This catches fixed thread IDs, leaked
front-door session files, and environment variables that change later runs.

`validate:validation-batch-isolation` compares the normalized summary from a
standalone validator run with the same validator executed through
`run-validation-batch.mjs isolation-smoke`. If the summaries differ, the batch
path has leaked state or changed routing behavior.
