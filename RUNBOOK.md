# Runbook

## Purpose

This repository is a generic Codex workbench for closed-loop harness work. The closed-loop harness is the runtime engine, and `product_build` is only one routed lane. It owns front-door routing, idea intake, planning, initial build negotiation, patch-request-driven remediation, controller summaries, adapter capability boundaries, and Codex handoff. It does not ship a bundled product surface.

## Primary inputs

- `IDEA.md`: the current harness goal or refactor request
- `npm run loop:intent -- "<user request>"`: generic front door that separates product build, harness design, run control, run resume, and evaluator tuning before work starts
- `npm run loop:intake -- "<user request>"`: stateless staged parser/helper that returns product questions, execution questions, or a `ready_for_prepare` parse result for a single request
- `npm run loop:discover -- --message "<answer>" --json`: stateful file-backed product discovery front door that accumulates intake answers per thread under `evals/front-door-sessions/`, remembers the last question ids for terse answer merging, restores the latest snapshot without depending on chat history, and becomes immutable after prepare. Pass `--thread-id` only when a stable thread id is available; otherwise the CLI falls back to `CODEX_THREAD_ID`, `HARNESS_FRONT_DOOR_THREAD_ID`, then `local-codex-thread`.
- `npm run loop:prepare -- --front-door-session <evals/front-door-sessions/session-thread-id.json> --json`: consumes a persisted discovery session only after it reaches `ready_for_prepare`, materializes `intake.json` into both the prepare root and target root, writes the session-owned `build-brief`, `run-contract`, `operator-surface`, `session-status`, `session-stream`, and execution-plan artifacts, then leaves the run at the explicit `ready_to_start` gate. For product-family sessions it now also persists the generated adapter plan, adapter review task, and prepared adapter/rubric/evaluator bundle identity into the prepare surfaces, and when no explicit rubric is supplied it refreshes the generated bundle before the run reaches `ready_to_start`.
- same-thread session refresh now preserves that `validation_bundle` inside `runtime/run-contract.json`, so `summary.json` recovery and `--resume-run` still restore the prepared product lane instead of silently downgrading to `generic-core`
- restored product bundles now act as resume defaults only. Explicit bundle overrides such as `--target-family`, `--adapter`, `--rubric`, or `--evaluator-profile` still flow into the standard resume identity mismatch and `--allow-resume-migration` path instead of being blocked by the prepared-session guard
- once a prepared same-thread session starts, its persisted session status now moves to `running`, started runs with `summary.json` are excluded from `ready_to_start` discovery, and unbound current-thread starts cannot consume thread-bound prepared sessions from another Codex thread
- `npm run loop:bootstrap`: writes `IDEA.md`, `intake.json`, `feature_list.generated.json`, `progress.md`, `progress.jsonl`, `done_when.md`, `init.sh`, `adapter.generated.json`, `rubric.generated.json`, and `verification-profile.generated.json`, then uses the generated rubric/bundle on the first run unless the CLI explicitly overrides them. Bootstrap now also captures deeper quality intent such as must-not-break flows, failure expectations, continuity boundaries, reference signals, non-goals, probe hints, and optional user-authored subjective metrics with minimum `x/10` thresholds.
- `npm run reference-adapter:scaffold-quality-lane -- --profile <bundle.json> --out <strict-bundle.json>`: derives a stricter companion evaluator lane from an existing bundle without demanding release assertions that the source bundle does not actually configure
- `SPEC.md`: stable harness scope
- `PLANS.md`: current milestone map
- `STATUS.md`: current state of the harness
- `AGENT_PROTOCOL.md`: authoritative round file protocol
- `docs/CODEX_SESSION_SUPERVISED_CLOSED_LOOP.md`: session-level foreground-thread design for question-gated product-build work
- `ADAPTER_CONTRACT.md`: external adapter capability contract
- `feature_list.generated.json`: append-safe long-horizon feature ledger for what is still planned, done, or blocked
- `progress.md`: operator-facing summary of the latest decisions, blockers, and next actions
- `progress.jsonl`: append-friendly task journal for restart-safe event history
- `done_when.md`: human-readable stop condition that should stay aligned with the real closeout bar
- `init.sh`: fast session bootstrap for workbench setup, `evals/runs` storage creation, and canonical front-door commands
- `docs/OPERATOR_QUICKSTART.md`: short Codex app operator entrypoint for clean ZIP setup, lane-centric skills, validation, and security defaults
- `.agents/skills/*/SKILL.md`: repo-local Codex app operator surfaces, with lane-centric entry skills such as `intent-router`, `app-builder-loop`, `harness-design`, `run-resume`, `evaluator-tuning`, `run-attempt`, and `closeout`; `product-intake` remains the staged intake gate inside `app-builder-loop`; compatibility aliases such as `harness-intake`, `harness-run-attempt`, and `harness-closeout` remain only for older automation
- `.agents/skills/*/scripts/*.mjs`: plugin-facing guidance treats missing `packages/loop-orchestrator/dist` as a source archive signal first. Prefer installing `.tmp/release/generic-codex-workbench.zip`; helpers fail closed by default in this state and only build with an existing local TypeScript install, `HARNESS_ALLOW_NPX_INSTALL=1`, or intentional `HARNESS_ALLOW_SOURCE_BOOTSTRAP=1` for `bash ./init.sh`.
- `npm run release:zip`: builds the workspace, packages `.tmp/release/generic-codex-workbench.zip`, validates that the installable ZIP includes `packages/loop-orchestrator/dist` while excluding `node_modules`, `.tmp`, and persisted run artifacts, then proves release-root product discovery -> prepare -> `loop:start:codex` can consume the prepared run without `npm ci`
- `.agents/skills/app-builder-loop/SKILL.md`: session-supervised product-build skill for discovery -> prepare -> `ready_to_start` -> running on one Codex foreground thread
- `.agents/skills/*/agents/openai.yaml`: UI-facing Codex app metadata for the key lane-centric skills
- `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`: repo-root local plugin metadata for Codex app discovery
- `evals/rubrics/generic-harness-rubric.json`: stop policy and required artifact list
- `evals/verification-profiles/*.json`: core-owned evaluator bundles such as `generic-core.profile.json`, `api-service.profile.json`, `crud-service.profile.json`, `chat-agent.profile.json`, `browser-app.profile.json`, `editor-app.profile.json`, `fullstack-app.profile.json`, and `dashboard.profile.json`
- The default rubric still points at `fullstack-app.profile.json` for adapter-backed fallback, but adapter-free runs now auto-resolve to the neutral `generic-core.profile.json` bundle so `loop:single` stays harness-centric instead of product-biased.

## Runtime roles

- `planner`: turns `IDEA.md` into a run-local scenario, build strategy, and remediation policy
- `intent gate`: classifies whether the next request should go through product intake, harness design, run resume, or evaluator calibration
- `intake`: keeps product questions separate from execution-control questions and ends at a prepare-ready gate before session preparation artifacts are written
- `generator`: takes a long build attempt against the negotiated attempt contract
- `evaluator`: reviews the contract before build, then writes the verdict, eval report, and patch request after each build attempt
- `quality critique`: turns threshold gaps, failed dimensions, and failed release-gate probes into structured quality findings while keeping patch authority carry-forward-safe
- `trajectory controller`: turns critique, patch, and failure-lineage signals into explicit continuation policy for the next attempt
- `subjective judge`: optional bootstrap-owned grading path inside generated `grade_round` that scores user-defined quality metrics from captured evidence, fails closed when review evidence is unavailable, and publishes structured metric results
- `controller`: records the attempt summary and stop reason
- `adapter`: optional external capability provider for target prep, apply, and run
- `verifier`: optional external proof provider for capture, checks, and grading under a separate trust domain
- `Codex`: reads run artifacts and continues harness work in-session
- Default operation is a single agent and one worktree per lane or run. Reach for worktrees or subagents only when the request explicitly needs parallel exploration or comparator work.
- `bootstrap generator`: now receives an inline remediation brief built from the current round contract, generator plan, latest patch request, latest quality critique, and latest eval threshold gaps so patch-only mutation is no longer prompt-stateless
- `bootstrap grader`: now preserves `quality_contract`, `quality_axis_id`, and `subjective_metrics` through runtime loading, so intake-authored quality semantics reach grading, critique, and patch-request generation intact
- Browser-backed bootstrap bundles now auto-inject default subjective metrics such as `interaction_clarity`, `visual_hierarchy`, `finish_line_coherence`, optional `reference_fit`, and `prototype_delta`, with stricter minimums derived from `target_score`.
- Browser-backed `target_reached` now also depends on subjective release quality and prototype delta: rendered screenshots or traces must exist, a baseline screenshot must persist beyond the first browser round, and release scoring can be capped when browser subjective evidence or visible product lift is missing.
- `same-thread transport`: keeps the active operator surface on the same thread or turn, forbids nested `codex exec` calls from shared runtime paths, routes bootstrap `apply_change` through attached generator task/response artifacts, and lets attached App Server runs refine planner/generator-plan through same-thread skill turns plus contract/eval through inline review turns

