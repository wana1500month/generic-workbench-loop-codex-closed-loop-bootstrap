# Generic Closed-Loop Harness Core

## Idea

Keep this repository focused on the harness itself. It should accept a short idea, negotiate round contracts, continue across multiple rounds, and optionally cross an external adapter boundary for real target proof.

## Goals

- Make the file protocol easy to understand.
- Make the external adapter boundary explicit and reusable.
- Keep continuation centered on `patch-request.json`.
- Preserve enough run context that Codex can resume from files alone.

## Constraints

- Do not bundle a sample app into this repo.
- Do not hardcode a product domain.
- Do not claim end-to-end proof without an adapter.
- Do not collapse the core and adapter responsibilities together.

## Quality Bar

- The harness should read clearly from its artifacts alone.
- The controller should be able to continue across multiple rounds before stopping.
- The stop reason should be explicit whether an adapter is attached or not.
- The repo structure should not distract from the harness core.
