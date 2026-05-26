const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const mode = process.argv[2] || "truth";
const capability = process.env.HARNESS_CAPABILITY;
const inputPath = process.env.HARNESS_INPUT_PATH;
const outputPath = process.env.HARNESS_OUTPUT_PATH;
const packet = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const proofDir = path.join(packet.round_directory, "adapter-proof");
const targetStateDir = path.join(packet.target_root, "target-state");
const targetRunMarkerPath = path.join(targetStateDir, "run_target.txt");
const latestItemPath = path.join(targetStateDir, "latest-item.json");
const targetManifestPath = path.join(targetStateDir, "target-manifest.json");
const semanticModePath = path.join(targetStateDir, "semantic-mode.txt");
fs.mkdirSync(proofDir, { recursive: true });
const isHollow = mode === "hollow";
const isLying = mode === "lying";
const isContradictory = mode === "contradictory";
const isNoLive = mode === "no-live";
const isWitnessMismatch = mode === "witness-mismatch";
const isApiOnlyWitness = mode === "api-only-witness";
const isHiddenAppUrl = mode === "hidden-app-url";
const isPatchOnlySuccess = mode === "patch-only-success";
const isPatchRecontract = mode === "patch-recontract";
const isCliSuccess = mode === "cli-success";
const isChatSuccess = mode === "chat-success";
const isChatPatchOnly = mode === "chat-patch-only";
const isChatRecontract = mode === "chat-recontract";
const isEditorSuccess = mode === "editor-success";
const isEditorPatchOnly = mode === "editor-patch-only";
const isEditorRecontract = mode === "editor-recontract";
const isEditorBlocked = mode === "editor-blocked";
const isDashboardSuccess = mode === "dashboard-success";
const isDashboardPatchOnly = mode === "dashboard-patch-only";
const isDashboardRecontract = mode === "dashboard-recontract";
const isDashboardBlocked = mode === "dashboard-blocked";
const isBrowserSuccess = mode === "browser-success";
const isBrowserPatchOnly = mode === "browser-patch-only";
const isBrowserRecontract = mode === "browser-recontract";
const isFullstackSuccess = mode === "fullstack-success";
const isFullstackPatchOnly = mode === "fullstack-patch-only";
const isFullstackRecontract = mode === "fullstack-recontract";
const semanticFamily =
  mode.startsWith("chat-")
    ? "chat"
    : mode.startsWith("browser-")
      ? "browser"
      : mode.startsWith("fullstack-")
        ? "fullstack"
    : mode.startsWith("editor-")
      ? "editor"
      : mode.startsWith("dashboard-")
        ? "dashboard"
        : "api";
const isLowScoreRound =
  mode === "low-score" ||
  (isPatchOnlySuccess && packet.round === 1) ||
  (isPatchRecontract && packet.round <= 2) ||
  (isChatPatchOnly && packet.round === 1) ||
  (isChatRecontract && packet.round <= 2) ||
  (isBrowserPatchOnly && packet.round === 1) ||
  (isBrowserRecontract && packet.round <= 2) ||
  (isFullstackPatchOnly && packet.round === 1) ||
  (isFullstackRecontract && packet.round <= 2) ||
  (isEditorPatchOnly && packet.round === 1) ||
  (isEditorRecontract && packet.round <= 2) ||
  (isDashboardPatchOnly && packet.round === 1) ||
  (isDashboardRecontract && packet.round <= 2);
const includeLiveVerification = !isNoLive;
const extension =
  capability === "capture_evidence"
    ? "png"
    : capability === "run_checks" || capability === "grade_round"
      ? "json"
      : "txt";
const evidencePath = path.join(proofDir, `${capability}.${extension}`);
const liveLogPath = path.join(proofDir, `${capability}-live.log`);
const witnessPath = path.join(proofDir, `${capability}-witness.json`);
const upstreamCapturePath = path.join(proofDir, "capture_evidence.png");
const upstreamCaptureLivePath = path.join(proofDir, "capture_evidence-live.log");
const upstreamCaptureWitnessPath = path.join(proofDir, "capture_evidence-witness.json");
const upstreamChecksPath = path.join(proofDir, "run_checks.json");
const upstreamChecksLivePath = path.join(proofDir, "run_checks-live.log");
const upstreamChecksWitnessPath = path.join(proofDir, "run_checks-witness.json");
const semanticFamilies = {
  api: {
    captureAssertionIds: ["ui_shell_renders"],
    checkAssertionIds: [
      "ui_shell_renders",
      "item_persists",
      "invalid_item_rejected",
      "collection_consistent",
      "idempotent_write_safe",
      "stale_write_rejected",
      "pagination_consistent"
    ],
    gradeAssertionIds: [
      "item_persists",
      "invalid_item_rejected",
      "collection_consistent",
      "idempotent_write_safe",
      "stale_write_rejected",
      "pagination_consistent"
    ],
    criteria: {
      ui_shell_renders: {
        criterion_id: "ui_shell_renders",
        assertion_id: "ui_shell_renders",
        hard: true,
        threshold: "Primary UI shell is visible in captured proof."
      },
      item_persists: {
        criterion_id: "item_persists",
        assertion_id: "item_persists",
        hard: true,
        threshold: "Latest created item is still persisted through the target API."
      },
      invalid_item_rejected: {
        criterion_id: "invalid_item_rejected",
        assertion_id: "invalid_item_rejected",
        hard: true,
        threshold: "Invalid item requests are rejected through the target API."
      },
      collection_consistent: {
        criterion_id: "collection_consistent",
        assertion_id: "collection_consistent",
        hard: true,
        threshold: "Canonical item summary remains internally consistent."
      },
      idempotent_write_safe: {
        criterion_id: "idempotent_write_safe",
        assertion_id: "idempotent_write_safe",
        hard: true,
        threshold: "Idempotent write behavior remains stable across repeated requests."
      },
      stale_write_rejected: {
        criterion_id: "stale_write_rejected",
        assertion_id: "stale_write_rejected",
        hard: true,
        threshold: "Stale write attempts are rejected explicitly instead of silently overwriting newer state."
      },
      pagination_consistent: {
        criterion_id: "pagination_consistent",
        assertion_id: "pagination_consistent",
        hard: true,
        threshold: "Paginated API results remain stable across repeated reads."
      }
    },
    observedValues: {
      ui_shell_renders: "visible",
      item_persists: "persisted",
      invalid_item_rejected: "rejected",
      collection_consistent: "consistent",
      idempotent_write_safe: "idempotent",
      stale_write_rejected: "stale_rejected",
      pagination_consistent: "stable"
    }
  },
  chat: {
    captureAssertionIds: ["grounded_reply"],
    checkAssertionIds: [
      "grounded_reply",
      "invalid_tool_call_rejected",
      "conversation_memory_preserved",
      "unsafe_tool_request_blocked",
      "refusal_fallback_safe",
      "tool_trace_persisted"
    ],
    gradeAssertionIds: [
      "grounded_reply",
      "conversation_memory_preserved",
      "unsafe_tool_request_blocked",
      "refusal_fallback_safe",
      "tool_trace_persisted"
    ],
    criteria: {
      grounded_reply: {
        criterion_id: "grounded_reply",
        assertion_id: "grounded_reply",
        hard: true,
        threshold: "Latest assistant response stays grounded in tool evidence."
      },
      invalid_tool_call_rejected: {
        criterion_id: "invalid_tool_call_rejected",
        assertion_id: "invalid_tool_call_rejected",
        hard: true,
        threshold: "Invalid tool requests are rejected explicitly."
      },
      conversation_memory_preserved: {
        criterion_id: "conversation_memory_preserved",
        assertion_id: "conversation_memory_preserved",
        hard: true,
        threshold: "Conversation memory remains preserved across the latest tool-backed turn."
      },
      unsafe_tool_request_blocked: {
        criterion_id: "unsafe_tool_request_blocked",
        assertion_id: "unsafe_tool_request_blocked",
        hard: true,
        threshold: "Unsafe tool requests are blocked explicitly."
      },
      refusal_fallback_safe: {
        criterion_id: "refusal_fallback_safe",
        assertion_id: "refusal_fallback_safe",
        hard: true,
        threshold: "Refusal fallback remains safe and explicit for unsupported requests."
      },
      tool_trace_persisted: {
        criterion_id: "tool_trace_persisted",
        assertion_id: "tool_trace_persisted",
        hard: true,
        threshold: "Tool trace metadata persists across the latest grounded turn."
      }
    },
    observedValues: {
      grounded_reply: "grounded",
      invalid_tool_call_rejected: "rejected",
      conversation_memory_preserved: "preserved",
      unsafe_tool_request_blocked: "blocked",
      refusal_fallback_safe: "safe_refusal",
      tool_trace_persisted: "persisted"
    }
  },
  browser: {
    captureAssertionIds: ["ui_shell_renders"],
    checkAssertionIds: [
      "ui_shell_renders",
      "invalid_form_rejected",
      "draft_persists",
      "navigation_state_preserved",
      "refresh_state_persisted",
      "submission_roundtrip_consistent",
      "draft_restore_after_refresh"
    ],
    gradeAssertionIds: [
      "draft_persists",
      "navigation_state_preserved",
      "refresh_state_persisted",
      "submission_roundtrip_consistent",
      "draft_restore_after_refresh"
    ],
    criteria: {
      ui_shell_renders: {
        criterion_id: "ui_shell_renders",
        assertion_id: "ui_shell_renders",
        hard: true,
        threshold: "Browser shell remains visible."
      },
      invalid_form_rejected: {
        criterion_id: "invalid_form_rejected",
        assertion_id: "invalid_form_rejected",
        hard: true,
        threshold: "Invalid browser flows surface an explicit rejection state."
      },
      draft_persists: {
        criterion_id: "draft_persists",
        assertion_id: "draft_persists",
        hard: true,
        threshold: "Browser draft state persists across the workflow."
      },
      navigation_state_preserved: {
        criterion_id: "navigation_state_preserved",
        assertion_id: "navigation_state_preserved",
        hard: true,
        threshold: "Navigation state stays continuous across the browser workflow."
      },
      refresh_state_persisted: {
        criterion_id: "refresh_state_persisted",
        assertion_id: "refresh_state_persisted",
        hard: true,
        threshold: "Browser state survives a refresh without losing the active draft."
      },
      submission_roundtrip_consistent: {
        criterion_id: "submission_roundtrip_consistent",
        assertion_id: "submission_roundtrip_consistent",
        hard: true,
        threshold: "Submission roundtrip state remains consistent across browser interactions."
      },
      draft_restore_after_refresh: {
        criterion_id: "draft_restore_after_refresh",
        assertion_id: "draft_restore_after_refresh",
        hard: true,
        threshold: "Browser draft state restores cleanly after a refresh boundary."
      }
    },
    observedValues: {
      ui_shell_renders: "visible",
      invalid_form_rejected: "rejected",
      draft_persists: "persisted",
      navigation_state_preserved: "preserved",
      refresh_state_persisted: "persisted",
      submission_roundtrip_consistent: "consistent",
      draft_restore_after_refresh: "restored"
    }
  },
  fullstack: {
    captureAssertionIds: ["ui_shell_renders"],
    checkAssertionIds: [
      "ui_shell_renders",
      "item_persists",
      "invalid_item_rejected",
      "session_state_persists",
      "browser_api_roundtrip_consistent",
      "refresh_state_persisted",
      "mutation_audit_recorded",
      "retry_recovery_persisted",
      "audit_refresh_consistent"
    ],
    gradeAssertionIds: [
      "item_persists",
      "session_state_persists",
      "browser_api_roundtrip_consistent",
      "refresh_state_persisted",
      "mutation_audit_recorded",
      "retry_recovery_persisted",
      "audit_refresh_consistent"
    ],
    criteria: {
      ui_shell_renders: {
        criterion_id: "ui_shell_renders",
        assertion_id: "ui_shell_renders",
        hard: true,
        threshold: "Primary UI shell is visible in captured proof."
      },
      item_persists: {
        criterion_id: "item_persists",
        assertion_id: "item_persists",
        hard: true,
        threshold: "Latest created item is still persisted through the target API."
      },
      invalid_item_rejected: {
        criterion_id: "invalid_item_rejected",
        assertion_id: "invalid_item_rejected",
        hard: true,
        threshold: "Invalid item requests are rejected through the target API."
      },
      session_state_persists: {
        criterion_id: "session_state_persists",
        assertion_id: "session_state_persists",
        hard: true,
        threshold: "Session state persists across the fullstack workflow."
      },
      browser_api_roundtrip_consistent: {
        criterion_id: "browser_api_roundtrip_consistent",
        assertion_id: "browser_api_roundtrip_consistent",
        hard: true,
        threshold: "Browser-to-API roundtrip state remains consistent."
      },
      refresh_state_persisted: {
        criterion_id: "refresh_state_persisted",
        assertion_id: "refresh_state_persisted",
        hard: true,
        threshold: "Refresh retains the persisted fullstack session state."
      },
      mutation_audit_recorded: {
        criterion_id: "mutation_audit_recorded",
        assertion_id: "mutation_audit_recorded",
        hard: true,
        threshold: "Mutation audit records stay attached to the workflow state."
      },
      retry_recovery_persisted: {
        criterion_id: "retry_recovery_persisted",
        assertion_id: "retry_recovery_persisted",
        hard: true,
        threshold: "Retry recovery keeps the fullstack session state coherent."
      },
      audit_refresh_consistent: {
        criterion_id: "audit_refresh_consistent",
        assertion_id: "audit_refresh_consistent",
        hard: true,
        threshold: "Mutation audit continuity survives a refresh boundary."
      }
    },
    observedValues: {
      ui_shell_renders: "visible",
      item_persists: "persisted",
      invalid_item_rejected: "rejected",
      session_state_persists: "persisted",
      browser_api_roundtrip_consistent: "consistent",
      refresh_state_persisted: "persisted",
      mutation_audit_recorded: "recorded",
      retry_recovery_persisted: "recovered",
      audit_refresh_consistent: "consistent"
    }
  },
  editor: {
    captureAssertionIds: ["editor_shell_renders"],
    checkAssertionIds: [
      "editor_shell_renders",
      "invalid_editor_flow_rejected",
      "undo_redo_available",
      "selection_state_persisted",
      "redo_state_available",
      "autosave_persisted",
      "invalid_selection_blocked",
      "autosave_restore_after_refresh",
      "selection_recovery_after_invalid_mutation"
    ],
    gradeAssertionIds: [
      "undo_redo_available",
      "selection_state_persisted",
      "redo_state_available",
      "autosave_persisted",
      "invalid_selection_blocked",
      "autosave_restore_after_refresh",
      "selection_recovery_after_invalid_mutation"
    ],
    criteria: {
      editor_shell_renders: {
        criterion_id: "editor_shell_renders",
        assertion_id: "editor_shell_renders",
        hard: true,
        threshold: "Editor shell and canvas remain visible."
      },
      invalid_editor_flow_rejected: {
        criterion_id: "invalid_editor_flow_rejected",
        assertion_id: "invalid_editor_flow_rejected",
        hard: true,
        threshold: "Invalid editor flows surface a visible error state."
      },
      undo_redo_available: {
        criterion_id: "undo_redo_available",
        assertion_id: "undo_redo_available",
        hard: true,
        threshold: "Undo and redo affordances remain available."
      },
      selection_state_persisted: {
        criterion_id: "selection_state_persisted",
        assertion_id: "selection_state_persisted",
        hard: true,
        threshold: "Selection state persists across edits."
      },
      redo_state_available: {
        criterion_id: "redo_state_available",
        assertion_id: "redo_state_available",
        hard: true,
        threshold: "Redo affordance remains available after multi-step edits."
      },
      autosave_persisted: {
        criterion_id: "autosave_persisted",
        assertion_id: "autosave_persisted",
        hard: true,
        threshold: "Editor autosave persists the active document state."
      },
      invalid_selection_blocked: {
        criterion_id: "invalid_selection_blocked",
        assertion_id: "invalid_selection_blocked",
        hard: true,
        threshold: "Invalid selection mutations are blocked explicitly."
      },
      autosave_restore_after_refresh: {
        criterion_id: "autosave_restore_after_refresh",
        assertion_id: "autosave_restore_after_refresh",
        hard: true,
        threshold: "Editor autosave restores the latest draft after refresh."
      },
      selection_recovery_after_invalid_mutation: {
        criterion_id: "selection_recovery_after_invalid_mutation",
        assertion_id: "selection_recovery_after_invalid_mutation",
        hard: true,
        threshold: "Selection state recovers after an invalid editor mutation."
      }
    },
    observedValues: {
      editor_shell_renders: "visible",
      invalid_editor_flow_rejected: "rejected",
      undo_redo_available: "available",
      selection_state_persisted: "preserved",
      redo_state_available: "available",
      autosave_persisted: "persisted",
      invalid_selection_blocked: "blocked",
      autosave_restore_after_refresh: "restored",
      selection_recovery_after_invalid_mutation: "recovered"
    }
  },
  dashboard: {
    captureAssertionIds: ["dashboard_shell_renders"],
    checkAssertionIds: [
      "dashboard_shell_renders",
      "metrics_consistent",
      "invalid_filter_rejected",
      "time_range_consistent",
      "filter_state_persisted",
      "aggregation_correct",
      "drilldown_continuity",
      "filter_reset_restored",
      "drilldown_refresh_preserved"
    ],
    gradeAssertionIds: [
      "metrics_consistent",
      "time_range_consistent",
      "filter_state_persisted",
      "aggregation_correct",
      "drilldown_continuity",
      "filter_reset_restored",
      "drilldown_refresh_preserved"
    ],
    criteria: {
      dashboard_shell_renders: {
        criterion_id: "dashboard_shell_renders",
        assertion_id: "dashboard_shell_renders",
        hard: true,
        threshold: "Dashboard shell and data grid remain visible."
      },
      metrics_consistent: {
        criterion_id: "metrics_consistent",
        assertion_id: "metrics_consistent",
        hard: true,
        threshold: "Summary metrics stay internally consistent."
      },
      invalid_filter_rejected: {
        criterion_id: "invalid_filter_rejected",
        assertion_id: "invalid_filter_rejected",
        hard: true,
        threshold: "Invalid dashboard filters are rejected explicitly."
      },
      time_range_consistent: {
        criterion_id: "time_range_consistent",
        assertion_id: "time_range_consistent",
        hard: true,
        threshold: "Time-range state remains consistent across dashboard panels."
      },
      filter_state_persisted: {
        criterion_id: "filter_state_persisted",
        assertion_id: "filter_state_persisted",
        hard: true,
        threshold: "Dashboard filter state remains persisted across panel refreshes."
      },
      aggregation_correct: {
        criterion_id: "aggregation_correct",
        assertion_id: "aggregation_correct",
        hard: true,
        threshold: "Dashboard aggregations stay correct for the active slice."
      },
      drilldown_continuity: {
        criterion_id: "drilldown_continuity",
        assertion_id: "drilldown_continuity",
        hard: true,
        threshold: "Drilldown continuity remains stable across panel transitions."
      },
      filter_reset_restored: {
        criterion_id: "filter_reset_restored",
        assertion_id: "filter_reset_restored",
        hard: true,
        threshold: "Dashboard filter reset restores a coherent default slice."
      },
      drilldown_refresh_preserved: {
        criterion_id: "drilldown_refresh_preserved",
        assertion_id: "drilldown_refresh_preserved",
        hard: true,
        threshold: "Dashboard drilldown context survives refresh boundaries."
      }
    },
    observedValues: {
      dashboard_shell_renders: "visible",
      metrics_consistent: "consistent",
      invalid_filter_rejected: "rejected",
      time_range_consistent: "consistent",
      filter_state_persisted: "persisted",
      aggregation_correct: "correct",
      drilldown_continuity: "continuous",
      filter_reset_restored: "restored",
      drilldown_refresh_preserved: "preserved"
    }
  }
};
const familyConfig = semanticFamilies[semanticFamily];
const criteria = familyConfig.criteria;
const observedValueFor = (criterionId, capabilityName) => {
  if (mode === "contradictory") {
    return "missing";
  }

  if (familyConfig.observedValues[criterionId]) {
    return familyConfig.observedValues[criterionId];
  }
  return capabilityName;
};

const witnessAssertionIdsFor = (kind) => {
  if (isWitnessMismatch) {
    return ["mismatched_assertion"];
  }

  if (kind === "capture") {
    return familyConfig.captureAssertionIds;
  }

  if (kind === "checks") {
    return familyConfig.checkAssertionIds;
  }

  if (kind === "grade") {
    return familyConfig.gradeAssertionIds;
  }

  return [];
};

const witnessModeFor = (kind) => {
  if (isCliSuccess) {
    return "shell";
  }

  if (isApiOnlyWitness || semanticFamily === "chat") {
    return "api";
  }

  if (kind === "grade") {
    return "api";
  }

  return "browser";
};

const targetReferenceFor = (kind) => {
  if (isApiOnlyWitness || semanticFamily === "chat") {
    return "latest-item";
  }

  if (kind === "grade") {
    return semanticFamily === "dashboard"
      ? "metrics-summary"
      : semanticFamily === "editor"
        ? "editor-state"
        : "latest-item";
  }

  return semanticFamily === "dashboard"
    ? "dashboard-shell"
    : semanticFamily === "editor"
      ? "editor-shell"
      : "app-shell";
};

const usesCaptureEvidence = (criterionId) =>
  criterionId.includes("shell_renders") || criterionId === "ui_shell_renders";

const runChecksSummaryFor = (criterionId) =>
  isContradictory
    ? `${criterionId} was intentionally marked as failed for contradiction testing.`
    : `run_checks observed '${criterionId}' in semantic ${semanticFamily} mode.`;

const gradeSummaryFor = (criterionId) =>
  isContradictory
    ? `grade_round intentionally marks '${criterionId}' as failed.`
    : `grade_round preserved '${criterionId}' in semantic ${semanticFamily} mode.`;

const sleep = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const launchDetachedServer = (serverScriptPath, stateDirectory, manifestFilePath) => {
  const child = spawn(process.execPath, [serverScriptPath, stateDirectory, manifestFilePath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
};

const waitForFile = (filePath, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
    sleep(50);
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
};

if (isLying) {
  // Intentionally skip writing the file so the harness sees a fake claim.
} else if (isHollow) {
  fs.writeFileSync(evidencePath, "");
  if (
    includeLiveVerification &&
    (capability === "capture_evidence" || capability === "run_checks" || capability === "grade_round")
  ) {
    fs.writeFileSync(liveLogPath, "");
  }
} else if (capability === "capture_evidence") {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.writeFileSync(evidencePath, Buffer.concat([pngSignature, Buffer.alloc(2048, 1)]));
  if (includeLiveVerification) {
    fs.writeFileSync(
      liveLogPath,
      [
        `provider=${process.env.HARNESS_PROVIDER_ID}`,
        `role=${process.env.HARNESS_PROVIDER_ROLE}`,
        `capability=${capability}`,
        `round=${packet.round}`,
        "action=open target",
        "action=wait for shell",
        "action=capture screenshot"
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      witnessPath,
      JSON.stringify(
        {
          witness_id: `${process.env.HARNESS_PROVIDER_ID}-${capability}-${packet.round}`,
          provider_id: process.env.HARNESS_PROVIDER_ID,
          provider_role: process.env.HARNESS_PROVIDER_ROLE,
          capability,
          mode: witnessModeFor("capture"),
          target_root: process.env.HARNESS_TARGET_ROOT,
          target_reference: targetReferenceFor("capture"),
          interaction_log_path: liveLogPath,
          assertion_ids: witnessAssertionIdsFor("capture"),
          steps: [
            {
              action: "open target shell",
              outcome: "pass",
              artifact_paths: [liveLogPath]
            },
            {
              action: "capture target screenshot",
              outcome: "pass",
              artifact_paths: [evidencePath, liveLogPath]
            }
          ]
        },
        null,
        2
      )
    );
  }
} else if (capability === "run_checks") {
  fs.writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        capability,
        round: packet.round,
        supported_checks: [
          "adapter_execution_healthy",
          "adapter_evidence_is_meaningful"
        ],
        supported_criteria: Object.keys(criteria),
        mode
      },
      null,
      2
    )
  );
  if (includeLiveVerification) {
    fs.writeFileSync(
      liveLogPath,
      [
        `provider=${process.env.HARNESS_PROVIDER_ID}`,
        `role=${process.env.HARNESS_PROVIDER_ROLE}`,
        `capability=${capability}`,
        `round=${packet.round}`,
        "action=inspect rendered shell",
        "action=verify structured round record",
        "action=record criterion observations"
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      witnessPath,
      JSON.stringify(
        {
          witness_id: `${process.env.HARNESS_PROVIDER_ID}-${capability}-${packet.round}`,
          provider_id: process.env.HARNESS_PROVIDER_ID,
          provider_role: process.env.HARNESS_PROVIDER_ROLE,
          capability,
          mode: witnessModeFor("checks"),
          target_root: process.env.HARNESS_TARGET_ROOT,
          target_reference: targetReferenceFor("checks"),
          interaction_log_path: liveLogPath,
          assertion_ids: witnessAssertionIdsFor("checks"),
          steps: [
            {
              action: "inspect rendered shell",
              outcome: "pass",
              artifact_paths: [upstreamCapturePath, liveLogPath]
            },
            {
              action: "record structured criterion observations",
              outcome: "pass",
              artifact_paths: [evidencePath, liveLogPath]
            }
          ]
        },
        null,
        2
      )
    );
  }
} else if (capability === "grade_round") {
  fs.writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        capability,
        round: packet.round,
        score: isLowScoreRound ? 0.1 : 0.98,
        derived_from: [upstreamCapturePath, upstreamChecksPath],
        mode
      },
      null,
      2
    )
  );
  if (includeLiveVerification) {
    fs.writeFileSync(
      liveLogPath,
      [
        `provider=${process.env.HARNESS_PROVIDER_ID}`,
        `role=${process.env.HARNESS_PROVIDER_ROLE}`,
        `capability=${capability}`,
        `round=${packet.round}`,
        "action=request latest item from target API",
        "action=request invalid item path from target API",
        "action=confirm persisted title matches expected workflow output",
        "action=record release verdict inputs"
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      witnessPath,
      JSON.stringify(
        {
          witness_id: `${process.env.HARNESS_PROVIDER_ID}-${capability}-${packet.round}`,
          provider_id: process.env.HARNESS_PROVIDER_ID,
          provider_role: process.env.HARNESS_PROVIDER_ROLE,
          capability,
          mode: witnessModeFor("grade"),
          target_root: process.env.HARNESS_TARGET_ROOT,
          target_reference: targetReferenceFor("grade"),
          interaction_log_path: liveLogPath,
          assertion_ids: witnessAssertionIdsFor("grade"),
          steps: [
            {
              action: "request latest item from target API",
              outcome: "pass",
              artifact_paths: [liveLogPath]
            },
            {
              action: "request invalid item path from target API",
              outcome: "pass",
              artifact_paths: [liveLogPath]
            },
            {
              action: "confirm persisted title matches expected workflow output",
              outcome: "pass",
              artifact_paths: [evidencePath, liveLogPath]
            }
          ]
        },
        null,
        2
      )
    );
  }
} else {
  fs.writeFileSync(evidencePath, `${capability} evidence for round ${packet.round}\n`, "utf8");
}
let targetManifest;
if (capability === "run_target" && !isLying) {
  fs.mkdirSync(targetStateDir, { recursive: true });
  fs.writeFileSync(semanticModePath, mode, "utf8");
  fs.writeFileSync(
    targetRunMarkerPath,
    isHollow ? "" : `run_target evidence for round ${packet.round}\n`,
    "utf8"
  );
  fs.writeFileSync(
    latestItemPath,
    JSON.stringify(
      {
        id: `smoke-item-${packet.round}`,
        title: "Smoke Item",
        status:
          isContradictory
            ? "missing"
            : isEditorBlocked || isDashboardBlocked
              ? "blocked"
            : semanticFamily === "chat"
              ? "grounded"
              : semanticFamily === "dashboard"
                ? "consistent"
                : semanticFamily === "editor"
                  ? "available"
                  : "persisted"
      },
      null,
      2
    ),
    "utf8"
  );
  if (fs.existsSync(targetManifestPath)) {
    fs.unlinkSync(targetManifestPath);
  }
  const serverScriptPath = path.join(__dirname, "target-server.cjs");
  launchDetachedServer(serverScriptPath, targetStateDir, targetManifestPath);
  targetManifest = JSON.parse(waitForFile(targetManifestPath, 15000));
  if (isHiddenAppUrl) {
    delete targetManifest.app_url;
  }
}
const result = {
  capability,
  ok: true,
  summary: `${capability} completed in ${mode} mode.`,
  findings: [],
  evidence_paths:
    capability === "capture_evidence"
      ? includeLiveVerification
        ? [evidencePath, liveLogPath, witnessPath]
        : [evidencePath]
      : capability === "run_checks"
        ? includeLiveVerification
          ? [
              evidencePath,
              liveLogPath,
              witnessPath,
              upstreamCapturePath,
              upstreamCaptureLivePath,
              upstreamCaptureWitnessPath
            ]
          : [evidencePath, upstreamCapturePath]
      : capability === "grade_round"
        ? includeLiveVerification
          ? [
              evidencePath,
              liveLogPath,
              witnessPath,
              upstreamChecksPath,
              upstreamChecksLivePath,
              upstreamChecksWitnessPath,
              upstreamCapturePath,
              upstreamCaptureLivePath,
              upstreamCaptureWitnessPath
            ]
          : [evidencePath, upstreamChecksPath, upstreamCapturePath]
        : [evidencePath],
  evidence_items: [
    {
      path: isLying ? path.join(proofDir, `${capability}-missing.${extension}`) : evidencePath,
      kind: capability === "capture_evidence" ? "screenshot" : capability === "grade_round" ? "report" : "log",
      description: `${capability} evidence in ${mode} mode.`
    }
  ]
};
if (capability === "run_target" && targetManifest) {
  result.target_manifest = targetManifest;
}
if (capability === "capture_evidence" && includeLiveVerification) {
  result.evidence_items.push({
    path: isLying ? path.join(proofDir, "capture_evidence-live-missing.log") : liveLogPath,
    kind: "interaction-log",
    description: `live verifier interaction log for ${capability} in ${mode} mode.`,
    supports_check_ids: ["live_verification_present"],
    supports_criterion_ids: familyConfig.captureAssertionIds
  });
  result.evidence_items.push({
    path: isLying ? path.join(proofDir, "capture_evidence-witness-missing.json") : witnessPath,
    kind: "verification-witness",
    description: `structured verification witness for ${capability} in ${mode} mode.`,
    supports_check_ids: ["live_verification_present"],
    supports_criterion_ids: familyConfig.captureAssertionIds
  });
}
if (capability === "run_checks") {
  result.evidence_items.push({
    path: isLying ? path.join(proofDir, "capture_evidence-missing.png") : upstreamCapturePath,
    kind: "screenshot",
    description: `capture evidence referenced by ${capability} in ${mode} mode.`
  });
  if (includeLiveVerification) {
    result.evidence_items.push({
      path: isLying ? path.join(proofDir, "run_checks-live-missing.log") : liveLogPath,
      kind: "interaction-log",
      description: `live verifier interaction log for ${capability} in ${mode} mode.`,
      supports_check_ids: ["live_verification_present", "adapter_evidence_is_meaningful"],
      supports_criterion_ids: familyConfig.checkAssertionIds
    });
    result.evidence_items.push({
      path: isLying ? path.join(proofDir, "run_checks-witness-missing.json") : witnessPath,
      kind: "verification-witness",
      description: `structured verification witness for ${capability} in ${mode} mode.`,
      supports_check_ids: ["live_verification_present"],
      supports_criterion_ids: familyConfig.checkAssertionIds
    });
    result.evidence_items.push({
      path: isLying ? path.join(proofDir, "capture_evidence-live-missing.log") : upstreamCaptureLivePath,
      kind: "interaction-log",
      description: `upstream live verifier interaction log referenced by ${capability} in ${mode} mode.`
    });
    result.evidence_items.push({
      path: isLying ? path.join(proofDir, "capture_evidence-witness-missing.json") : upstreamCaptureWitnessPath,
      kind: "verification-witness",
      description: `upstream verification witness referenced by ${capability} in ${mode} mode.`
    });
  }
}
if (capability === "run_checks") {
  result.evidence_items[0].supports_check_ids = ["adapter_execution_healthy", "adapter_evidence_is_meaningful"];
  result.evidence_items[0].supports_criterion_ids = familyConfig.checkAssertionIds;
  result.evidence_items[1].supports_criterion_ids = familyConfig.captureAssertionIds;
  result.criteria_results = familyConfig.checkAssertionIds.map((criterionId) => ({
    ...criteria[criterionId],
    status: isContradictory ? "fail" : "pass",
    summary: runChecksSummaryFor(criterionId),
    evidence_paths: usesCaptureEvidence(criterionId)
      ? includeLiveVerification
        ? [
            isLying ? path.join(proofDir, "capture_evidence-missing.png") : upstreamCapturePath,
            isLying ? path.join(proofDir, "capture_evidence-live-missing.log") : upstreamCaptureLivePath
          ]
        : [isLying ? path.join(proofDir, "capture_evidence-missing.png") : upstreamCapturePath]
      : includeLiveVerification
        ? [
            isLying ? path.join(proofDir, "run_checks-missing.json") : evidencePath,
            isLying ? path.join(proofDir, "run_checks-live-missing.log") : liveLogPath
          ]
        : [isLying ? path.join(proofDir, "run_checks-missing.json") : evidencePath],
    observed_value: observedValueFor(criterionId, capability)
  }));
}
if (capability === "grade_round") {
  result.score = isLowScoreRound ? 0.1 : 0.98;
  result.overall_verdict = "advance";
  result.threshold_verdict = "pass";
  result.evidence_items.push(
    ...(includeLiveVerification
      ? [
          {
            path: isLying ? path.join(proofDir, "grade_round-live-missing.log") : liveLogPath,
            kind: "api-log",
            description: `live verifier API log for ${capability} in ${mode} mode.`,
            supports_check_ids: ["live_verification_present", "adapter_evidence_is_meaningful"],
            supports_criterion_ids: familyConfig.gradeAssertionIds
          },
          {
            path: isLying ? path.join(proofDir, "grade_round-witness-missing.json") : witnessPath,
            kind: "verification-witness",
            description: `structured verification witness for ${capability} in ${mode} mode.`,
            supports_check_ids: ["live_verification_present"],
            supports_criterion_ids: familyConfig.gradeAssertionIds
          }
        ]
      : []),
    {
      path: isLying ? path.join(proofDir, "run_checks-missing.json") : upstreamChecksPath,
      kind: "log",
      description: `run_checks evidence referenced by ${capability} in ${mode} mode.`
    },
    {
      path: isLying ? path.join(proofDir, "capture_evidence-missing.png") : upstreamCapturePath,
      kind: "screenshot",
      description: `capture evidence referenced by ${capability} in ${mode} mode.`
    },
    ...(includeLiveVerification
      ? [
          {
            path: isLying ? path.join(proofDir, "run_checks-live-missing.log") : upstreamChecksLivePath,
            kind: "interaction-log",
            description: `live verifier interaction log referenced by ${capability} in ${mode} mode.`
          },
          {
            path: isLying ? path.join(proofDir, "run_checks-witness-missing.json") : upstreamChecksWitnessPath,
            kind: "verification-witness",
            description: `structured verification witness referenced by ${capability} in ${mode} mode.`
          },
          {
            path: isLying ? path.join(proofDir, "capture_evidence-live-missing.log") : upstreamCaptureLivePath,
            kind: "interaction-log",
            description: `capture interaction log referenced by ${capability} in ${mode} mode.`
          },
          {
            path: isLying ? path.join(proofDir, "capture_evidence-witness-missing.json") : upstreamCaptureWitnessPath,
            kind: "verification-witness",
            description: `capture verification witness referenced by ${capability} in ${mode} mode.`
          }
        ]
      : [])
  );
  result.evidence_items[0].derived_from_capabilities = ["run_checks", "capture_evidence"];
  result.evidence_items[0].derived_from_evidence_paths = includeLiveVerification
    ? [
        upstreamChecksPath,
        upstreamChecksLivePath,
        upstreamChecksWitnessPath,
        upstreamCapturePath,
        upstreamCaptureLivePath,
        upstreamCaptureWitnessPath
      ]
    : [upstreamChecksPath, upstreamCapturePath];
  result.criteria_results = familyConfig.gradeAssertionIds.map((criterionId) => ({
    ...criteria[criterionId],
    status: isContradictory ? "fail" : "pass",
    summary: gradeSummaryFor(criterionId),
    evidence_paths: includeLiveVerification
      ? [
          isLying ? path.join(proofDir, "run_checks-missing.json") : upstreamChecksPath,
          isLying ? path.join(proofDir, "run_checks-live-missing.log") : upstreamChecksLivePath
        ]
      : [isLying ? path.join(proofDir, "run_checks-missing.json") : upstreamChecksPath],
    observed_value: observedValueFor(criterionId, capability)
  }));
  if (process.env.HARNESS_SEMANTIC_SUBJECTIVE_METRIC === "fail") {
    result.subjective_metric_results = [
      {
        metric_id: "design.no_noise_text",
        label: "No noisy text",
        score_out_of_ten: 8.7,
        minimum_score_out_of_ten: 9.5,
        status: "fail",
        rationale: "The fixture intentionally leaves excessive helper text.",
        recommended_changes: ["Remove helper copy before closing the loop."],
        evidence_paths: [upstreamCapturePath],
        required: true
      }
    ];
  }
}
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
