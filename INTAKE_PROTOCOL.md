# Intake Protocol

Use this protocol whenever the user is asking this repository to build or design
an app, service, editor, dashboard, API, agent, or product feature.

Generic request routing now lives in:

- `npm run loop:intent -- "<user request>"`

The operator-facing lane for product-build requests is the same-thread `app-builder-loop` skill. The stateless parser/helper inside that lane is:

- `npm run loop:intake -- "<user request>"`

The stateful product-build discovery front door is:

- `npm run loop:discover -- --thread-id <thread-id> --message "<turn>" --json`

Only enter this protocol after the request has been classified as
`product_build`, or when the request is obviously a product-build prompt.

Use `loop:discover` for the real same-thread UX. If it returns
`ask_product_questions` or `ask_execution_questions`, the next assistant reply
should contain those questions only. If it returns `ready_for_prepare`, run
`loop:prepare -- --front-door-session <path> --json`, then stop at
`ready_to_start`.

## Goal

Route product-build requests into a fail-closed intake flow instead of letting
the model jump directly into design or implementation advice.

## Hard rules

1. The first response must contain clarifying questions only.
2. Do not classify the target family in the first response.
3. Do not propose IA, screen layouts, MVP scope, architecture, stack, adapter
   design, or validation strategy in the first response.
4. Product ambiguity is a hard block. Keep asking product questions until the
   product is concrete enough.
5. Once the product is clear, ask execution-control questions only.
6. Keep target family inference internal through prepare unless the user
   explicitly asks to choose or override it.
7. Only after the intake is sufficiently filled may the agent:
   - write a short preparation summary if useful
   - enter prepare mode on the same thread
   - write the session preparation artifacts, preferably through `npm run loop:prepare -- --front-door-session <path> --json` on shell/operator surfaces
   - stop at `ready_to_start`
   - wait for an explicit `루프 시작` or `start loop` before running

## Minimum intake fields

The agent should gather enough information to cover these product areas before moving on:

- product name or working title
- one concrete summary of what is being built
- target users
- core workflows
- reference products or visual direction, if any
- finish line or "good enough" definition

Once the product is clear, gather the execution-control fields:

- project mode (`new` or `existing`)
- target root
- target score
- max rounds
- if needed for an existing target: run command, check command, ready URL, and app/health/api URLs

Target family should stay internal and be inferred during prepare mode unless the
user explicitly wants to override it.

## Supported working hypotheses

These can be used internally while asking questions, but should not be presented
as the first answer:

- `browser-app`
- `api-service`
- `fullstack-app`
- `dashboard`
- `browser-editor`
- `crud-api`
- `chat-agent`

## First-turn template

Use a concise question set like this:

1. What exactly are we building, in one sentence?
2. Who will use it?
3. What are the main workflows they must complete?
4. Are there reference products or a visual direction?
5. For the first version, what counts as good enough?

After the product fields are clear, switch to execution questions only. The
normal second phase is:

1. Is this a new project or an existing project?
2. Where is the working folder?
3. What target score should we aim for?
4. What should max rounds be?
5. If this is an existing project, what run/check commands and URLs should the harness use?

## Explicitly wrong behavior

These are considered wrong for this repository before intake is complete:

- "This should be a browser-editor family."
- "Pick browser-editor or fullstack-app before we clarify the product."
- "Use a 3-panel layout."
- "The MVP is login, sync, drag and drop, export."
- "The biggest risk is auth."
- "You need a placeholder adapter."

Those may be good later, but not before the intake is complete.