## Security guards

- Evidence path resolution now fail-closes to allowlisted runtime roots: `roundDirectory`, `runDirectory`, `targetRoot`, and adapter `baseDirectory`. The core may resolve relative candidates from capability `cwd`, but the final real path must still land inside the allowlist before evidence is accepted.
- Adapter `target_root` values resolve inside the harness repository by default. External companion roots require explicit opt-in with `--allow-external-target-root` or `HARNESS_ALLOW_EXTERNAL_TARGET_ROOT=1`.
- Credential-looking evidence paths are rejected before content inspection, including `.codex` paths, `.env` files, auth or credentials files, private keys, token files, and secret files.
- Evidence files must be regular files and stay under `HARNESS_EVIDENCE_MAX_BYTES`, which defaults to `10485760`.
- Core HTTP, HTTP JSON, browser, and browser journey probes accept only localhost or loopback target URLs by default. External target probes require `HARNESS_ALLOW_NONLOCAL_TARGET_URLS=1`, while private, link-local, loopback, broadcast, and metadata hosts remain blocked in nonlocal mode.
- Core fetch probes use manual redirects and cap response body capture with `HARNESS_HTTP_BODY_MAX_BYTES`, which defaults to `1048576`.
- Adapter capability commands run without a shell by default. A string command such as `node ./executor.mjs prepare_target` is tokenized and direct-spawned; shell execution only occurs when the adapter capability explicitly sets `shell`.
- Core shell/browser probe commands also run without a shell by default and kill the full process tree on timeout or output-cap breach. Use `args` for commands such as `python -c ...`; shell execution only occurs when a core probe explicitly sets `shell`.
- Adapter capability commands and core shell/browser probe commands cap stdout and stderr with `HARNESS_COMMAND_OUTPUT_MAX_BYTES`, which defaults to `1048576`; adapter capabilities fail when the cap is exceeded.
- Process-tree cleanup sends `SIGTERM`, waits `HARNESS_PROCESS_TREE_KILL_GRACE_MS` milliseconds, then sends `SIGKILL` on Unix-like hosts; Windows cleanup uses `taskkill /T /F`.
- Validation batch entries are killed after `HARNESS_VALIDATION_TIMEOUT_MS`, which defaults to `300000`.
- Validation helper loop invocations are killed after `HARNESS_VALIDATION_LOOP_TIMEOUT_MS`, which defaults to `300000`.
- Validation package-script helpers such as `validate-loop-continue` are killed after `HARNESS_VALIDATION_HELPER_TIMEOUT_MS`, which defaults to `300000`.
- Reference adapter validators clean up target server PIDs published by `run_target` metadata before the validation process exits.
- Run `npm run validate:security-guards` after `npm run build` to check evidence containment, URL policy, and command output caps.

## Round contract and dimension floors

- Each executed round now writes `round-###/round-contract.json` and `round-###/round-contract.md` before adapter mutation begins.
- The round contract names the implementation slice, generator deliverables, evaluator checks, release-gate probe ids, required live verification modes, pivot triggers, and numeric success thresholds.
- Each evaluated round now also writes `trajectory-decision.json`, which records whether the next attempt should tighten, refine, pivot, or parallel-pivot, plus the restart anchor that should guide that attempt.
- Evaluator scoring now happens as an end-pass QA step for the whole round rather than through a separate sprint artifact layer.
- `AdapterCapabilityPacket` now includes `round_contract_path`, so adapter-side tooling can read the same scoped contract the controller is grading.
- `eval_report.json` now also records `dimension_scores[]` plus `threshold_results.dimension_thresholds_met`.
- The default rubric now includes hard dimension floors for contract execution, proof integrity, API release QA, browser release QA when applicable, and repair convergence.
- Dimension floors are target-family aware: browser or API QA dimensions are marked not applicable when the active evaluator bundle does not expose that surface in the current lane.

## Bundle selection and resume

- Use `--evaluator-profile <path>` when a specific bundle file must be selected directly.
- Use `--target-family <family>` when the harness should resolve a bundled evaluator pack for a known family such as `generic-core`, `api-service`, `crud-api`, `chat-agent`, `browser-app`, `browser-editor`, `fullstack-app`, or `dashboard`.
- Use `--resume-run <evals/runs/run-###>` to reopen an existing run from file state alone.
- Use `--controller-mode detached` for the default crash-safe supervisor path and `--controller-mode attached` only when the active operator surface is expected to stay in control without nested `codex exec`.
- `controller_mode` and `transport_mode` are separate axes:
  - `detached` currently requires `--transport codex-exec`
  - `attached` currently allows `--transport current-thread` or `--transport app-server`
- `npm run loop:start:codex` is the Codex-owned current-thread start surface. When a thread-bound `ready_to_start` session prepared by `loop:prepare` or `app-builder-loop` exists, `loop:start:codex` now consumes that prepared run instead of allocating a fresh one. Use `npm run loop:start:codex -- --json` when a same-thread worker needs machine-readable continuation state immediately after start, use `npm run loop:resume -- --run-dir <evals/runs/run-###> --json` for machine-readable foreground re-entry, and use `npm run loop:continue -- --run-dir <evals/runs/run-###> --json` for the same-thread autocontinue dispatcher. Use `npm run loop:start:bg -- ...` or the deprecated `npm run loop:run -- ...` only when the operator explicitly wants detached background supervision.
- Codex app run-control prompts such as `루프 시작`, `루프 시작 가능하냐?`, `현재 루프 상태`, `run-179 상태 보여줘`, and `모든 루프 정지` should stay in the `run_control` lane and map to `loop:start:*`, `loop:status`, `loop:resume`, or `loop:stop` instead of falling through harness-design guidance.
- `npm run loop:run:raw -- ...` remains the direct controller debugging surface, and `npm run loop:watch -- ...` keeps the supervisor detached from the launching shell.
- Supervisor, runner, and bootstrap-generated runtime helper spawns now set `windowsHide: true`, so Windows detached runs stop opening a visible stack of extra `cmd.exe` shells while the harness is working.
- Attached runs now default to `--transport current-thread`. That is the stock foreground-thread transport surface, but current-thread only claims foreground ownership when a real bound `CODEX_THREAD_ID` is present.
- Use `--transport current-thread` for the stock Codex foreground-thread protocol. Current-thread attached generator work now persists `attached-generator-prompt.md` / `attached-generator-response.json` as a Codex-owned same-thread checkpoint and still stops honestly with `awaiting_codex_checkpoint` while accepting the deprecated `awaiting_current_thread_handoff` alias during restore and validation.
- Current-thread is now the honest foreground default across planner, contract-review, generator-plan, eval, and attached-generator stages. Each current-thread enhancement persists explicit `*-task.json`, `*-prompt.md`, and `*-response.json` artifacts, reports `attention_required = codex` plus `auto_resume_eligible = true` on the operator surface, echoes a strict `checkpoint_id` in same-thread responses, and resumes from those files instead of pretending the process is still running.
- Operator and session status artifacts now also persist `ui_visibility` and `foreground_owner`: `attention_required = codex` maps to `internal_checkpoint` owned by `codex`, while human, external, and terminal boundaries map to `user_boundary` owned by `human` or `external`.
- Canonical foreground flow:
  1. `루프 시작`
  2. `npm run loop:start:codex -- --json`
  3. If `attention_required = codex`, continue immediately inside `$loop-control` with `npm run loop:continue -- --run-dir <run> --json`
  4. Do not surface intermediate checkpoint pauses to the user
  5. Use `$attached-loop` only as the recovery skill when an existing foreground run must be re-entered after interruption
  6. Only stop on human, external, or terminal boundaries
- Canonical foreground re-entry flow:
  1. `run-179 이어가`
  2. `npm run loop:resume -- --run-dir evals/runs/run-179 --json`
  3. If `attention_required = codex`, continue immediately inside `$loop-control` with `npm run loop:continue -- --run-dir <run> --json`
  4. Use `$attached-loop` only if the foreground thread was interrupted and must be recovered manually
