import { evaluateIntakeRequest, renderIntakeGateResponse } from "./intake-gate.js";
import { detectProductBuildIntent } from "./product-build-signals.js";
const isPrepareReadyIntakeStatus = (status) => status === "ready_for_prepare";
const hasKoreanText = (value) => /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(value);
const detectIntentLocale = (value) => hasKoreanText(value) ? "ko" : "en";
const localizedQuestion = (input) => input.locale === "ko" ? input.ko : input.en;
const harnessSurfaceSignals = [
    { label: "harness", pattern: /\bharness\b/i },
    { label: "closed-loop harness", pattern: /\bclosed-?\s*loop\s+harness\b/i },
    { label: "generic closed-loop harness", pattern: /\bgeneric\s+closed-?\s*loop\s+harness\b/i },
    { label: "generic workbench", pattern: /\bgeneric(?:\s+codex)?\s+workbench\b/i },
    { label: "Codex workbench", pattern: /\bcodex\s+workbench\b/i },
    { label: "closed-loop", pattern: /\bclosed-?\s*loop\b/i },
    { label: "front door", pattern: /\bfront\s+door\b/i },
    { label: "planner", pattern: /\bplanner\b/i },
    { label: "control plane", pattern: /\bcontrol(?:-|\s+)plane\b/i },
    { label: "operator surface", pattern: /\boperator(?:-|\s+)surface\b/i },
    { label: "operator UX", pattern: /\boperator\s+ux\b/i },
    { label: "Codex app", pattern: /\bcodex\s+app\b/i },
    { label: "current-thread", pattern: /\bcurrent-thread\b/i },
    { label: "app-server", pattern: /\bapp-server\b/i },
    { label: "worktree", pattern: /\bworktree(?:s)?\b/i },
    { label: "handoff", pattern: /\bhandoff\b/i },
    { label: "automation", pattern: /\bautomation(?:s)?\b/i },
    { label: "transport-mode", pattern: /\btransport(?:-|\s+)mode\b/i },
    { label: "presentation_mode", pattern: /\bpresentation(?:_|\s+)mode\b/i },
    { label: "plugin", pattern: /\bplugin(?:s)?\b/i },
    { label: "marketplace", pattern: /\bmarketplace\b/i },
    { label: "skills", pattern: /\.agents\/skills|\.codex\/agents|\bskills\b/i },
    { label: "loop:intent", pattern: /\bloop:intent\b/i },
    { label: "loop:intake", pattern: /\bloop:intake\b/i },
    { label: "loop:run", pattern: /\bloop:run\b/i },
    { label: "AGENTS.md", pattern: /\bagents\.md\b/i },
    { label: "RUNBOOK.md", pattern: /\brunbook\.md\b/i },
    { label: "feature_list.generated.json", pattern: /\bfeature_list\.generated\.json\b/i },
    { label: "progress.md", pattern: /\bprogress\.md\b/i },
    { label: "progress.jsonl", pattern: /\bprogress\.jsonl\b/i },
    { label: "done_when.md", pattern: /\bdone_when\.md\b/i },
    { label: "init.sh", pattern: /\binit\.sh\b/i },
    { label: "patch-request", pattern: /\bpatch-request\b/i },
    { label: "trajectory-decision", pattern: /\btrajectory-decision\b/i },
    { label: "round-contract", pattern: /\bround-contract\b/i },
    { label: "quality-critique", pattern: /\bquality-critique\b/i },
    { label: "resume-identity", pattern: /\bresume-identity\b/i },
    { label: "하네스", pattern: /\uD558\uB124\uC2A4/u },
    { label: "범용 워크벤치", pattern: /\uBC94\uC6A9.{0,4}\uC6CC\uD06C\uBCA4\uCE58/u },
    { label: "닫힌 루프", pattern: /\uB2EB\uD78C\s*\uB8E8\uD504/u },
    { label: "앞문", pattern: /\uC55E\uBB38/u },
    { label: "제어면", pattern: /\uC81C\uC5B4\uBA74/u },
    { label: "플래너", pattern: /\uD50C\uB798\uB108/u },
    { label: "평가기", pattern: /\uD3C9\uAC00\uAE30/u },
    { label: "closed-loop harness (ko)", pattern: /\uB2EB\uD78C\s*\uB8E8\uD504.{0,4}\uD558\uB124\uC2A4/u },
    {
        label: "generic closed-loop harness (ko)",
        pattern: /\uBC94\uC6A9.{0,8}\uB2EB\uD78C\s*\uB8E8\uD504.{0,4}\uD558\uB124\uC2A4/u
    }
];
const harnessChangeSignals = [
    { label: "add", pattern: /\badd\b/i },
    { label: "apply", pattern: /\bapply\b/i },
    { label: "adopt", pattern: /\badopt\b/i },
    { label: "change", pattern: /\bchange\b/i },
    { label: "refactor", pattern: /\brefactor\b/i },
    { label: "integrate", pattern: /\bintegrate\b/i },
    { label: "split", pattern: /\bsplit\b/i },
    { label: "route", pattern: /\broute\b/i },
    { label: "promote", pattern: /\bpromote\b/i },
    { label: "replace", pattern: /\breplace\b/i },
    { label: "remove", pattern: /\bremove\b/i },
    { label: "upgrade", pattern: /\bupgrade\b/i },
    { label: "improve", pattern: /\bimprove\b/i },
    { label: "harden", pattern: /\bharden\b/i },
    { label: "rewrite", pattern: /\brewrite\b/i },
    { label: "need", pattern: /\bneed(?:s|ed)?\b/i },
    { label: "want", pattern: /\bwant(?:s|ed)?\b/i },
    { label: "require", pattern: /\brequire(?:s|d)?\b/i },
    { label: "keep", pattern: /\bkeep\b/i },
    { label: "maintain", pattern: /\bmaintain\b/i },
    { label: "in progress", pattern: /\bin\s+progress\b/i },
    { label: "inspired by", pattern: /\binspired\s+by\b/i },
    { label: "추가", pattern: /\uCD94\uAC00/u },
    { label: "변경", pattern: /\uBCC0\uACBD/u },
    { label: "분리", pattern: /\uBD84\uB9AC/u },
    { label: "승격", pattern: /\uC2B9\uACA9/u },
    { label: "교체", pattern: /\uAD50\uCCB4/u },
    { label: "개선", pattern: /\uAC1C\uC120/u },
    { label: "수정", pattern: /\uC218\uC815/u },
    { label: "보강", pattern: /\uBCF4\uAC15/u },
    { label: "재작성", pattern: /\uC7AC\uC791\uC131/u },
    { label: "유지", pattern: /\uC720\uC9C0/u },
    { label: "고정", pattern: /\uACE0\uC815/u },
    { label: "apply (ko)", pattern: /\uC801\uC6A9/u },
    { label: "reflect (ko)", pattern: /\uBC18\uC601/u },
    { label: "in progress (ko)", pattern: /\uC9C4\uD589\s*\uC911/u },
    { label: "building now (ko)", pattern: /\uB9CC\uB4DC\uB294\s*\uC911/u },
    { label: "inspiration (ko)", pattern: /\uC601\uAC10/u },
    { label: "influenced by (ko)", pattern: /\uC601\uD5A5.{0,4}\uBC1B/u },
    { label: "aiming for (ko)", pattern: /\uBAA9\uD45C.{0,4}\uC911/u },
    { label: "need (ko)", pattern: /\uD544\uC694/u },
    { label: "want (ko)", pattern: /\uC6D0(?:\uD568|\uD55C\uB2E4|\uD574)/u }
];
const gapSignals = [
    { label: "missing", pattern: /\bmissing\b/i },
    { label: "gap", pattern: /\bgap\b/i },
    { label: "weak", pattern: /\bweak\b/i },
    { label: "problem", pattern: /\bproblem\b/i },
    { label: "pain", pattern: /\bpain\b/i },
    { label: "falls through", pattern: /\bfalls?\s+through\b/i },
    { label: "still", pattern: /\bstill\b/i },
    { label: "unknown", pattern: /\bunknown\b/i },
    { label: "noise", pattern: /\bnoise\b/i },
    { label: "취약", pattern: /\uCDE8\uC57D/u },
    { label: "문제", pattern: /\uBB38\uC81C/u },
    { label: "병목", pattern: /\uBCD1\uBAA9/u },
    { label: "놓친다", pattern: /\uB193\uCE58/u },
    { label: "빠진다", pattern: /\uBE60\uC9C0/u },
    { label: "약하다", pattern: /\uC57D\uD558/u },
    { label: "어렵다", pattern: /\uC5B4\uB835/u },
    { label: "신뢰도", pattern: /\uC2E0\uB8B0/u }
];
const successSignals = [
    { label: "priority", pattern: /\bpriority\b/i },
    { label: "goal", pattern: /\bgoal\b/i },
    { label: "outcome", pattern: /\boutcome\b/i },
    { label: "acceptance", pattern: /\bacceptance\b/i },
    { label: "done when", pattern: /\bdone\s+when\b/i },
    { label: "success means", pattern: /\bsuccess\s+means\b/i },
    { label: "must", pattern: /\bmust\b/i },
    { label: "should", pattern: /\bshould\b/i },
    { label: "good enough", pattern: /\bgood\s+enough\b/i },
    { label: "trigger conditions", pattern: /\btrigger\s+conditions?\b/i },
    { label: "우선순위", pattern: /\uC6B0\uC120\uC21C\uC704/u },
    { label: "목표", pattern: /\uBAA9\uD45C/u },
    { label: "성공", pattern: /\uC131\uACF5/u },
    { label: "완료", pattern: /\uC644\uB8CC/u },
    { label: "완료 기준", pattern: /\uC644\uB8CC.{0,4}\uAE30\uC900/u },
    { label: "여야", pattern: /\uC5EC\uC57C/u },
    { label: "되어야", pattern: /\uB418\uC5B4\uC57C/u },
    { label: "해야", pattern: /\uD574\uC57C/u },
    { label: "한 줄로 정리", pattern: /\uD55C\s*\uC904\uB85C.{0,4}\uC815\uB9AC/u }
];
const resumeSignals = [
    { label: "resume", pattern: /\bresume(?:-run)?\b/i },
    { label: "continue", pattern: /\bcontinue\b/i },
    { label: "reopen", pattern: /\breopen\b/i },
    { label: "pick up", pattern: /\bpick\s+up\b/i },
    { label: "codex-handoff", pattern: /\bcodex-handoff\b/i },
    { label: "summary.json", pattern: /\bsummary\.json\b/i },
    { label: "evals/runs", pattern: /evals[\\/]+runs[\\/]+run-\d+/i },
    { label: "continue (ko)", pattern: /\uC774\uC5B4\uAC00/u },
    { label: "이어", pattern: /\uC774\uC5B4/u },
    { label: "재개", pattern: /\uC7AC\uAC1C/u },
    { label: "다시 열기", pattern: /\uB2E4\uC2DC.{0,4}\uC5F4\uAE30/u }
];
const runStateSignals = [
    { label: "blocked", pattern: /\bblocked\b/i },
    { label: "failed", pattern: /\bfailed\b/i },
    { label: "hold", pattern: /\bhold(?:ing)?\b/i },
    { label: "round", pattern: /\bround\b/i },
    { label: "patch request", pattern: /\bpatch\s+request\b/i },
    { label: "stop reason", pattern: /\bstop\s+reason\b/i },
    { label: "environment_blocked", pattern: /\benvironment_blocked\b/i },
    { label: "target_reached", pattern: /\btarget_reached\b/i },
    { label: "중단", pattern: /\uC911\uB2E8/u },
    { label: "보류", pattern: /\uBCF4\uB958/u },
    { label: "멈춤", pattern: /\uBA48/u }
];
const runControlSignals = [
    { label: "loop start", pattern: /\bloop\s+start\b/i },
    { label: "start loop", pattern: /\bstart\s+loop\b/i },
    { label: "run loop", pattern: /\brun\s+loop\b/i },
    { label: "start run", pattern: /\bstart\s+run\b/i },
    { label: "show status", pattern: /\bshow\s+status\b/i },
    { label: "loop status", pattern: /\bloop\s+status\b/i },
    { label: "resume loop", pattern: /\bresume\s+(?:the\s+)?(?:current\s+|active\s+|latest\s+|previous\s+|last\s+)?loop\b/i },
    { label: "continue loop", pattern: /\bcontinue\s+(?:the\s+)?(?:current\s+|active\s+|latest\s+|previous\s+|last\s+)?loop\b/i },
    { label: "continue last run", pattern: /\bcontinue\s+(?:the\s+)?(?:last|previous)\s+run\b/i },
    { label: "resume latest run", pattern: /\bresume\s+(?:the\s+)?(?:current|active|latest|previous|last)\s+run\b/i },
    { label: "pick up where left off", pattern: /\bpick\s+up\s+(?:from\s+)?(?:where\s+we\s+left\s+off|last\s+run|previous\s+loop)\b/i },
    { label: "monitor", pattern: /\bmonitor(?:ing)?\b/i },
    { label: "status", pattern: /\bstatus\b/i },
    { label: "loop:status", pattern: /\bloop:status\b/i },
    { label: "loop:stop", pattern: /\bloop:stop\b/i },
    { label: "loop:start:bg", pattern: /\bloop:start:bg\b/i },
    { label: "loop:start:codex", pattern: /\bloop:start:codex\b/i },
    { label: "loop:start:manual", pattern: /\bloop:start:manual\b/i },
    { label: "background", pattern: /\bbackground\b/i },
    { label: "detached", pattern: /\bdetached\b/i },
    { label: "supervisor", pattern: /\bsupervisor\b/i },
    { label: "foreground", pattern: /\bforeground\b/i },
    { label: "current-thread", pattern: /\bcurrent-thread\b/i },
    { label: "attached", pattern: /\battached\b/i },
    { label: "Codex-owned", pattern: /\bcodex-?owned\b/i },
    { label: "Codex app", pattern: /\bcodex\s+app\b/i },
    { label: "루프 시작", pattern: /\uB8E8\uD504\s*\uC2DC\uC791/u },
    { label: "루프 상태", pattern: /\uB8E8\uD504\s*\uC0C1\uD0DC/u },
    { label: "상태", pattern: /\uC0C1\uD0DC/u },
    { label: "정지", pattern: /\uC815\uC9C0/u },
    { label: "중지", pattern: /\uC911\uC9C0/u },
    { label: "모니터링", pattern: /\uBAA8\uB2C8\uD130\uB9C1/u },
    { label: "백그라운드", pattern: /\uBC31\uADF8\uB77C\uC6B4\uB4DC/u },
    { label: "현재 스레드", pattern: /\uD604\uC7AC\s*\uC2A4\uB808\uB4DC/u },
    { label: "코덱스 소유", pattern: /\uCF54\uB371\uC2A4\s*\uC18C\uC720/u }
];
const runActionSignals = [
    { label: "resume", pattern: /\bresume\b/i },
    { label: "continue", pattern: /\bcontinue\b/i },
    { label: "reopen", pattern: /\breopen\b/i },
    { label: "advance", pattern: /\badvance\b/i },
    { label: "close out", pattern: /\bclose\s*out\b/i },
    { label: "next step", pattern: /\bnext\s+step\b/i },
    { label: "continue (ko)", pattern: /\uC774\uC5B4\uAC00/u },
    { label: "이어가기", pattern: /\uC774\uC5B4\uAC00\uAE30/u },
    { label: "재개", pattern: /\uC7AC\uAC1C/u },
    { label: "결정", pattern: /\uACB0\uC815/u },
    { label: "닫기", pattern: /\uB2EB\uAE30/u }
];
const evaluatorSurfaceSignals = [
    { label: "evaluator", pattern: /\bevaluator\b/i },
    { label: "rubric", pattern: /\brubric\b/i },
    { label: "calibration", pattern: /\bcalibration\b/i },
    { label: "threshold", pattern: /\bthresholds?\b/i },
    { label: "few-shot", pattern: /\bfew-?shot\b/i },
    { label: "golden", pattern: /\bgoldens?\b/i },
    { label: "exemplar", pattern: /\bexemplar\b/i },
    { label: "false positive", pattern: /\bfalse\s+positives?\b/i },
    { label: "false negative", pattern: /\bfalse\s+negatives?\b/i },
    { label: "subjective metrics", pattern: /\bsubjective\s+metrics?\b/i },
    { label: "quality contract", pattern: /\bquality(?:_|-|\s+)contract\b/i },
    { label: "verification profile", pattern: /\bverification\s+profile\b/i },
    { label: "release gate", pattern: /\brelease\s+gate\b/i },
    { label: "light lane", pattern: /\blight\s+lane\b/i },
    { label: "heavy lane", pattern: /\bheavy\s+lane\b/i },
    { label: "browser-app", pattern: /\bbrowser-app\b/i },
    { label: "dashboard", pattern: /\bdashboard\b/i },
    { label: "api-service", pattern: /\bapi-service\b/i },
    { label: "cli-tool", pattern: /\bcli-tool\b/i },
    { label: "command-artifact", pattern: /\bcommand-artifact\b/i },
    { label: "평가기", pattern: /\uD3C9\uAC00\uAE30/u },
    { label: "보정", pattern: /\uBCF4\uC815/u },
    { label: "튜닝", pattern: /\uD29C\uB2DD/u },
    { label: "임계값", pattern: /\uC784\uACC4\uAC12/u },
    { label: "오탐", pattern: /\uC624\uD0D0/u },
    { label: "미탐", pattern: /\uBBF8\uD0D0/u }
];
const evaluatorChangeSignals = [
    { label: "tune", pattern: /\btune\b/i },
    { label: "calibrate", pattern: /\bcalibrate\b/i },
    { label: "adjust", pattern: /\badjust\b/i },
    { label: "threshold", pattern: /\bthresholds?\b/i },
    { label: "bundle", pattern: /\bbundle\b/i },
    { label: "profile", pattern: /\bprofile\b/i },
    { label: "보정", pattern: /\uBCF4\uC815/u },
    { label: "튜닝", pattern: /\uD29C\uB2DD/u },
    { label: "조정", pattern: /\uC870\uC815/u },
    { label: "프로파일", pattern: /\uD504\uB85C\uD30C\uC77C/u }
];
const evaluatorExampleSignals = [
    { label: "false positive", pattern: /\bfalse\s+positives?\b/i },
    { label: "false negative", pattern: /\bfalse\s+negatives?\b/i },
    { label: "golden", pattern: /\bgoldens?\b/i },
    { label: "example", pattern: /\bexamples?\b/i },
    { label: "regression", pattern: /\bregression\b/i },
    { label: "plateau", pattern: /\bplateau\b/i },
    { label: "오탐", pattern: /\uC624\uD0D0/u },
    { label: "미탐", pattern: /\uBBF8\uD0D0/u },
    { label: "예시", pattern: /\uC608\uC2DC/u },
    { label: "사례", pattern: /\uC0AC\uB840/u },
    { label: "회귀", pattern: /\uD68C\uADC0/u }
];
const runReferencePattern = /(evals[\\/]+runs[\\/]+run-\d+|(?:[A-Za-z]:\\|\.{1,2}[\\/])?[^\r\n\s]*run-\d+[^\r\n\s]*)/i;
const normalizeText = (value) => value.replace(/\s+/g, " ").trim();
const sanitizeIntentRequest = (value) => normalizeText(value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]+\]/g, "$1")
    .replace(/^\[[^\]]+\]:\s+https?:\/\/\S+\s*$/gm, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/`+/g, " "));
const matchSignals = (value, signals) => signals.filter((signal) => signal.pattern.test(value)).map((signal) => signal.label);
const roundScore = (value) => Number(value.toFixed(3));
const extractRunReference = (request) => {
    const match = request.match(runReferencePattern)?.[0]?.trim();
    return match && match.length > 0 ? match : undefined;
};
const calculateConfidence = (score) => roundScore(Math.min(0.55 + score * 0.08, 0.97));
const parseRunControlRequest = (request) => {
    const normalized = normalizeText(request);
    const runReference = extractRunReference(normalized);
    const startRequested = /\b(loop\s+start|start\s+loop|run\s+loop|start\s+run|loop:start:(?:codex|bg|manual))\b/i.test(normalized) ||
        /\bcan\s+(?:we|i|you)\s+start(?:\s+the)?\s+loop\b/i.test(normalized) ||
        /\uB8E8\uD504\s*\uC2DC\uC791/u.test(request);
    const statusRequested = /\b(loop\s+status|show\s+status|monitor(?:ing)?|current\s+loop\s+status)\b/i.test(normalized) ||
        (runReference !== undefined && /\bstatus\b/i.test(normalized)) ||
        /\uD604\uC7AC\s*\uB8E8\uD504\s*\uC0C1\uD0DC/u.test(request) ||
        /\uC0C1\uD0DC\s*\uBCF4\uC5EC/u.test(request) ||
        (runReference !== undefined && /\uC0C1\uD0DC/u.test(request));
    const stopRequested = /\b(loop:stop|stop(?:\s+all)?(?:\s+loops?)?|halt(?:\s+all)?(?:\s+loops?)?|terminate(?:\s+all)?(?:\s+loops?)?)\b/i.test(normalized) ||
        /\uBAA8\uB4E0\s*\uB8E8\uD504\s*\uC815\uC9C0/u.test(request) ||
        /\uB8E8\uD504\s*(?:\uC815\uC9C0|\uBA48\uCDB0)/u.test(request);
    const resumeRequested = /\b(resume|continue)\s+(?:the\s+)?(?:(?:current|active|latest|previous|last)\s+)?(?:run|loop)\b/i.test(normalized) ||
        /\b(?:pick\s+up|resume|continue)\s+(?:from\s+)?(?:where\s+we\s+left\s+off|last\s+run|previous\s+loop)\b/i.test(normalized) ||
        (runReference !== undefined && /\b(resume|continue)\b/i.test(normalized)) ||
        (runReference !== undefined &&
            /\uC774\uC5B4\uAC00|\uACC4\uC18D|\uC7AC\uAC1C/u.test(request)) ||
        /\uB8E8\uD504\s*\uC7AC\uAC1C/u.test(request);
    const explicitStartSurfaces = [
        { surface: "codex", index: normalized.search(/\bloop:start:codex\b/i) },
        { surface: "background", index: normalized.search(/\bloop:start:bg\b/i) },
        { surface: "manual", index: normalized.search(/\bloop:start:manual\b/i) }
    ]
        .filter((entry) => entry.index >= 0)
        .sort((left, right) => left.index - right.index);
    const hintedStartSurface = explicitStartSurfaces[0]?.surface ??
        (/\b(manual(?:-protocol)?|shell-?owned)\b/i.test(normalized)
            ? "manual"
            : /\b(background|detached|supervisor)\b/i.test(normalized)
                ? "background"
                : /\b(codex\s+app|codex-?owned|current-thread|attached|foreground)\b/i.test(normalized)
                    ? "codex"
                    : /\uBC31\uADF8\uB77C\uC6B4\uB4DC/u.test(request)
                        ? "background"
                        : /\uCF54\uB371\uC2A4\s*\uC18C\uC720|\uD604\uC7AC\s*\uC2A4\uB808\uB4DC/u.test(request)
                            ? "codex"
                            : undefined);
    const targetsAllRuns = /\b(all\s+loops?|everything)\b/i.test(normalized) ||
        /\uBAA8\uB4E0\s*\uB8E8\uD504/u.test(request);
    const diagnosticFocus = [];
    if (/\b(timeout|timed?\s*out|stall(?:ed)?|root\s+cause|why)\b/i.test(normalized) ||
        /\uD0C0\uC784\uC544\uC6C3|\uC6D0\uC778|\uADDC\uBA85/u.test(request)) {
        diagnosticFocus.push("timeout_root_cause");
    }
    if (/\brestart\s+budget|restart_count|supervisor\s+failed\b/i.test(normalized)) {
        diagnosticFocus.push("restart_budget");
    }
    if (/\b(ownership|current-thread|detached|codex-?owned|background\s+supervisor)\b/i.test(normalized) ||
        /\uC18C\uC720|\uD604\uC7AC\s*\uC2A4\uB808\uB4DC|\uBC31\uADF8\uB77C\uC6B4\uB4DC/u.test(request)) {
        diagnosticFocus.push("ownership_mismatch");
    }
    if (/\b(status\s+truth|stale|live-state|supervisor-state)\b/i.test(normalized) ||
        /\uC5C7\uAC08|\uC2E4\uC81C\s*\uC0C1\uD0DC/u.test(request)) {
        diagnosticFocus.push("status_truth");
    }
    return {
        action: stopRequested
            ? "stop"
            : statusRequested
                ? "status"
                : startRequested
                    ? "start"
                    : resumeRequested
                        ? "resume"
                        : undefined,
        ...(startRequested ? { start_surface: hintedStartSurface ?? "codex" } : {}),
        targets_all_runs: targetsAllRuns,
        diagnostic_focus: diagnosticFocus
    };
};
const normalizeRunReferenceForCommand = (runReference) => {
    const normalized = runReference.replace(/\\/g, "/");
    if (/evals\/runs\/run-\d+/i.test(normalized)) {
        return normalized;
    }
    const simpleRunId = normalized.match(/\brun-\d+\b/i)?.[0];
    if (simpleRunId) {
        return `evals/runs/${simpleRunId}`;
    }
    return normalized;
};
export const deriveRunControlDispatchPlan = (input) => {
    if (!input.action) {
        return undefined;
    }
    const commandRunReference = input.runReference
        ? normalizeRunReferenceForCommand(input.runReference)
        : undefined;
    const codexAutocontinuePlan = {
        enabled: true,
        mode: "same-thread",
        worker: "loop-control",
        recovery_skill: "attached-loop"
    };
    if (input.action === "start") {
        const codexStart = input.startSurface !== "background" && input.startSurface !== "manual";
        return {
            primary_command: input.startSurface === "background"
                ? "npm run loop:start:bg -- --max-rounds 3"
                : input.startSurface === "manual"
                    ? "npm run loop:start:manual -- --json"
                    : "npm run loop:start:codex -- --json",
            follow_up_commands: [],
            follow_up_skills: [],
            ...(codexStart
                ? {
                    autocontinue: codexAutocontinuePlan
                }
                : {})
        };
    }
    if (input.action === "status") {
        return {
            primary_command: commandRunReference
                ? `npm run loop:status -- --run-dir ${commandRunReference} --json`
                : "npm run loop:status -- --json",
            follow_up_commands: [],
            follow_up_skills: []
        };
    }
    if (input.action === "resume") {
        return {
            primary_command: commandRunReference
                ? `npm run loop:resume -- --run-dir ${commandRunReference} --json`
                : "npm run loop:resume -- --json",
            follow_up_commands: [],
            follow_up_skills: [],
            autocontinue: codexAutocontinuePlan
        };
    }
    const stopCommand = input.targetsAllRuns
        ? "npm run loop:stop -- --all"
        : commandRunReference
            ? `npm run loop:stop -- --run-dir ${commandRunReference}`
            : "npm run loop:stop";
    return {
        primary_command: stopCommand,
        follow_up_commands: input.diagnosticFocus.length > 0
            ? commandRunReference
                ? [`npm run loop:status -- --run-dir ${commandRunReference} --json`]
                : ["npm run loop:status -- --json"]
            : [],
        follow_up_skills: []
    };
};
const buildQuestions = (states) => states.filter((field) => !field.satisfied).map((field) => field.question);
const buildMissingFields = (states) => states.filter((field) => !field.satisfied).map((field) => field.id);
const buildSatisfiedFields = (states) => states.filter((field) => field.satisfied).map((field) => field.id);
const buildIntentRationale = (label, matchedKeywords, extraRationale) => {
    const rationale = [];
    if (matchedKeywords.length > 0) {
        rationale.push(`Matched ${label} signals: ${matchedKeywords.slice(0, 6).join(", ")}.`);
    }
    else {
        rationale.push(`Matched ${label} signals from the request.`);
    }
    if (extraRationale) {
        rationale.push(...extraRationale);
    }
    return rationale;
};
const buildHarnessFieldStates = (request, locale, matchedHarnessSignals, matchedGapSignals, matchedSuccessSignals, matchedChangeSignals) => {
    const normalized = normalizeText(request);
    return [
        {
            id: "change_goal",
            satisfied: normalized.length >= 32 && (matchedChangeSignals.length > 0 || matchedHarnessSignals.length >= 2),
            question: localizedQuestion({
                locale,
                en: "What harness surface or operator path should change first?",
                ko: "어떤 하네스 표면이나 운영자 경로를 먼저 바꿔야 하나?"
            })
        },
        {
            id: "current_gap",
            satisfied: matchedGapSignals.length > 0 ||
                (matchedHarnessSignals.length >= 4 &&
                    matchedChangeSignals.length > 0 &&
                    matchedSuccessSignals.length > 0),
            question: localizedQuestion({
                locale,
                en: "What concrete gap, failure mode, or operator pain exists in the current flow?",
                ko: "현재 흐름에서 어떤 구체적 결함, 실패 모드, 또는 운영자 불편이 있나?"
            })
        },
        {
            id: "success_criteria",
            satisfied: matchedSuccessSignals.length > 0 || /\b1\.\s|\b2\.\s/.test(request),
            question: localizedQuestion({
                locale,
                en: "What outcome would tell us the harness change worked?",
                ko: "어떤 결과가 나오면 이번 하네스 변경이 효과 있었다고 볼 수 있나?"
            })
        }
    ];
};
const buildRunControlFieldStates = (request, locale, matchedRunControlSignals) => {
    const normalized = normalizeText(request);
    const runReference = extractRunReference(request);
    const wantsStart = /\b(loop\s+start|start\s+loop|run\s+loop|start\s+run)\b/i.test(request) ||
        /\uB8E8\uD504\s*\uC2DC\uC791/u.test(request);
    const wantsStatus = /\b(status|show\s+status|loop\s+status|monitor(?:ing)?)\b/i.test(request) ||
        /\uC0C1\uD0DC|\uBAA8\uB2C8\uD130\uB9C1/u.test(request);
    const wantsStop = /\b(stop|halt|terminate)\b/i.test(request) ||
        /\uC815\uC9C0|\uC911\uC9C0/u.test(request);
    const wantsResume = /\b(resume|continue)\b/i.test(request) ||
        /\uC7AC\uAC1C|\uACC4\uC18D|\uC774\uC5B4\uAC00/u.test(request);
    const mentionsBackground = /\b(background|detached|supervisor)\b/i.test(request) ||
        /\uBC31\uADF8\uB77C\uC6B4\uB4DC/u.test(request);
    const mentionsCodexOwnership = /\b(codex\s+app|codex-?owned|current-thread|attached|foreground)\b/i.test(request) ||
        /\uCF54\uB371\uC2A4\s*\uC18C\uC720|\uD604\uC7AC\s*\uC2A4\uB808\uB4DC/u.test(request);
    const stopAll = /\b(all\s+loops?|everything)\b/i.test(request) || /\uBAA8\uB4E0\s*\uB8E8\uD504/u.test(request);
    const referencesCurrentRun = /\b(current|active|latest)\b/i.test(normalized) ||
        /\uD604\uC7AC|\uC9C0\uAE08|\uCD5C\uC2E0/u.test(request);
    return [
        {
            id: "action",
            satisfied: wantsStart || wantsStatus || wantsStop || wantsResume || matchedRunControlSignals.length > 0,
            question: localizedQuestion({
                locale,
                en: "Which run-control action should happen next: start, status, stop, or resume?",
                ko: "다음에 어떤 run-control 동작이 필요하나: start, status, stop, resume 중 무엇인가?"
            })
        },
        {
            id: "run_reference",
            satisfied: runReference !== undefined ||
                wantsStart ||
                wantsResume ||
                stopAll ||
                (wantsStatus && referencesCurrentRun) ||
                (wantsStop && referencesCurrentRun),
            question: localizedQuestion({
                locale,
                en: "Which run should this control action target? Provide a run id/run directory, or say this should target the next new run.",
                ko: "이 control action이 겨냥할 run이 무엇인가? run id/run 디렉터리를 적거나 새 run 시작이라고 적어줘."
            })
        },
        {
            id: "background_preference",
            satisfied: true,
            question: localizedQuestion({
                locale,
                en: "Should this start stay on the current Codex thread or launch as a background supervisor?",
                ko: "이 시작은 현재 Codex thread에 붙어 있어야 하나, 아니면 background supervisor로 띄워야 하나?"
            })
        },
        {
            id: "codex_ownership_preference",
            satisfied: true,
            question: localizedQuestion({
                locale,
                en: "Should Codex own the foreground current-thread surface for this run, or should the run stay shell/background-owned?",
                ko: "이 run은 Codex가 foreground current-thread surface를 소유해야 하나, 아니면 shell/background 소유로 남아야 하나?"
            })
        }
    ];
};
const buildResumeFieldStates = (request, locale, matchedRunStateSignals, matchedRunActionSignals) => {
    const runReference = extractRunReference(request);
    return [
        {
            id: "run_reference",
            satisfied: runReference !== undefined,
            question: localizedQuestion({
                locale,
                en: "Which run should be resumed? Provide the run directory or run id.",
                ko: "어느 run을 이어야 하나? run id나 run 디렉터리를 적어줘."
            })
        },
        {
            id: "current_state",
            satisfied: matchedRunStateSignals.length > 0,
            question: localizedQuestion({
                locale,
                en: "What is the current run state, stop reason, or latest patch status?",
                ko: "현재 run 상태, stop reason, 또는 최신 patch 상태가 어떤지 적어줘."
            })
        },
        {
            id: "next_step",
            satisfied: matchedRunActionSignals.length > 0,
            question: localizedQuestion({
                locale,
                en: "What should happen next: reopen, continue, hold, or close out?",
                ko: "다음에 무엇을 해야 하나? reopen, continue, hold, close out 중에서 정해줘."
            })
        }
    ];
};
const buildEvaluatorFieldStates = (request, locale, matchedEvaluatorSignals, matchedEvaluatorExampleSignals, matchedSuccessSignals) => [
    {
        id: "calibration_focus",
        satisfied: matchedEvaluatorSignals.length >= 2 ||
            /(?:browser-app|dashboard|api-service|chat-agent|fullstack-app|browser-editor|cli-tool|command-artifact|light lane|heavy lane)/i.test(request),
        question: localizedQuestion({
            locale,
            en: "Which evaluator lane, family, or rubric surface needs calibration?",
            ko: "어느 evaluator lane, family, 또는 rubric 표면을 보정해야 하나?"
        })
    },
    {
        id: "failure_examples",
        satisfied: matchedEvaluatorExampleSignals.length > 0,
        question: localizedQuestion({
            locale,
            en: "What examples show the evaluator getting it wrong today?",
            ko: "지금 evaluator가 틀리고 있다는 예시가 무엇인지 적어줘."
        })
    },
    {
        id: "success_criteria",
        satisfied: matchedSuccessSignals.length > 0,
        question: localizedQuestion({
            locale,
            en: "What lift or calibration outcome should count as a successful evaluator change?",
            ko: "어떤 lift나 calibration 결과가 나오면 evaluator 변경이 성공이라고 볼 수 있나?"
        })
    }
];
const buildProductResult = (intake, rationale, locale) => ({
    intent: "product_build",
    status: "route_to_app_builder_loop",
    phase: isPrepareReadyIntakeStatus(intake.status) ? "prepare" : "intent",
    locale,
    confidence: isPrepareReadyIntakeStatus(intake.status) ? 0.96 : 0.91,
    route_target: "app_builder_loop",
    questions: intake.questions,
    missing_fields: [],
    satisfied_fields: [],
    rationale,
    recommended_skill: "app-builder-loop",
    product_build_dispatch_plan: {
        recommended_skill: "app-builder-loop",
        staged_intake_gate: "loop:intake",
        session_mode: "same-thread",
        next_step: isPrepareReadyIntakeStatus(intake.status) ? "prepare" : "ask_questions"
    },
    intake,
    intake_status: intake.status,
    intake_phase: intake.phase,
    intake_missing_fields: intake.missing_fields
});
const buildRunControlResult = (input) => {
    const states = buildRunControlFieldStates(input.request, input.locale, input.matchedRunControlSignals);
    const missingFields = buildMissingFields(states);
    const dispatchPlan = deriveRunControlDispatchPlan({
        action: input.parsed.action,
        runReference: input.runReference,
        startSurface: input.parsed.start_surface,
        targetsAllRuns: input.parsed.targets_all_runs,
        diagnosticFocus: input.parsed.diagnostic_focus
    });
    return {
        intent: "run_control",
        status: missingFields.length > 0 ? "ask_run_control_questions" : "ready_for_run_control",
        phase: missingFields.length > 0 ? "intent" : "handoff",
        locale: input.locale,
        confidence: calculateConfidence(input.confidenceScore),
        route_target: "run_control",
        questions: buildQuestions(states),
        missing_fields: missingFields,
        satisfied_fields: buildSatisfiedFields(states),
        rationale: input.rationale,
        extracted_run_reference: input.runReference,
        ...(input.parsed.action ? { run_control_action: input.parsed.action } : {}),
        ...(input.parsed.start_surface ? { run_control_start_surface: input.parsed.start_surface } : {}),
        ...(input.parsed.targets_all_runs ? { run_control_targets_all_runs: true } : {}),
        ...(input.parsed.diagnostic_focus.length > 0
            ? { run_control_diagnostic_focus: input.parsed.diagnostic_focus }
            : {}),
        ...(dispatchPlan ? { run_control_dispatch_plan: dispatchPlan } : {}),
        ...(dispatchPlan ? { run_control_primary_command: dispatchPlan.primary_command } : {}),
        ...(dispatchPlan && dispatchPlan.follow_up_commands.length > 0
            ? { run_control_follow_up_commands: dispatchPlan.follow_up_commands }
            : {}),
        ...(dispatchPlan && dispatchPlan.follow_up_skills.length > 0
            ? { run_control_follow_up_skills: dispatchPlan.follow_up_skills }
            : {})
    };
};
export const evaluateLoopIntent = (request) => {
    const normalizedRequest = normalizeText(request);
    const sanitizedRequest = sanitizeIntentRequest(normalizedRequest);
    const runReference = extractRunReference(normalizedRequest);
    const intake = evaluateIntakeRequest(sanitizedRequest);
    const matchedHarnessSignals = matchSignals(sanitizedRequest, harnessSurfaceSignals);
    const matchedHarnessChangeSignals = matchSignals(sanitizedRequest, harnessChangeSignals);
    const matchedGapSignals = matchSignals(sanitizedRequest, gapSignals);
    const matchedSuccessSignals = matchSignals(sanitizedRequest, successSignals);
    const matchedRunControlSignals = matchSignals(sanitizedRequest, runControlSignals);
    const matchedResumeSignals = matchSignals(sanitizedRequest, resumeSignals);
    const matchedRunStateSignals = matchSignals(sanitizedRequest, runStateSignals);
    const matchedRunActionSignals = matchSignals(sanitizedRequest, runActionSignals);
    const matchedEvaluatorSignals = matchSignals(sanitizedRequest, evaluatorSurfaceSignals);
    const matchedEvaluatorChangeSignals = matchSignals(sanitizedRequest, evaluatorChangeSignals);
    const matchedEvaluatorExampleSignals = matchSignals(sanitizedRequest, evaluatorExampleSignals);
    const parsedRunControl = parseRunControlRequest(normalizedRequest);
    const hasLocalizedSignalHint = [
        ...matchedHarnessSignals,
        ...matchedHarnessChangeSignals,
        ...matchedGapSignals,
        ...matchedSuccessSignals,
        ...matchedRunControlSignals,
        ...matchedResumeSignals,
        ...matchedRunStateSignals,
        ...matchedRunActionSignals,
        ...matchedEvaluatorSignals,
        ...matchedEvaluatorChangeSignals,
        ...matchedEvaluatorExampleSignals
    ].some((signal) => signal.includes("(ko)") || /[^\x00-\x7F]/.test(signal));
    const locale = detectIntentLocale(normalizedRequest) === "ko" || hasLocalizedSignalHint ? "ko" : "en";
    const productBuildDetection = detectProductBuildIntent(sanitizedRequest);
    const hasProductContext = productBuildDetection.is_product_build;
    const hasReferenceNoise = sanitizedRequest !== normalizedRequest;
    const hasHarnessSurface = matchedHarnessSignals.length > 0;
    const hasStrongHarnessSurface = matchedHarnessSignals.some((signal) => [
        "harness",
        "closed-loop harness",
        "generic closed-loop harness",
        "generic workbench",
        "Codex workbench",
        "closed-loop",
        "front door",
        "planner",
        "control plane",
        "operator surface",
        "operator UX",
        "loop:intent",
        "loop:intake",
        "AGENTS.md",
        "RUNBOOK.md",
        "patch-request",
        "trajectory-decision",
        "round-contract",
        "quality-critique",
        "resume-identity"
    ].includes(signal));
    const hasRepoSurface = matchedHarnessSignals.some((signal) => [
        "skills",
        "loop:intent",
        "loop:intake",
        "loop:run",
        "AGENTS.md",
        "RUNBOOK.md",
        "feature_list.generated.json",
        "progress.md",
        "progress.jsonl",
        "done_when.md",
        "init.sh",
        "patch-request",
        "trajectory-decision",
        "round-contract",
        "quality-critique",
        "resume-identity",
        "current-thread",
        "app-server",
        "worktree",
        "handoff",
        "automation",
        "transport-mode",
        "presentation_mode",
        "plugin",
        "marketplace"
    ].includes(signal));
    const productScore = (intake.is_product_build_request ? 4 : 0) +
        (isPrepareReadyIntakeStatus(intake.status) ? 1 : 0);
    const resumeScore = matchedResumeSignals.length +
        matchedRunStateSignals.length +
        matchedRunActionSignals.length +
        (runReference !== undefined ? 3 : 0);
    const explicitRunControl = matchedRunControlSignals.some((signal) => [
        "loop start",
        "start loop",
        "run loop",
        "start run",
        "show status",
        "loop status",
        "resume loop",
        "continue loop",
        "continue last run",
        "resume latest run",
        "pick up where left off",
        "monitor",
        "status",
        "loop:status",
        "loop:stop",
        "loop:start:bg",
        "loop:start:codex",
        "loop:start:manual",
        "루프 시작",
        "루프 상태",
        "정지",
        "중지",
        "모니터링"
    ].includes(signal));
    const runControlScore = explicitRunControl
        ? matchedRunControlSignals.length * 2 + (runReference !== undefined ? 1 : 0) + (hasRepoSurface ? 1 : 0)
        : 0;
    const explicitHarnessChange = hasHarnessSurface &&
        (matchedHarnessChangeSignals.length > 0 ||
            matchedGapSignals.length > 0 ||
            matchedSuccessSignals.length > 0 ||
            (hasStrongHarnessSurface && hasRepoSurface));
    const harnessScore = explicitHarnessChange
        ? matchedHarnessSignals.length +
            matchedHarnessChangeSignals.length * 2 +
            matchedGapSignals.length +
            matchedSuccessSignals.length +
            (hasRepoSurface ? 2 : 0)
        : 0;
    const explicitEvaluatorChange = matchedEvaluatorSignals.length > 0 &&
        (matchedEvaluatorChangeSignals.length > 0 ||
            matchedEvaluatorExampleSignals.length > 0 ||
            matchedSuccessSignals.length > 0);
    const evaluatorScore = explicitEvaluatorChange
        ? matchedEvaluatorSignals.length +
            matchedEvaluatorChangeSignals.length * 2 +
            matchedEvaluatorExampleSignals.length +
            matchedSuccessSignals.length +
            (hasRepoSurface ? 1 : 0)
        : 0;
    const directRunControlFastPath = parsedRunControl.action !== undefined &&
        !hasProductContext &&
        matchedHarnessChangeSignals.length === 0 &&
        matchedEvaluatorChangeSignals.length === 0;
    if (directRunControlFastPath) {
        return buildRunControlResult({
            request: normalizedRequest,
            locale,
            matchedRunControlSignals,
            runReference,
            parsed: parsedRunControl,
            confidenceScore: Math.max(runControlScore, 6),
            rationale: buildIntentRationale("run-control", matchedRunControlSignals, [
                `Direct run-control phrase mapped to '${parsedRunControl.action}'.`,
                ...(parsedRunControl.diagnostic_focus.length > 0
                    ? [`Secondary analysis: ${parsedRunControl.diagnostic_focus.join(", ")}.`]
                    : []),
                ...(runReference ? [`Target run reference: ${runReference}.`] : [])
            ])
        });
    }
    if (resumeScore >= 4 &&
        resumeScore >= productScore &&
        resumeScore >= runControlScore &&
        resumeScore >= harnessScore &&
        resumeScore >= evaluatorScore) {
        const states = buildResumeFieldStates(normalizedRequest, locale, matchedRunStateSignals, matchedRunActionSignals);
        const missingFields = buildMissingFields(states);
        return {
            intent: "run_resume",
            status: missingFields.length > 0 ? "ask_resume_questions" : "ready_for_handoff",
            phase: missingFields.length > 0 ? "intent" : "handoff",
            locale,
            confidence: calculateConfidence(resumeScore),
            route_target: "run_resume",
            questions: buildQuestions(states),
            missing_fields: missingFields,
            satisfied_fields: buildSatisfiedFields(states),
            rationale: buildIntentRationale("run-resume", [
                ...matchedResumeSignals,
                ...(runReference ? [runReference] : [])
            ]),
            extracted_run_reference: runReference
        };
    }
    if (runControlScore >= 4 &&
        runControlScore >= productScore &&
        runControlScore >= harnessScore &&
        runControlScore >= evaluatorScore) {
        return buildRunControlResult({
            request: normalizedRequest,
            locale,
            matchedRunControlSignals,
            runReference,
            parsed: parsedRunControl,
            confidenceScore: runControlScore,
            rationale: buildIntentRationale("run-control", matchedRunControlSignals, [
                ...(runReference ? [runReference] : []),
                ...(parsedRunControl.diagnostic_focus.length > 0
                    ? [`Secondary analysis: ${parsedRunControl.diagnostic_focus.join(", ")}.`]
                    : [])
            ])
        });
    }
    if (productScore > 0) {
        const explicitHarnessOverride = explicitHarnessChange &&
            (hasRepoSurface || harnessScore >= productScore + 2);
        const explicitEvaluatorOverride = explicitEvaluatorChange &&
            !hasProductContext &&
            (hasRepoSurface || evaluatorScore >= productScore + 1);
        if (!explicitHarnessOverride && !explicitEvaluatorOverride) {
            return buildProductResult(intake, buildIntentRationale("product-build", [], [
                `Detected a product-build request and kept loop:intake authoritative (${intake.status}).`,
                ...(matchedEvaluatorSignals.length > 0 && !explicitEvaluatorOverride
                    ? [
                        "Evaluator language appeared as product context rather than as a workbench-lane override."
                    ]
                    : []),
                ...(hasReferenceNoise
                    ? ["Reference URLs were ignored while scoring the lane."]
                    : [])
            ]), locale);
        }
    }
    if (harnessScore >= evaluatorScore && harnessScore >= 4) {
        const states = buildHarnessFieldStates(sanitizedRequest, locale, matchedHarnessSignals, matchedGapSignals, matchedSuccessSignals, matchedHarnessChangeSignals);
        const missingFields = buildMissingFields(states);
        return {
            intent: "harness_design",
            status: missingFields.length > 0 ? "ask_harness_questions" : "ready_for_handoff",
            phase: missingFields.length > 0 ? "intent" : "handoff",
            locale,
            confidence: calculateConfidence(harnessScore),
            route_target: "harness_design",
            questions: buildQuestions(states),
            missing_fields: missingFields,
            satisfied_fields: buildSatisfiedFields(states),
            rationale: buildIntentRationale("harness-design", matchedHarnessSignals, [
                ...(hasReferenceNoise ? ["Reference URLs were ignored while scoring the lane."] : [])
            ])
        };
    }
    if (evaluatorScore >= 4) {
        const states = buildEvaluatorFieldStates(sanitizedRequest, locale, matchedEvaluatorSignals, matchedEvaluatorExampleSignals, matchedSuccessSignals);
        const missingFields = buildMissingFields(states);
        return {
            intent: "evaluator_tuning",
            status: missingFields.length > 0 ? "ask_evaluator_questions" : "ready_for_handoff",
            phase: missingFields.length > 0 ? "intent" : "handoff",
            locale,
            confidence: calculateConfidence(evaluatorScore),
            route_target: "evaluator_tuning",
            questions: buildQuestions(states),
            missing_fields: missingFields,
            satisfied_fields: buildSatisfiedFields(states),
            rationale: buildIntentRationale("evaluator-tuning", matchedEvaluatorSignals, [
                ...(hasReferenceNoise ? ["Reference URLs were ignored while scoring the lane."] : [])
            ])
        };
    }
    if (intake.is_product_build_request) {
        return buildProductResult(intake, buildIntentRationale("product-build", [], [
            `Detected a product-build request and delegated to loop:intake (${intake.status}).`,
            ...(hasReferenceNoise ? ["Reference URLs were ignored while scoring the lane."] : [])
        ]), locale);
    }
    return {
        intent: "unknown",
        status: "unclassified",
        phase: "none",
        locale,
        confidence: 0.4,
        route_target: "clarify",
        questions: [
            locale === "ko"
                ? "\uC774 \uC694\uCCAD\uC740 product-build, harness-design, run-control, run-resume, evaluator-tuning \uC911 \uC5B4\uB290 \uB808\uC778\uC778\uAC00?"
                : localizedQuestion({
                    locale,
                    en: "Is this a product-build, harness-design, run-control, run-resume, or evaluator-tuning request?",
                    ko: "이 요청은 product-build, harness-design, run-resume, evaluator-tuning 중 어느 쪽인가?"
                }),
            localizedQuestion({
                locale,
                en: "What concrete output should the workbench produce next?",
                ko: "워크벤치가 다음으로 내야 할 구체적 산출물이 무엇인지 적어줘."
            })
        ],
        missing_fields: [],
        satisfied_fields: [],
        rationale: [
            "The request did not contain enough stable lane signals after stripping URL and reference noise."
        ]
    };
};
const renderReadyRoute = (result) => {
    const koreanRouteLine = result.route_target === "app_builder_loop"
        ? "\uACBD\uB85C: app-builder-loop \uC138\uC158\uC73C\uB85C \uC9C4\uD589."
        : result.route_target === "harness_design"
            ? "\uACBD\uB85C: harness-design \uB808\uC778\uC73C\uB85C \uC9C4\uD589."
            : result.route_target === "run_control"
                ? "\uACBD\uB85C: run-control \uB808\uC778\uC73C\uB85C \uC9C4\uD589."
                : result.route_target === "run_resume"
                    ? "\uACBD\uB85C: \uAE30\uC874 run\uC744 \uC774\uC5B4\uC11C \uC9C4\uD589."
                    : result.route_target === "evaluator_tuning"
                        ? "\uACBD\uB85C: evaluator calibration \uB808\uC778\uC73C\uB85C \uC9C4\uD589."
                        : "\uACBD\uB85C: \uC694\uCCAD\uC744 \uBA3C\uC800 \uBD84\uB958\uD574\uC57C \uD568.";
    const englishRouteLine = result.route_target === "app_builder_loop"
        ? "Route: proceed in the app-builder-loop session."
        : result.route_target === "harness_design"
            ? "Route: proceed in the harness-design lane."
            : result.route_target === "run_control"
                ? "Route: proceed in the run-control lane."
                : result.route_target === "run_resume"
                    ? "Route: resume the existing run."
                    : result.route_target === "evaluator_tuning"
                        ? "Route: proceed in the evaluator-calibration lane."
                        : "Route: clarify the request.";
    const routeLine = result.locale === "ko" ? koreanRouteLine : englishRouteLine;
    /*
    const routeLine =
      result.locale === "ko"
        ? koreanRouteLine
        : result.route_target === "app_builder_loop"
          ? "경로: product intake로 진행."
          : result.route_target === "harness_design"
            ? "경로: harness-design 레인으로 진행."
            : result.route_target === "run_resume"
              ? "경로: 기존 run을 이어서 진행."
              : result.route_target === "evaluator_tuning"
                ? "경로: evaluator calibration 레인으로 진행."
                : "경로: 요청을 먼저 분류해야 함."
        : result.route_target === "app_builder_loop"
          ? "Route: proceed in the app-builder-loop session."
          : result.route_target === "harness_design"
            ? "Route: proceed in the harness-design lane."
            : result.route_target === "run_control"
              ? "Route: proceed in the run-control lane."
            : result.route_target === "run_resume"
              ? "Route: resume the existing run."
            : result.route_target === "evaluator_tuning"
                ? "Route: proceed in the evaluator-calibration lane."
                : "Route: clarify the request.";
    */
    const lines = [
        result.locale === "ko" ? `의도: ${result.intent}` : `Intent: ${result.intent}`,
        routeLine
    ];
    if (result.extracted_run_reference) {
        lines.push(result.locale === "ko"
            ? `Run 참조: ${result.extracted_run_reference}`
            : `Run reference: ${result.extracted_run_reference}`);
    }
    if (result.locale === "en" && result.rationale.length > 0) {
        lines.push(result.rationale[0]);
    }
    return lines.join("\n");
};
const renderReadyRouteWithDispatch = (result) => {
    const koreanRouteLine = result.route_target === "app_builder_loop"
        ? "\uACBD\uB85C: app-builder-loop \uC138\uC158\uC73C\uB85C \uC9C4\uD589."
        : result.route_target === "harness_design"
            ? "\uACBD\uB85C: harness-design \uB808\uC778\uC73C\uB85C \uC9C4\uD589."
            : result.route_target === "run_control"
                ? "\uACBD\uB85C: run-control \uB808\uC778\uC73C\uB85C \uC9C4\uD589."
                : result.route_target === "run_resume"
                    ? "\uACBD\uB85C: \uAE30\uC874 run\uC744 \uC774\uC5B4\uC11C \uC9C4\uD589."
                    : result.route_target === "evaluator_tuning"
                        ? "\uACBD\uB85C: evaluator calibration \uB808\uC778\uC73C\uB85C \uC9C4\uD589."
                        : "\uACBD\uB85C: \uC694\uCCAD\uC744 \uBA3C\uC800 \uBD84\uB958\uD574\uC57C \uD568.";
    const englishRouteLine = result.route_target === "app_builder_loop"
        ? "Route: proceed in the app-builder-loop session."
        : result.route_target === "harness_design"
            ? "Route: proceed in the harness-design lane."
            : result.route_target === "run_control"
                ? "Route: proceed in the run-control lane."
                : result.route_target === "run_resume"
                    ? "Route: resume the existing run."
                    : result.route_target === "evaluator_tuning"
                        ? "Route: proceed in the evaluator-calibration lane."
                        : "Route: clarify the request.";
    const routeLine = result.locale === "ko" ? koreanRouteLine : englishRouteLine;
    const lines = [
        result.locale === "ko"
            ? `\uC758\uB3C4: ${result.intent}`
            : `Intent: ${result.intent}`,
        routeLine
    ];
    if (result.run_control_action) {
        lines.push(result.locale === "ko"
            ? `\uB3D9\uC791: ${result.run_control_action}`
            : `Action: ${result.run_control_action}`);
    }
    if (result.run_control_action === "start" && result.run_control_start_surface) {
        const startSurfaceLabel = result.run_control_start_surface === "background"
            ? result.locale === "ko"
                ? "\uBC31\uADF8\uB77C\uC6B4\uB4DC supervisor"
                : "background supervisor"
            : result.run_control_start_surface === "manual"
                ? "manual shell-owned protocol"
                : "Codex foreground current-thread";
        lines.push(result.locale === "ko"
            ? `\uC2DC\uC791 \uD45C\uBA74: ${startSurfaceLabel}`
            : `Start surface: ${startSurfaceLabel}`);
    }
    if (result.extracted_run_reference) {
        lines.push(result.locale === "ko"
            ? `Run \uCC38\uC870: ${result.extracted_run_reference}`
            : `Run reference: ${result.extracted_run_reference}`);
    }
    if (result.run_control_targets_all_runs) {
        lines.push(result.locale === "ko"
            ? "\uB300\uC0C1: \uBAA8\uB4E0 run"
            : "Target: all runs");
    }
    if (result.run_control_diagnostic_focus && result.run_control_diagnostic_focus.length > 0) {
        lines.push(result.locale === "ko"
            ? `\uC9C4\uB2E8 \uD3EC\uCEE4\uC2A4: ${result.run_control_diagnostic_focus.join(", ")}`
            : `Diagnostic focus: ${result.run_control_diagnostic_focus.join(", ")}`);
    }
    if (result.run_control_primary_command) {
        lines.push(result.locale === "ko"
            ? `\uBA85\uB839: ${result.run_control_primary_command}`
            : `Command: ${result.run_control_primary_command}`);
    }
    if (result.run_control_follow_up_commands && result.run_control_follow_up_commands.length > 0) {
        for (const command of result.run_control_follow_up_commands) {
            lines.push(result.locale === "ko"
                ? `\uB2E4\uC74C \uBA85\uB839: ${command}`
                : `Next command: ${command}`);
        }
    }
    if (result.run_control_follow_up_skills && result.run_control_follow_up_skills.length > 0) {
        for (const skill of result.run_control_follow_up_skills) {
            lines.push(result.locale === "ko"
                ? `\uB2E4\uC74C \uC2A4\uD0AC: $${skill}`
                : `Next skill: $${skill}`);
        }
    }
    if (result.run_control_dispatch_plan?.autocontinue?.enabled) {
        lines.push(result.locale === "ko"
            ? "\uC5F0\uC18D \uC2E4\uD589: same-thread autocontinue"
            : "Autocontinue: same-thread foreground");
        lines.push(result.locale === "ko"
            ? `\uBCF5\uAD6C \uC2A4\uD0AC: $${result.run_control_dispatch_plan.autocontinue.recovery_skill}`
            : `Recovery skill: $${result.run_control_dispatch_plan.autocontinue.recovery_skill}`);
    }
    if (result.locale === "en" && result.rationale.length > 0) {
        lines.push(result.rationale[0]);
    }
    return lines.join("\n");
};
export const renderLoopIntentResponse = (result) => {
    if (result.intent === "product_build" && result.intake) {
        return renderIntakeGateResponse(result.intake);
    }
    if (result.status === "ask_harness_questions" ||
        result.status === "ask_run_control_questions" ||
        result.status === "ask_resume_questions" ||
        result.status === "ask_evaluator_questions" ||
        result.status === "unclassified") {
        return result.questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
    }
    return renderReadyRouteWithDispatch(result);
};
//# sourceMappingURL=intent-gate.js.map