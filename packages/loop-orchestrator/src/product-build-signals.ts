type PatternLabel = {
  label: string;
  pattern: RegExp;
};

export interface ProductBuildDetection {
  is_product_build: boolean;
  strength: "strong" | "weak" | "rejected";
  matched_nouns: string[];
  matched_verbs: string[];
  rejected_by: string[];
}

const KO_PRODUCT_NOUN_HINTS = [
  "\uC571",
  "\uC11C\uBE44\uC2A4",
  "\uC6F9\uC571",
  "\uC0AC\uC774\uD2B8",
  "\uB300\uC2DC\uBCF4\uB4DC",
  "\uC5D0\uB514\uD130",
  "\uD3B8\uC9D1\uAE30",
  "\uD3B8\uC9D1\uD234",
  "\uAD00\uB9AC\uD234",
  "\uD234",
  "\uB3C4\uAD6C",
  "\uBD84\uC11D\uAE30",
  "\uAC80\uC0AC\uAE30",
  "\uD30C\uC11C",
  "\uBCC0\uD658\uAE30",
  "\uC2DC\uC2A4\uD15C",
  "\uD3EC\uD138",
  "\uC2A4\uD1A0\uB9AC\uBCF4\uB4DC"
] as const;

const KO_PRODUCT_VERB_HINTS = [
  "\uB9CC\uB4E4",
  "\uAD6C\uD604",
  "\uC124\uACC4",
  "\uAC1C\uBC1C",
  "\uAE30\uD68D",
  "\uC81C\uC791",
  "\uAD6C\uC0C1"
] as const;

const KO_NON_PRODUCT_WORK_HINTS = [
  "\uBB38\uC11C",
  "\uC804\uB7B5",
  "\uB85C\uB4DC\uB9F5",
  "\uC2A4\uD399",
  "\uC81C\uC548",
  "\uAC10\uC0AC",
  "\uB9AC\uBDF0",
  "\uB9C8\uC774\uADF8\uB808\uC774\uC158",
  "\uB9AC\uD329\uD130",
  "\uD328\uCE58",
  "\uCE74\uD53C",
  "\uCF58\uD150\uCE20",
  "\uBB38\uAD6C"
] as const;

const STRONG_PRODUCT_NOUN_PATTERNS: readonly PatternLabel[] = [
  { label: "app", pattern: /\bapp(?:lication)?s?\b/i },
  { label: "web app", pattern: /\bweb\s*app(?:lication)?s?\b/i },
  { label: "website", pattern: /\bwebsite\b/i },
  { label: "dashboard", pattern: /\bdashboard\b/i },
  { label: "editor", pattern: /\beditor\b/i },
  { label: "workspace", pattern: /\bworkspace\b/i },
  { label: "storyboard", pattern: /\bstoryboard\b/i },
  { label: "api", pattern: /\bapi\b/i }
] as const;

const CONTEXTUAL_PRODUCT_NOUN_PATTERNS: readonly PatternLabel[] = [
  { label: "saas", pattern: /\bsaas\b/i }
] as const;

const WEAK_PRODUCT_NOUN_PATTERNS: readonly PatternLabel[] = [
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
] as const;

const BUILD_VERB_PATTERNS: readonly PatternLabel[] = [
  { label: "build", pattern: /\bbuild\b/i },
  { label: "create", pattern: /\bcreate\b/i },
  { label: "make", pattern: /\bmake\b/i },
  { label: "prototype", pattern: /\bprototype\b/i },
  { label: "ship", pattern: /\bship\b/i }
] as const;

const NON_PRODUCT_WORK_PATTERNS: readonly PatternLabel[] = [
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
] as const;

const PRODUCT_NOUN_SOURCE = String.raw`(?:app(?:lication)?|web\s*app|dashboard|editor|workspace|storyboard|website|api|saas|service|platform|portal|tool|cli|analy[sz]er|checker|validator|parser|converter|package|pipeline|automation|artifact|agent|system)`;
const NON_PRODUCT_DELIVERABLE_SOURCE = String.raw`(?:docs?|documentation|spec|strategy|roadmap|copy|content|proposal|analysis|audit|review|migration(?:\s+planning|\s+plan)?|evaluation\s+spec)`;
const PRODUCT_SURFACE_AFTER_DELIVERABLE_SOURCE = String.raw`(?:portal|site|website|app(?:lication)?|dashboard|editor|tool|workspace|package|pipeline|automation|artifact|system)`;