- Shell-launched `attached/current-thread` seeds now fail closed unless a real bound `CODEX_THREAD_ID` is present. Use `--allow-manual-protocol-seed` only when you intentionally want to start a `manual-protocol` shell run instead of a Codex-owned foreground run.
- Use `--transport app-server` to open an embedded `codex app-server` stdio session. The runtime initializes the server, starts or resumes a thread, names it, reads runtime state through `thread/read`, opens a turn, and steers that turn at phase boundaries while persisting `thread_id`, `turn_id`, the event cursor, and thread runtime status.
- `current-thread` and `app-server` are same-thread transports. Both forbid nested `codex exec` calls from shared runtime paths.
- Bootstrap-generated `apply_change` now accepts same-thread generator work through `runtime/attached-generator-prompt.md` and `runtime/attached-generator-response.json` instead of insisting on nested `codex exec`.
- App Server attached turns now default to `approvalPolicy = "never"` because the embedded background transport does not expose a human approval client. Explicit override is still available when a caller deliberately wants `untrusted`, `on-failure`, or `on-request`, and the transport still accepts older `unlessTrusted` / `onRequest` naming when a host advertises those legacy values.
- App Server attached planner and generator-plan refinement now run as same-thread skill turns using `.agents/skills/round-enhancement/SKILL.md`, and contract/eval refinement now runs through inline `review/start` turns instead of being skipped outright.
- App Server attached planner, contract-review, generator-plan, and eval refinement now fail soft on transport exceptions. If a live turn interrupts or times out before structured output arrives, the harness keeps the deterministic artifact, records a runtime warning, and continues writing resumable run state instead of corrupting early initialization.
- Resume now treats missing `planned-scenario.json` or `plan.json` as a partial-init state when no committed round exists yet. In that case the controller rebuilds planner state from `IDEA.md` plus `effective-rubric.json` inside the same run instead of treating the run directory as corrupted.
- `loop:intent` now mirrors the operator language for harness, resume, and evaluator questions. Korean harness-design or run-resume prompts should produce Korean follow-up questions instead of falling back to English-only front-door text.
- App Server attached generator turns now honor per-task `cwd`, writable roots, request timeout, and task completion timeout. Use `--app-server-task-timeout-ms`, `--app-server-request-timeout-ms`, and `--phase-timeout-ms phase=value,...` to tune long-running attached work without abusing `turn/steer` as a heartbeat.
- Use `npm run loop:watch -- ...` when the controller should survive outer shell timeouts. The supervisor now polls runtime health while the child is still alive, marks stale-progress runs as `stalled`, restarts from `--resume-run` when needed, persists `runtime/supervisor-state.json` once the run exists, and discovers the owned run through a supervisor marker instead of guessing from the newest run directory.
- `loop:status` now reports terminal summary truth first and `runtime/supervisor-state.json` second, so stale runtime heartbeats cannot mask a failed supervisor.
- `loop:intent` now renders `run_control` action, targeting, diagnostic focus, and canonical command guidance directly, so operators and higher-level Codex agents can read the next command without reconstructing it from lane prose.
- Bootstrap-generated adapter commands now run as direct `node` invocations with explicit capability timeouts. Timed-out adapter executions kill the full process tree, write an attempt sentinel with `execution_id`, and quarantine late orphaned results under `adapter/late-results/`.
- Treat `loop:run` as a compatibility alias for detached supervisor execution, not as the preferred Codex app front door.
- Bootstrap-generated `run_target` now probes `ready_url` first and reuses a live server instead of restarting it every round. When a tracked process must be replaced, Windows cleanup now uses `taskkill /T /F` so stale `node` or `vite` children do not survive after their parent shell exits.
- Use `--repair` with `--resume-run` when the controller should repair persisted state and stop instead of opening additional rounds.
- Use `--resume-phase <phase>` to force repair or resume from a known persisted controller phase such as `evaluation` or `round_commit`.
- Use `npm run loop:status -- --run-dir <evals/runs/run-###>` to inspect `summary.json`, runtime journals, `runtime/session-status.json`, `runtime/session-status-events.jsonl`, `runtime/session-stream.json`, `runtime/app-server-session-events.jsonl`, and `operator-surface.json` without starting a new controller process. Add `--json` when another tool should consume the report.
- `loop:start:codex`, `loop:resume`, `loop:phase`, `loop:status`, and `--help` now prefer the bundled compiled CLI when `packages/loop-orchestrator/dist/cli.js` exists. Set `HARNESS_FORCE_BUILD=1` or `HARNESS_DEV_REBUILD=1` only when a developer intentionally wants to rebuild before running; installable release ZIPs should not need `npm ci` at loop start.
- Use `npm run loop:resume -- --run-dir <evals/runs/run-###> --json` as the explicit machine-readable foreground re-entry surface instead of remembering the raw `--resume-run` form.
- Use `npm run loop:phase -- <phase> --run-dir <evals/runs/run-###>` to re-enter from a named controller phase. Friendly aliases such as `open`, `negotiate`, `pre-verify`, `evaluate`, and `finalize` resolve to the canonical persisted phase names.
- `loop:phase` is a phase-oriented front door, not a separate controller engine. It resumes from the named persisted phase and then runs until the next file-backed checkpoint or terminal stop.
- App-visible `current-thread` runs now treat same-thread Codex continuation as the canonical path. Shell `loop:resume` / `loop:phase` attempts fail closed unless you intentionally pass `--allow-shell-resume-downgrade`, which downgrades the run back to `manual-protocol`.
- Use `--force-reopen-terminal` only when you intentionally want to reopen a run that already ended with `target_reached`, `contract_completed`, `environment_blocked`, or `adapter_contract_invalid`.
- When no adapter, explicit bundle, or restored bundle is present, the runtime now defaults to the neutral `generic-core` family in the `deterministic_semantic` lane.
- Resume identity now binds `adapter_contract_path`, `adapter_contract_sha256`, `target_family`, `validation_lane`, `evaluator_profile_path`, `evaluator_bundle_sha256`, and `rubric_sha256`.
- Every run now persists that identity in `resume-identity.json`, and `summary.json.resume_identity_path` points to it directly.
- Resumed invocations now also persist `resume-decision.json`, and `summary.json.resume_decision_path` points at the authoritative reopen or no-op decision for that invocation.
- Every run now also persists `runtime/live-state.json`, `runtime/round-phase.json`, and `runtime/controller-lease.json`, and `summary.json` carries those paths so recovery can inspect controller state without trusting chat memory.
- `runtime/live-state.json` now separates `execution_state` from transport liveness and records `last_progress_at` / `last_progress_note`, so a fresh heartbeat is no longer treated as proof of real forward progress.
- `runtime/round-phase.json` and `runtime/controller-lease.json` now also carry progress timestamps plus `stalled`, `awaiting_codex_work`, and the legacy `awaiting_input` status, so pause and stall surfaces survive resume and supervision flows.
- Every run now also persists `runtime/transport-state.json`, and `summary.json.transport_state_path` points at the active transport contract and live thread/turn state.
- `transport-state.json.ui_surface` now also carries `session_status_path`, `session_status_events_path`, `session_stream_path`, and a normalized session projection, so attached UI consumers can discover one structured session feed contract without reopening mixed controller files first.
- Every run now also persists `runtime/operator-surface.json` plus `.md`, and `summary.json.operator_surface_path` points at the operator-facing projection that tells humans whether the active surface is foreground-thread, background-automation, or headless.
- Every run now also persists `runtime/session-status.json`, append-only `runtime/session-status-events.jsonl`, `runtime/session-stream.json`, and when App Server transport is active `runtime/app-server-session-events.jsonl`. `summary.json`, `operator-surface.json`, and `transport-state.json.ui_surface` all point at the normalized session snapshot plus its incremental session-stream contract.
- `runtime/session-status.json` now carries both coarse loop readiness (`session_status`, `readiness`, `next_attention`) and supervisory detail (`attention_kind`, `active_checkpoint`, `session_binding`), so attached clients can tell whether the run is asking for steering, waiting on review, blocked externally, or still bound to a Codex-owned thread/turn without reverse-engineering mixed control-plane files.
- Current-thread operator surfaces now distinguish shell-launched `manual-protocol` runs from stock Codex `foreground-thread` runs by requiring a real bound `CODEX_THREAD_ID`; launch-origin overrides alone no longer promote foreground ownership.
- Operator-surface and transport-state now also persist `launch_origin`, `surface_owner`, `thread_binding_state`, `entrypoint`, and `app_visibility`, so stock Codex visibility is explicit instead of inferred from transport labels alone.
- Operator-surface now also persists `handoff_state`, `worker_skill`, `recovery_skill`, legacy `resume_skill`, `resume_command`, `requires_codex_app`, `worktree_id`, `worktree_path`, and a normalized `session` projection, so `loop:status` and `loop:ui` can tell the operator whether the next continuation belongs in a local thread, worktree, automation surface, or manual shell resume while also exposing foreground session readiness directly.
- App-visible `current-thread` runs now distinguish `worker_skill = loop-control` for the canonical foreground autocontinue chain from `recovery_skill = attached-loop` for recovery after interruption, while legacy `recommended_skill` / `resume_skill` fields remain as compatibility aliases and shell or manual runs continue to publish explicit CLI resume commands.
- `loop:status` now prints shell fallback commands for app-visible `current-thread` runs only as explicit downgrade commands that include `--allow-shell-resume-downgrade`, and `resume` / `phase` require the same persisted Codex `thread_id` instead of accepting any foreground-looking shell context.
- Completed operator surfaces now clear stale handoff notes and replace resume-style `next_action` text with closeout guidance, so terminal runs do not keep obsolete reattach instructions.
- Use `HARNESS_WORKSPACE_SURFACE`, `HARNESS_WORKTREE_ID`, `HARNESS_WORKTREE_PATH`, `HARNESS_HANDOFF_STATE`, `HARNESS_RESUME_SKILL`, or `HARNESS_REQUIRES_CODEX_APP` only when an outer launcher already knows the Codex app resume surface and needs the persisted operator surface to reflect it explicitly.
- Same-thread runs now also persist `runtime/current-thread-protocol.md` or `runtime/app-server-protocol.md`, and `summary.json.transport_protocol_path` points at that operator surface.
- Same-thread bootstrap generator rounds now also persist `runtime/attached-generator-task.json`, `runtime/attached-generator-prompt.md`, and `runtime/attached-generator-response.json`, so attached mutation can be resumed from files alone.
- The controller now checkpoints `summary.json`, `current_best.json`, and `controller-summary.md` after each committed round instead of only at final closeout, so committed rounds survive parent-controller crashes.
- Resume now merges `summary.json.round_history[]` with committed `round-###/round_summary.json` files and can rebuild missing run summaries or repair interrupted rounds directly from runtime journals.
- Interrupted-round repair now reconstructs missing pre/post capability aggregates from `round-###/adapter/*-result.json` plus core probe aggregates from `round-###/core-probes/*-result.json`, then reruns only the missing capability or probe slices when persisted aggregates are stale or absent.
- `summary.json.runtime_events[]` now carries machine-readable event codes such as `resume.noop_terminal`, `resume.reopened_terminal`, `resume.continued`, `resume.migration_override`, and `validation.environment_lane_hint`, so validators no longer depend on warning-string matching.
- `summary.json.runtime_events[]` now also carries `resume.recovered_round_checkpoint` and `resume.repaired_interrupted_round`, so repaired controller state is explicitly reviewable.
- `summary.json.round_history[]` now also persists the resolved `target_family` and `validation_lane` for each attempt, so resume migrations and explicit-profile runs stay machine-auditable after the fact.
- `summary.json.round_history[]` now also persists `round_stop_reason`, so per-round terminal outcomes no longer depend on parsing handoff prose.
- `summary.json.round_history[]` now also persists `decision_source`, so reviewers can tell whether a round followed `policy_snapshot`, a hard rule, or default patch authority without reading handoff prose.
- `summary.json.feature_list_path`, `summary.json.progress_path`, `summary.json.progress_log_path`, `summary.json.done_when_path`, and `summary.json.init_script_path` now point at the durable memory surfaces that travel with the run.
- The root `build`, `loop:run`, `loop:run:raw`, and `loop:single` entrypoints now retry the TypeScript build with pinned `5.8.3` when the host compiler exits abnormally, matching the bootstrap fallback already used by `init.sh`.
- Browser-first bootstrap defaults now use `npm run dev -- --host 127.0.0.1 --port 3000 --strictPort`, so the generated harness fails closed on port collisions instead of silently drifting to a different Vite port than `ready_url` or `app_url`.
- Resume identity mismatches fail closed by default. Use `--allow-resume-migration` only when intentionally changing the adapter contract, bundle, rubric, or target family for an existing run, and expect the controller to write `resume-migration.json`.
- Rejected resume attempts no longer overwrite `resume-identity.json`. The persisted identity only advances after the resume is actually allowed to continue or reopen.
- Resuming a run that already ended with `target_reached`, `contract_completed`, `environment_blocked`, or `adapter_contract_invalid` now defaults to a no-op closure. `--allow-resume-migration` alone does not reopen a terminal run; use `--force-reopen-terminal` when you intentionally want to spend more budget, and pair it with `--allow-resume-migration` when the reopen also changes run identity.
- `loop:single` now means a literal single detached/headless attempt even when an adapter is attached. Use `loop:start:codex` for the Codex-owned current-thread front door and `loop:start:manual` for an explicit shell `manual-protocol` seed. `loop:single:codex` and `loop:single:manual` remain deprecated compatibility aliases.

