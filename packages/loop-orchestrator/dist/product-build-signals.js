import { koreanNonProductWorkHints, koreanProductNounHints, koreanProductVerbHints, matchKoreanNonProductDeliverableObjects } from "./front-door/korean-product-detection.js";
const STRONG_PRODUCT_NOUN_PATTERNS = [
    { label: "app", pattern: /\bapp(?:lication)?s?\b/i },
    { label: "web app", pattern: /\bweb\s*app(?:lication)?s?\b/i },
    { label: "website", pattern: /\bwebsite\b/i },
    { label: "dashboard", pattern: /\bdashboard\b/i },
    { label: "editor", pattern: /\beditor\b/i },
    { label: "workspace", pattern: /\bworkspace\b/i },
    { label: "storyboard", pattern: /\bstoryboard\b/i },
    { label: "api", pattern: /\bapi\b/i }
];
const CONTEXTUAL_PRODUCT_NOUN_PATTERNS = [
    { label: "saas", pattern: /\bsaas\b/i }
];
const WEAK_PRODUCT_NOUN_PATTERNS = [
    { label: "service", pattern: /\bservice\b/i },
    { label: "platform", pattern: /\bplatform\b/i },
    { label: "portal", pattern: /\bportal\b/i },
    { label: "tool", pattern: /\btool\b/i },
    { label: "cli", pattern: /\bcli\b/i },
    { label: "analyzer", pattern: /\banaly[sz]er\b/i },
    { label: "checker", pattern: /\bchecker\b/i },
    { label: "validator", pattern: /\bvalidator\b/i },
    { label: "parser", pattern: /\bparser\b/i },
    { label: "converter", pattern: /\bconverter\b/i },
    { label: "package", pattern: /\bpackage\b/i },
    { label: "pipeline", pattern: /\bpipeline\b/i },
    { label: "automation", pattern: /\bautomation\b/i },
    { label: "artifact", pattern: /\bartifact\b/i },
    { label: "agent", pattern: /\bagent\b/i },
    { label: "system", pattern: /\bsystem\b/i }
];
const BUILD_VERB_PATTERNS = [
    { label: "build", pattern: /\bbuild\b/i },
    { label: "create", pattern: /\bcreate\b/i },
    { label: "make", pattern: /\bmake\b/i },
    { label: "prototype", pattern: /\bprototype\b/i },
    { label: "ship", pattern: /\bship\b/i }
];
const NON_PRODUCT_WORK_PATTERNS = [
    { label: "docs", pattern: /\bdocs?\b/i },
    { label: "documentation", pattern: /\bdocumentation\b/i },
    { label: "strategy", pattern: /\bstrategy\b/i },
    { label: "roadmap", pattern: /\broadmap\b/i },
    { label: "spec", pattern: /\bspec\b/i },
    { label: "proposal", pattern: /\bproposal\b/i },
    { label: "analysis", pattern: /\banalysis\b/i },
    { label: "audit", pattern: /\baudit\b/i },
    { label: "review", pattern: /\breview\b/i },
    { label: "migration", pattern: /\bmigration\b/i },
    { label: "refactor", pattern: /\brefactor\b/i },
    { label: "patch", pattern: /\bpatch\b/i },
    { label: "copy", pattern: /\bcopy\b/i },
    { label: "content", pattern: /\bcontent\b/i },
    { label: "refresh", pattern: /\brefresh\b/i }
];
const PRODUCT_NOUN_SOURCE = String.raw `(?:app(?:lication)?|web\s*app|dashboard|editor|workspace|storyboard|website|api|saas|service|platform|portal|tool|cli|analy[sz]er|checker|validator|parser|converter|package|pipeline|automation|artifact|agent|system)`;
const NON_PRODUCT_DELIVERABLE_SOURCE = String.raw `(?:docs?|documentation|spec|strategy|roadmap|copy|content|proposal|analysis|audit|review|migration(?:\s+planning|\s+plan)?|evaluation\s+spec)`;
const PRODUCT_SURFACE_AFTER_DELIVERABLE_SOURCE = String.raw `(?:portal|site|website|app(?:lication)?|dashboard|editor|tool|workspace|package|pipeline|automation|artifact|system)`;
const NON_PRODUCT_DELIVERABLE_OBJECT_PATTERNS = [
    {
        label: "product deliverable",
        pattern: new RegExp(String.raw `\b${PRODUCT_NOUN_SOURCE}\b[^.!?]{0,24}\b${NON_PRODUCT_DELIVERABLE_SOURCE}\b`, "i")
    },
    {
        label: "deliverable for product",
        pattern: new RegExp(String.raw `\b${NON_PRODUCT_DELIVERABLE_SOURCE}\b[^.!?]{0,24}\bfor\b[^.!?]{0,24}\b${PRODUCT_NOUN_SOURCE}\b`, "i")
    }
];
const DELIVERABLE_AS_PRODUCT_MODIFIER_PATTERNS = [
    {
        label: "deliverable as product modifier",
        pattern: new RegExp(String.raw `\b${NON_PRODUCT_DELIVERABLE_SOURCE}\b[^.!?]{0,24}\b${PRODUCT_SURFACE_AFTER_DELIVERABLE_SOURCE}\b`, "i")
    },
    {
        label: "product deliverable surface",
        pattern: new RegExp(String.raw `\b(?:api|website|service|platform)\b[^.!?]{0,16}\b${NON_PRODUCT_DELIVERABLE_SOURCE}\b[^.!?]{0,24}\b${PRODUCT_SURFACE_AFTER_DELIVERABLE_SOURCE}\b`, "i")
    }
];
const STRONG_EXPLICIT_PRODUCT_BUILD_PHRASE = /\b(?:app(?:lication)?|web\s*app|dashboard|editor|workspace|website|api|saas)\b.{0,32}\bfor\b/i;
const WEAK_EXPLICIT_PRODUCT_BUILD_PHRASE = /\b(?:build|create|make|prototype|ship)\b\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?[^.!?]{0,48}\b(?:service|platform|portal|tool|agent|system)\b[^.!?]{0,48}\bfor\b/i;
const BUILD_OBJECT_PATTERN = /\b(?:build|create|make|prototype|ship)\b\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?(.+?)(?:[.!?]|$)/i;
const unique = (values) => [...new Set(values)];
const matchPatternLabels = (value, patterns) => patterns.filter((entry) => entry.pattern.test(value)).map((entry) => entry.label);
const matchHintLabels = (value, hints) => hints.filter((hint) => value.includes(hint));
const extractBuildObject = (value) => BUILD_OBJECT_PATTERN.exec(value)?.[1]?.trim();
const stripAudienceTail = (value) => {
    const stripped = value.replace(/\b(?:for|to)\b.+$/i, "").trim();
    return stripped.length > 0 ? stripped : value.trim();
};
const hasKoreanText = (value) => /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(value);
const koreanNonBuildActionPattern = /(?:\uCD94\uCC9C|\uCC3E\uC544|\uC54C\uB824|\uBE44\uAD50|\uC124\uBA85|\uC694\uC57D|\uBD84\uC11D|\uBC88\uC5ED|\uAC80\uD1A0|\uB9AC\uBDF0)/u;
export const hasExplicitProductBuildPhrase = (value) => STRONG_EXPLICIT_PRODUCT_BUILD_PHRASE.test(value) ||
    WEAK_EXPLICIT_PRODUCT_BUILD_PHRASE.test(value);
