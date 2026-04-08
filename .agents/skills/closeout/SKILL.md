---
name: closeout
description: Close a run conservatively from persisted evidence once the workbench may be ready to stop.
---

# Closeout

Use this skill near the end of a run or when deciding whether the workbench can honestly stop.

## Workflow

1. Summarize the run from artifacts.

```bash
node .agents/skills/closeout/scripts/summarize-closeout.mjs evals/runs/run-###
```

2. Separate structural completion from target completion before stopping.

## Hard rules

- Fail closed on weak proof.
- Do not claim end-to-end success inside this repo without adapter-backed evidence.
