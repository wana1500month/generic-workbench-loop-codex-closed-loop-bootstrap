---
name: loop-control
description: Start, inspect, resume, or stop harness runs from the correct Codex app surface.
---

# Loop Control

Use this skill when the lane is `run_control`.

## Workflow

1. Classify the control action first: `start`, `status`, `resume`, or `stop`.
2. Prefer the Codex app foreground surface by default.
3. Use the matching command surface:

```bash
npm run loop:start:codex
npm run loop:start:bg -- --max-rounds 3
npm run loop:start:manual
npm run loop:status -- --run-dir evals/runs/run-###
npm run loop:resume -- --run-dir evals/runs/run-###
npm run loop:stop -- --run-dir evals/runs/run-###
```

## Hard rules

- In the Codex app, default `start` to `npm run loop:start:codex`.
- Only use `loop:start:bg` when the operator explicitly asks for detached or background supervision.
- Treat `loop:start:manual` as an intentional shell-owned downgrade, not the default attached start path.
- Do not claim continuous monitoring unless a real background supervisor or automation owns that task.
- If the request is about deciding whether an existing persisted run should reopen, hold, continue, or close, switch to `run-resume`.
