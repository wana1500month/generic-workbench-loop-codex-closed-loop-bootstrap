# Plan

## Executor tracks

- Mainline executor: `harness`
- Experimental executor: `subagents-experimental`

`harness` stays the default control plane. `subagents-experimental` is reserved for manifest-backed Codex role experiments and must keep the same artifact contract so A/B comparisons stay reviewable.

## M0. Harness-only cleanup

Goal:
Remove bundled product code and leave only the closed-loop core.

Acceptance:
- No sample app remains in the repository.
- No domain package remains in the repository.
- Loop commands write protocol artifacts only.

Validation:
- `npm run build`

## M1. Planner and protocol baseline

Goal:
Keep idea intake, planner-owned build strategy, negotiated contracts, and file handoff clear.

Acceptance:
- `IDEA.md` drives the run.
- `planned-scenario.json`, `plan.json`, and `planner-brief.md` are written.
- The initial build attempt writes the full V2 negotiation files, and remediation attempts stay centered on `patch-request.json` plus evaluator feedback.
- Weak contracts can be rejected before build-attempt execution.
- `patch-request.json` carries `target_check_ids` for structural continuation.

Validation:
- `npm run loop:single`

## M2. Controller and Codex continuation

Goal:
Make the harness easy to continue from repo files alone.

