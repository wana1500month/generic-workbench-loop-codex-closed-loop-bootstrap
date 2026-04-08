---
name: harness-closeout
description: Compatibility alias for `closeout`. Close a harness run conservatively from persisted evidence when older automation still references `harness-closeout`.
---

# Harness Closeout (Compatibility Alias)

Use this skill only when older automation or notes still reference
`harness-closeout`. Otherwise prefer `closeout` as the operator-facing entry.

## Workflow

1. Read the terminal evidence first.
- `eval_report.json`
- `patch-request.json`
- `quality-critique.json`
- `trajectory-decision.json`
- `summary.json`

Use the local summarizer when you want one file-grounded snapshot first:

```bash
node .agents/skills/harness-closeout/scripts/summarize-run.mjs evals/runs/run-###
```

2. Separate structural completion from target completion.
- `contract_completed` means the negotiated contract is done.
- `target_reached` requires the configured control-plane, proof, and release
  thresholds.

3. Fail closed on weak proof.
- If the run lacks adapter-backed or live verification proof, do not overclaim.
- If release-gate evidence is contradictory or thin, keep the run open or hold
  it instead of forcing success language.

4. Record the honest next action.
- Use `complete` only when the run can really stop.
- Otherwise leave a concrete revise or hold path grounded in artifacts.

## Hard rules

- Prefer artifact-grounded closure over chat-memory summaries.
- Preserve the distinction between control-plane quality and product proof.
- Do not claim end-to-end success inside this repo when no adapter is attached.
