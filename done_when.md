# Done When

## Product Stop Condition

- The generic front door routes `product_build`, `harness_design`, `run_resume`, and `evaluator_tuning` reliably, durable memory stays identity-coherent, and control-plane validations pass without bundling a product surface.

## Core Workflows

- Make the generic front-door file protocol easy to understand.
- Make the closed-loop harness engine and external adapter boundary explicit and reusable.
- Keep continuation centered on `patch-request.json`.
- Preserve enough run context that Codex can resume from files alone.

## Quality Bar

- The workbench should read clearly from its artifacts alone.
- The controller should be able to continue across multiple rounds before stopping.
- The stop reason should be explicit whether an adapter is attached or not.
- The repo structure should not distract from the workbench or its harness engine.

## Must Not Break

- The generic front door must stay lane-oriented: `product_build` remains one lane, not the repository identity.

## Runtime Bounds

- If no adapter is attached, do not overclaim end-to-end product proof.
