---
name: run-attempt
description: Summarize the latest round surfaces and execute a narrow run attempt once the lane and run are already known.
---

# Run Attempt

Use this skill when work should happen inside the current round boundary.

## Workflow

1. Read the latest round surfaces.

```bash
node .agents/skills/run-attempt/scripts/summarize-run-attempt.mjs evals/runs/run-###
```

2. Keep the mutation scope bound to the active round contract and patch request.

## Hard rules

- Do not widen the task because adjacent cleanup exists.
- Patch-only remains the default unless persisted policy says otherwise.
