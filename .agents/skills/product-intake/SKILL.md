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

2. If the result asks product or execution questions, ask those questions only.

## Hard rules

- `loop:intake` stays authoritative for product-build prompts.
- Do not mix harness-design questions into this lane.