## Operating policy

- Use `IDEA.md` as the top-level input.
- For Codex foreground product-build work, prefer a question-gated same-thread session that writes `runtime/build-brief.json` and `runtime/run-contract.json` before heavy implementation starts.
- Treat `loop:intake` as the stateless staged parser and `loop:discover` as the thread-bound discovery state machine. Persist discovery state in `evals/front-door-sessions/` until `loop:prepare -- --front-door-session <path>` materializes run-owned artifacts and marks the discovery session prepared.
- Treat `runtime/build-brief.json` and `runtime/run-contract.json` as session-level surfaces. They do not replace attempt-level `round-###/round-contract.json`.
- The same session-preparation pass should also write `runtime/open-questions.json`, `runtime/session-status.json`, `runtime/session-status-events.jsonl`, `runtime/session-stream.json`, and `docs/EXECUTION_PLAN.md` for the active run, and refresh them when round feedback, human steering, or external blockers change the active session context.
- Keep the repo adapter-free.
- Treat every build attempt as resumable from files alone.
- Treat `patch-request.json` as the main continuation request.
- Treat `quality-critique.json` as the evaluator-owned quality steering surface that explains why the next patch should refine, tighten, or pivot.
- Treat `trajectory-decision.json` as the controller-owned execution surface that decides whether the next attempt stays on the current head or reopens from a stronger anchor.
- Treat `patch-request.json.must_fix[].target_check_ids` as the structural continuation key.
- Use full contract negotiation on the initial build attempt; keep one active contract frame after agreement and default later remediation to patch-only work centered on carried check ids, QA feedback, and `patch-request.json`.
- Reopen contract negotiation only when no active contract frame exists, the patch request is not actionable, release-gate regressions reopen closed checks, target-manifest requirements stay broken, scope drifts beyond the active contract frame, or the persisted `policy_snapshot` concludes that repeated unresolved signatures or plateaued progress collapsed patch authority.
- When `trajectory-decision.json` selects `pivot` or `parallel_pivot`, reopen through `decision_source = "trajectory_policy"` even if patch authority is still structurally actionable, and carry the selected restart anchor into the next generator attempt.
- Normalize raw adapter capability failures into evaluator-known continuation checks before carrying them forward.
- Validate adapter result schema before trusting adapter-owned success claims.
- Require verifiable evidence paths for successful `capture_evidence`, `run_checks`, and `grade_round` claims.
- Reject empty evidence files as non-proof.
- Require successful proof claims to provide evidence item `kind` and `description` fields.
- Require successful `run_checks` evidence to declare supported check ids.
- Require successful `run_checks` and `grade_round` results to publish grounded `criteria_results` with concrete evidence paths.
- Require successful `run_checks` evidence to declare supported criterion ids as well as supported check ids.
- Require adapter-attached target proof to include a core-owned evaluator profile selected by the rubric or CLI.
- Require adapter-attached target proof to run through an independent verification provider with a distinct `provider_id`.
- Require adapter-attached target proof to include at least one verifier-produced live interaction artifact such as an `interaction-log`, transcript, or trace.
- Require adapter-attached target proof to include at least one structured `verification-witness` artifact that points at the live interaction log and enumerates verifier steps.
- Require adapter-attached target proof to include evaluator-owned `core_probes` so the core can generate independent target evidence before claiming `target_reached`.
- Require `run_target` to publish `target_manifest` URLs when release-gate probes resolve target surfaces through manifest keys.
- Run generated or external `run_checks` / `grade_round` only after the core-owned probe phase has written `core-probe-results.json` and `target-manifest.json`, so verifier grading can consume one shared release-gate signal instead of re-executing probes out-of-band.
- Require core-owned evaluator profiles to declare the target surfaces they expect through `expected_target_surfaces`, so browser/API coverage policy is owned by the harness instead of the adapter.
- Require release-gate probes to use `http_json` or `browser_journey`, carry `assertion_id`, stay at `semantic_level: "feature"` or `"workflow"`, and resolve target surfaces through `target_manifest_key`.
- Require browser/API proof only when the core-owned evaluator profile declares those surfaces through `expected_target_surfaces`.
- Allow core-owned evaluator profiles to require tagged release assertion coverage through `minimum_assertion_tag_counts`, so bundle strength can demand browser, API, persistence, or error-path coverage by policy.
- Fail adapter-backed rounds when a core-owned evaluator profile expects `browser` or `api` surfaces but `run_target` does not publish the corresponding `target_manifest` URL.
- Require `target_reached` eligibility to include the configured minimum number of distinct passing release-gate assertions. When `minimum_feature_release_assertions` is omitted, the harness defaults that minimum to `2`.
- Treat `http`, `browser`, target-root file probes, target JSON probes, and `shell_command` as supporting evidence only.
- Require successful `run_checks` and `grade_round` criteria to publish `observed_value` so the core can compare observations against the verification profile.
- Require successful `grade_round` evidence to reference upstream `run_checks` or `capture_evidence` proof by capability and by concrete evidence path.
- Require hard release assertions to be covered by both verifier-owned `verification-witness.assertion_ids` and passing core-owned release-gate probes.
- Require successful `grade_round` results to publish a `threshold_verdict`, keep `blocking_criterion_ids` aligned with failing criteria, and fail when grading contradicts earlier hard criteria without new grounded proof.
- Generated evaluator bundles must preserve the selected family bundle as a quality floor. Intake-derived probes and criteria are layered on top of the base family profile rather than replacing its release assertions or assertion-tag minima.
- User-defined subjective metrics belong to `grade_round`, not `run_checks`. Generated `grade_round` may attach minimum `x/10` thresholds, keep `ok: true`, publish `subjective_metric_results`, and fail closure through `criteria_results`, `threshold_verdict`, and `blocking_criterion_ids`.
- When subjective metrics are configured, generated `grade_round` writes `artifacts/subjective-quality-review.json`. For deterministic tests, `HARNESS_SUBJECTIVE_REVIEW_PATH` can inject a prebuilt review artifact instead of calling Codex live.
- Persist verifier command, stdout, stderr, result, and evidence hashes so proof provenance is reviewable after execution.
- Perform generic content inspection on text, JSON, image, and binary evidence before trusting it.
- Cap `proof_score` when skeptical proof checks fail so contradictory or weakly grounded proof cannot still look release-ready in summaries.
- Treat `*_surface_reserved` checks as placeholder-or-final surface existence checks, not final-content proof.
- Negotiate the initial build contract before the generator commits to the long build attempt, and keep remediation attempts patch-request-led even when compatibility artifacts are rewritten.
- Fail fast with `stop_reason = "adapter_contract_invalid"` when a static adapter contract error is detected, such as missing verifier/profile policy or verifier/executor command overlap.
- Do not send static adapter contract invalidation through the in-run recontract path; treat it as an external boundary failure and stop immediately.
- Reject adapter-backed target rounds during contract review when no core-owned evaluator profile is attached.
- Ignore adapter-authored `verification_profile_path` values during runtime; only rubric/CLI-selected core-owned profiles are attached.
- Emit a runtime warning when an adapter still publishes deprecated `verification_profile_path`, and carry that warning into stdout, `summary.json`, `controller-summary.md`, and `codex-handoff.md`.
- Semantic validation fixtures intentionally omit `verification_profile_path`; choose their validation lane explicitly through `--evaluator-profile` or the rubric-owned bundle.
- Shipped explicit evaluator profiles should publish `target_family` and `validation_lane` metadata so direct `--evaluator-profile` launches keep both run-level and per-round reporting intact.
- Surface resolved `target_family` and `validation_lane` in run summaries and round handoff files so deterministic semantic lanes stay separate from environment-integration lanes.
- Surface those same resolved values in `summary.json.round_history[]` and `round_summary.json`, not only in human-readable handoff text.
- Persist `failure-lineage.json` for every evaluated attempt and treat it as the controller's first-class explanation of release regressions, manifest breakage, repeated unresolved signatures, and environment blockers.
- Persist `failure-lineage.json.policy_snapshot` for every evaluated attempt and treat it as the controller's reviewable recommendation surface for `patch_only`, `recontract`, or `stop`.
- Persist `adapter-drift-report.json` plus `.md` whenever static contract blockers or missing target-manifest keys indicate that the adapter execution or verification boundary drifted outside the active remediation envelope.
- When `patch-request.json.next_action = "recontract_adapter"`, treat that as a first-class recontract surface: reopen planner-owned contract negotiation for the adapter boundary instead of pretending the next step is ordinary patch-only remediation.
- Generated-local runtime-surface drift may now auto-apply inside the recontract round when the repair stays within `.generated/codex-adapter/runtime-config.json` plus `adapter.generated.json`; that path writes `adapter-migration-proposal.json`, `adapter-migration-applied.json`, and an authorized `resume-migration.json` before the same run continues with the migrated adapter identity.
- Proposal-only adapter migrations now open a persisted approval lane. The recontract round writes `adapter-migration-approval-prompt.md`, `adapter-migration-response.json`, and `adapter-migration-instructions.md`, then pauses with `checkpoint_kind = adapter-migration-approval` until the operator accepts, rejects, or opens a new run.
- Current-thread recontract rounds can now open a persisted `adapter-migration-authoring` Codex checkpoint before that approval lane. The runtime writes `adapter-migration-authoring-task.json`, `adapter-migration-authoring-prompt.md`, `adapter-migration-authoring-response.json`, and `adapter-migration.patch`, then rehydrates the proposal with the authored bundle before human approval opens.
- Resume now consumes `adapter-migration-response.json` directly from that approval lane. `accept` records `adapter.migration_accepted` and reopens as `awaiting_external_condition` so external or proposal-only follow-up can continue honestly, `reject` closes the current run with `stop_reason = "adapter_migration_rejected"`, and `open_new_run` closes the current run with `stop_reason = "new_run_required"`.
- Boundary-crossing adapter drift now classifies as `migration_class = boundary_break` with `apply_mode = new_run_required`, so the current run stays fail-closed instead of pretending same-run migration is safe.
- Recontract rounds that reopen the adapter boundary now stamp `recontract_mode = true` plus `adapter_only_paths` into `round-contract.json`, and generated-local autoapply rejects any touched file outside the generated adapter write surface.
- Generated-local kernel wiring drift no longer stays proposal-only: on the same-thread path Codex can author a bundle, human approval can accept it, and the runtime then applies that bundle in place, records `adapter-migration-applied.json`, and authorizes the adapter identity change through `resume-migration.json`.
- External adapter drift still stays conservative: current-thread Codex can author an advisory proposal bundle plus expected post-apply identity, but `accept` pauses on `awaiting_external_condition` until that external/manual apply work is completed outside the current run.
- Classify blocked browser or live-target probes as `environment_blocked` when the failure comes from the host environment rather than the product under test.
- When the latest patch request is purely `environment_blocked`, stop with `patch-request.next_action = "hold"` and `stop_reason = "environment_blocked"` instead of spending remediation budget on product repair.
- Reject adapter-backed target rounds during contract review when no independent verification provider is attached.
- Execute adapter capabilities only after the contract reaches agreement.
- Do not claim product proof inside this repo unless an external adapter is attached.
- Treat terminal `next_action = "complete"` as attempt-contract completion.
- Reserve `target_reached` for runs that also meet the rubric's control-plane, proof, and release thresholds.
- Record `target_signal_thresholds_met` as `not_applicable` when no adapter is attached, and exclude that state from pass-rate and resolved/unresolved check summaries.
- Claim each `evals/runs/run-###` directory at run start so concurrent launches do not reuse the same run id.
- Allow adapter-attached threshold misses to spend `max_remediation_rounds` beyond the initial build-attempt budget before the controller gives up with `max_rounds_reached`.
- Allow evaluator bundles to own score composition through optional `score_policy`, so target families can weight `external_grade` and `proof_score` differently without hard-coding those ratios in the controller.
- In `patch_only` remediation, skip the full contract-execution dimension floor and reuse static contract checks when dimension scoring still needs structural context from the active contract frame.
- `repair_convergence` remains visible in eval reports, but it must not block `target_signal_thresholds_met` on its own; the threshold pass is computed first, then carried patch resolution is recomputed against that final target signal.
- In `patch_only` remediation, only carry forward quality targets that correspond to failed or threshold-gated checks. Do not widen patch authority by carrying passing evaluator meta-checks such as `release_blockers_recorded`.

