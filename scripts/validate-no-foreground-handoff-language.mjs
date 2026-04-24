import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { repoRoot } from "./validation-utils.mjs";

const readRepoFile = async (relativePath) =>
  readFile(resolve(repoRoot, relativePath), "utf8");

console.log("[validate-no-foreground-handoff-language] transport protocol uses loop-control as canonical worker");
const transportProtocol = await readRepoFile("packages/loop-orchestrator/src/transport-protocol.ts");
assert(
  transportProtocol.includes("$loop-control") &&
    transportProtocol.includes("same-thread autocontinue chain moving"),
  "Expected transport protocol to describe $loop-control as the same-thread autocontinue worker."
);
assert(
  !transportProtocol.includes("$attached-loop` should consume the active") &&
    !transportProtocol.includes("$attached-loop should consume the active"),
  "Transport protocol should not describe $attached-loop as the canonical foreground checkpoint consumer."
);

console.log("[validate-no-foreground-handoff-language] loop runtime notes treat attached-loop as recovery only");
const loopSource = await readRepoFile("packages/loop-orchestrator/src/loop.ts");
assert(
  loopSource.includes("$loop-control owns the same-thread autocontinue chain"),
  "Expected loop runtime notes to mention $loop-control as the same-thread owner."
);
assert(
  !loopSource.includes("Use the attached-loop skill and keep the current thread as the generator/controller surface."),
  "Legacy attached-loop foreground handoff note should be removed from loop runtime notes."
);

console.log("[validate-no-foreground-handoff-language] loop:continue no longer recommends attached-loop for codex checkpoints");
const loopContinue = await readRepoFile("scripts/loop-continue.mjs");
assert(
  !loopContinue.includes('recommendedSkill: "attached-loop"'),
  "loop:continue should not recommend attached-loop for codex checkpoints."
);

console.log("[validate-no-foreground-handoff-language] repo instructions keep foreground ownership inside loop-control");
const agentsInstructions = await readRepoFile("AGENTS.md");
assert(
  agentsInstructions.includes("keep control inside `$loop-control` through `npm run loop:continue -- --run-dir <run> --json`"),
  "Expected AGENTS.md to keep foreground continuation inside $loop-control."
);
assert(
  agentsInstructions.includes("`ui_visibility = internal_checkpoint`") &&
    agentsInstructions.includes("`foreground_owner = codex`"),
  "Expected AGENTS.md to encode internal checkpoint visibility and Codex foreground ownership."
);
assert(
  !agentsInstructions.includes("then continue on the same thread with `$attached-loop`"),
  "AGENTS.md should not describe $attached-loop as the canonical foreground continuation."
);

console.log("[validate-no-foreground-handoff-language] loop-control skill treats attached-loop as recovery only");
const loopControlSkill = await readRepoFile(".agents/skills/loop-control/SKILL.md");
assert(
  loopControlSkill.includes("`start` and `resume` own the same-thread autocontinue chain."),
  "Expected loop-control skill to state that start and resume own the same-thread autocontinue chain."
);
assert(
  loopControlSkill.includes("use `$attached-loop` only to recover an already-existing foreground run after interruption"),
  "Expected loop-control skill to demote $attached-loop to recovery-only semantics."
);
assert(
  loopControlSkill.includes("`ui_visibility = internal_checkpoint`") &&
    loopControlSkill.includes("`foreground_owner = codex`"),
  "Expected loop-control skill to treat internal checkpoint visibility as machine-readable autocontinue policy."
);

console.log("foreground handoff language validation passed.");
