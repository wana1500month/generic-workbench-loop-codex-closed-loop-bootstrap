export const koreanProductNounHints = [
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
  "\uD328\uD0A4\uC9C0",
  "\uB77C\uC774\uBE0C\uB7EC\uB9AC",
  "\uC0DD\uC131\uAE30",
  "\uBE4C\uB354",
  "\uD15C\uD50C\uB9BF",
  "\uCCB4\uD06C\uB9AC\uC2A4\uD2B8",
  "\uC0B0\uCD9C\uBB3C \uC0DD\uC131\uAE30",
  "\uD30C\uC774\uD504\uB77C\uC778 \uC0DD\uC131\uAE30",
  "\uBCF4\uACE0\uC11C \uC0DD\uC131\uAE30",
  "\uBB38\uC11C \uC0DD\uC131\uAE30",
  "\uAC00\uC774\uB4DC \uC0DD\uC131\uAE30",
  "\uBD84\uC11D\uAE30",
  "\uAC80\uC0AC\uAE30",
  "\uD30C\uC11C",
  "\uBCC0\uD658\uAE30",
  "\uC790\uB3D9\uD654",
  "\uD30C\uC774\uD504\uB77C\uC778",
  "\uC2DC\uC2A4\uD15C",
  "\uD3EC\uD138",
  "\uC2A4\uD1A0\uB9AC\uBCF4\uB4DC"
] as const;

export const koreanProductVerbHints = [
  "\uB9CC\uB4E4",
  "\uAD6C\uD604",
  "\uC124\uACC4",
  "\uAC1C\uBC1C",
  "\uAE30\uD68D",
  "\uC81C\uC791",
  "\uAD6C\uC0C1"
] as const;

export const koreanNonProductWorkHints = [
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

const koreanProductOrderHints = [
  ...koreanProductNounHints,
  "api"
] as const;

const koreanProductSurfaceAfterDeliverableHints = [
  "\uAD00\uB9AC\uD234",
  "\uD234",
  "\uB3C4\uAD6C",
  "\uC0DD\uC131\uAE30",
  "\uBE4C\uB354",
  "\uC790\uB3D9\uD654",
  "\uD30C\uC774\uD504\uB77C\uC778",
  "\uC0B0\uCD9C\uBB3C",
  "\uD15C\uD50C\uB9BF",
  "\uCCB4\uD06C\uB9AC\uC2A4\uD2B8",
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

const matchHintLabels = (value: string, hints: readonly string[]): string[] =>
  hints.filter((hint) => value.includes(hint));

export const matchKoreanNonProductDeliverableObjects = (
  value: string
): string[] => {
  const product = findFirstHintIndex(value, koreanProductOrderHints);
  const deliverable = findFirstHintIndex(value, koreanNonProductWorkHints);
  if (!product || !deliverable || deliverable.index <= product.index) {
    return [];
  }

  const trailingText = value.slice(deliverable.index + deliverable.hint.length);
  if (
    matchHintLabels(trailingText, koreanProductSurfaceAfterDeliverableHints)
      .length > 0
  ) {
    return [];
  }

  return [`${product.hint} ${deliverable.hint}`];
};