## Authoritative surfaces

| Surface | Role | Runtime authority | Notes |
|---|---|---|---|
| `round-contract.json` | load-bearing attempt boundary | core | always authoritative |
| `patch-request.json` | load-bearing remediation authority | evaluator/core | patch-only rounds continue from this file by default |
| `quality-critique.json` | evaluator-owned quality steering | evaluator/core | persists structured findings, preserve signals, and remediation strategy |
| `trajectory-decision.json` | controller-owned trajectory policy | controller/core | persists restart anchor, novelty target, and pivot-vs-refine branch selection |
| `eval_report.json` | evidence and rationale bundle | evaluator/core | carries proof score, release score, and threshold gaps |
| `failure-lineage.json` | persisted failure explanation | evaluator/core | carries regressions, unresolved signatures, and environment blockers |
| `contract-review.json` | negotiation diagnostic | evaluator | omitted in clean patch-only rounds |
| `contract-agreement.json` | negotiation authority | evaluator | initial and recontract rounds only |
| `generator-plan.json` | compatibility and handoff artifact | controller/generator | retained for resumability even in patch-only rounds |
| adapter `verification_profile_path` | compatibility-only metadata | none | deprecated and ignored at runtime |

## Run layout

Each run writes:

```text
evals/runs/<run-id>/
  effective-rubric.json
  planned-scenario.json
  plan.json
  planner-brief.md
  controller-summary.md
  codex-handoff.md
  summary.json
  current_best.json
  resume-identity.json
  resume-decision.json
  resume-migration.json
  runtime/
    build-brief.json
    run-contract.json
    live-state.json
    round-phase.json
    controller-lease.json
    transport-state.json
    open-questions.json
    session-status.json
    session-status-events.jsonl
    operator-surface.json
    operator-surface.md
    supervisor-state.json
    current-thread-protocol.md
    app-server-protocol.md
    attached-generator-task.json
    attached-generator-prompt.md
    attached-generator-response.json
  docs/
    EXECUTION_PLAN.md
    codex-sessions.json
  round-001/
    round-contract.json
    round-contract.md
    generator-plan.json
    generator-plan.md
    evaluator-verdict.json
    evaluator-verdict.md
    patch-request.json
    patch-request.md
    quality-critique.json
    quality-critique.md
    trajectory-decision.json
    trajectory-decision.md
    round-result.json
    round_summary.json
    eval_report.json
    failure-lineage.json
    agent_handoff/
      planner-context.md
      generator-brief.md
      qa-review.md
      controller-decision.md
    runtime/
      negotiation-state.json
      pre-verification-executions.json
      post-verification-executions.json
      adapter-executions.json
    adapter/
      <capability>-input.json
      <capability>-result.json
      <capability>-stdout.log
      <capability>-stderr.log
    core-probes/
      <probe-id>-result.json
```

