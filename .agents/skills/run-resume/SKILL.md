---
name: run-resume
description: Inspect persisted run state and decide whether a run should reopen, continue, hold, or close from file-backed artifacts.
---

# Run Resume

Use this skill when the lane is `run_resume`.

## Workflow

1. Read the run state first.

```bash
node .agents/skills/run-resume/scripts/read-resume-state.mjs evals/runs/run-###
```

2. Decide whether the next step is reopen, continue, hold, or closeout.

## Hard rules

- Prefer persisted artifacts over chat summaries.
- Do not reopen a terminal run casually.
