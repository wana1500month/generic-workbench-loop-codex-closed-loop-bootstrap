const KO_PRODUCT_NOUN_HINTS = [
  "앱",
  "서비스",
  "웹앱",
  "사이트",
  "대시보드",
  "에디터",
  "편집기",
  "편집툴",
  "관리툴",
  "툴",
  "스토리보드"
] as const;

const KO_PRODUCT_VERB_HINTS = [
  "만들",
  "구현",
  "설계",
  "개발",
  "기획",
  "제작",
  "구상"
] as const;

const EN_PRODUCT_NOUN_PATTERNS = [
  /\bapp(?:lication)?s?\b/i,
  /\bweb\s*app(?:lication)?s?\b/i,
  /\bsite\b/i,
  /\bwebsite\b/i,
  /\bservice\b/i,
  /\bplatform\b/i,
  /\bportal\b/i,
  /\btool\b/i,
  /\bsaas\b/i,
  /\bdashboard\b/i,
  /\beditor\b/i,
  /\bworkspace\b/i,
  /\bstoryboard\b/i,
  /\bapi\b/i,
  /\bagent\b/i,
  /\bsystem\b/i,
  /\bproduct\b/i
] as const;

const EN_PRODUCT_VERB_PATTERNS = [
  /\bbuild\b/i,
  /\bcreate\b/i,
  /\bmake\b/i,
  /\bdesign\b/i,
  /\bprototype\b/i,
  /\bship\b/i
] as const;

const EXPLICIT_PRODUCT_BUILD_PHRASE =
  /\b(?:app(?:lication)?|web\s*app|service|platform|portal|tool|dashboard|editor|workspace|website|api|agent|system|product)\b.{0,32}\bfor\b/i;

const matchAnyPattern = (value: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(value));

export const hasProductBuildNoun = (value: string): boolean =>
  KO_PRODUCT_NOUN_HINTS.some((hint) => value.includes(hint)) ||
  matchAnyPattern(value, EN_PRODUCT_NOUN_PATTERNS);

export const hasProductBuildVerb = (value: string): boolean =>
  KO_PRODUCT_VERB_HINTS.some((hint) => value.includes(hint)) ||
  matchAnyPattern(value, EN_PRODUCT_VERB_PATTERNS);

export const hasExplicitProductBuildPhrase = (value: string): boolean =>
  (hasProductBuildNoun(value) && hasProductBuildVerb(value)) ||
  EXPLICIT_PRODUCT_BUILD_PHRASE.test(value);
