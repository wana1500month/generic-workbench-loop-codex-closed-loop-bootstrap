---
name: product-intake
description: Run product intake only after the generic front door has classified the request as product_build.
---

# Product Intake

This skill is the staged intake gate used inside `$app-builder-loop`, and should only be used directly when the operator explicitly wants the intake questions in isolation.

Use this skill only when the router has already returned `product_build`.

## Workflow

1. Run the intake helper.

```bash
node .agents/skills/product-intake/scripts/run-product-intake.mjs "<product request>"
```

2. If the result asks product, execution, or adapter-design questions, ask those questions only.
3. Treat `workflow_checks` and `verification_surfaces` as first-class intake data; do not hide adapter design in generic notes.

## Hard rules

- `loop:intake` stays authoritative for product-build prompts.
- Do not mix harness-design questions into this lane.
- Do not start prepare until the stateful app-builder flow has enough product, execution, and adapter-design intake to generate an adapter plan.