Acceptance:
- `controller-summary.md` explains the stop decision.
- `codex-handoff.md` is enough for the next Codex pass to continue.
- `patch-request.json` stays the first follow-up file.
- `--resume-run <run-dir>` can reopen an existing run from persisted artifacts alone.
- `loop:single` can seed a one-attempt run that later resumes in a fresh process.
- Every run should persist `runtime/live-state.json`, `runtime/round-phase.json`, and `runtime/controller-lease.json`, and every committed round should checkpoint `summary.json` plus `current_best.json`.
- Resume should merge committed `round_summary.json` files back into controller history so missing or stale run summaries can be rebuilt from disk.
- `--repair` plus `--resume-phase <phase>` should repair interrupted rounds from persisted controller journals without forcing the controller to open extra rounds.
- Repair should also reconstruct missing pre/post capability aggregates from `round-###/adapter/*-result.json` plus missing core probe aggregates from `round-###/core-probes/*-result.json`, then rerun only the missing capability or probe slices.
- Resume identity mismatches fail closed by default when adapter contract, evaluator bundle, rubric fingerprint, target family, or validation lane changes.
- Each run persists `resume-identity.json`, and resume checks should prefer that artifact over reconstructed summary state when it exists.
- `--allow-resume-migration` writes a reviewable `resume-migration.json` plus summary fingerprints when a mismatch is intentionally accepted.
- Terminal runs (`target_reached`, `contract_completed`, `environment_blocked`, `adapter_contract_invalid`) should stay closed on default resume and only reopen when `--force-reopen-terminal` is set explicitly. `--allow-resume-migration` should not act as a hidden reopen override.
- Each evaluated attempt persists `failure-lineage.json`, and resumed runs restore that lineage instead of reconstructing controller state from patch requests alone.
- Resumed invocations should persist machine-readable `runtime_events[]` and `resume-decision.json`, so noop, continue, and reopen policy can be audited without parsing warning prose.
- Per-round summaries should also persist `decision_source`, so policy-snapshot decisions, hard rules, and default patch authority stay reviewable after resume.
- The runtime should separate `controller_mode = detached|attached` from `transport_mode = codex-exec|current-thread|app-server`, with detached currently reserved for crash-safe `codex-exec` execution and attached reserved for same-thread transports.
- Attached should default to `current-thread`, while `app-server` remains an explicit embedded background transport surface.
- Same-thread transports should fail closed at the shared Codex runtime boundary so no nested `runCodexCommand()` path can bypass policy, including subjective-quality review.
- `current-thread` should remain the stock Codex attached surface with explicit manual protocol files and manual-pause stop reasons across planner, contract-review, generator-plan, eval, and attached-generator handoffs, while `app-server` should persist live `thread/start`, `thread/read`, `thread/resume`, `thread/name/set`, `turn/start`, `turn/steer`, and `turn/interrupt` state instead of becoming another meaning of CLI `attached`.
- Every run should also project a single operator-facing surface artifact such as `runtime/operator-surface.json` / `.md`, so foreground current-thread, embedded app-server, and headless detached modes expose one honest status surface to humans and tooling.
- Operator-surface and transport-state should compute foreground ownership from actual thread binding, not from transport labels alone, so shell-launched current-thread runs report `manual-protocol` instead of pretending to be a stock Codex foreground thread.
- Operator-surface should also persist explicit worktree and continuation guidance such as `handoff_state`, `resume_skill`, `resume_command`, `requires_codex_app`, `worktree_id`, and `worktree_path`, so Codex app local/worktree/background surfaces can be resumed without guesswork.
- Operator-surface terminal states should clear stale handoff notes and publish closeout-oriented `next_action` text instead of leaking obsolete reattach or shell-resume guidance.
- App-visible `current-thread` surfaces should prefer skill-first continuation guidance such as `$attached-loop`, while CLI resume commands stay as explicit fallback for manual or shell-driven paths.
- App-visible `current-thread` continuation should fail closed outside the same bound Codex `thread_id` by default, with any shell fallback requiring an explicit downgrade flag so the ownership change is intentional and reviewable.
- Shell-launched `attached/current-thread` seeds should also fail closed by default unless a real bound `CODEX_THREAD_ID` is present, with explicit `manual-protocol` seeding requiring an intentional flag rather than silently opening a shell-owned attached run.
- The npm single-run front door should stay split explicitly between detached/headless (`loop:single`) and Codex-owned current-thread (`loop:single:codex`) or intentional shell manual-protocol (`loop:single:manual`) seeds, so repo scripts do not blur app ownership semantics.
- The Codex app front door should treat start/status/stop/resume as a dedicated `run_control` lane with `loop:start:codex`, `loop:start:bg`, `loop:start:manual`, and `loop:stop`, so loop ownership is explicit before execution starts.
- The same front door should also expose deterministic `run_control_action`, targeting, and canonical command guidance in both human-readable and JSON output, so higher-level Codex turns can dispatch without a second inference pass.
- Direct natural-language prompts such as `루프 시작`, `루프 시작 가능하냐?`, `현재 루프 상태`, and `run-### 상태 보여줘` should fast-path into `run_control` without depending on a high aggregate router score.
- The repo should expose key lane-centric skills through `agents/openai.yaml` and a repo-root local plugin manifest, so Codex app discovery starts from app-facing metadata rather than raw npm script knowledge.
- Same-thread bootstrap generator work should flow through persisted `attached-generator-task.json`, `attached-generator-prompt.md`, and `attached-generator-response.json` artifacts so current-thread and App Server surfaces can mutate without nested child Codex processes. App Server generator turns should honor task-local cwd, writable roots, and timeout budgets.
- The repo should expose phase-oriented foreground entrypoints such as `loop:status`, `loop:resume`, and `loop:phase`, so Codex app operators can inspect or re-enter a persisted run without memorizing raw `--resume-run` and `--resume-phase` flag combinations.
- Foreground entrypoints such as `loop:start:codex`, `loop:resume`, `loop:phase`, `loop:status`, and `--help` should reuse a bundled `dist/` build in installable ZIPs instead of forcing `npm ci` or TypeScript rebuilds before start, resume, phase re-entry, or inspection.
- Installable release ZIPs should be the documented Codex app artifact, with source archives treated as bootstrap-required developer inputs rather than zero-touch installs.
- Dist-missing source archives should not trigger local npm bootstrap from skill helpers or front-door wrappers unless the operator explicitly opts in.
- Product-build attached generator task artifacts should expose product-facing deliverables and release-gate selector requirements, not internal harness control-plane checks.
- Product-build generated verification profiles should preserve the requested product surface: browser-only builds must not inherit API probes, draft/persistence probes, or error-recovery probes unless intake explicitly asks for those surfaces or behaviors, and generated workflow selectors should be semantic-first with legacy selectors as fallbacks.
- App foreground starts without a stable `CODEX_THREAD_ID` should be allowed only as assumed-foreground starts with an explicit prepared `--run-id`, so unbound app skills cannot consume the wrong ready session.
- Validator-created runs should be isolated with `HARNESS_RUNS_DIRECTORY` instead of writing transient ready markers into the operator's real `evals/runs`.
- Outer-timeout prevention should live in a separate supervisor surface that can restart the controller from `--resume-run` state, survive launcher-shell death when detached, and discover the owned run through an explicit supervisor marker instead of newest-run guessing.
- The repo should expose a lightweight runtime dashboard for attached monitoring through `loop:ui`.
- Trusted environments should have a real `app-server` smoke validator in addition to the existing `codex exec` smoke, while developer hosts without a usable `codex` binary should remain `environment_blocked`.
- The live Codex gate should keep real binary availability separate from deterministic fake-Codex auth semantics, failing before strict smoke when `codex` is missing or `HARNESS_CODEX_BIN` is misconfigured.
- Validation acceptance should stay split into `validate:fast`, `validate:process`, `validate:core`, `validate:release`, `validate:source-archive-repro`, `validate:codex-live`, and `validate:external-adapter`, with process-control and source-archive reproducibility failures blocking release gates.
- Source and install archive candidates must exclude TypeScript incremental metadata, and build success must be backed by required compiled-output sentinels rather than TypeScript exit code alone.
- Operator-facing docs should present `loop:intent`, `loop:discover`, `loop:prepare`, `loop:start:codex`, `loop:continue`, and `loop:status` as the canonical path; lower-level runner, phase, family, and adapter commands remain internal, recovery, validation, or compatibility surfaces.
- Prepare should produce a run-local `evaluation-policy.generated.json` / `.md` with `project_kind`, evidence surfaces, strictness level 1-5, target score, and required custom dimensions.
- Each evaluated round should produce `scorecard.json` / `scorecard.md`, and required custom dimensions below their minimum should keep `target_reached` false even when total score passes.
- `loop:scorecards` should read scorecards from the runtime's actual `run/round-###/` directories and the compatibility `run/rounds/round-###/` layout.
- Scorecard gating should have a loop-level validation that proves generated scorecards, custom-dimension target blocking, eval-report threshold updates, and CLI display stay connected end to end.
- Intake should infer evidence surfaces for CLI tools, API services, libraries, agents, document artifacts, data pipelines, automation, and browser/mobile UI without making browser evidence the default for every target.
- Non-web targets should be able to close through evidence-appropriate release gates such as `shell_command`, `file_contains`, or `json_value` instead of requiring browser/API probes.
- `loop:status` should surface the latest scorecard and required custom-dimension failures so operators do not need to inspect raw round files first.

