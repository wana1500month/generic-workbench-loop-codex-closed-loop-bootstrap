# Validation Status

Generated at: 2026-04-28T19:33:25+09:00

Validation scope: current working tree after release-finalization changes, before commit.

Git SHA at validation start: `652d59eaf29531cd7d699e693fbe571187bddab9`

Runtime:

- Host Node: `v22.12.0`
- Validation Node: `v22.16.0` via `npx -p node@22.16.0 -p npm@10.9.2`
- Validation npm: `10.9.2`
- Note: host Node `v22.12.0` crashed while loading the local TypeScript CLI on this machine, so build and validation commands were executed through the pinned `node@22.16.0` runtime.

Release artifact:

- Path: `.tmp/release/generic-codex-workbench.zip`
- Size: `1314988` bytes
- SHA-256: `939B260489D0D1F6025A62575E02F112004E826F74130F15341B23A9D7DFF143`

Passed commands:

- `npm run build`
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
