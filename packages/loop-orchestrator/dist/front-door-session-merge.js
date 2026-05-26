import { buildAdapterPlanFromIntake, normalizeVerificationSurfacesForFamily, parseVerificationSurfacesAnswer, parseWorkflowChecksAnswer } from "./adapter-plan.js";
import { evaluateIntakeRequest } from "./intake-gate.js";
import { evidenceSurfacesForProjectKind, inferProjectKindFromText } from "./evaluation-policy.js";
const listJoinPattern = /\s*(?:,|;|\band\b|\bor\b)\s*|\s+\/\s+/i;
const urlPattern = /https?:\/\/[^\s,;]+/gi;
const targetUsersLabelPattern = String.raw `target users?|primary users?|주\s*사용자|대상\s*사용자|사용자|유저|주\s*유저`;
const coreFeaturesLabelPattern = String.raw `core workflows?|workflows?|core features?|features?|핵심\s*작업|핵심\s*기능|핵심\s*플로우|첫\s*버전\s*기능`;
const finishLineLabelPattern = String.raw `good enough means|finish line(?: is)?|success means|mvp means|성공\s*기준|완성\s*기준|첫\s*버전\s*기준|MVP\s*기준`;
const referenceLabelPattern = String.raw `reference products?|reference apps?|reference visuals?|visual direction|references?|visuals?|참고\s*제품|참고\s*앱|참고\s*화면|참고|레퍼런스`;
const productTitleLabelPattern = String.raw `product title|app name|product name|제품명|앱\s*이름|서비스\s*이름`;
const nextIntakeLabelPattern = String.raw `good enough means|finish line|success means|mvp means|target users?|primary users?|core workflows?|workflows?|core features?|features?|references?|target root|target score|max(?:imum)? rounds?|run command|ready url|주\s*사용자|대상\s*사용자|핵심\s*작업|핵심\s*기능|핵심\s*플로우|참고\s*앱|참고|레퍼런스|성공\s*기준|완성\s*기준|작업\s*폴더|프로젝트\s*폴더|대상\s*폴더|경로`;
const coreFeaturesLabelPatternEnhanced = String.raw `${coreFeaturesLabelPattern}|\uD575\uC2EC\s*\uC791\uC5C5\uBCC4\s*\uC2E4\uC81C\s*\uB3D9\uC791|\uC791\uC5C5\uBCC4\s*\uC2E4\uC81C\s*\uB3D9\uC791|\uD575\uC2EC\s*\uC791\uC5C5|\uD575\uC2EC\s*\uAE30\uB2A5|\uD575\uC2EC\s*\uC6CC\uD06C\uD50C\uB85C|\uCCAB\s*\uBC84\uC804\s*\uAE30\uB2A5`;
const explicitTargetScorePattern = /\btarget\s*score\b|\bscore\b/i;
const explicitMaxRoundsPattern = /\bmax(?:imum)?\s*rounds?\b|\brounds?\b/i;
const uniqueStrings = (values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const normalizeInlineValue = (value) => value
    .replace(/^[:\-]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
const stripFinalSentencePunctuation = (value) => value
    .trim()
    .replace(/[!?]+$/u, "")
    .replace(/\.(?=\s*$)/u, "")
    .trim();
const workflowHeaderOnlyPattern = /^(?:\uD575\uC2EC\s*)?(?:\uC791\uC5C5|\uC6CC\uD06C\uD50C\uB85C)(?:\uBCC4)?\s*(?:\uC2E4\uC81C\s*)?(?:\uB3D9\uC791|\uAC80\uC99D|\uC131\uACF5\s*\uC870\uAC74)?\s*[:\uFF1A]?$/u;
const workflowHeaderRemainderPattern = /^(?:\uBCC4\s*)?(?:\uC2E4\uC81C\s*)?(?:\uB3D9\uC791|\uAC80\uC99D|\uC131\uACF5\s*\uC870\uAC74)\s*[:\uFF1A]?$/u;
const isWorkflowHeaderOnlyValue = (value) => {
    const normalized = normalizeInlineValue(value);
    return (workflowHeaderOnlyPattern.test(normalized) ||
        workflowHeaderRemainderPattern.test(normalized));
};
const protectUrls = (value) => {
    const urls = new Map();
    const protectedValue = value.replace(urlPattern, (url) => {
        const key = `__URL_${urls.size}__`;
        urls.set(key, stripFinalSentencePunctuation(url));
        return key;
    });
    return { protectedValue, urls };
};
const normalizeListEntry = (entry, urls) => {
    const normalized = normalizeInlineValue(entry);
    return urls.get(normalized) ?? stripFinalSentencePunctuation(normalized);
};
const splitKoreanEnumeratedList = (value) => {
    const parts = value
        .replace(/(?:^|\s)(?:\d+[.)]\s+|[①②③④⑤⑥⑦⑧⑨]\s*)/gu, "\n")
        .replace(/(?:^|\s)(?:첫째|둘째|셋째|넷째|다섯째)\s*/gu, "\n")
        .split(/\n+/u)
        .map((part) => normalizeInlineValue(part))
        .filter(Boolean);
    return parts.length > 1 ? parts : [normalizeInlineValue(value)];
};
const splitInlineList = (value) => {
    const enumerated = splitKoreanEnumeratedList(value);
    if (enumerated.length > 1) {
        return uniqueStrings(enumerated.map((entry) => stripFinalSentencePunctuation(entry)));
    }
    const { protectedValue, urls } = protectUrls(value);
    return uniqueStrings(protectedValue
        .replace(/\b(?:and|or)\b|및/gi, ",")
        .split(listJoinPattern)
        .map((entry) => normalizeListEntry(entry, urls)));
};
const splitAnswerLines = (message) => message
    .split(/\r?\n|(?<=\.)\s+(?=\d+[.)]\s*)/)
    .map((line) => line
    .replace(/^\s*(?:\d+[.)]|[-*])\s*/, "")
    .trim())
    .filter(Boolean);
const normalizeNoneAnswer = (value) => value
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .trim();
const trimAtNextIntakeLabel = (value) => value
    .replace(new RegExp(String.raw `\s+(?=(?:${nextIntakeLabelPattern})(?:\s*(?:can be|are|is|는|은|:|=)|\b)).+$`, "iu"), "")
    .trim();