Validation:
- Inspect the latest run under `evals/runs`
- `npm run validate:process`
- `npm test`
- `npm run validate:release`
- `npm run validate:source-archive-repro`
- `npm run validate:transport-mode`
- `npm run validate:attached-resume-smoke`
- `npm run validate:cli-front-door`
- `npm run validate:status-supervisor-precedence`
- `npm run validate:late-result-restore`
- `npm run validate:app-server-generator-mainline`
- `npm run validate:app-server-interrupted-generator`
- `npm run validate:supervisor-timeout-prevention`
- `npm run validate:resume-smoke`
- `npm run validate:browser-only-no-api-probes`
- `npm run validate:semantic-workflow-selectors`
- `npm run validate:productization`
- `npm run validate:loop-scorecards`
- `npm run validate:scorecard-e2e-prepared-run`
- `npm run validate:non-web-e2e`

## M3. External adapter boundary

Goal:
Allow real build and QA execution without reintroducing product code into this repo.

Acceptance:
- The harness exposes explicit capability hooks for `prepare_target`, `apply_change`, `run_target`, `capture_evidence`, `run_checks`, and `grade_round`.
- The core runtime stays generic.
- Product-specific proof moves to the adapter side.
- The core rejects adapter success claims when the result schema is inconsistent or cited evidence paths do not exist.
- Successful `capture_evidence`, `run_checks`, and `grade_round` claims require at least one verifiable evidence path.
- Empty evidence files are rejected as meaningless proof.
- Successful proof claims must provide evidence item `kind` and `description` fields.
- Successful `run_checks` claims must link evidence to supported check ids.
- Successful `run_checks` and `grade_round` claims must provide grounded `criteria_results` that cite concrete evidence paths.
- Successful `run_checks` claims must link evidence to supported criterion ids as well as check ids.
- Adapter-attached target proof must carry a core-owned evaluator profile so criterion expectations live outside adapter-authored status strings.
- Adapter-attached target proof must also carry an independent `verification_provider`, so `capture_evidence`, `run_checks`, and `grade_round` do not execute in the same trust domain as target mutation.
- Successful `run_checks` and `grade_round` claims must provide `observed_value` fields that the core can compare against the verification profile.
- Successful `grade_round` claims must reference upstream `run_checks` or `capture_evidence` proof by capability and by concrete evidence path.
- Successful `grade_round` claims must provide `threshold_verdict`, keep `blocking_criterion_ids` consistent with failing criteria, and fail when grading contradicts earlier hard criteria without new grounded proof.
- Successful adapter-backed proof must include at least one verifier-produced live interaction artifact that is linked into criteria or grading.
- Successful adapter-backed proof must also include at least one structured `verification-witness` artifact that references the live interaction log and grounded verifier steps.
- Adapter-attached target proof must also configure evaluator-owned `core_probes`, so the core can generate independent target evidence instead of relying only on verifier-authored proof.
- Successful `run_target` may publish `target_manifest` URLs that release-gate probes can hit directly.
- Supporting probes may use `http`, `browser`, target-root files, target JSON probes, or `shell_command`, but required release-gate probes must use `http_json` or `browser_journey`.
- Required release-gate probes must declare `assertion_id`, use `semantic_level: "feature"` or `"workflow"`, and resolve through `target_manifest_key`.
- Profiles may set `minimum_feature_release_assertions`; when omitted, the harness defaults that requirement to `2`.
- Profiles may also set `minimum_assertion_tag_counts` so target families can require browser, API, persistence, or error-path release assertions by bundle policy.
- Hard release assertions must be covered by both verifier witness assertion ids and passing core-owned release-gate probe results.
- Evaluator profile ownership must live in the core through `rubric.evaluator_profile_path` or `--evaluator-profile`; adapter-authored profiles are ignored at runtime.
- Browser/API witness and release-gate requirements must come only from core-owned `expected_target_surfaces`, not from adapter-published optional surfaces alone.
- Core-owned evaluator profiles must declare expected target surfaces, and runs must fail when `run_target` omits a required `target_manifest` surface such as `app_url` or `api_base_url`.
- Core-owned evaluator bundles should be split by target family, with dedicated policy for API services, browser apps, and fullstack apps.
- The CLI should also support `--target-family <family>` so bundled evaluator packs can be selected without passing raw file paths.
- Run summaries should surface the resolved `validation_lane` so deterministic semantic packs stay separate from environment-integration packs.
- Run summaries should also persist machine-readable `round_history[].target_family`, `round_history[].validation_lane`, and `round_history[].round_stop_reason` so resume migration and explicit-profile audits do not depend only on handoff prose.
- Run summaries should also persist machine-readable `round_history[].decision_source` so reopen precedence remains auditable when hard rules diverge from weighted policy.
- Round handoff files should surface the resolved `target_family` and `validation_lane`, not only the bundle-selection defaults.
- The harness should provide a companion-repo smoke entrypoint instead of bundling a reference target into this repository.
- The companion-repo smoke entrypoint should also expose a preflight mode and an external bootstrap helper so operators can validate setup before they try a full seed-and-resume run.
- The companion-repo validation surface should split into strict validation, smoke, preflight, and a fully reproducible canonical companion path so operators know exactly what each command proves.
- The companion-repo validation surface should cover more than one family through canonical companions such as CRUD and chat, not only API-only examples.
- The companion-repo validation surface should also cover deterministic multi-round external convergence through canonical patch-only and recontract companion templates.
- The companion-repo validation surface should also ship a helper that installs strict harness validation into a real companion repository CI workflow without copying harness logic into that repo.
- The companion-repo validation surface should also ship a one-command bootstrap helper that scaffolds an independent sibling companion repo and installs the strict CI workflow without putting that target into this repository.
- That CI installer should derive the harness repository and ref from the current git checkout by default, with explicit overrides only when the operator asks for them.
- Executed proof capabilities must leave reviewable provenance through command, stdout, stderr, result, and evidence hashes.
- The core performs generic content inspection for text, JSON, image, and binary artifacts before it trusts adapter proof.