const NON_PRODUCT_DELIVERABLE_OBJECT_PATTERNS: readonly PatternLabel[] = [
  {
    label: "product deliverable",
    pattern: new RegExp(
      String.raw`\b${PRODUCT_NOUN_SOURCE}\b[^.!?]{0,24}\b${NON_PRODUCT_DELIVERABLE_SOURCE}\b`,
      "i"
    )
  },
  {
    label: "deliverable for product",
    pattern: new RegExp(
      String.raw`\b${NON_PRODUCT_DELIVERABLE_SOURCE}\b[^.!?]{0,24}\bfor\b[^.!?]{0,24}\b${PRODUCT_NOUN_SOURCE}\b`,
      "i"
    )
  }
] as const;

const DELIVERABLE_AS_PRODUCT_MODIFIER_PATTERNS: readonly PatternLabel[] = [
  {
    label: "deliverable as product modifier",
    pattern: new RegExp(
      String.raw`\b${NON_PRODUCT_DELIVERABLE_SOURCE}\b[^.!?]{0,24}\b${PRODUCT_SURFACE_AFTER_DELIVERABLE_SOURCE}\b`,
      "i"
    )
  },
  {
    label: "product deliverable surface",
    pattern: new RegExp(
      String.raw`\b(?:api|website|service|platform)\b[^.!?]{0,16}\b${NON_PRODUCT_DELIVERABLE_SOURCE}\b[^.!?]{0,24}\b${PRODUCT_SURFACE_AFTER_DELIVERABLE_SOURCE}\b`,
      "i"
    )
  }
] as const;

const STRONG_EXPLICIT_PRODUCT_BUILD_PHRASE =
  /\b(?:app(?:lication)?|web\s*app|dashboard|editor|workspace|website|api|saas)\b.{0,32}\bfor\b/i;

const WEAK_EXPLICIT_PRODUCT_BUILD_PHRASE =
  /\b(?:build|create|make|prototype|ship)\b\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?[^.!?]{0,48}\b(?:service|platform|portal|tool|agent|system)\b[^.!?]{0,48}\bfor\b/i;

const BUILD_OBJECT_PATTERN =
  /\b(?:build|create|make|prototype|ship)\b\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?(.+?)(?:[.!?]|$)/i;

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const matchPatternLabels = (
  value: string,
  patterns: readonly PatternLabel[]
): string[] => patterns.filter((entry) => entry.pattern.test(value)).map((entry) => entry.label);

const matchHintLabels = (value: string, hints: readonly string[]): string[] =>
  hints.filter((hint) => value.includes(hint));

const extractBuildObject = (value: string): string | undefined =>
  BUILD_OBJECT_PATTERN.exec(value)?.[1]?.trim();

const stripAudienceTail = (value: string): string => {
  const stripped = value.replace(/\b(?:for|to)\b.+$/i, "").trim();
  return stripped.length > 0 ? stripped : value.trim();
};

const findFirstHintIndex = (
  value: string,
  hints: readonly string[]
): { hint: string; index: number } | undefined => {
  let found: { hint: string; index: number } | undefined;
  for (const hint of hints) {
    const index = value.indexOf(hint);
    if (index >= 0 && (found === undefined || index < found.index)) {
      found = { hint, index };
    }
  }
  return found;
};

const KO_PRODUCT_ORDER_HINTS = [
  ...KO_PRODUCT_NOUN_HINTS,
  "api"
] as const;

const KO_PRODUCT_SURFACE_AFTER_DELIVERABLE_HINTS = [
  "\uAD00\uB9AC\uD234",
  "\uD234",
  "\uB3C4\uAD6C",
  "\uC2DC\uC2A4\uD15C",
  "\uD3EC\uD138",
  "\uB300\uC2DC\uBCF4\uB4DC",
  "\uC571",
  "\uC6F9\uC571",
  "\uC0AC\uC774\uD2B8",
  "\uC5D0\uB514\uD130",
  "\uD3B8\uC9D1\uAE30",
  "\uD3B8\uC9D1\uD234"
] as const;

