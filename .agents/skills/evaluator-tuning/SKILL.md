---
name: evaluator-tuning
description: Tune evaluator lanes, goldens, thresholds, and trigger conditions without confusing the request with a product build.
---

# Evaluator Tuning

Use this skill when the lane is `evaluator_tuning`.

## Workflow

1. Summarize the calibration request.

```bash
node .agents/skills/evaluator-tuning/scripts/prepare-evaluator-tuning.mjs "<request>"
```

2. Work on evaluator lanes, goldens, thresholds, or trigger conditions only.

## Hard rules

- Keep evaluator tuning separate from product intake.
- Prefer calibrated examples and clear trigger conditions over global always-on evaluation.
