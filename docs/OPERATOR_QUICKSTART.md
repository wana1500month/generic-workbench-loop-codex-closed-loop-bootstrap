# Operator Quickstart

This repository is a generic Codex workbench for closed-loop harness runs. It does not bundle a product target or reference app.

## Installable ZIP

Use the generated release artifact, not the repository source archive, for Codex app installation:

```bash
npm run release:zip
```

Install `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`. It includes `packages/loop-orchestrator/dist`, keeps `node_modules` out, includes release-owned `CODEX_APP_INSTALL.md` plus `release-manifest.json`, and lets `loop:intent`, `loop:discover`, `loop:prepare`, and `loop:start:codex` run before `npm ci`. Use `npm run validate:release` when you also need ZIP validation and release-start proof.

## First Run From A Source ZIP

If `packages/loop-orchestrator/dist` is missing or `SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL.md` is present, the folder is a source archive, not the installable Codex app artifact. Source checkouts and source archives should not contain `CODEX_APP_INSTALL.md` or `release-manifest.json`. Prefer installing `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip`. If you intentionally use a source archive and accept local npm bootstrap, run one bootstrap command before using plugin skills:

```bash
bash ./init.sh
```

On Windows shells, use the equivalent npm path:

```bash
npm ci
npm run build
```

Do not expect the first product-build turn from a source archive to be zero-touch: bootstrap may need network access for `npm ci`. The installable release ZIP is the no-`npm ci` path for Codex app use. Skill helpers and npm front-door wrappers now fail closed when `dist/` is missing unless local TypeScript is already installed, `HARNESS_ALLOW_NPX_INSTALL=1` is set for build fallback, or `HARNESS_ALLOW_SOURCE_BOOTSTRAP=1` is set for intentional `init.sh` bootstrap.

## Codex App Flow

1. Unzip the release artifact.
2. Open that folder in the Codex app.
3. Say `가계부 앱 만들어줘` or another app/product request.
4. Answer only the returned product, execution, and adapter-design questions.
5. Resolve `ask_conflict_resolution` questions before prepare if Codex reports a product-family or scope conflict, then confirm the generated adapter plan and adapter review task that prepare exposes.
6. If Codex reports `prepared_with_blockers`, open `runtime/readiness-report.md`, resolve the listed blockers, and run prepare again.
7. Review `evaluation-policy.generated.md` when strictness or custom quality criteria matter.
8. When Codex reports `ready_to_start`, say `루프 시작`.
9. During or after a run, inspect per-round scorecards with `npm run loop:scorecards -- --run-dir <evals/runs/run-id>`.

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
npm run validate:productization
npm run validate:app
npm run validate:app-release
```

The productization gate validates readiness doctor, evaluation policy, strictness, scorecard output, adaptive intake, and non-web target behavior. The app gates validate the Codex app foreground path and install ZIP without requiring a local `codex` binary. `npm run validate:release-gate` is the stricter release gate: it adds source/install identity and source-archive reproducibility before validating the install ZIP path.

For faster commit checks, run `npm run validate:fast`. For heavier deterministic coverage, run `npm test`, `npm run validate:smoke-clean`, and `npm run validate:source-archive-repro`; those are nightly or pre-broader-beta gates, not prerequisites for installing the Codex app ZIP.

Real Codex and App Server smoke checks still require a trusted host with a usable `codex` binary and authenticated `CODEX_HOME`. If `codex` is not on `PATH`, install Codex CLI or set `HARNESS_CODEX_BIN` before running the live gate:

```bash
npm run validate:transport:cli
npm run validate:transport:app-server
npm run release:preflight-live
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
