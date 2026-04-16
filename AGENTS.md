# Repository Rules

This repository exists to build a generic Codex workbench for closed-loop harness work.
The closed-loop harness is the core runtime engine, and `product_build` is only one routed lane rather than the repository identity.

## Scope

- The repo should contain harness logic only.
- Do not bundle a sample product surface, domain fixtures, or reference app here.
- If real build or QA proof is needed, attach an adapter outside this repository.

## Working model

- Treat `packages/loop-orchestrator` as the core runtime.
- Treat `evals/rubrics` as harness scoring policy.
- Treat `evals/runs` as persisted run artifacts and controller history.
- Keep long-running state in files, not chat history.
- Treat `feature_list.generated.json`, `progress.md`, `progress.jsonl`, `done_when.md`, and `init.sh` as durable task memory rather than disposable notes.

## Intake-first UX

- Use `npm run loop:intent -- "<user request>"` as the generic front door. `product_build` is only one routed lane, not the repository identity.
- `loop:intent` may route requests into `product_build`, `harness_design`, `run_control`, `run_resume`, or `evaluator_tuning`.
- If `loop:intent` routes to `product_build`, continue on the same Codex thread with `app-builder-loop`. Inside that flow, keep `npm run loop:intake -- "<user request>"` as the authoritative staged intake gate.
- Prefer lane-centric skills such as `intent-router`, `app-builder-loop`, `harness-design`, `loop-control`, `run-resume`, `evaluator-tuning`, `run-attempt`, and `closeout`. Use `product-intake` as the staged gate inside `app-builder-loop` rather than as the operator-facing front door.
- Compatibility aliases may remain for older automation, but the operator-facing surface should stay centered on that lane-centric set.
- Treat runtime-control requests such as "start the loop", "show loop status", "resume the active loop", and "stop the loop" as `run_control`, not as product intake or generic harness design.
- In the Codex app, default new loop starts to `npm run loop:start:codex` or `$loop-control`. Use `npm run loop:start:bg` only when the operator explicitly asks for detached background supervision.
- In the Codex app, `루프 시작` must not end with a user-visible checkpoint-waiting message. Start with `npm run loop:start:codex -- --json`, then keep control inside `$loop-control` through `npm run loop:continue -- --run-dir <run> --json` until the run reaches a human stop, an external block, or a terminal state.
- A Codex-owned checkpoint is never a user-visible pause. Foreground start or resume stays inside `$loop-control` until the run reaches a human stop, an external block, or a terminal state.
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
- The desired UX is: product questions only -> execution questions only -> prepare mode -> `ready_to_start` -> explicit `루프 시작` / `start loop` -> same-thread planner/generator/evaluator loop.
- The executable front-controller for generic request routing is `npm run loop:intent -- "<user request>"`. For product-build behavior, the operator-facing lane is `app-builder-loop`, and the authoritative staged gate inside it remains `npm run loop:intake -- "<user request>"`. If it returns `ask_product_questions` or `ask_execution_questions`, ask those questions only; if it returns `ready_for_confirmation`, move directly into prepare mode on the same thread, write the session artifacts, and stop at `ready_to_start` until the operator explicitly starts the loop.
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
- Keep the generic front door stable and lane-oriented before adding deeper loop complexity.
- Generator/evaluator contract negotiation must happen before a round is executed.
- Every executed round should write a scoped `round-contract.json` before mutation starts.
- `patch-request.json` should stay central to continuation logic.
- Planning and QA language should stay generic and adapter-aware.
- Repository structure should optimize for understanding the harness, not for demo completeness.
- Dimension floors in the rubric should fail closed when proof integrity or release-gate QA drops below the configured bar.

## Evaluation expectations

- Prefer explicit protocol artifacts over implicit state.
- Planner and evaluator should remain available, but evaluator lift should stay selective rather than always-on.
- Do not claim end-to-end proof when no adapter is attached.
- Use scaffold rounds to test control-plane coherence, not fake product quality.

## Document hygiene

- Update `STATUS.md` when the harness phase changes.
- Update `PLANS.md` when milestones or acceptance criteria change.
- Update `RUNBOOK.md` when commands or runtime behavior change.
- Keep `SPEC.md` stable unless harness scope changes.
