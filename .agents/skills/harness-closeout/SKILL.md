---
name: harness-closeout
description: Close a harness run conservatively from persisted evidence. Use when a run appears done and you need to decide between target reached, contract completed, revise, or hold.
---

# Harness Closeout

Use this skill near the end of a run or when someone asks whether the harness
can honestly stop.

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