const extractLabeledRestOfLine = (message, labelPattern) => {
    const match = new RegExp(String.raw `(?:^|[\r\n]|[.;!?。！？]\s*)(?:${labelPattern})\s*(?:can be|are|is|는|은|:|=)?\s*(.+)$`, "imu").exec(message);
    return match?.[1]
        ? stripFinalSentencePunctuation(trimAtNextIntakeLabel(match[1]))
        : undefined;
};
const isNoneAnswer = (value) => /^(?:none|no|no references?|없음|없어|없어요|없습니다|없다)$/i.test(normalizeNoneAnswer(value));
const parseTargetScoreAnswer = (value) => {
    const match = value.match(/\b(?:0?\.\d+|1(?:\.0)?|\d{1,3})\b/);
    if (!match) {
        return undefined;
    }
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    const normalized = parsed > 1 ? parsed / 100 : parsed;
    return normalized > 0 && normalized <= 1 ? normalized : undefined;
};
const parseMaxRoundsAnswer = (value) => {
    const match = value.match(/\b\d{1,2}\b/);
    if (!match) {
        return undefined;
    }
    const parsed = Number(match[0]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};
const parseStrictnessLevel = (value) => {
    const match = value.match(/(?:strictness|엄격도|까다롭|깐깐|출시\s*리뷰)[^\d]{0,12}([1-5])/iu) ??
        value.match(/([1-5])\s*(?:단계|level)\s*(?:엄격|strict)/iu);
    const parsed = match?.[1] ? Number(match[1]) : undefined;
    return parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5
        ? parsed
        : undefined;
};
const normalizeMetricId = (label) => `custom.${label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "metric"}`;
const parseCustomQualityMetrics = (value) => {
    const metrics = splitAnswerLines(value)
        .map((line) => {
        const match = line.match(/^(?:추가\s*)?(?:평가\s*)?(?:기준\s*)?([^:：>=]+?)\s*[:：]\s*(?:최소\s*)?([0-9]+(?:\.[0-9]+)?)\s*(?:점|\/\s*10)?\.?\s*(.*)$/u) ??
            line.match(/^([^:：>=]+?)\s*(?:>=|이상|최소)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:점|\/\s*10)?\.?\s*(.*)$/u);
        if (!match?.[1] || !match[2]) {
            return undefined;
        }
        const label = normalizeInlineValue(match[1]).replace(/^[-*]\s*/u, "");
        const score = Number(match[2]);
        if (!label || !Number.isFinite(score)) {
            return undefined;
        }
        const description = normalizeInlineValue(match[3] ?? "") || `${label} quality dimension.`;
        return {
            metric_id: normalizeMetricId(label),
            label,
            description,
            minimum_score_out_of_ten: score > 10 ? score / 10 : score,
            required: !/optional|선택|참고/u.test(value),
            weight: /디자인|깔끔|텍스트|문구|앱스러|visual|design|copy/u.test(label)
                ? 2
                : 1
        };
    })
        .filter((metric) => metric !== undefined);
    return metrics.length > 0 ? metrics : undefined;
};
const inferProjectKindCandidate = (value) => {
    const projectKind = inferProjectKindFromText(value);
    return projectKind === "generic" ? undefined : projectKind;
};
const evidenceSurfacesForCandidate = (projectKind, explicitSurfaces) => {
    const surfaces = [
        ...(explicitSurfaces ?? []),
        ...(projectKind ? evidenceSurfacesForProjectKind(projectKind) : [])
    ];
    return surfaces.length > 0 ? [...new Set(surfaces)] : undefined;
};
const firstMatch = (value, patterns) => {
    for (const pattern of patterns) {
        const match = pattern.exec(value);
        const capture = match?.[1]?.trim();
        if (capture) {
            return normalizeInlineValue(capture);
        }
    }
    return undefined;
};
const firstSentence = (value) => value
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .find(Boolean);
const koBuildVerbPattern = /(?:만들|만들어|만들어줘|구현|개발|제작|설계|기획|빌드)/u;
const koProductSurfacePattern = /(?:앱|웹앱|서비스|사이트|대시보드|툴|도구|시스템|포털|에디터|편집기|API|api)/u;
const enBuildVerbPattern = /\b(?:build|create|make|prototype|ship)\b/i;
const enProductSurfacePattern = /\b(?:app|application|web app|website|site|dashboard|tool|service|system|portal|editor|api|agent)\b/i;
const looksLikeProductBuildRequestSentence = (sentence) => {
    const normalized = sentence.trim();
    return ((koBuildVerbPattern.test(normalized) && koProductSurfacePattern.test(normalized)) ||
        (enBuildVerbPattern.test(normalized) && enProductSurfacePattern.test(normalized)));
};
const titleCase = (value) => value
    .split(/\s+/)
    .map((word) => (word.length > 0 ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
const deriveProductTitle = (request) => {
    const normalized = normalizeInlineValue(request)
        .replace(/[.!?。！？]+$/u, "")
        .trim();
    if (!normalized) {
        return undefined;
    }
    const ko = normalized
        .replace(/(?:을|를)?\s*(?:만들어줘|만들어 줘|만들어|구현해줘|구현해 줘|구현|개발해줘|제작해줘|빌드해줘)\s*$/u, "")
        .trim();
    if (ko !== normalized && ko.length >= 2 && ko.length <= 80) {
        return ko;
    }
    const enBuildObject = normalized.match(/\b(?:build|create|make|prototype|ship)\b\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?(.+?)(?:\s+for\s+.+)?$/i)?.[1];
    if (enBuildObject) {
        return titleCase(enBuildObject.replace(/[.!?]+$/u, "").trim());
    }
    return normalized.length <= 80 ? normalized : undefined;
};
const extractExplicitTargetUsers = (message) => {
    const labeledMatch = extractLabeledRestOfLine(message, targetUsersLabelPattern);
    const explicitMatch = labeledMatch ??
        firstMatch(message, [
            /\b(?:target users?|primary users?)\s*(?:are|is|:)\s*(.+?)(?:[.!?]|$)/i,
            /\b(?:target users?|primary users?)\s+(?!can\b)(.+?)(?:[.!?]|$)/i,
            /\busers?\s*(?:are|is|:)\s*(.+?)(?:[.!?]|$)/i
        ]);
    return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};
const extractImplicitTargetUsers = (message) => {
    const explicitForMatch = firstMatch(message, [/\bfor\s+(.+?)(?:[.!?]|$)/i]);
    if (explicitForMatch) {
        return splitInlineList(explicitForMatch);
    }
    const sentences = message
        .split(/(?<=[.!?。！？])\s+/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    const first = sentences[0];
    if (first && looksLikeProductBuildRequestSentence(first)) {
        return undefined;
    }
    if (sentences.length >= 1 &&
        first !== undefined &&
        first.split(/\s+/).length <= 6 &&
        !/\b(build|create|make|prototype|ship|references?|good enough|finish line|this is|target root|target score|max rounds?|run command|ready url|new project|existing project)\b/i.test(first)) {
        return [first.replace(/[.!?。！？]+$/u, "").trim()];
    }
    return undefined;
};
const extractExplicitCoreFeatures = (message) => {
    const labeledMatch = extractLabeledRestOfLine(message, coreFeaturesLabelPatternEnhanced);
    const explicitMatch = labeledMatch ??
        firstMatch(message, [
            /\b(?:core workflows?|workflows?|core features?|features?)\s*(?:are|is|:)?\s*(.+?)(?:[.!?]|$)/i
        ]);
    if (!explicitMatch) {
        return undefined;
    }
    const features = splitInlineList(explicitMatch).filter((entry) => !isWorkflowHeaderOnlyValue(entry));
    return features.length > 0 ? features : undefined;
};
const extractImplicitCoreFeatures = (message) => {
    const explicitMatch = firstMatch(message, [
        /\b(?:the )?first version needs\s+(.+?)(?:[.!?]|$)/i,
        /\bmust\s+(.+?)(?:[.!?]|$)/i,
        /\bneeds? to\s+(.+?)(?:[.!?]|$)/i
    ]);
    return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};
const extractExplicitReferenceApps = (message) => {
    const value = extractLabeledRestOfLine(message, referenceLabelPattern);
    if (!value) {
        return undefined;
    }
    if (isNoneAnswer(value)) {
        return [];
    }
    return splitInlineList(value);
};
const extractImplicitReferenceApps = (message) => {
    if (isNoneAnswer(message)) {
        return [];
    }
    const explicitMatch = firstMatch(message, [/\blike\s+(.+?)(?:[.!?]|$)/i]);
    return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};
const extractFinishLine = (message) => extractLabeledRestOfLine(message, finishLineLabelPattern) ??
    firstMatch(message, [
        /\b(?:good enough means|finish line(?: is)?|success means|mvp means)\s+(.+?)(?:[.!?]|$)/i
    ]);
const extractCommand = (message, patterns) => firstMatch(message, patterns);
const extractUrl = (message, label) => {
    const pattern = new RegExp(`\\b${label}\\s*(?:is|:)?\\s*(https?:\\/\\/[^\\s]+)`, "i");
    return firstMatch(message, [pattern]);
};
const isExecutionQuestionPair = (questionIds) => questionIds.some((fieldId) => [
    "project_mode",
    "target_root",
    "target_score",
    "max_rounds",
    "run_command",
    "ready_url"
].includes(fieldId));
const isAdapterQuestionPair = (questionIds) => questionIds.some((fieldId) => ["verification_surface", "workflow_checks", "quality_metrics"].includes(fieldId));
const messageExplicitlyAnswersAdapterDesign = (message) => /(?:\uAC80\uC99D\s*(?:\uBC29\uC2DD|\uC218\uB2E8|\uBC29\uBC95)|verification\s*surface|verify\s+with|browser\s+verification|screen\s+verification|\uD654\uBA74\uC73C\uB85C\s*\uAC80\uC99D|\uBE0C\uB77C\uC6B0\uC800\uB85C\s*\uAC80\uC99D|API\uB85C\s*\uAC80\uC99D|\uD14C\uC2A4\uD2B8\s*\uBA85\uB839\uC73C\uB85C\s*\uAC80\uC99D)/iu.test(message);
const answerForField = (lines, index, isGroupedPair) => {
    if (lines[index]) {
        return lines[index];
    }
    if (lines.length === 1 && isGroupedPair) {
        return lines[0];
    }
    return undefined;
};
const stripTrailingPunctuation = (value) => value.replace(/[.!?]+$/u, "");
const parsePathAnswer = (value) => {
    const candidate = value.match(/[A-Za-z]:\\[^\r\n,;!?]+/)?.[0] ??
        value.match(/(?:^|[\s,;:=])((?:\/|\.\/|\.\.\/)[^\s,;.!?]+)/)?.[1] ??
        value.match(/(?<!\/)[A-Za-z0-9._-]+(?:[\\/][^\s,;.!?]+)+/)?.[0];
    return candidate ? stripTrailingPunctuation(candidate).trim() : undefined;
};
const parseUrlAnswer = (value) => {
    const candidate = value.match(/https?:\/\/[^\s,;]+/)?.[0];
    return candidate ? stripTrailingPunctuation(candidate).trim() : undefined;
};
const parseRunCommandAnswer = (value) => {
    const withoutUrl = value.replace(/,?\s*https?:\/\/[^\s,;]+/i, "").trim();
    const candidate = withoutUrl.match(/\b(?:npm|pnpm|yarn|bun|node|python|python3|uvicorn|docker(?: compose)?|make)\s+[^\r\n,;]+/i)?.[0];
    return candidate?.trim();
};
const stripKoreanSentenceEnding = (value) => value
    .replace(/[.!?\u3002\uFF01\uFF1F,，;；]+$/u, "")
    .trim()
    .replace(/(?:\uC774\uC57C|\uC57C|\uC785\uB2C8\uB2E4|\uC608\uC694|\uC774\uC5D0\uC694|\uC774\uACE0|\uC774\uBA70|\uC774\uB2E4|\uC784)$/u, "")
    .trim();
const normalizeKoreanUserValue = (value) => {
    const cleaned = stripKoreanSentenceEnding(normalizeInlineValue(value)
        .replace(/^(?:\uC8FC\s*)?(?:\uB300\uC0C1\s*)?(?:\uC0AC\uC6A9\uC790|\uC720\uC800|\uC774\uC6A9\uC790|\uACE0\uAC1D)(?:\uC740|\uB294|:|=)?\s*/u, "")
        .replace(/^(?:\uB300\uC0C1|\uC8FC\s*\uB300\uC0C1)(?:\uC740|\uB294|:|=)?\s*/u, "")
        .replace(/(?:\uAC00|\uC774|\uC744|\uB97C|\uC5D0\uAC8C|\uC6A9)$/u, "")
        .trim());
    return cleaned === "\uAC1C\uC778" ? "\uAC1C\uC778 \uC0AC\uC6A9\uC790" : cleaned;
};
const normalizeKoreanCoreWorkflowText = (value) => stripKoreanSentenceEnding(normalizeInlineValue(value)
    .replace(/^(?:(?:\uD575\uC2EC|\uC8FC\uC694)?\s*(?:\uC791\uC5C5|\uAE30\uB2A5|\uC6CC\uD06C\uD50C\uB85C|\uD750\uB984)(?:\uBCC4)?(?:\s*\uC2E4\uC81C\s*(?:\uB3D9\uC791|\uAC80\uC99D|\uC131\uACF5\s*\uC870\uAC74))?|\uD575\uC2EC|\uC8FC\uC694|\uD574\uC57C\s*\uD558\uB294\s*(?:\uAC83|\uC791\uC5C5)?)(?:\uC740|\uB294|:|=)?\s*/u, "")
    .trim());
const normalizeKoreanFinishLineValue = (value) => stripKoreanSentenceEnding(normalizeInlineValue(value)
    .replace(/^(?:\uC131\uACF5\s*\uAE30\uC900|\uC131\uACF5|\uC644\uB8CC\s*\uAE30\uC900)(?:\uC740|\uB294|:)?\s*/u, "")
    .trim())
    .replace(/(?:\uD558\uB294\s*)?\uAC70$/u, "")
    .trim();
const extractKoreanNaturalProductAnswers = (message, questionIds) => {
    const result = {};
    const asksTargetUsers = questionIds.includes("target_users");
    const asksCoreWorkflows = questionIds.includes("core_workflows");
    const asksFinishLine = questionIds.includes("finish_line");
    if (!asksTargetUsers && !asksCoreWorkflows && !asksFinishLine) {
        return result;
    }
    const sentences = message
        .split(/[.!?\n\u3002]+/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    if (asksTargetUsers) {
        const explicitUserMatch = message.match(/(?:^|[.!?\n\u3002]\s*)(?:\uB300\uC0C1|\uC0AC\uC6A9\uC790|\uC720\uC800|\uACE0\uAC1D)(?:\uC740|\uB294|:)\s*([^.!?\n\u3002,]+?)(?:\uC774\uC57C|\uC57C|\uC785\uB2C8\uB2E4|\uC608\uC694|\uC774\uACE0|,|$)/u);
        const userSentence = sentences.find((sentence) => /(?:\uC0AC\uC6A9\uC790|\uC720\uC800|\uACE0\uAC1D|\uAC1C\uC778|\uD300|\uAD00\uB9AC\uC790|\uD559\uC0DD|\uC9C1\uC6D0)/u.test(sentence) &&
            /(?:\uC4F8|\uC0AC\uC6A9|\uC774\uC6A9|\uB300\uC0C1|\uC704\uD55C|\uC6A9)/u.test(sentence));
        const userMatch = userSentence?.match(/([\p{Letter}\p{Number}\s]+?(?:\uC0AC\uC6A9\uC790|\uC720\uC800|\uACE0\uAC1D|\uAC1C\uC778|\uD300|\uAD00\uB9AC\uC790|\uD559\uC0DD|\uC9C1\uC6D0))/u);
        const userValue = normalizeKoreanUserValue(explicitUserMatch?.[1] ?? userMatch?.[1] ?? "");
        if (userValue) {
            result.target_users = [userValue];
        }
    }
    if (asksCoreWorkflows) {
        const coreAfterKeywordMatch = message.match(/(?:\uD575\uC2EC|\uC8FC\uC694\s*\uAE30\uB2A5|\uC8FC\uC694|\uAE30\uB2A5|\uC791\uC5C5|\uD574\uC57C\s*\uD558\uB294\s*(?:\uAC83|\uC791\uC5C5)?)(?:\uC740|\uB294|:)\s*([^.!?\n\u3002]+?)(?:\uC774\uC57C|\uC57C|\uC785\uB2C8\uB2E4|\uC608\uC694|\uC774\uACE0|$)/u);
        const coreMatch = coreAfterKeywordMatch ??
            message.match(/(?:^|[,.;\n])\s*([^.!?\n\u3002]+?)(?:\uAC00|\uC774)?\s*(?:\uD575\uC2EC|\uC8FC\uC694|\uBC18\uB4DC\uC2DC|\uAE30\uB2A5|\uC791\uC5C5)/u) ??
            message.match(/([^.!?\n\u3002]+?(?:\uAE30\uB85D|\uAD00\uB9AC|\uD1B5\uACC4|\uCD94\uAC00|\uC0AD\uC81C|\uC870\uD68C|\uBCF4\uAE30)[^.!?\n\u3002]*)/u);
        const coreText = normalizeKoreanCoreWorkflowText(coreMatch?.[1]
            ?.replace(/^.*(?:\uC4F8|\uC0AC\uC6A9|\uC774\uC6A9).*?(?:,|\uADF8\uB9AC\uACE0|\uBC0F)\s*/u, "")
            .trim() ?? "");
        const features = coreText
            ? splitInlineList(coreText)
                .map((entry) => normalizeKoreanCoreWorkflowText(entry.replace(/(?:\uAC00|\uC774)?\s*(?:\uD575\uC2EC|\uC8FC\uC694).*$/u, "")))
                .filter((entry) => entry.length > 0 &&
                !isWorkflowHeaderOnlyValue(entry) &&
                !/(?:\uC131\uACF5|\uB418\uBA74|\uD655\uC778\s*\uAC00\uB2A5)/u.test(entry))
            : [];
        if (features.length > 0) {
            result.core_features = features;
        }
    }
    if (asksFinishLine) {
        const explicitFinishMatch = message.match(/(?:\uC131\uACF5\s*\uAE30\uC900|\uC131\uACF5|\uC644\uB8CC\s*\uAE30\uC900)(?:\uC740|\uB294|:)?\s*([^.!?\n\u3002]+?)(?:\uC774\uC57C|\uC57C|\uC785\uB2C8\uB2E4|\uC608\uC694|\uC774\uACE0|$)/u) ??
            message.match(/([^.!?\n\u3002]*(?:\uC131\uACF5|\uB418\uBA74|\uC644\uB8CC|\uCDA9\uBD84|good enough|\uD655\uC778)[^.!?\n\u3002]*)/iu);
        const finishLine = explicitFinishMatch?.[1]?.trim();
        if (finishLine) {
            result.finish_line = normalizeKoreanFinishLineValue(finishLine);
        }
    }
    return result;
};
const extractCandidatesFromQuestionOrder = (message, questionIds, existingIntake) => {
    const lines = splitAnswerLines(message);
    if (lines.length === 0 || questionIds.length === 0) {
        return {};
    }
    const isExecutionPair = isExecutionQuestionPair(questionIds);
    const isAdapterPair = isAdapterQuestionPair(questionIds);
    const isGroupedPair = isExecutionPair || isAdapterPair;
    if (questionIds.length > 1 && lines.length < 2 && !isGroupedPair) {
        const naturalProductAnswers = extractKoreanNaturalProductAnswers(message, questionIds);
        if (Object.keys(naturalProductAnswers).length > 0) {
            return naturalProductAnswers;
        }
        return {};
    }
    const result = {};
    questionIds.forEach((fieldId, index) => {
        const answer = answerForField(lines, index, isGroupedPair);
        if (!answer) {
            return;
        }
        switch (fieldId) {
            case "target_users":
                result.target_users = splitInlineList(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(answer)
                    ? normalizeKoreanUserValue(answer)
                    : answer);
                break;
            case "core_workflows":
                result.core_features = splitInlineList(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(answer)
                    ? normalizeKoreanCoreWorkflowText(answer)
                    : answer).map((entry) => /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(entry)
                    ? normalizeKoreanCoreWorkflowText(entry)
                    : entry).filter((entry) => entry.length > 0 && !isWorkflowHeaderOnlyValue(entry));
                break;
            case "references":
                result.reference_apps = isNoneAnswer(answer) ? [] : splitInlineList(answer);
                break;
            case "finish_line":
                result.finish_line = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(answer)
                    ? normalizeKoreanFinishLineValue(answer)
                    : normalizeInlineValue(answer);
                break;
            case "project_mode":
                if (/\bnew\b|\bfrom scratch\b|\bnew project\b|새\s*프로젝트|처음부터|새로/u.test(answer)) {
                    result.project_mode = "new";
                }
                else if (/\bexisting\b|\bcurrent\b|\bexisting project\b|기존\s*프로젝트|현재/u.test(answer)) {
                    result.project_mode = "existing";
                }
                break;
            case "target_root":
                {
                    const parsedPath = parsePathAnswer(answer);
                    if (parsedPath) {
                        result.target_root = parsedPath;
                    }
                    else if (!(isExecutionPair && questionIds.length > 1)) {
                        result.target_root = normalizeInlineValue(answer);
                    }
                }
                break;
            case "target_score": {
                const targetScore = parseTargetScoreAnswer(answer);
                if (targetScore !== undefined) {
                    result.target_score = targetScore;
                }
                break;
            }
            case "max_rounds": {
                const maxRounds = parseMaxRoundsAnswer(answer);
                if (maxRounds !== undefined) {
                    result.max_rounds = maxRounds;
                }
                break;
            }
            case "run_command":
                result.run_command =
                    parseRunCommandAnswer(answer) ?? normalizeInlineValue(answer);
                break;
            case "ready_url":
                result.ready_url = parseUrlAnswer(answer) ?? normalizeInlineValue(answer);
                break;
            case "verification_surface": {
                const surfaces = parseVerificationSurfacesAnswer(answer);
                if (surfaces.length > 0) {
                    result.verification_surfaces = existingIntake?.target_family
                        ? normalizeVerificationSurfacesForFamily(existingIntake.target_family, surfaces)
                        : surfaces;
                }
                break;
            }
            case "workflow_checks": {
                const existingSurfaces = existingIntake?.target_family
                    ? normalizeVerificationSurfacesForFamily(existingIntake.target_family, existingIntake.verification_surfaces)
                    : existingIntake?.verification_surfaces;
                const surface = result.verification_surfaces?.[0] ??
                    existingSurfaces?.[0] ??
                    "browser";
                const checks = parseWorkflowChecksAnswer(isAdapterPair ? message : answer, surface);
                if (checks.length > 0) {
                    result.workflow_checks = checks;
                }
                break;
            }
            default:
                break;
        }
    });
    return result;
};
const explicitFieldMentions = (message) => ({
    targetScore: explicitTargetScorePattern.test(message),
    maxRounds: explicitMaxRoundsPattern.test(message)
});
const targetRootValuePattern = String.raw `(?:[A-Za-z]:\\[^\r\n\s),.;!?]+|(?:\/|\.\/|\.\.\/)[^\r\n\s),.;!?]+|[A-Za-z0-9._-]+(?:[\\/][^\r\n\s),.;!?]+)+)`;
const extractTargetRootFromMessage = (message) => {
    const match = new RegExp(String.raw `(?:target root|root(?: directory)?|working directory|project root|target folder|working folder|\uC791\uC5C5\s*\uD3F4\uB354|\uC791\uC5C5\uD3F4\uB354|\uB300\uC0C1\s*\uD3F4\uB354|\uD504\uB85C\uC81D\uD2B8\s*\uD3F4\uB354|\uD3F4\uB354|\uACBD\uB85C)\s*(?:is|\uB294|\uC740|:|=)?\s*(${targetRootValuePattern})`, "iu").exec(message)?.[1];
    return match?.trim();
};
const extractCandidates = (input) => {
    const { message, sourceRequest, intakeResult } = input;
    const previousQuestionIds = input.previousQuestionIds ?? [];
    const hasQuestionContext = previousQuestionIds.length > 0;
    const previousQuestionSet = new Set(previousQuestionIds);
    const acceptsAdapterAnswer = isAdapterQuestionPair(previousQuestionIds) ||
        messageExplicitlyAnswersAdapterDesign(message);
    const messageOnlyIntakeResult = message === sourceRequest ? intakeResult : evaluateIntakeRequest(message);
    const targetRootFromMessage = extractTargetRootFromMessage(message);
    const shouldImplicitlyParse = (field) => !hasQuestionContext || previousQuestionSet.has(field);
    const explicit = explicitFieldMentions(message);
    const productTitle = extractLabeledRestOfLine(message, productTitleLabelPattern) ??
        deriveProductTitle(sourceRequest) ??
        deriveProductTitle(message);
    const productSummary = intakeResult.extracted_summary ??
        firstSentence(sourceRequest) ??
        firstSentence(message);
    const targetUsers = extractExplicitTargetUsers(message) ??
        (shouldImplicitlyParse("target_users")
            ? extractImplicitTargetUsers(message)
            : undefined) ??
        (!hasQuestionContext
            ? extractExplicitTargetUsers(sourceRequest) ??
                extractImplicitTargetUsers(sourceRequest)
            : undefined);
    const coreFeatures = extractExplicitCoreFeatures(message) ??
        (shouldImplicitlyParse("core_workflows")
            ? extractImplicitCoreFeatures(message)
            : undefined) ??
        (!hasQuestionContext && message === sourceRequest
            ? extractExplicitCoreFeatures(sourceRequest) ??
                extractImplicitCoreFeatures(sourceRequest)
            : undefined);
    const referenceApps = extractExplicitReferenceApps(message) ??
        (shouldImplicitlyParse("references")
            ? extractImplicitReferenceApps(message)
            : undefined) ??
        (!hasQuestionContext && message === sourceRequest
            ? extractExplicitReferenceApps(sourceRequest) ??
                extractImplicitReferenceApps(sourceRequest)
            : undefined);
    const finishLine = extractFinishLine(message) ??
        (!hasQuestionContext && message === sourceRequest
            ? extractFinishLine(sourceRequest)
            : undefined);
    const runCommand = extractCommand(message, [
        /\brun command\s*(?:is|:)?\s*(.+?)(?:[.!?]|$)/i,
        /\bstart command\s*(?:is|:)?\s*(.+?)(?:[.!?]|$)/i
    ]);
    const checkCommand = extractCommand(message, [
        /\bcheck command\s*(?:is|:)?\s*(.+?)(?:[.!?]|$)/i
    ]);
    const readyUrl = extractUrl(message, "ready url");
    const appUrl = extractUrl(message, "app url");
    const healthUrl = extractUrl(message, "health url");
    const apiBaseUrl = extractUrl(message, "api base url");
    const projectKind = inferProjectKindCandidate(`${sourceRequest}\n${message}`) ??
        input.existingIntake?.project_kind;
    const strictnessLevel = parseStrictnessLevel(message) ??
        (message === sourceRequest ? parseStrictnessLevel(sourceRequest) : undefined);
    const customQualityMetrics = parseCustomQualityMetrics(message);
    const rawExplicitVerificationSurfaces = parseVerificationSurfacesAnswer(message);
    const explicitVerificationSurfaces = input.existingIntake?.target_family && rawExplicitVerificationSurfaces.length
        ? normalizeVerificationSurfacesForFamily(input.existingIntake.target_family, rawExplicitVerificationSurfaces)
        : rawExplicitVerificationSurfaces;
    const candidateVerificationSurfaces = acceptsAdapterAnswer && intakeResult.extracted_verification_surfaces?.length
        ? intakeResult.extracted_verification_surfaces
        : explicitVerificationSurfaces.length
            ? explicitVerificationSurfaces
            : undefined;
    const workflowChecksFromMessage = parseWorkflowChecksAnswer(message, candidateVerificationSurfaces?.[0] ??
        input.existingIntake?.verification_surfaces?.[0] ??
        "browser");
    const candidateWorkflowChecks = acceptsAdapterAnswer && intakeResult.extracted_workflow_checks?.length
        ? intakeResult.extracted_workflow_checks
        : acceptsAdapterAnswer && workflowChecksFromMessage.length
            ? workflowChecksFromMessage
            : undefined;
    const evidenceSurfaces = evidenceSurfacesForCandidate(projectKind, candidateVerificationSurfaces);
    const regexCandidates = {
        ...(productTitle ? { product_title: productTitle } : {}),
        ...(productSummary ? { product_summary: productSummary } : {}),
        ...(targetUsers ? { target_users: targetUsers } : {}),
        ...(coreFeatures ? { core_features: coreFeatures } : {}),
        ...(referenceApps ? { reference_apps: referenceApps } : {}),
        ...(finishLine ? { finish_line: finishLine } : {}),
        ...(intakeResult.internal_working_hypothesis
            ? { target_family: intakeResult.internal_working_hypothesis }
            : {}),
        ...(messageOnlyIntakeResult.extracted_project_mode ??
            intakeResult.extracted_project_mode
            ? {
                project_mode: messageOnlyIntakeResult.extracted_project_mode ??
                    intakeResult.extracted_project_mode
            }
            : {}),
        ...(targetRootFromMessage ??
            messageOnlyIntakeResult.extracted_target_root ??
            intakeResult.extracted_target_root
            ? {
                target_root: targetRootFromMessage ??
                    messageOnlyIntakeResult.extracted_target_root ??
                    intakeResult.extracted_target_root
            }
            : {}),
        ...(explicit.targetScore && intakeResult.extracted_target_score !== undefined
            ? { target_score: intakeResult.extracted_target_score }
            : {}),
        ...(explicit.maxRounds && intakeResult.extracted_max_rounds !== undefined
            ? { max_rounds: intakeResult.extracted_max_rounds }
            : {}),
        ...(runCommand ? { run_command: runCommand } : {}),
        ...(checkCommand ? { check_command: checkCommand } : {}),
        ...(readyUrl ? { ready_url: readyUrl } : {}),
        ...(appUrl ? { app_url: appUrl } : {}),
        ...(healthUrl ? { health_url: healthUrl } : {}),
        ...(apiBaseUrl ? { api_base_url: apiBaseUrl } : {}),
        ...(projectKind ? { project_kind: projectKind } : {}),
        ...(strictnessLevel ? { strictness_level: strictnessLevel } : {}),
        ...(evidenceSurfaces?.length ? { evidence_surfaces: evidenceSurfaces } : {}),
        ...(customQualityMetrics?.length
            ? { custom_quality_metrics: customQualityMetrics }
            : {}),
        ...(candidateVerificationSurfaces?.length
            ? { verification_surfaces: candidateVerificationSurfaces }
            : {}),
        ...(candidateWorkflowChecks?.length
            ? { workflow_checks: candidateWorkflowChecks }
            : {})
    };
    return {
        ...regexCandidates,
        ...extractCandidatesFromQuestionOrder(message, previousQuestionIds, input.existingIntake)
    };
};
const areArraysEquivalent = (left, right) => {
    if (!left && !right) {
        return true;
    }
    if (!left || !right || left.length !== right.length) {
        return false;
    }
    const leftSorted = [...left].sort();
    const rightSorted = [...right].sort();
    return leftSorted.every((value, index) => value === rightSorted[index]);
};
const removeConflictsForField = (conflicts, field) => {
    for (let index = conflicts.length - 1; index >= 0; index -= 1) {
        if (conflicts[index]?.field === field) {
            conflicts.splice(index, 1);
        }
    }
};
const applyScalarField = (target, field, candidate, sourceTurn, conflicts, options = {}) => {
    const targetRecord = target;
    if (candidate === undefined) {
        return;
    }
    const existing = targetRecord[field];
    if (existing === undefined || options.replace) {
        targetRecord[field] = candidate;
        removeConflictsForField(conflicts, field);
        return;
    }
    if (existing === candidate) {
        return;
    }
    conflicts.push({
        field,
        existing_value: existing,
        candidate_value: candidate,
        source_turn: sourceTurn
    });
};
const applyArrayField = (target, field, candidate, sourceTurn, conflicts, options = {}) => {
    if (candidate === undefined) {
        return;
    }
    const normalizedCandidate = uniqueStrings(candidate);
    if (options.replace) {
        target[field] = normalizedCandidate;
        removeConflictsForField(conflicts, field);
        return;
    }
    const existing = target[field];
    if (existing === undefined) {
        target[field] = normalizedCandidate;
        return;
    }
    if (normalizedCandidate.length === 0 && existing.length > 0) {
        conflicts.push({
            field,
            existing_value: existing,
            candidate_value: normalizedCandidate,
            source_turn: sourceTurn
        });
        return;
    }
    const merged = uniqueStrings([...existing, ...normalizedCandidate]);
    if (!areArraysEquivalent(existing, merged)) {
        target[field] = merged;
    }
};
const applyVerificationSurfaces = (target, candidate, conflicts, options = {}) => {
    if (!candidate) {
        return;
    }
    const normalizedCandidate = [...new Set(candidate)];
    if (normalizedCandidate.length === 0) {
        return;
    }
    if (!target.verification_surfaces || options.replace) {
        target.verification_surfaces = normalizedCandidate;
        removeConflictsForField(conflicts, "verification_surfaces");
        return;
    }
    target.verification_surfaces = [...new Set([...target.verification_surfaces, ...normalizedCandidate])];
};
const applyEvidenceSurfaces = (target, candidate, conflicts, options = {}) => {
    if (!candidate?.length) {
        return;
    }
    const normalizedCandidate = [...new Set(candidate)];
    if (!target.evidence_surfaces || options.replace) {
        target.evidence_surfaces = normalizedCandidate;
        removeConflictsForField(conflicts, "evidence_surfaces");
        return;
    }
    target.evidence_surfaces = [
        ...new Set([...target.evidence_surfaces, ...normalizedCandidate])
    ];
};
const applyCustomQualityMetrics = (target, candidate, conflicts, options = {}) => {
    if (!candidate?.length) {
        return;
    }
    if (!target.custom_quality_metrics || options.replace) {
        target.custom_quality_metrics = candidate;
        removeConflictsForField(conflicts, "custom_quality_metrics");
        return;
    }
    const byId = new Map(target.custom_quality_metrics.map((metric) => [metric.metric_id, metric]));
    for (const metric of candidate) {
        byId.set(metric.metric_id, metric);
    }
    target.custom_quality_metrics = [...byId.values()];
};
const applyWorkflowChecks = (target, candidate, conflicts, options = {}) => {
    if (!candidate || candidate.length === 0) {
        return;
    }
    if (!target.workflow_checks || options.replace) {
        target.workflow_checks = candidate;
        removeConflictsForField(conflicts, "workflow_checks");
        return;
    }
    const byWorkflow = new Map(target.workflow_checks.map((check) => [check.workflow.toLowerCase(), check]));
    for (const check of candidate) {
        byWorkflow.set(check.workflow.toLowerCase(), check);
    }
    target.workflow_checks = [...byWorkflow.values()];
};
const messageLooksLikeCorrection = (message) => /\b(?:actually|change|replace|set|correct)\b|(?:정정|수정|변경|바꿔|교체|실제로는)/iu.test(message);
const hasExplicitTargetRoot = (message) => /(?:target root|root directory|working directory|project root|target folder|working folder|작업\s*폴더|프로젝트\s*폴더|대상\s*폴더|경로)\s*(?:is|는|은|:|=)?/iu.test(message);
const hasExplicitProjectMode = (message) => /\b(?:new project|existing project|from scratch)\b|(?:새\s*프로젝트|기존\s*프로젝트|처음부터|새로)/iu.test(message);
const hasExplicitProductIdentity = (message) => new RegExp(String.raw `(?:${productTitleLabelPattern}|product\s*summary|product\s*brief|what\s+to\s+build)\s*(?:can be|are|is|는|은|:|=)?`, "iu").test(message);
const replaceFieldsForTurn = (message, previousQuestionIds) => {
    const replace = new Set();
    for (const field of previousQuestionIds) {
        switch (field) {
            case "target_users":
                replace.add("target_users");
                break;
            case "product_summary":
                replace.add("product_summary");
                break;
            case "core_workflows":
                replace.add("core_features");
                break;
            case "references":
                replace.add("reference_apps");
                break;
            case "finish_line":
                replace.add("finish_line");
                break;
            case "project_mode":
                replace.add("project_mode");
                break;
            case "target_root":
                replace.add("target_root");
                break;
            case "verification_surface":
                replace.add("verification_surfaces");
                break;
            case "workflow_checks":
                replace.add("workflow_checks");
                break;
            default:
                break;
        }
    }
    if (messageLooksLikeCorrection(message)) {
        if (hasExplicitTargetRoot(message)) {
            replace.add("target_root");
        }
        if (hasExplicitProjectMode(message)) {
            replace.add("project_mode");
        }
    }
    if (hasExplicitTargetRoot(message)) {
        replace.add("target_root");
    }
    if (hasExplicitProjectMode(message)) {
        replace.add("project_mode");
    }
    if (hasExplicitProductIdentity(message)) {
        replace.add("product_summary");
    }
    return replace;
};
const safePathSegment = (value) => value
    .normalize("NFKC")
    .trim()
    .replace(/[\\/:"*?<>|]+/g, " ")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "app";
const defaultTargetRootForNewProject = (intake) => {
    if (intake.project_mode !== "new") {
        return undefined;
    }
    if (intake.target_root?.trim()) {
        return intake.target_root;
    }
    const title = intake.product_title ?? intake.product_summary;
    return title?.trim() ? `./apps/${safePathSegment(title)}` : undefined;
};
const defaultAcceptanceSet = (existing, intakeResult, message, intake) => {
    const accepted = new Set(existing);
    const explicit = explicitFieldMentions(message);
    if (explicit.targetScore) {
        accepted.delete("target_score");
    }
    else if (intakeResult.extracted_target_score !== undefined &&
        intakeResult.missing_product_fields.length === 0 &&
        !intakeResult.missing_execution_fields.includes("target_score")) {
        accepted.add("target_score");
    }
    if (explicit.maxRounds) {
        accepted.delete("max_rounds");
    }
    else if (intakeResult.extracted_max_rounds !== undefined &&
        intakeResult.missing_product_fields.length === 0 &&
        !intakeResult.missing_execution_fields.includes("max_rounds")) {
        accepted.add("max_rounds");
    }
    if (intake.project_mode === "new" && intake.target_root?.trim()) {
        accepted.add("target_root");
    }
    return [...accepted].sort();
};
export const buildDiscoveryAggregateRequest = (input) => {
    const { intake } = input;
    const lines = [input.sourceRequest.trim()];
    if (intake.product_title) {
        lines.push(`Product title: ${intake.product_title}.`);
    }
    if (intake.product_summary) {
        lines.push(`Product summary: ${intake.product_summary}.`);
    }
    if (intake.target_users?.length) {
        lines.push(`The target users are ${intake.target_users.join(", ")}.`);
    }
    if (intake.core_features?.length) {
        lines.push(`The core workflows are ${intake.core_features.join(", ")}.`);
    }
    if (intake.reference_apps) {
        lines.push(intake.reference_apps.length > 0
            ? `References can be ${intake.reference_apps.join(", ")}.`
            : "References can be none.");
    }
    if (intake.finish_line) {
        lines.push(`Good enough means ${intake.finish_line}.`);
    }
    if (intake.project_mode && intake.target_root) {
        lines.push(`This is a ${intake.project_mode} project and the target root is ${intake.target_root}.`);
    }
    else if (intake.project_mode) {
        lines.push(`This is a ${intake.project_mode} project.`);
    }
    else if (intake.target_root) {
        lines.push(`The target root is ${intake.target_root}.`);
    }
    if (intake.target_score !== undefined) {
        lines.push(`target score ${intake.target_score}.`);
    }
    if (intake.max_rounds !== undefined) {
        lines.push(`max rounds ${intake.max_rounds}.`);
    }
    if (intake.run_command) {
        lines.push(`run command is ${intake.run_command}.`);
    }
    if (intake.check_command) {
        lines.push(`check command is ${intake.check_command}.`);
    }
    if (intake.ready_url) {
        lines.push(`ready url is ${intake.ready_url}.`);
    }
    if (intake.app_url) {
        lines.push(`app url is ${intake.app_url}.`);
    }
    if (intake.health_url) {
        lines.push(`health url is ${intake.health_url}.`);
    }
    if (intake.api_base_url) {
        lines.push(`api base url is ${intake.api_base_url}.`);
    }
    if (intake.verification_surfaces?.length) {
        lines.push(`Verification surfaces: ${intake.verification_surfaces.join(", ")}.`);
    }
    if (intake.workflow_checks?.length) {
        lines.push(...intake.workflow_checks.map((check) => `${check.workflow} -> ${check.expected_result}.`));
    }
    if (input.latestMessage?.trim()) {
        lines.push(input.latestMessage.trim());
    }
    return lines
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .join("\n")
        .trim();
};
export const mergeFrontDoorSessionTurn = (input) => {
    const nextIntake = {
        ...(input.existingSession?.intake ?? {})
    };
    const conflicts = [...(input.existingSession?.unresolved_conflicts ?? [])];
    const candidates = extractCandidates({
        message: input.message,
        sourceRequest: input.sourceRequest,
        intakeResult: input.intakeResult,
        previousQuestionIds: input.existingSession?.last_question_ids ?? [],
        existingIntake: input.existingSession?.intake
    });
    const previousQuestionIds = input.existingSession?.last_question_ids ?? [];
    const replaceFields = replaceFieldsForTurn(input.message, previousQuestionIds);
    const candidateOverridesDefaultTargetRoot = candidates.target_root !== undefined &&
        (input.existingSession?.defaults_accepted?.includes("target_root") ||
            nextIntake.target_root?.startsWith("./apps/"));
    applyScalarField(nextIntake, "product_title", candidates.product_title, input.turnCount, conflicts);
    if (!nextIntake.product_summary || replaceFields.has("product_summary")) {
        applyScalarField(nextIntake, "product_summary", candidates.product_summary, input.turnCount, conflicts, { replace: replaceFields.has("product_summary") });
    }
    applyScalarField(nextIntake, "target_family", candidates.target_family, input.turnCount, conflicts);
    applyScalarField(nextIntake, "project_kind", candidates.project_kind, input.turnCount, conflicts);
    applyScalarField(nextIntake, "strictness_level", candidates.strictness_level, input.turnCount, conflicts);
    applyScalarField(nextIntake, "project_mode", candidates.project_mode, input.turnCount, conflicts, {
        replace: replaceFields.has("project_mode")
    });
    applyScalarField(nextIntake, "target_root", candidates.target_root, input.turnCount, conflicts, {
        replace: replaceFields.has("target_root") || candidateOverridesDefaultTargetRoot
    });
    applyScalarField(nextIntake, "target_score", candidates.target_score, input.turnCount, conflicts);
    applyScalarField(nextIntake, "max_rounds", candidates.max_rounds, input.turnCount, conflicts);
    applyScalarField(nextIntake, "run_command", candidates.run_command, input.turnCount, conflicts);
    applyScalarField(nextIntake, "check_command", candidates.check_command, input.turnCount, conflicts);
    applyScalarField(nextIntake, "ready_url", candidates.ready_url, input.turnCount, conflicts);
    applyScalarField(nextIntake, "app_url", candidates.app_url, input.turnCount, conflicts);
    applyScalarField(nextIntake, "health_url", candidates.health_url, input.turnCount, conflicts);
    applyScalarField(nextIntake, "api_base_url", candidates.api_base_url, input.turnCount, conflicts);
    applyScalarField(nextIntake, "finish_line", candidates.finish_line, input.turnCount, conflicts, {
        replace: replaceFields.has("finish_line")
    });
    applyArrayField(nextIntake, "target_users", candidates.target_users, input.turnCount, conflicts, {
        replace: replaceFields.has("target_users")
    });
    applyArrayField(nextIntake, "core_features", candidates.core_features, input.turnCount, conflicts, {
        replace: replaceFields.has("core_features")
    });
    applyArrayField(nextIntake, "reference_apps", candidates.reference_apps, input.turnCount, conflicts, {
        replace: replaceFields.has("reference_apps")
    });
    applyVerificationSurfaces(nextIntake, candidates.verification_surfaces, conflicts, {
        replace: replaceFields.has("verification_surfaces")
    });
    applyEvidenceSurfaces(nextIntake, candidates.evidence_surfaces, conflicts);
    applyCustomQualityMetrics(nextIntake, candidates.custom_quality_metrics, conflicts, {
        replace: replaceFields.has("custom_quality_metrics")
    });
    applyWorkflowChecks(nextIntake, candidates.workflow_checks, conflicts, {
        replace: replaceFields.has("workflow_checks")
    });
    if (!nextIntake.reference_apps) {
        nextIntake.reference_apps = [];
    }
    if (nextIntake.project_kind && !nextIntake.evidence_surfaces?.length) {
        nextIntake.evidence_surfaces = evidenceSurfacesForProjectKind(nextIntake.project_kind);
    }
    const defaultTargetRoot = defaultTargetRootForNewProject(nextIntake);
    if (defaultTargetRoot && !nextIntake.target_root) {
        nextIntake.target_root = defaultTargetRoot;
        removeConflictsForField(conflicts, "target_root");
    }
    if (nextIntake.target_family) {
        nextIntake.adapter_plan = buildAdapterPlanFromIntake({
            intake: nextIntake,
            targetFamily: nextIntake.target_family
        });
    }
    return {
        intake: nextIntake,
        unresolvedConflicts: conflicts,
        defaultsAccepted: defaultAcceptanceSet(input.existingSession?.defaults_accepted ?? [], input.intakeResult, input.message, nextIntake)
    };
};
export const questionIdsForIntakeResult = (intakeResult) => {
    if (intakeResult.status === "ask_product_questions") {
        return [...intakeResult.missing_product_fields].slice(0, intakeResult.questions.length);
    }
    if (intakeResult.status === "ask_execution_questions") {
        return [...intakeResult.missing_execution_fields].slice(0, intakeResult.questions.length);
    }
    if (intakeResult.status === "ask_adapter_questions") {
        return [...intakeResult.missing_adapter_fields].slice(0, intakeResult.questions.length);
    }
    return [];
};
//# sourceMappingURL=front-door-session-merge.js.map