Each `round-###` directory is now an attempt record: the first is the initial build attempt, and later ones are patch-request-driven remediation attempts unless the controller escalates a round into recontract mode. The per-round `runtime/` subtree carries round-local negotiation and capability aggregates, while run-level controller journals stay under the top-level `runtime/` directory. Run directories are claimed when the controller allocates the next run id, so overlapping launches should create distinct `run-###` folders instead of racing on the same numeric suffix.

Initial build attempts and recontract attempts also write `contract-review.*` and `contract-agreement.*`. Patch-only remediation attempts may omit those two files on disk unless carried checks explicitly require them, and otherwise keep the carried scope centered on `round-contract`, `generator-plan`, `patch-request`, `quality-critique`, `trajectory-decision`, and `eval_report`.

`resume-decision.json` appears on resumed invocations and should be treated as the authoritative record of whether the controller continued, reopened a terminal run, or returned as a no-op. `resume-migration.json` appears only when `--allow-resume-migration` is used to override a resume identity mismatch. `failure-lineage.json` is written whenever an eval report exists and should be treated as the authoritative explanation for why the controller stayed in `patch_only`, escalated to `recontract`, or classified a lane as environment-blocked. `trajectory-decision.json` is written whenever an eval report exists and should be treated as the authoritative explanation of whether the next attempt should keep tightening the current head or reopen from a stronger anchor.

`current_best.json` now points at the terminal selected round for downstream tooling and also records `best_scoring_*` fields when the highest-scoring round happened earlier.

## Default flow

1. Read `IDEA.md`.
2. Write `planned-scenario.json`, `plan.json`, and `planner-brief.md`.
3. Write the full initial-build negotiation surface, including `round-contract`, `contract-review`, `contract-agreement`, and `generator-plan`, before any adapter execution.
4. If QA reopens the run, let the controller choose between patch-only remediation and recontract. Patch-only remediation is the default when the active contract frame still holds and the patch request is actionable; only rewrite `contract-review` or `contract-agreement` when the controller escalates or carried checks explicitly require those surfaces.
5. If an adapter is attached and the agreement is valid, execute adapter capabilities in order: prepare, apply, run, capture, check, grade.
6. Write `evaluator-verdict`, `patch-request`, `quality-critique`, `trajectory-decision`, `round-result`, and attempt handoff files.
7. Score the attempt as `control_plane_score`, `proof_score`, and `release_score` instead of a single opaque number.
8. Treat adapter capability failures, malformed result payloads, empty artifacts, weak evidence semantics, missing verification profiles, missing verification providers, contradictory criterion manifests, and weak generic content as release blockers that can force `revise` or `hold`.
9. Emit `patch-request.next_action = "complete"` only when the current attempt can stop honestly. If target thresholds are still open, carry `target_signal_thresholds_met` forward instead of pretending the run is done.
10. Let the controller distinguish `contract_completed` from `target_reached` based on rubric thresholds, adapter-backed proof, live verification artifacts, verifier provenance, and evaluator-owned release-gate probe results.
11. Continue to the next remediation attempt until target, contract completion, plateau, or max rounds. Do not let plateau stop a blocking `revise` with explicit must-fix work.
12. When `trajectory-decision.json` chooses `pivot` or `parallel_pivot`, reopen from the selected anchor instead of treating the next attempt as a linear patch of the current head.
13. When the initial build attempt closes structurally but still misses target thresholds, keep revising through the remediation budget instead of forcing a fake terminal success.
14. If a process stops early, reopen the same run with `--resume-run` and let the controller restore its state from `summary.json`, `runtime/live-state.json`, `runtime/round-phase.json`, committed `round_summary.json` files, the latest patch request, the latest trajectory decision, the latest eval report, the latest `failure-lineage.json`, and the latest agreed contract frame.
15. If the persisted state shows an interrupted round, use `--repair` to finish the interrupted round from the runtime journal without spending additional round budget on new work.
16. Reject resume attempts that change the run identity unless `--allow-resume-migration` is explicitly present, and persist that override as `resume-migration.json` for later review.
17. Continue harness work by reading `codex-handoff.md`.

## Validation commands

```powershell
npm run build
npm run loop:intent -- --json "Add a loop:intent router for harness design prompts"
npm run validate:intent-gate
npm run validate:bootstrap-deep-intake
npm run validate:bootstrap-custom-quality-metrics
npm run validate:bootstrap-profile-aware-verifier
npm run loop:single
npm run loop:start:codex
npm run loop:start:codex -- --json
npm run loop:start:manual
npm run loop:start:bg -- --max-rounds 3
npm run loop:stop -- --run-dir ./evals/runs/run-###
npm run validate:late-result-restore
npm run validate:stop-boundaries
npm run loop:run:raw -- --max-rounds 1
npm run loop:run -- --adapter ./adapter.example.json --max-rounds 3
npm run loop:run -- --adapter ./.tmp/semantic-validation/patch-only-success/adapter.json --target-family api-service --max-rounds 3
npm run loop:single -- --adapter ./.tmp/semantic-validation/patch-only-success/adapter.json --target-family api-service
npm run loop:run -- --resume-run ./evals/runs/run-### --max-rounds 3
npm run loop:run -- --resume-run ./evals/runs/run-### --repair --resume-phase evaluation
npm run loop:run -- --controller-mode attached --max-rounds 1
npm run loop:run -- --controller-mode attached --transport current-thread --max-rounds 1
npm run loop:watch -- --adapter ./.tmp/semantic-validation/patch-only-success/adapter.json --target-family api-service --max-rounds 3
npm run loop:ui -- ./evals/runs/run-###
npm run loop:ui -- ./evals/runs/run-### --once
npm run loop:ui -- ./evals/runs/run-### --once --json
```

Run with a live App Server transport:

```bash
npm run loop:run:raw -- --single --controller-mode attached --transport app-server
```

If the host does not expose a real `codex app-server`, point the runtime at a compatible override:

```powershell
$env:HARNESS_APP_SERVER_BIN="node"
$env:HARNESS_APP_SERVER_BIN_ARGS='["C:\\path\\to\\compatible-app-server.mjs"]'
npm run loop:run:raw -- --single --controller-mode attached --transport app-server
```

Useful validation and companion commands:

```bash
npm run loop:run -- --resume-run ./evals/runs/run-### --target-family crud-api --allow-resume-migration --max-rounds 3
npm run validate:lifecycle-api
npm run validate:family-crud
npm run validate:family-chat
npm run validate:family-browser-semantic
npm run validate:family-browser:preflight
npm run validate:family-browser
npm run validate:family-browser:positive
npm run validate:family-editor
npm run validate:family-editor:preflight
npm run validate:family-editor:positive
npm run validate:family-dashboard
npm run validate:family-dashboard:preflight
npm run validate:family-dashboard:positive
npm run validate:family-fullstack-semantic
npm run validate:family-fullstack:preflight
npm run validate:attached-resume-smoke
npm run validate:status-supervisor-precedence
npm run validate:session-preparation-artifacts
npm run validate:session-status-event-stream
npm run validate:loop-ui-session-status
npm run validate:app-server-session-stream
npm run validate:app-server-generator-mainline
npm run validate:app-server-interrupted-generator
npm run validate:supervisor-timeout-prevention
npm run validate:app-server:real-smoke
npm run validate:family-fullstack
npm run validate:family-fullstack:positive
npm run validate:family-editor-semantic
npm run validate:family-dashboard-semantic
npm run validate:failure-policy
npm run validate:resume-smoke
npm run validate:score-policy
npm run validate:quality-lift
npm run summarize:realism-positive
npm run validate:reference-adapter:check
npm run validate:reference-adapter:canonical
npm run validate:reference-adapter:canonical:patch-only
npm run validate:reference-adapter:canonical:recontract
npm run validate:reference-adapter:canonical:crud
npm run validate:reference-adapter:canonical:crud:patch-only
npm run validate:reference-adapter:canonical:crud:recontract
npm run validate:reference-adapter:canonical:chat
npm run validate:reference-adapter:canonical:chat:patch-only
npm run validate:reference-adapter:canonical:chat:recontract
npm run smoke:reference-adapter
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-template
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-api-patch-only --template canonical-api-patch-only
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-api-recontract --template canonical-api-recontract
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-crud --template canonical-crud
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-crud-patch-only --template canonical-crud-patch-only
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-crud-recontract --template canonical-crud-recontract
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-chat --template canonical-chat
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-chat-patch-only --template canonical-chat-patch-only
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-chat-recontract --template canonical-chat-recontract
npm run reference-adapter:scaffold -- ./.tmp/reference-adapter-placeholder --template placeholder
npm run reference-adapter:scaffold-quality-lane -- --profile ./.tmp/semantic-validation/verification-profile-score-policy-lenient.json --out ./.tmp/external-quality-lane.json
npm run reference-adapter:install-ci -- ../external-companion --adapter adapter.json --target-family crud-api
npm run reference-adapter:bootstrap-independent -- ../independent-crud-companion --template canonical-crud
npm run loop:run -- --adapter ./.tmp/semantic-validation/truth/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 3
npm run loop:run -- --adapter ./.tmp/semantic-validation/low-score/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 3
npm run loop:run -- --adapter ./.tmp/semantic-validation/patch-only-success/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 3
npm run loop:run -- --adapter ./.tmp/semantic-validation/patch-recontract/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 3
npm run loop:run -- --adapter ./.tmp/semantic-validation/browser-success/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-browser-semantic.json --max-rounds 3
npm run loop:run -- --adapter ./.tmp/semantic-validation/fullstack-success/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-fullstack-semantic.json --max-rounds 3
npm run loop:run -- --adapter ./.tmp/semantic-validation/chat-success/adapter.json --target-family chat-agent --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/editor-success/adapter.json --target-family browser-editor --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/dashboard-success/adapter.json --target-family dashboard --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/contradictory/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/no-live/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/no-core-probe/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-no-core-probe.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/shell-only/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-shell-only.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/truth/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/api-only-witness/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/hidden-app-url/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/overlap/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/browser/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-browser.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/liveness-only/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-liveness-only.json --max-rounds 1
npm run loop:run -- --adapter ./.tmp/semantic-validation/witness-mismatch/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 1
npm run validate:reference-adapter
```

