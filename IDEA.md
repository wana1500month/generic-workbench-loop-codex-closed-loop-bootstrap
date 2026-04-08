# Generic Codex Workbench

## Idea

This repository is a generic Codex workbench for closed-loop harness work. The closed-loop harness is the runtime engine; `product_build` is only one routed lane.

## Goals

- Make the generic front-door file protocol easy to understand.
- Make the closed-loop harness engine and external adapter boundary explicit and reusable.
- Keep continuation centered on `patch-request.json`.
- Preserve enough run context that Codex can resume from files alone.

## Constraints

- Do not bundle a sample app into this repo.
- Do not hardcode a product domain.
- Do not claim end-to-end proof without an adapter.
- Do not collapse the workbench engine and adapter responsibilities together.

## Quality Bar

- The workbench should read clearly from its artifacts alone.
- The controller should be able to continue across multiple rounds before stopping.
- The stop reason should be explicit whether an adapter is attached or not.
- The repo structure should not distract from the workbench or its harness engine.