const matchKoNonProductDeliverableObjects = (value: string): string[] => {
  const product = findFirstHintIndex(value, KO_PRODUCT_ORDER_HINTS);
  const deliverable = findFirstHintIndex(value, KO_NON_PRODUCT_WORK_HINTS);
  if (!product || !deliverable || deliverable.index <= product.index) {
    return [];
  }

  const trailingText = value.slice(deliverable.index + deliverable.hint.length);
  if (matchHintLabels(trailingText, KO_PRODUCT_SURFACE_AFTER_DELIVERABLE_HINTS).length > 0) {
    return [];
  }

  return [`${product.hint} ${deliverable.hint}`];
};

export const hasExplicitProductBuildPhrase = (value: string): boolean =>
  STRONG_EXPLICIT_PRODUCT_BUILD_PHRASE.test(value) ||
  WEAK_EXPLICIT_PRODUCT_BUILD_PHRASE.test(value);

export const detectProductBuildIntent = (value: string): ProductBuildDetection => {
  const strongNouns = matchPatternLabels(value, STRONG_PRODUCT_NOUN_PATTERNS);
  const contextualNouns = matchPatternLabels(value, CONTEXTUAL_PRODUCT_NOUN_PATTERNS);
  const weakNouns = matchPatternLabels(value, WEAK_PRODUCT_NOUN_PATTERNS);
  const koNouns = matchHintLabels(value, KO_PRODUCT_NOUN_HINTS);
  const koVerbs = matchHintLabels(value, KO_PRODUCT_VERB_HINTS);
  const koRejectedBy = matchHintLabels(value, KO_NON_PRODUCT_WORK_HINTS);
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
  const buildObjectStrongNouns = matchPatternLabels(
    buildObjectCore,
    STRONG_PRODUCT_NOUN_PATTERNS
  );
  const buildObjectWeakNouns = matchPatternLabels(
    buildObjectCore,
    WEAK_PRODUCT_NOUN_PATTERNS
  );
  const buildObjectKoNouns = matchHintLabels(
    buildObjectCore,
    KO_PRODUCT_NOUN_HINTS
  );
  const buildObjectSurfaceNouns = unique([
    ...buildObjectStrongNouns,
    ...buildObjectWeakNouns,
    ...buildObjectKoNouns
  ]);
  const buildObjectRejectedBy = unique([
    ...matchHintLabels(buildObjectCore, KO_NON_PRODUCT_WORK_HINTS),
    ...matchPatternLabels(buildObjectCore, NON_PRODUCT_WORK_PATTERNS)
  ]);
  const nonProductDeliverableObject = unique([
    ...matchPatternLabels(buildObjectCore, NON_PRODUCT_DELIVERABLE_OBJECT_PATTERNS),
    ...matchKoNonProductDeliverableObjects(buildObjectCore)
  ]);
  const deliverableAsProductModifier = matchPatternLabels(
    buildObjectCore,
    DELIVERABLE_AS_PRODUCT_MODIFIER_PATTERNS
  );
  const strongExplicitProductBuildPhrase =
    STRONG_EXPLICIT_PRODUCT_BUILD_PHRASE.test(value);
  const weakExplicitProductBuildPhrase =
    WEAK_EXPLICIT_PRODUCT_BUILD_PHRASE.test(value);
  const hasVerb = matchedVerbs.length > 0;
  const hasStrongSurfaceNoun = strongNouns.length > 0 || koNouns.length > 0;
  const hasWeakNoun = weakNouns.length > 0;

  if (
    nonProductDeliverableObject.length > 0 &&
    deliverableAsProductModifier.length === 0
  ) {
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

  if (
    buildObjectRejectedBy.length > 0 &&
    buildObjectSurfaceNouns.length === 0 &&
    deliverableAsProductModifier.length === 0
  ) {
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

  if (
    (weakExplicitProductBuildPhrase || (hasVerb && hasWeakNoun)) &&
    (buildObjectRejectedBy.length === 0 ||
      deliverableAsProductModifier.length > 0)
  ) {
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
