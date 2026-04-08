---
name: harness-intake
description: Route generic closed-loop harness requests into the correct operator lane before work starts. Use when the user is asking for product build intake, harness design, run resume, or evaluator tuning inside this repository.
---

# Harness Intake

Use this skill in the harness repository when the next step is ambiguous and you
need to classify the request before planning or implementation.

## Workflow

1. Run the generic intent gate first.

```bash
npm run loop:intent -- --json "<user request>"
```

Or use the local helper when operating inside Codex:

```bash
node .agents/skills/harness-intake/scripts/route-intent.mjs "<user request>"
```

2. Follow the routed lane exactly.
- If `intent = "product_build"`, run:

```bash
npm run loop:intake -- --json "<user request>"
```

- If the intake result asks product or execution questions, reply with those
  questions only.
- If `intent = "harness_design"`, keep the conversation on harness surfaces such
  as intake, contracts, memory, Codex operator UX, or evaluator orchestration.
- If `intent = "run_resume"`, gather the run reference, current stop state, and
  desired next action before touching the run.
- If `intent = "evaluator_tuning"`, gather the target lane, bad examples, and
  desired calibration outcome before changing bundles or thresholds.

3. Do not force product-build intake onto non-product requests.

## Hard rules

- `loop:intake` remains the authoritative staged gate for product-build prompts.
- Do not jump from an intent result into implementation if the routed lane still
  has missing required questions.
- Keep target-family guesses internal until product intake is complete.