Validation:
- Adapter contract document and example config exist and do not require in-repo UI files
- `npm run validate:reference-adapter:check`
- `npm run validate:reference-adapter`
- `npm run validate:reference-adapter:canonical`
- `npm run validate:reference-adapter:canonical:patch-only`
- `npm run validate:reference-adapter:canonical:recontract`
- `npm run validate:reference-adapter:canonical:crud`
- `npm run validate:reference-adapter:canonical:crud:patch-only`
- `npm run validate:reference-adapter:canonical:crud:recontract`
- `npm run validate:reference-adapter:canonical:chat`
- `npm run validate:reference-adapter:canonical:chat:patch-only`
- `npm run validate:reference-adapter:canonical:chat:recontract`
- `npm run smoke:reference-adapter`

## M4. Thresholded release semantics

Goal:
Separate contract closure from target closure so scores, stop reasons, and release signals stay honest.

Acceptance:
- `eval_report.json` records `control_plane_score`, `proof_score`, `release_score`, and explicit threshold results.
- No-adapter runs can finish with `contract_completed` without claiming `target_reached`.
- Truthful adapter runs can still finish with `target_reached`.
- Low-score adapter runs must keep remediation open through `target_signal_thresholds_met` and stop at `max_rounds_reached` when the budget is exhausted.
- Adapter-attached threshold misses may extend beyond the initial build-attempt budget through the rubric's remediation budget, but must still stop honestly when that budget is exhausted.
- Contradictory or weakly grounded proof cannot keep a near-success `proof_score`; skeptical proof failures must cap the released score signal.
- Adapter-attached runs without a live verifier artifact are blocked from target closure.
- Adapter-attached runs without a required release-gate core probe are blocked before adapter execution.
- Adapter-attached runs with only supporting probes such as `shell_command` are blocked before adapter execution.
- Adapter-attached runs with liveness-only release-gate probes are blocked before adapter execution.
- Adapter-attached runs whose verifier witnesses do not cover hard release assertions fail `live_verification_present`.
- Adapter-attached runs with required release-gate probes that do not pass still fail `target_reached` eligibility even if verifier proof looks good.
- Adapter-attached runs without a verification profile are blocked before adapter execution.
- Adapter-attached runs without a rubric/CLI-selected core-owned evaluator profile are blocked before target-specific closure.
- Adapter-attached runs without an independent verification provider are blocked before adapter execution.
- Static adapter contract failures such as verifier/executor overlap stop immediately with `adapter_contract_invalid` instead of consuming remediation attempts.
- Deterministic semantic-validation fixtures should cover both `patch_only` recovery and `recontract` fallback, so lifecycle validation does not depend on interpreting generic low-score runs by hand.
- When both stop conditions apply at the end of the final round, `max_rounds_reached` wins over `plateau_limit_reached`.
- Concurrent launches claim distinct run directories so controller history does not collide.
- `summary.json` is terminal-first and records separate `best_scoring_*` fields for ranking-style consumers.
- `current_best.json` points at the terminal selected round and records separate `best_scoring_*` fields for ranking-style consumers.
- Core-owned evaluator bundles may override proof and release score composition through bundle-owned `score_policy`.
- The harness should provide direct validation coverage showing that two evaluator bundles can produce different target-closure outcomes for the same evidence because of `score_policy`.
- Evaluated rounds should also persist a structured `quality-critique.json` artifact, and that critique should stay aligned with threshold gaps even when no individual probe fails.
- `patch-request.json.must_fix` should promote only carry-forward-safe quality targets so patch-only remediation does not escalate into false scope drift or false release regression.
- Failure lineage should be a first-class persisted artifact that records release regressions, environment blockers, contradictory witness coverage, and unresolved signatures.
- Failure-lineage policy snapshots and controller decision surfaces should stay explicitly labeled when hard rules or default patch authority win over the weighted recommendation.
- Successful rounds should record `failure_classification = "none"` so clean closures are not mislabeled as product defects.
- Pure environment blockers should stop with `environment_blocked` instead of spending remediation budget on product repair.
- Explicit `--evaluator-profile` bundles should be able to carry `target_family` and `validation_lane` metadata directly so family/lane reporting stays intact without `--target-family`.
- Shipped explicit evaluator profiles should publish `target_family` and `validation_lane` metadata so direct profile-path runs do not fall back to `none / none`.
- Browser-editor and dashboard should each have a deterministic semantic validation lane separate from their environment-integration smoke lane.
- Browser-app and fullstack-app should also each have a deterministic semantic validation lane separate from their environment-integration smoke lane.
- Adapter-free launches should default to a neutral `generic-core` evaluator bundle instead of inheriting a product-biased family label from the rubric fallback.
- Deterministic semantic-family validators should assert controller-decision family/lane semantics and `failure_classification = "none"` on clean success rounds, not just stop reasons.
- Companion reference-adapter smoke should fail with an actionable setup checklist when the external wiring is missing.
- Companion reference-adapter smoke should also provide a clean preflight mode and a bootstrap script for external adapter scaffolding.
- Browser/fullstack realism preflight should write machine-readable readiness artifacts, not only throw human-readable errors.
- Browser-editor and dashboard realism should also offer dedicated preflight commands and machine-readable readiness artifacts, not only environment smoke.
- The repo should ship a standard browser-ready ops package such as a devcontainer and CI workflow for realism preflight.
- The repo should also ship a positive browser-ready realism workflow so the same packaged environment can prove green environment lanes, not only preflight readiness.
- Positive browser-ready realism should also leave separate machine-readable latest-state and latest-positive-state artifacts so local blocked smokes do not overwrite the latest known green packaged-environment evidence.
- Target-family acceptance packs should keep deepening beyond surface and liveness semantics into persistence, error-path, and workflow continuity checks such as draft restore, retry recovery, autosave restore, selection recovery, filter reset, and drilldown refresh continuity.

Validation:
- `npm run loop:single`
- `npm run loop:run -- 3`
- `npm run validate:lifecycle-api`
- `npm run validate:family-crud`
- `npm run validate:family-chat`
- `npm run validate:family-browser-semantic`
- `npm run validate:family-browser:preflight`
- `npm run validate:family-browser`
- `npm run validate:family-editor:preflight`
- `npm run validate:family-editor`
- `npm run validate:family-dashboard:preflight`
- `npm run validate:family-dashboard`
- `npm run validate:family-fullstack-semantic`
- `npm run validate:family-fullstack:preflight`
- `npm run validate:family-fullstack`
- `npm run validate:family-editor-semantic`
- `npm run validate:family-dashboard-semantic`
- `npm run validate:score-policy`
- `npm run validate:failure-policy`
- `npm run validate:quality-lift`
- `npm run validate:reference-adapter:check`
- `npm run validate:reference-adapter:canonical:crud`
- `npm run validate:reference-adapter:canonical:chat`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/truth/adapter.json --max-rounds 3`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/low-score/adapter.json --max-rounds 3`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/patch-only-success/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 3`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/patch-recontract/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 3`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/no-live/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/no-core-probe/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/contradictory/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/no-profile/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/no-verifier/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/overlap/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/shell-only/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/browser/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/liveness-only/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/witness-mismatch/adapter.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/truth/adapter.json --rubric ./.tmp/semantic-validation/rubric-without-profile.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/truth/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/truth/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/api-only-witness/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 1`
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/hidden-app-url/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile.json --max-rounds 1`

Operational note:
Repeated `loop:single` launches should allocate unique `evals/runs/run-###` directories even when they start at the same time.

## M5. Sprintless V2 Realignment

Goal:
Realign the runtime with Anthropic's sprintless V2 shape while preserving the skeptical evaluator hardening already added to the harness core.

Keep:
- Planner-owned spec expansion from short user input.
- File-based handoff and persisted controller history.
- `patch-request.json` as the central continuation surface.
- Skeptical proof gates: verification profile, verifier boundary, live proof, witness/provenance, and core-owned probes.

Delete:
- Fixed three-stage round playbook as a load-bearing runtime scaffold.
- Hard-coded round labels such as `contract scaffold`, `continuation and authority`, and `adapter boundary`.
- The assumption that success should advance through preplanned objectives before the run is allowed to stop.

Reshape:
- `round-###` directories remain, but they now represent build attempts and remediation attempts rather than planned sprints.
- The planner emits one build strategy plus remediation policy instead of a fixed multi-round playbook.
- The generator takes one long initial build attempt, and the evaluator reopens only bounded remediation attempts when skeptical checks or release thresholds fail.
- The controller keeps an active contract frame, defaults later rounds to `patch_only`, and opens `recontract` only when the patch request loses authority or remediation stalls.
- `recontract` should also open on richer evidence-based triggers such as release-gate regression, manifest-contract breakage, or scope drift rather than only on bare plateau counters.
- The controller should persist those reopen signals in `failure-lineage.json` so later resume, handoff, and review surfaces can explain why a round stayed patch-only or escalated to recontract.
- The controller should also persist `decision_source` alongside those signals so reviewers can distinguish weighted-policy decisions from hard rules or explicit legacy overrides.
- The controller should also persist `trajectory-decision.json` and promote `tighten`, `refine`, `pivot`, and `parallel_pivot` into explicit continuation policy rather than leaving pivot as critique-only metadata.
- `pivot` and `parallel_pivot` should reopen through `decision_source = "trajectory_policy"` and carry restart anchors such as `current_head`, `last_stable`, or `best_passing` into the next generator attempt.
- Remediation attempts stay patch-request-led and may advertise a lighter required-artifact surface than the first build attempt.
- Required target-closure probes must include assertion-based `release_gate` probes using `http_json` or `browser_journey` rather than relying only on target-root markers, `http` liveness checks, or `shell_command` diagnostics.
- `target_reached` policy ownership should live in the evaluator bundle, not in adapter.json.
- Clean remediation attempts may omit `contract-review.*` and `contract-agreement.*` on disk while keeping `round-contract`, `generator-plan`, `patch-request`, and `eval_report` authoritative.
- Environment-sensitive bundles should classify blocked browser or live-target probes as `environment_blocked` instead of silently turning them into generic product failures.
- Pure environment-blocked lanes should stop honestly with `stop_reason = "environment_blocked"` once the patch request says `hold`.
- Honest early stop is allowed on the first attempt for `contract_completed` or `target_reached`.

Validation:
- `npm run loop:run -- 3` should stop in one attempt with `contract_completed` when no adapter is attached.
- `npm run validate:lifecycle-api` should resolve `target-family` API bundles into the same deterministic patch-only and recontract flows the semantic fixtures expect.
- `npm run validate:resume-smoke` should seed a one-attempt run, reject resume identity mismatches by default, and then reach closure only after `--resume-run` reopens the same controller history.
- `npm run validate:resume-smoke` should also reject presence-change resumes such as no-adapter -> adapter unless `--allow-resume-migration` is explicitly accepted.
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/truth/adapter.json --max-rounds 3` should stop in one attempt with `target_reached`.
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/low-score/adapter.json --max-rounds 3` should reopen remediation attempts and stop honestly at `max_rounds_reached`.
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/patch-only-success/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 3` should force round 2 into `patch_only` and stop successfully without recontract.
- `npm run loop:run -- --adapter ./.tmp/semantic-validation/patch-recontract/adapter.json --evaluator-profile ./.tmp/semantic-validation/verification-profile-api-only.json --max-rounds 3` should force round 2 into `patch_only`, round 3 into `recontract`, and then recover honestly.
- `npm run validate:family-browser-semantic` should force browser-app success, patch-only, recontract, and hard-failure controller cases without depending on browser permissions.
- `npm run validate:family-fullstack-semantic` should do the same for fullstack-family controller cases.
- `npm run validate:family-editor-semantic` should force browser-editor success, patch-only, recontract, environment-blocked, and hard-failure controller cases without relying on browser permissions.
- `npm run validate:family-dashboard-semantic` should do the same for dashboard-family controller cases.
- `npm run validate:failure-policy` should prove that weighted policy, hard-rule stops, and labeled legacy overrides stay aligned with deterministic fixtures.

## M6. Intake-Driven Quality Lift

Goal:
Turn intake answers into evaluator-owned quality steering, and let stricter companion lanes push quality without breaking patch-only controller closure.

Acceptance:
- `loop:bootstrap` writes `rubric.generated.json` and `verification-profile.generated.json`, and the generated profile includes intake-derived `quality_contract.quality_axes`.
- Bootstrap intake should collect deeper quality intent, including must-not-break flows, failure expectations, continuity boundaries, reference signals, non-goals, optional probe hints, and optional user-defined subjective metrics with minimum required scores.
- Generated intake artifacts (`IDEA.md`, `intake.json`, runtime config, generated bundle) should preserve that deeper quality data rather than collapsing it into a shallow `qualityBar`.
- Generated browser/API probes should cover finish-line flow, error recovery, and continuity/persistence, including browser `reload` plus `assert_value` and negative assertions such as `assert_not_visible`.
- Bootstrap-generated `run_checks` and `grade_round` should consume harness-owned `core-probe-results.json` and `target-manifest.json` instead of re-running release probes independently, and they should express failed release criteria through `criteria_results`, `threshold_verdict`, and `blocking_criterion_ids` rather than `ok: false`.
- Runtime loading should preserve generated `quality_contract`, per-criterion and per-probe `quality_axis_id`, and `subjective_metrics` so critique and patch-request generation keep the same quality semantics the intake authored.
- Bootstrap-generated `apply_change` should inline the current round contract, generator plan, latest patch request, latest quality critique, and latest eval threshold gaps into the generator prompt so remediation rounds stay quality-aware.
- Generated evaluator bundles should preserve the selected family bundle as a base floor, merging family probes, criteria, and assertion-tag minima with the intake-derived overlay instead of replacing them.
- Bootstrap-generated `grade_round` should optionally run a fail-closed subjective judge for user-defined metrics, persist `subjective-quality-review.json`, publish `subjective_metric_results`, and turn required metric misses into blocking `grade_round` criteria.
- Each evaluated round should persist `quality-critique.json` with `remediation_strategy`, `quality_focus`, `preserve_signals`, and structured findings tied to threshold gaps, failed dimensions, or failed release-gate probes.
- Subjective metric failures should also surface as `quality-critique.json` findings and flow into `patch-request.json.quality_findings`, so later remediation rounds see concrete product-quality gaps instead of only generic score misses.
- `patch-request.json` should carry `quality_findings`, `must_preserve`, and `remediation_strategy`, but it must only promote carry-forward-safe target checks into `must_fix`.
- The repo should ship a companion strict-lane scaffold command that can derive a stricter evaluator bundle from a base bundle without requiring assertion tags or release assertions that the base bundle does not actually configure.
- The repo should ship a regression validator that proves:
  - a lenient bundle can close `target_reached` on the low-score fixture
  - a stricter external quality lane holds that same fixture open
  - intake-generated bundles publish richer quality axes and journey probes
  - patch-only remediation persists structured critique and patch-request quality surfaces
  - deep intake fields survive bootstrap artifact generation
  - subjective metric thresholds fail closed and become patch-request-visible quality findings

Validation:
- `npm run loop:bootstrap`
- `npm run validate:bootstrap-generator-fail-closed`
- `npm run validate:bootstrap-evidence-integrity`
- `npm run validate:bootstrap-deep-intake`
- `npm run validate:bootstrap-custom-quality-metrics`
- `npm run validate:bootstrap-profile-aware-verifier`
- `npm run validate:lifecycle-api`
- `npm run validate:family-browser-semantic`
- `npm run validate:family-fullstack-semantic`
- `npm run validate:failure-policy`
- `npm run validate:score-policy`
- `npm run validate:quality-lift`
- `npm run reference-adapter:scaffold-quality-lane -- --profile ./.tmp/semantic-validation/verification-profile-score-policy-lenient.json --out ./.tmp/external-quality-lane.json`

## M7. Session-Supervised Foreground App Builder

Goal:
Make product-build work feel like one Codex-owned foreground session: question
gate first, then prepare durable session artifacts, then continue execution and
review on the same thread.

Acceptance:
- The repo ships a dedicated `app-builder-loop` skill for session-supervised
  product-build work in the Codex app.
- The repo documents `runtime/build-brief.json` as the normalized product brief
  for the session.
- The repo documents `runtime/run-contract.json` as the session-level execution
  contract for the same-thread foreground loop.
- The exact field sets for both artifacts are locked in documentation and
  mirrored in `packages/loop-orchestrator/src/types.ts`.
- The session-level contract explicitly coexists with, and does not replace,
  attempt-level `round-###/round-contract.json`.
