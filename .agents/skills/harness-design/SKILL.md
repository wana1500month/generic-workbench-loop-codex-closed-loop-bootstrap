---
name: harness-design
description: Work on generic front-door routing, skills, memory, planner/evaluator wiring, and other Codex operator surfaces in this repository.
---

# Harness Design

Use this skill when the lane is `harness_design`.

## Workflow

1. Summarize the request against the canonical workbench surfaces.

```bash
node .agents/skills/harness-design/scripts/prepare-harness-design.mjs "<request>"
```

2. Work only on workbench surfaces such as routing, skills, memory, planner/evaluator wiring, or resume policy.

## Hard rules

- Keep the repository harness-only.
- Do not route harness-design work through product intake.
