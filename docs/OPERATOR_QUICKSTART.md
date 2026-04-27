# Operator Quickstart

This repository is a generic Codex workbench for closed-loop harness runs. It does not bundle a product target or reference app.

## First Run From A Clean ZIP

Run one bootstrap command before using plugin skills:

```bash
./init.sh
```

On Windows shells, use the equivalent npm path:

```bash
npm ci
npm run build
```

Skill helpers also attempt `npm run build --silent` when the compiled `packages/loop-orchestrator/dist` entrypoint is missing. If that automatic build fails, the helper prints the recovery command instead of failing with only a missing-dist stack.

## Main Codex App Surfaces

Use these entry skills as the operator-facing surface:

- `intent-router`: classify the next request into the correct lane.
- `loop-control`: start, inspect, resume, continue, or stop foreground harness runs.
- `run-resume`: decide whether a persisted run should continue, hold, reopen, or close.
- `closeout`: close a run from persisted evidence when the harness is ready to stop.

Compatibility aliases remain for older automation, but new operator flows should start from the lane-centric skills above.

## Minimal Validation

Use this sequence before treating the workbench as operational:

```bash
npm run build
npm run validate:security-guards
npm test
```

Real Codex and App Server smoke checks still require a host with a usable `codex` binary and authenticated `CODEX_HOME`:

```bash
npm run validate:codex:real-smoke:strict
npm run validate:app-server:real-smoke:strict
```

## Security Defaults

Evidence files are resolved only inside allowed runtime roots and credential-looking paths such as `.codex/auth.json`, `.env`, private keys, tokens, and secret files are rejected.

Target manifest URLs and core live probes are limited to localhost and loopback hosts by default. To probe an explicitly approved external target, set:

```bash
HARNESS_ALLOW_NONLOCAL_TARGET_URLS=1
```

Private, link-local, loopback, broadcast, and metadata hosts remain blocked for nonlocal mode.

Large evidence, HTTP response bodies, and command output are capped by default. Override only for trusted runs:

```bash
HARNESS_EVIDENCE_MAX_BYTES=10485760
HARNESS_HTTP_BODY_MAX_BYTES=1048576
HARNESS_COMMAND_OUTPUT_MAX_BYTES=1048576
```
