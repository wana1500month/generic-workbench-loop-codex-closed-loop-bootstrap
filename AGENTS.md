# Repository Rules

This repository exists to build a generic closed-loop harness core.

## Scope

- The repo should contain harness logic only.
- Do not bundle a sample product surface, domain fixtures, or reference app here.
- If real build or QA proof is needed, attach an adapter outside this repository.

## Working model

- Treat `packages/loop-orchestrator` as the core runtime.
- Treat `evals/rubrics` as harness scoring policy.
- Treat `evals/runs` as persisted run artifacts and controller history.
- Keep long-running state in files, not chat history.

## Intake-first UX

- If a user asks this repo to build or design an app, service, editor, dashboard, API, agent, or product feature, the first response must follow the intake protocol in `INTAKE_PROTOCOL.md`.
- Do not jump straight to adapter analysis, family classification, MVP breakdown, UX proposals, wireframes, architecture advice, or stack recommendations before the intake is complete.
- Treat missing intake fields as a hard block. This should fail closed: ask questions instead of guessing.
- The first response for a product-build request should contain clarifying questions only.
- Keep the early questions product-first:
  - what is being built
  - who it is for
  - the core workflows
  - reference products or visual direction
  - what "good enough" means
- After the product is clear, gather execution controls only:
  - project mode
  - target root
  - target score
  - max rounds
  - if needed for an existing target: run/check commands and ready/app/health/api URLs
- Keep target family as an internal working hypothesis until confirmation. Do not ask the user to pick a family unless they explicitly want to override it.
- When the request obviously maps to a supported family such as `browser-editor`, `crud-api`, or `chat-agent`, keep that as an internal working hypothesis until the intake is complete. Do not lead with "this is a browser-editor family" as the primary response.
- The desired UX is: product questions only -> execution questions only -> short confirmation -> internal bootstrap -> planner/generator/evaluator loop.
- The executable front-controller for this behavior is `npm run loop:intake -- "<user request>"`. Use it when the request is a product-build prompt and follow its result. If it returns `ask_product_questions` or `ask_execution_questions`, ask those questions only.
- Bad first-turn behavior for this repo:
  - classifying the family immediately
  - proposing a panel layout immediately
  - listing MVP features immediately
  - recommending adapter work immediately
- Good first-turn behavior for this repo:
  - ask the minimum product questions needed to remove ambiguity
  - summarize only after the user answers
  - move to bootstrap only after the intake is sufficiently filled

## Priorities

- File-based handoff must remain clear and resumable.
- Generator/evaluator contract negotiation must happen before a round is executed.
- Every executed round should write a scoped `round-contract.json` before mutation starts.
- `patch-request.json` should stay central to continuation logic.
- Planning and QA language should stay generic and adapter-aware.
- Repository structure should optimize for understanding the harness, not for demo completeness.
- Dimension floors in the rubric should fail closed when proof integrity or release-gate QA drops below the configured bar.

## Evaluation expectations

- Prefer explicit protocol artifacts over implicit state.
- Do not claim end-to-end proof when no adapter is attached.
- Use scaffold rounds to test control-plane coherence, not fake product quality.

## Document hygiene

- Update `STATUS.md` when the harness phase changes.
- Update `PLANS.md` when milestones or acceptance criteria change.
- Update `RUNBOOK.md` when commands or runtime behavior change.
- Keep `SPEC.md` stable unless harness scope changes.
