---
name: harness-run-attempt
description: Compatibility alias for `run-attempt`. Execute a scoped harness attempt from negotiated artifacts when older automation still references `harness-run-attempt`.
---

# Harness Run Attempt (Compatibility Alias)

Use this skill only when older automation or notes still reference
`harness-run-attempt`. Otherwise prefer `run-attempt` as the operator-facing
entry.

## Workflow

1. Read the active round surfaces before making changes.
- `round-contract.json`
- `generator-plan.json`
- `patch-request.json`
- `quality-critique.json`
- `trajectory-decision.json`

2. Determine whether the attempt is patch-only or recontract.
- Patch-only is the default when the existing contract frame still holds.
- Recontract only when the persisted controller policy or missing authority
  forces it.

3. Keep the mutation scope narrow.
- Work from the carried patch ids and failed checks.
- Do not widen the task just because adjacent cleanup is tempting.
- Preserve the harness-only boundary; do not smuggle in demo surfaces or sample
  products.

4. Verify the attempted change with the narrowest honest proof available.
- Run deterministic checks first.
- Escalate to live proof only when the lane or release gate requires it.

5. Leave the next handoff file-grounded.
- Tie conclusions to artifacts, checks, and evidence paths.
- If proof is weak, prefer revise or hold over optimistic closure.

## Hard rules

- `patch-request.json` stays central to continuation.
- Do not claim `target_reached` without the configured proof.
- Do not discard or rewrite active run artifacts casually.
