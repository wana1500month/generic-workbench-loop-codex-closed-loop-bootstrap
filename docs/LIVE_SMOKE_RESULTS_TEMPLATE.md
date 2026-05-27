# Live Smoke Results Template

Use this template for real Codex app or Codex CLI smoke runs. Deterministic
validation proves repository behavior with fake or local fixtures; live smoke
proves that the installed operator surface, auth, transport, and real Codex
execution path still work in the current environment.

## Run Metadata

- Date:
- Operator:
- Repository commit:
- Install ZIP:
- OS / shell:
- Node version:
- npm version:
- Codex CLI version:
- Codex app version:
- Network/auth context:

## Commands

Run only the live checks that match the environment. Record skipped checks with
a concrete reason.

```bash
npm run validate:release
npm run validate:codex-binary-preflight
npm run validate:codex-auth-preflight:fake
npm run validate:transport:cli
npm run validate:transport:app-server
npm run release:preflight-live
```

## Results

| Check | Result | Duration | Artifact / log path | Notes |
| --- | --- | ---: | --- | --- |
| validate:release |  |  |  |  |
| validate:codex-binary-preflight |  |  |  |  |
| validate:codex-auth-preflight:fake |  |  |  |  |
| validate:transport:cli |  |  |  |  |
| validate:transport:app-server |  |  |  |  |
| release:preflight-live |  |  |  |  |

## Foreground Loop Smoke

- Request used:
- Expected lane:
- Front-door session path:
- Prepared run id:
- Loop start command:
- Final stop reason:
- Scorecard path:
- Operator surface path:
- Session status path:

## Process Cleanup

- Target-server processes before:
- Target-server processes after:
- Codex/app-server helper processes after:
- Cleanup command used, if any:

## Release ZIP Install Smoke

- ZIP path:
- Extraction target:
- First command after extraction:
- Result:
- Notes:

## Follow-ups

- Blocking failures:
- Non-blocking risks:
- Repro command:
- Owner / next action:
