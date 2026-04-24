---
name: app-builder-loop
description: Use when the user asks to build an app, product, dashboard, tool, service, or agent and the correct UX is a question-gated foreground loop that stays in the same Codex thread from discovery through review.
---

# App Builder Loop

Use this skill when the lane is still product build, but the operator wants the
work to stay on one Codex foreground thread instead of fragmenting into separate
intake and execution sessions.

## Workflow

1. Start in discovery mode.
2. Ask only the missing high-impact questions.
3. Ask at most 1 to 3 short questions per turn.
4. Prefer reasonable defaults over low-value questions.
5. When discovery is sufficient, switch to prepare mode.
6. Before heavy implementation, create or update:
   - Prefer `npm run loop:prepare -- --front-door-session <path> --json` after `loop:discover` reaches `ready_for_prepare`; same-thread skill flows may call the same prepare writer internally.
   - `runtime/build-brief.json`
   - `runtime/run-contract.json`
   - `runtime/operator-surface.json`
   - `runtime/open-questions.json`
   - `runtime/session-status.json`
   - `runtime/session-status-events.jsonl`
   - `runtime/session-stream.json`
   - `docs/EXECUTION_PLAN.md`
7. After prepare mode, stop at `ready_to_start` on the same thread.
8. Start running only when the operator explicitly says `루프 시작` or `start loop`.
9. After start, continue in running mode on the same thread.
10. Use review boundaries and steering turns instead of resetting the session.

## Hard rules

- Follow `INTAKE_PROTOCOL.md` before acting like implementation is ready.
- Keep the first phase product-first. Do not jump straight into layout, stack,
  adapter, or validation plans until the product is concrete enough.
- Do not ask the user to pick a target family unless they explicitly want to
  override the inferred family.
- Do not treat automation as the front door for this flow. The front door is a
  foreground Codex thread.
- Treat `runtime/build-brief.json` as the normalized product brief for the
  session.
- Treat `runtime/run-contract.json` as the session-level execution contract.
- Do not replace `round-###/round-contract.json`; attempt-level round contracts
  still derive from the session contract and current controller state.
- Prefer `worktree` for large new app builds or risky exploratory changes.
- Treat evaluator-style passes as risk-triggered, not always-on.

## Discovery stop condition

End discovery as soon as the following are concrete enough:

- target user
- core workflow
- primary surface
- delivery level
- critical integrations or data constraints
- enough execution control to prepare the run

If the remaining uncertainty is non-blocking, move it into
`runtime/open-questions.json` instead of stalling the session, and keep
`runtime/session-status.json` aligned with the active session readiness.

## Operator vocabulary

Keep the operator-visible session state translated into exactly one of:

- `asking`
- `preparing`
- `ready_to_start`
- `running`
- `needs_steering`
- `blocked_externally`
- `ready_for_review`
- `done`

## Review behavior

When a meaningful diff is ready:

- mark the session as `ready_for_review`
- summarize what changed
- point the user at the highest-signal files or flows
- use the review pane as the preferred feedback surface

When feedback arrives:

- treat it as steering
- update the session surfaces if scope or priorities changed
- continue patch-oriented work on the same thread
