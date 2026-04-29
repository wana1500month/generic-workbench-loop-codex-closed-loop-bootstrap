# Validation Status

Generated at: 2026-04-30T03:58:50+09:00

Validation scope: current working tree after the clean-source bootstrap guard fix, release ZIP regeneration, snapshot-based intake fail-closed checks, expanded Korean natural-language parsing, localized ready output, and source archive export-ignore rules, before commit.

Git SHA at validation start: `cf18bdb`

Runtime:

- Host Node: `v22.12.0`
- Validation Node: `v22.16.0` via `npx -p node@22.16.0 -p npm@10.9.2`
- Validation npm: `10.9.2`
- Note: host Node `v22.12.0` crashed while loading the local TypeScript CLI on this machine, so build and validation commands were executed through the pinned `node@22.16.0` runtime.

Release artifact:

- Path: `.tmp/release/generic-codex-workbench.zip`
- Size: `1359269` bytes
- SHA-256: `C4779CE5DCE74AC7649CA75F435D6DDEECA34992ACD562FA587E7AE5160298B7`

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
- `npm run validate:source-bootstrap-guard` with `.tmp` absent before execution
- `npm run release:zip`

Release proof:

- `release:zip` rebuilt the workspace, packaged `.tmp/release/generic-codex-workbench.zip`, validated the installable ZIP, and validated product discovery -> prepare -> prepared `loop:start:codex` consumption without `node_modules`.
- `release:zip` ran `validate:release-zip` and `validate:release-product-start` against `.tmp/release/generic-codex-workbench.zip`.
- `validate:source-bootstrap-guard` now creates `.tmp` before `mkdtemp`, so the clean source archive path no longer fails before checking source-bootstrap policy.
- Generated adapters now persist an adapter review task, adapter-plan-aware evidence, workflow-level check findings, and an `adapter_contract_fulfillment` subjective metric.
- Operator surfaces expose adapter plan, adapter contract, evaluator profile, and adapter review task paths before `ready_to_start`.
- Front-door discovery includes an adapter-design checkpoint before `ready_for_prepare`; release validation covers the additional adapter answer turn and verifies workflow selectors in the attached generator prompt.
- Natural Korean product answers can fill target users, core workflows, and finish line from one paragraph.
- Korean labeled natural answers such as labeled user, core-workflow, and finish-line forms are normalized into snapshot fields.
- Front-door discovery rechecks the saved intake snapshot before allowing `ready_for_prepare`; missing core product fields force product questions instead of failing later in prepare.
- Korean ready output uses localized summary and next-step labels.
- Workflow checks are aligned back to core workflow names before prepare, so aliases such as "monthly stats" vs. "view monthly stats" do not block integrity validation.
- Adapter plan previews and generated markdown include completed run command and ready URL defaults.
- `.gitattributes` marks `.tmp/`, `node_modules/`, `evals/runs/`, and bundled dist as `export-ignore` for source archives generated through `git archive`.
