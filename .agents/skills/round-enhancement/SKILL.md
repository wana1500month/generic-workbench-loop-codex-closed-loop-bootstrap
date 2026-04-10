---
name: round-enhancement
description: Refine deterministic round artifacts on the same attached App Server thread without spawning nested exec sessions.
---

# Round Enhancement

Use this skill for attached App Server turns that refine planner or generator-plan artifacts in-place through structured JSON responses.

## Rules

- Stay harness-only.
- Do not edit files.
- Do not run commands.
- Do not spawn nested Codex sessions.
- Return JSON only when the prompt asks for JSON.
- Keep changes conservative and low-drift.
- Prefer adding clarity over widening scope.

## Focus

- Planner refinement for scenario and plan wording
- Generator-plan refinement for the current round
- Same-thread attached enhancement turns only