- The harness core writes `runtime/build-brief.json`,
  `runtime/run-contract.json`, `runtime/open-questions.json`,
  `runtime/session-status.json`, and `docs/EXECUTION_PLAN.md` as part of run
  initialization once discovery has
  produced a resumable plan.
- Those session surfaces refresh when round review feedback, human steering,
  or external blockers materially change the active session context.
- `runtime/session-status.json` is the normalized session-layer
  readiness/status artifact, and `runtime/operator-surface.json` should project
  that session layer directly instead of forcing UI consumers to infer it.
- `runtime/session-status.json` should also persist `attention_kind`,
  `active_checkpoint`, and `session_binding`, so supervisory clients can tell
  why the session stopped and whether it is still bound to the intended Codex
  thread or App Server turn.
- `runtime/session-status-events.jsonl` should persist append-only structured
  session-change events derived from the same source as `runtime/session-status.json`,
  and attached clients should be able to consume that stream directly.
- `runtime/session-stream.json` should persist the attached-session contract for
  snapshot path, source event path, preferred delivery mode, and widget-facing
  summary fields.
- App Server transport should mirror that source stream into
  `runtime/app-server-session-events.jsonl` as `harness/session.changed`
  notifications, so attached clients can subscribe without tailing files
  themselves.
- `loop:ui` should consume `runtime/session-status.json` as its first-class
  session feed, with `operator-surface.json.session` only as a compatibility
  fallback.
- `transport-state.json.ui_surface` should carry the same session snapshot path,
  session event-stream path, session-stream contract path, and normalized
  projection for attached App Server consumers, so embedded UI clients do not
  need to infer session state from mixed control-plane files.
- The operator-facing session vocabulary is fixed to `asking`, `preparing`,
  `ready_to_start`, `running`, `needs_steering`, `blocked_externally`,
  `ready_for_review`, and `done`.
- Intake completion should enter prepare directly: the staged intake gate should
  return `ready_for_prepare`, the surfaced phase should be `prepare`, and the
  same thread should stop at `ready_to_start` rather than showing a human
  confirmation hold or auto-starting into running.
- The skill instructs Codex to ask only the missing high-impact questions, ask
  at most 1 to 3 short questions per turn, and prefer defaults over low-value
  intake turns.
- The skill instructs Codex to prepare `runtime/build-brief.json`,
  `runtime/run-contract.json`, `runtime/operator-surface.json`,
  `runtime/open-questions.json`, `runtime/session-status.json`,
  `runtime/session-status-events.jsonl`, `runtime/session-stream.json`, and
  `docs/EXECUTION_PLAN.md` before heavy implementation, then stop at
  `ready_to_start` until the operator explicitly starts the loop.
- The skill treats automation as a later schedule layer, not as the front door
  for product-build work.

Validation:
- `docs/CODEX_SESSION_SUPERVISED_CLOSED_LOOP.md` exists and defines the exact
  `build-brief.json` and `run-contract.json` field sets.
- `.agents/skills/app-builder-loop/SKILL.md` exists and matches the
  question-gated same-thread workflow.
- `.agents/skills/app-builder-loop/agents/openai.yaml` exists for Codex app
  discovery.
- `npm run validate:session-preparation-artifacts` proves the emitted field
  set, path contract, execution-plan scaffold, and refresh behavior.
- `npm run validate:prepared-product-start-bundle` proves a `ready_to_start`
  product session carries its adapter/rubric/evaluator identity into
  `loop:start:codex` and refuses `generic-core` fallback.
- `npm run validate:prepared-product-start-bundle-recovery` proves that same
  product session keeps `runtime/run-contract.json.validation_bundle` through
  session refresh and summary-missing `--resume-run` recovery.
- `npm run validate:prepared-product-start-bundle-migration` proves those
  restored product bundles do not preempt explicit resume migrations, so
  `Resume identity mismatch` stays fail-closed by default and
  `--allow-resume-migration` refreshes the persisted bundle metadata.
- `npm run validate:prepared-session-consumption-boundary` proves that a
  started same-thread prepared session leaves `ready_to_start`, is no longer
  discoverable as a startable prepared candidate, and cannot be re-consumed by
  a later unbound current-thread start after its temporary bundle artifacts are
  gone.
- `npm run validate:loop-ui-session-status` proves the runtime dashboard
  prefers `runtime/session-status.json` over stale operator-surface session
  projections.
- `npm run validate:session-status-event-stream` proves session-change events
  append only on real session changes and stay aligned with the latest
  `runtime/session-status.json` snapshot.
- `npm run validate:app-server-session-stream` proves the app-server-native
  mirrored notification log stays aligned with the source session stream and
  that attached transport state points at the same session contract.
- `npm run build`
