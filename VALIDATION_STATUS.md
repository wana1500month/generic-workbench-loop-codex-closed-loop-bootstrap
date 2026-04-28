# Validation Status

Generated at: 2026-04-29T04:49:55+09:00

Validation scope: current working tree after adapter-design intake and generated adapter plan changes, before commit.

Git SHA at validation start: `cccb53ec5c57a0c4bbb39959ef75d846a09b6c50`

Runtime:

- Host Node: `v22.12.0`
- Validation Node: `v22.16.0` via `npx -p node@22.16.0 -p npm@10.9.2`
- Validation npm: `10.9.2`
- Note: host Node `v22.12.0` crashed while loading the local TypeScript CLI on this machine, so build and validation commands were executed through the pinned `node@22.16.0` runtime.

Release artifact:

- Path: `.tmp/release/generic-codex-workbench.zip`
- Size: `1337143` bytes
- SHA-256: `5287D9DCCFC58A4FA04A77DFA0A9D7331852FB7D32D617E3A1B7F78847643FAD`

Release ZIP contents checked:

- `packages/loop-orchestrator/dist/cli.js`: present
- `packages/loop-orchestrator/dist/intent-gate-cli.js`: present
- `packages/loop-orchestrator/dist/front-door-session-cli.js`: present
- `VALIDATION_STATUS.md`: external proof file, intentionally not embedded in the ZIP because the archive checksum is computed after packaging
- `node_modules/`: absent
- `.tmp/`: absent

Passed commands:

- `npm run build`
- `npm run validate:source-bootstrap-guard`
- `npm run validate:front-door-session`
- `npm run validate:session-preparation-artifacts`
- `npm run validate:prepared-product-start-bundle`
- `npm run validate:prepared-session-consumption-boundary`
- `npm run validate:release-zip`
- `npm run validate:release-product-start`
- `npm run release:zip`

Release proof:

- `release:zip` rebuilt the workspace, packaged `.tmp/release/generic-codex-workbench.zip`, validated the installable ZIP, and validated product discovery -> prepare -> prepared `loop:start:codex` consumption without `node_modules`.
- `validate:release-product-start` also passed as a standalone command using the default `.tmp/release/generic-codex-workbench.zip` path.
- `validate:source-bootstrap-guard` proved dist-missing source archives fail closed instead of invoking local npm bootstrap unless explicitly allowed.
- Front-door discovery now includes an adapter-design checkpoint before `ready_for_prepare`; release validation covers the additional adapter answer turn and verifies workflow selectors in the attached generator prompt.
