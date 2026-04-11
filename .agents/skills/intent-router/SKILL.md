---
name: intent-router
description: Route a generic Codex workbench request into product-intake, harness-design, run-control, run-resume, or evaluator-tuning before planning or implementation.
---

# Intent Router

Use this skill at the front door of the repository when the next step is not
yet known.

## Workflow

1. Run the router helper.

```bash
node .agents/skills/intent-router/scripts/route-intent.mjs "<user request>"
```

2. Follow the returned lane exactly.
- `product_build` -> switch to `product-intake`
- `harness_design` -> switch to `harness-design`
- `run_control` -> switch to `loop-control`
- `run_resume` -> switch to `run-resume`
- `evaluator_tuning` -> switch to `evaluator-tuning`

## Hard rules

- Treat this as the generic front door for the workbench.
- Do not start product intake unless the router returns `product_build`.
- Do not send loop start/status/stop/resume requests into generic harness design when the router returns `run_control`.
