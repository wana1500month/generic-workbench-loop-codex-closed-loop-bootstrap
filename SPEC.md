# Harness Spec

## Vision

Build a generic closed-loop harness that can take a short idea, turn it into a concrete build strategy, and continue work through file-based contracts, QA verdicts, and patch requests.

## Execution modes

- Mainline executor: `harness`
- Experimental executor: `subagents-experimental`

The mainline remains harness-controlled and Codex-assisted. The experimental executor may reuse custom agent manifests and prompt wrapping, but it does not yet claim native Codex subagent spawning as a stable default.

## Codex auth model

- The official auth model is ChatGPT-managed Codex login (`auth_mode: "chatgpt"`).
- Repo-local `.codex/config.toml` only owns model/profile defaults; it does not enforce auth.
- Auth enforcement belongs to user or runner Codex state under `CODEX_HOME`, plus user-managed or runner-managed Codex config.
- Trusted automation should prefer one persistent self-hosted runner, one persistent `CODEX_HOME`, and serialized access to a single `auth.json` copy.

## Primary jobs

1. Read a short idea from `IDEA.md`.
2. Convert that idea into a run-local scenario and long-build strategy.
3. Negotiate the initial build attempt, then let the evaluator reopen bounded remediation attempts through `patch-request.json` when QA says the release gate is still open.
4. Write attempt artifacts that a generator, evaluator, controller, adapter, and Codex can all continue from.
5. Keep the repository free of bundled product adapters.

## MVP scope

- Idea intake
- Planner output
- Initial build contract negotiation
- V2 round contract files
- Eval report and patch request files
- External adapter capability runtime
- Controller summary and Codex handoff
- Harness rubric and run storage

## Non-goals

- Bundled sample apps
- Domain-specific fixtures
- Product-specific browser validation
- Pretending the harness has real proof without an attached adapter

## Core artifacts

- `planned-scenario.json`
- `plan.json`
- `planner-brief.md`
- `round-contract.json`
- `contract-review.json`
- `contract-agreement.json`
- `generator-plan.json`
- `evaluator-verdict.json`
- `patch-request.json`
- `round-result.json`
- `eval_report.json`
- `controller-summary.md`
- `codex-handoff.md`

## Quality bar

- The protocol should be understandable from files alone.
- Continuation should prefer explicit artifacts over hidden state.
- Adapter-free mode should be honest about what it can and cannot prove.
- Adapter-aware mode should treat external evidence as first-class input.

## Done when

- A run can start from `IDEA.md` and end with complete round artifacts.
- Another agent can continue from the run files without chat history.
- The core can execute an initial build attempt plus evaluator-driven remediation and consume prior `patch-request.json` files.
- The repo remains harness-only.