`loop:single` and `loop:run` write harness artifacts by default. When `--adapter <path>` is provided, they also execute the external capability boundary.

`loop:ui` now consumes `runtime/session-status.json` as a first-class session feed, falls back to the normalized `operator-surface.json.session` projection only when that file is absent, and also exposes `runtime/session-stream.json` plus recent `runtime/session-status-events.jsonl` items as the incremental session contract. `transport-state.json.ui_surface` mirrors the same snapshot path, event-stream path, contract path, and normalized projection for attached App Server consumers, while App Server transport mirrors source events into `runtime/app-server-session-events.jsonl` as `harness/session.changed` notifications. Expect explicit `RUNNING`, `PAUSED`, `STALLED`, `COMPLETED`, or `FAILED` banners plus session readiness, `attention_kind`, active checkpoint detail, session binding detail, recent session-change events, presentation mode, next action, and heartbeat/progress ages. Use `--once` for a single snapshot and `--once --json` for machine-readable output.

Use `validate:lifecycle-api`, `validate:family-browser-semantic`, and `validate:family-fullstack-semantic` for deterministic controller coverage. Use `validate:family-browser`, `validate:family-fullstack`, `validate:family-editor`, and `validate:family-dashboard` for environment-integration smoke that may legitimately classify failures as `environment_blocked` instead of product defects.

Use `validate:family-crud`, `validate:family-chat`, `validate:family-editor-semantic`, and `validate:family-dashboard-semantic` for deterministic semantic release-pack coverage. Use `validate:family-editor` and `validate:family-dashboard` for environment-integration smoke that may legitimately classify failures as `environment_blocked` instead of product defects.

Use `validate:family-browser:preflight`, `validate:family-fullstack:preflight`, `validate:family-editor:preflight`, and `validate:family-dashboard:preflight` when you want machine-readable host-readiness artifacts before realism smoke consumes more of the workflow.

Use `validate:family-browser:positive`, `validate:family-editor:positive`, `validate:family-fullstack:positive`, and `validate:family-dashboard:positive` only inside a browser-ready environment such as `.devcontainer/browser-validation` or CI. Those commands promote `environment_blocked` into a hard validator failure and are intended to prove a positive realism pass rather than a packaging smoke.

`validate:reference-adapter` is now a strict companion-repo validator rather than a loose wiring smoke. It expects `REFERENCE_ADAPTER_CONTRACT` plus either `REFERENCE_TARGET_FAMILY` or `REFERENCE_EVALUATOR_PROFILE`, seeds one attempt, resumes the same run in a fresh process, and fails if the terminal run does not honestly reach `target_reached`, publish proof, and close the core proof-health checks. Default resume on an already-terminal strict run is now a no-op unless `--force-reopen-terminal` is passed explicitly. Use `smoke:reference-adapter` when you only want a wiring-oriented seed/resume smoke. Use `validate:reference-adapter:check` for preflight-only setup validation, `validate:reference-adapter:canonical` / `:canonical:patch-only` / `:canonical:recontract` / `:canonical:crud` / `:canonical:crud:patch-only` / `:canonical:crud:recontract` / `:canonical:chat` / `:canonical:chat:patch-only` / `:canonical:chat:recontract` for fully reproducible canonical external companion runs, `reference-adapter:scaffold -- <output-dir>` to scaffold an external companion adapter, `reference-adapter:bootstrap-independent -- <output-dir>` to create a sibling independent companion plus strict CI workflow in one command, and `reference-adapter:install-ci -- <companion-repo-dir> ...` to install a strict GitHub Actions validator into a real companion repository. The scaffold now supports `canonical-api`, `canonical-api-patch-only`, `canonical-api-recontract`, `canonical-crud`, `canonical-crud-patch-only`, `canonical-crud-recontract`, `canonical-chat`, `canonical-chat-patch-only`, `canonical-chat-recontract`, and `placeholder`; use `--template placeholder` only when you intentionally want a wiring shell that will not pass the strict validator.

The deeper semantic packs now exercise more than surface liveness. API and CRUD bundles include stale-write rejection plus pagination consistency. Chat includes refusal fallback safety plus tool-trace persistence. Browser and fullstack include refresh persistence plus workflow roundtrip or audit continuity. Editor includes autosave persistence plus invalid-selection blocking. Dashboard includes aggregation correctness plus drilldown continuity.

`validate:resume-smoke` now also proves that resume identity mismatches fail closed unless `--allow-resume-migration` is present, that accepted migrations persist reviewable metadata in `summary.json` and `resume-migration.json`, and that resumed invocations persist `runtime_events[]` plus `resume-decision.json` with machine-readable noop, continue, and reopen decisions. Terminal runs stay closed even under migration override unless `--force-reopen-terminal` is added explicitly.

`validate:score-policy` proves that bundle-owned `score_policy` can change target closure outcomes for the same evidence without changing the controller's generic stop logic.

`validate:quality-lift` proves that a lenient bundle can close low-score evidence, a stricter external quality lane can hold that same evidence open, intake-generated bundles publish richer `quality_contract` axes plus continuity/error-recovery probes while preserving the base family floor, and patch-only remediation persists structured `quality-critique.json` alongside quality-aware patch requests.

`validate:bootstrap-deep-intake` proves that deeper quality intake fields survive into `IDEA.md`, `intake.json`, runtime config, generated quality axes, and generated `subjective_metrics`.

`validate:durable-memory` proves that `feature_list.generated.json`, `progress.md`, `progress.jsonl`, `done_when.md`, and `init.sh` are scaffolded from intake context, rediscovered from disk, and restored when one of the files goes missing.

`validate:codex-warning-propagation` now self-bootstraps the `evals/runs` directory on a fresh checkout before seeding `loop:single`, so it validates Codex fallback warnings without assuming prior run storage exists.

`validate:bootstrap-custom-quality-metrics` proves that user-authored subjective metric thresholds are graded in `grade_round`, fail closed when the configured review falls below the requested minimum, publish `subjective-quality-review.json`, and surface as structured `subjective_quality` findings in quality critique generation.

`validate:bootstrap-profile-aware-verifier` proves that bootstrap-generated `run_checks` and `grade_round` consume the already-executed core probe results, keep capability execution `ok: true` while hard criteria fail, publish `core-probe-summary.json`, and turn failing release-gate assertions into blocking grading criteria.

For concurrency validation, launch `loop:single` multiple times in parallel and confirm that each invocation allocates a distinct `evals/runs/run-###` directory.

`summary.json` now reports:

- top-level score and `threshold_results` fields for the terminal attempt
- separate `best_scoring_*` fields when the highest score occurred before the terminal attempt
- `control_plane_score`: harness-side contract and handoff closure
- `proof_score`: adapter-backed proof quality after skepticism checks
- `release_score`: the composite score used for `target_reached`
- `terminal_round`: the last executed round in the run, even when the highest score appeared earlier
- `proof_score = 0` when adapter proof capabilities never ran, even if contract review blocked the round before execution
- `proof_boundary_is_independent`: the verifier trust domain gate for `capture_evidence`, `run_checks`, and `grade_round`
- `proof_provenance_is_attested`: verifier command/log/result/evidence attestation gate
- `live_verification_present`: verifier-produced interaction transcript/trace gate
- `independent_target_probe_present`: evaluator-owned core probe gate that must pass before adapter-backed runs can claim `target_reached`, including the configured minimum number of required `http_json` or `browser_journey` release assertions
- Core-owned evaluator profiles can now require browser/API surfaces explicitly, and only those declared surfaces open browser/API witness and release-gate requirements
- Core-owned evaluator bundles can also require tagged assertion coverage such as persistence or error-path checks before `target_reached` is eligible
- Runs fail when a core-owned evaluator profile expects a browser/API surface but `run_target` hides the corresponding `target_manifest` URL such as `app_url` or `api_base_url`
- skeptical proof failures cap `proof_score`, which also drags down `release_score`
- adapter-attached runs can satisfy live-verification gates and still fail `target_reached` when the core probe layer cannot independently reproduce target evidence
- adapter-attached runs that miss target thresholds now stay in `revise` and carry `target_signal_thresholds_met` forward until another attempt closes it or the initial budget plus `max_remediation_rounds` are exhausted
- `patch-only-success` deterministically exercises round 2 patch-only closure after a threshold miss on round 1 when paired with the API-only semantic verification profile
- `patch-recontract` deterministically exercises round 2 patch-only remediation and round 3 recontract fallback before recovery when paired with the API-only semantic verification profile
- browser/fullstack semantic profiles can still be blocked by managed browser environments, so lifecycle validation should use the API-only lane when deterministic control-plane coverage is required
- `stop_reason = "contract_completed"` remains valid for adapter-free structural closure, while adapter-attached runs use `target_reached` only after all target thresholds pass
- `stop_reason = "adapter_contract_invalid"` ends the run immediately when the adapter contract is statically unfit for skeptical QA
- `stop_reason = "environment_blocked"` ends the run immediately when the latest patch request is a pure environment blocker and remediation would only waste budget
- `threshold_results`: explicit gates for adapter presence, grade score presence, proof score, control-plane score, release score, independent core probes, and target eligibility
- `threshold_results.core_probe_required_met = false` when adapter-backed runs lack a rubric/CLI-selected core-owned evaluator profile
- `target_family` and `evaluator_profile_path`: the resolved bundle selection that governed the run
- `validation_lane`: whether the selected bundle ran in a deterministic semantic lane or an environment-integration lane
- adapter-free default runs now resolve to `target_family = "generic-core"` and `validation_lane = "deterministic_semantic"`
- prepared product sessions now fail closed if `loop:start:codex` cannot restore the persisted product adapter/evaluator identity, instead of silently falling back to `generic-core`
- explicit `--evaluator-profile` runs now inherit `target_family` and `validation_lane` from bundle metadata when the profile publishes those fields
- `round_history[].target_family` and `round_history[].validation_lane`: per-attempt machine-readable bundle semantics for audit, resume migration review, and validator assertions
- `round_history[].round_stop_reason`: per-attempt machine-readable terminal outcome (`continue`, `target_reached`, `contract_completed`, `environment_blocked`, `adapter_contract_invalid`, or other honest controller stops)
- `round_history[].decision_source`: whether the controller followed `policy_snapshot`, a hard rule, or default patch authority for that attempt
- `round_history[].trajectory` and `round_history[].trajectory_decision_path`: the persisted next-lineage choice and its artifact path for each attempt
- `adapter_contract_sha256`, `evaluator_bundle_sha256`, and `rubric_sha256`: the persisted resume identity for this run
- `resume_identity_path`: the authoritative run-level identity artifact used for fail-closed resume checks
- `resume_decision_path`: the authoritative per-resume decision artifact for `continue`, `noop_terminal`, or `reopened_terminal`
- `bundle_migrated`, `previous_bundle_fingerprint`, `new_bundle_fingerprint`, and `resume_migration_path` when a resume identity override was explicitly accepted
- `runtime_warnings`: deprecation or override warnings that affected runtime interpretation
- `runtime_events`: machine-readable runtime event codes such as `resume.noop_terminal`, `resume.continued`, `resume.reopened_terminal`, `resume.migration_override`, and `validation.environment_lane_hint`
- `round_history[].failure_lineage_path`: the persisted artifact that explains unresolved signatures, release regressions, manifest breakage, contradictory witness coverage, and environment blockers
- `round_history[].failure_lineage.failure_classification`: whether the remaining issue looks like a product defect, an environment blocker, a mixed case, or `none` on a clean round
- `round_history[].failure_lineage.policy_snapshot`: the persisted controller recommendation surface showing whether the evidence suggests `patch_only`, `recontract`, or `stop`
- `round_history[].failure_lineage.policy_snapshot.trigger_codes`, `trigger_scores`, `dominant_trigger_code`, `patch_authority_state`, `escalation_confidence`, `recommendation_source`, `projected_plateau_count`, and `plateau_limit_reached`: the richer reopen-policy surface for auditing why patch authority stayed healthy, strained, or collapsed
- `evals/runs/latest-realism-state.json`: the latest browser/editor/fullstack/dashboard environment-lane state observed locally or in CI
- `evals/runs/latest-positive-realism-state.json`: the latest known `target_reached` realism evidence per browser/editor/fullstack/dashboard family
- `evals/runs/realism-positive-summary.json`: the canonical positive-realism summary artifact uploaded with `realism-positive-runs`

For browser/fullstack realism on a host that does not already allow headless browser probes:

- Use `.devcontainer/browser-validation` as the standard Playwright-ready environment for local reproducibility.
- Use `.github/workflows/realism-preflight.yml` as the standard CI job for browser/fullstack preflight.
- Use `.github/workflows/realism-positive.yml` as the standard CI job when you need a positive browser-ready realism pass instead of packaging-only preflight.
- `validate:family-browser:preflight`, `validate:family-fullstack:preflight`, `validate:family-editor:preflight`, and `validate:family-dashboard:preflight` now write `browser-preflight.json`, `fullstack-preflight.json`, `editor-preflight.json`, or `dashboard-preflight.json` into the run directory before they fail or pass, so readiness is machine-readable as well as human-readable.
- `.github/workflows/realism-positive.yml` now also writes `latest-realism-state.json`, `latest-positive-realism-state.json`, `realism-positive-summary.json`, and `realism-positive-summary.md` before uploading `realism-positive-runs`, so reviewers can jump directly to the latest local state and the latest known green packaged-environment evidence.

`validate:failure-policy` directly checks that weighted policy snapshots and hard-rule stops stay aligned with controller decisions, including plateau-driven recontract that now opens through `policy_snapshot` itself. Use it when editing reopen logic in `failure-lineage.ts` or `attempt-lifecycle.ts`.

`reference-adapter:install-ci` now derives the harness repository and ref from the current git remote and branch by default. Pass `--harness-repo` or `--harness-ref` only when you need to override that auto-detected source.

Proof-side partial credit is intentionally conservative now: verification criteria, proof checks, and rubric dimension scores use a quadratic partial-credit curve, so intermediate scores rise more slowly until most checks are actually green.

The read-only `subjective-quality-judge` is now explicitly allowed under `current-thread` and `app-server` transports when it runs as a non-mutating judge, so strict browser scoring can still complete on the Codex app foreground surface.

Attached `current-thread` / `app-server` rounds now try that best-effort browser baseline capture from the controller before the attached generator mutates round 1, while detached `codex-exec` bootstrap adapters still do it inside generated `apply_change`. Once an attached generator checkpoint or response already exists for round 1, that pre-generator baseline window is treated as closed and the controller will not mint a new `pre_round_1` baseline on resume.

Bootstrap baseline manifests now distinguish `prototype_baseline_present` from `prototype_baseline_valid`. Only `pre_round_1`, `round_1_initial_prototype_fallback`, and `operator_provided_baseline` count as valid initial baselines; round 2 or later no longer invent a new fallback baseline, and `prototype_delta` fails closed when no valid initial baseline exists. Round-1 fallback baselines are now conservative for existing projects: they stay invalid by default unless the project is `new` or the recorded pre-round attempt explicitly skipped because there was no browser target yet or the target was not ready, and blocked attempts do not become valid fallbacks later.

Generated grade/evaluator artifacts now also persist `prototype_baseline_source_semantics` so operator surfaces can distinguish a true pre-round baseline from a `round_1_initial_prototype_fallback`. `first_rendered_round_fallback` explicitly means no pre-round existing-product baseline was available and the first rendered round is serving as the comparison baseline instead.

Generated `grade_round` artifacts now align their own score with browser release-score caps and persist `uncapped_release_score`, `release_score_cap`, and `release_score_cap_reasons` metadata for debugging.

## Additional validation

- `npm run validate:end-pass-qa`: proves that round contracts are written, release-gate probes are surfaced, and dimension floors both pass and fail in deterministic fixtures.
- `npm run validate:baseline-validity`: proves that baseline state distinguishes presence from validity, that attached round-1 baseline capture windows close once a checkpoint or response already exists, that existing projects do not silently mint valid round-1 fallbacks without an allowed pre-round reason, that round 2+ cannot silently replace an invalid late baseline, that baseline semantics are surfaced honestly, and that the validator only requires a captured helper baseline when local browser launch plus localhost navigation really works.
