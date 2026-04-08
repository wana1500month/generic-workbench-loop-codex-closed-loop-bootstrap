# Done When

## Product Stop Condition

- The first-version stop condition has not been written yet.

## Core Workflows

- Make the file protocol easy to understand.
- Make the external adapter boundary explicit and reusable.
- Keep continuation centered on `patch-request.json`.
- Preserve enough run context that Codex can resume from files alone.

## Quality Bar

- The harness should read clearly from its artifacts alone.
- The controller should be able to continue across multiple rounds before stopping.
- The stop reason should be explicit whether an adapter is attached or not.
- The repo structure should not distract from the harness core.

## Must Not Break

- none recorded

## Runtime Bounds

- If no adapter is attached, do not overclaim end-to-end product proof.
