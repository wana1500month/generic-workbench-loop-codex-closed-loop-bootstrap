# Validation Status

Generated at: 2026-04-29T18:35:58+09:00

Validation scope: current working tree after natural-language intake parsing, workflow-check alignment, completed adapter runtime strategy, and ready output changes, before commit.

Git SHA at validation start: `a14687f`

Runtime:

- Host Node: `v22.12.0`
- Validation Node: `v22.16.0` via `npx -p node@22.16.0 -p npm@10.9.2`
- Validation npm: `10.9.2`
- Note: host Node `v22.12.0` crashed while loading the local TypeScript CLI on this machine, so build and validation commands were executed through the pinned `node@22.16.0` runtime.

Release artifact:

- Path: `.tmp/release/generic-codex-workbench.zip`
- Size: `1353940` bytes
- SHA-256: `54618FE4B815289D167A43662A1343BF701F2062D89A2DBDB704FD7BCE2EA597`

Release ZIP contents checked:

- `packages/loop-orchestrator/dist/cli.js`: present
- `packages/loop-orchestrator/dist/intent-gate-cli.js`: present
- `packages/loop-orchestrator/dist/front-door-session-cli.js`: present
- `packages/loop-orchestrator/dist/bootstrap/generated-adapter.js`: present
- `VALIDATION_STATUS.md`: external proof file, intentionally not embedded in the ZIP because the archive checksum is computed after packaging
- `node_modules/`: absent
- `.tmp/`: absent

Passed commands:

- `npm run build`
- `npm run validate:intake-gate`
- `npm run validate:front-door-session`
- `npm run validate:session-preparation-artifacts`
- `npm run validate:prepared-product-start-bundle`
- `npm run validate:prepared-session-consumption-boundary`
- `npm run validate:loop-prepare`
- `npm run release:zip`

Release proof:

- `release:zip` rebuilt the workspace, packaged `.tmp/release/generic-codex-workbench.zip`, validated the installable ZIP, and validated product discovery -> prepare -> prepared `loop:start:codex` consumption without `node_modules`.
- `release:zip` ran `validate:release-zip` and `validate:release-product-start` against `.tmp/release/generic-codex-workbench.zip`.
- Generated adapters now persist an adapter review task, adapter-plan-aware evidence, workflow-level check findings, and an `adapter_contract_fulfillment` subjective metric.
- Operator surfaces expose adapter plan, adapter contract, evaluator profile, and adapter review task paths before `ready_to_start`.
- Front-door discovery includes an adapter-design checkpoint before `ready_for_prepare`; release validation covers the additional adapter answer turn and verifies workflow selectors in the attached generator prompt.
- Natural Korean product answers can fill target users, core workflows, and finish line from one paragraph.
- Workflow checks are aligned back to core workflow names before prepare, so aliases such as "monthly stats" vs. "view monthly stats" do not block integrity validation.
- Adapter plan previews and generated markdown include completed run command and ready URL defaults.