export const detectProductBuildIntent = (value) => {
    const strongNouns = matchPatternLabels(value, STRONG_PRODUCT_NOUN_PATTERNS);
    const contextualNouns = matchPatternLabels(value, CONTEXTUAL_PRODUCT_NOUN_PATTERNS);
    const weakNouns = matchPatternLabels(value, WEAK_PRODUCT_NOUN_PATTERNS);
    const koNouns = matchHintLabels(value, koreanProductNounHints);
    const koVerbs = matchHintLabels(value, koreanProductVerbHints);
    const koRejectedBy = matchHintLabels(value, koreanNonProductWorkHints);
    const matchedVerbs = unique([
        ...koVerbs,
        ...matchPatternLabels(value, BUILD_VERB_PATTERNS)
    ]);
    const rejectedBy = unique([
        ...koRejectedBy,
        ...matchPatternLabels(value, NON_PRODUCT_WORK_PATTERNS)
    ]);
    const matchedNouns = unique([
        ...koNouns,
        ...strongNouns,
        ...contextualNouns,
        ...weakNouns
    ]);
    const buildObject = extractBuildObject(value) ?? value;
    const buildObjectCore = stripAudienceTail(buildObject);
    const buildObjectStrongNouns = matchPatternLabels(buildObjectCore, STRONG_PRODUCT_NOUN_PATTERNS);
    const buildObjectWeakNouns = matchPatternLabels(buildObjectCore, WEAK_PRODUCT_NOUN_PATTERNS);
    const buildObjectKoNouns = matchHintLabels(buildObjectCore, koreanProductNounHints);
    const buildObjectSurfaceNouns = unique([
        ...buildObjectStrongNouns,
        ...buildObjectWeakNouns,
        ...buildObjectKoNouns
    ]);
    const buildObjectRejectedBy = unique([
        ...matchHintLabels(buildObjectCore, koreanNonProductWorkHints),
        ...matchPatternLabels(buildObjectCore, NON_PRODUCT_WORK_PATTERNS)
    ]);
    const nonProductDeliverableObject = unique([
        ...matchPatternLabels(buildObjectCore, NON_PRODUCT_DELIVERABLE_OBJECT_PATTERNS),
        ...matchKoreanNonProductDeliverableObjects(buildObjectCore)
    ]);
    const deliverableAsProductModifier = matchPatternLabels(buildObjectCore, DELIVERABLE_AS_PRODUCT_MODIFIER_PATTERNS);
    const strongExplicitProductBuildPhrase = STRONG_EXPLICIT_PRODUCT_BUILD_PHRASE.test(value);
    const weakExplicitProductBuildPhrase = WEAK_EXPLICIT_PRODUCT_BUILD_PHRASE.test(value);
    const hasVerb = matchedVerbs.length > 0;
    const hasStrongSurfaceNoun = strongNouns.length > 0 || koNouns.length > 0;
    const hasWeakNoun = weakNouns.length > 0;
    const hasImplicitKoreanProductNoun = !hasVerb &&
        hasKoreanText(value) &&
        koNouns.length > 0 &&
        buildObjectSurfaceNouns.length > 0 &&
        !koreanNonBuildActionPattern.test(value);
    if (nonProductDeliverableObject.length > 0 &&
        deliverableAsProductModifier.length === 0) {
        return {
            is_product_build: false,
            strength: "rejected",
            matched_nouns: matchedNouns,
            matched_verbs: matchedVerbs,
            rejected_by: unique([
                ...rejectedBy,
                ...buildObjectRejectedBy,
                ...nonProductDeliverableObject
            ])
        };
    }
    if (buildObjectRejectedBy.length > 0 &&
        buildObjectSurfaceNouns.length === 0 &&
        deliverableAsProductModifier.length === 0) {
        return {
            is_product_build: false,
            strength: "rejected",
            matched_nouns: matchedNouns,
            matched_verbs: matchedVerbs,
            rejected_by: unique([...rejectedBy, ...buildObjectRejectedBy])
        };
    }
    if (strongExplicitProductBuildPhrase || (hasVerb && hasStrongSurfaceNoun)) {
        return {
            is_product_build: true,
            strength: "strong",
            matched_nouns: matchedNouns,
            matched_verbs: matchedVerbs,
            rejected_by: unique([...rejectedBy, ...buildObjectRejectedBy])
        };
    }
    if (hasImplicitKoreanProductNoun) {
        return {
            is_product_build: true,
            strength: "strong",
            matched_nouns: matchedNouns,
            matched_verbs: matchedVerbs,
            rejected_by: unique([...rejectedBy, ...buildObjectRejectedBy])
        };
    }
    if ((weakExplicitProductBuildPhrase || (hasVerb && hasWeakNoun)) &&
        (buildObjectRejectedBy.length === 0 ||
            deliverableAsProductModifier.length > 0)) {
        return {
            is_product_build: true,
            strength: "weak",
            matched_nouns: matchedNouns,
            matched_verbs: matchedVerbs,
            rejected_by: unique([...rejectedBy, ...buildObjectRejectedBy])
        };
    }
    return {
        is_product_build: false,
        strength: buildObjectRejectedBy.length > 0 ? "rejected" : "weak",
        matched_nouns: matchedNouns,
        matched_verbs: matchedVerbs,
        rejected_by: unique([...rejectedBy, ...buildObjectRejectedBy])
    };
};
//# sourceMappingURL=product-build-signals.js.map