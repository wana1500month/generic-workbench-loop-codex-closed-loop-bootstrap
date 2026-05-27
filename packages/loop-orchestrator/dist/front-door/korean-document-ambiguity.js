const hasHangul = (value) => /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(value);
const includesAny = (value, hints) => hints.filter((hint) => value.includes(hint));
const documentTerms = [
    "\u0061\u0070\u0069 \uBB38\uC11C",
    "\uBB38\uC11C",
    "\uBCF4\uACE0\uC11C",
    "\uB9AC\uD3EC\uD2B8",
    "\uAC00\uC774\uB4DC",
    "\uC124\uCE58 \uAC00\uC774\uB4DC"
];
const directCreationTerms = [
    "\uB9CC\uB4E4",
    "\uC791\uC131",
    "\uC368\uC918",
    "\uC4F0\uACE0",
    "\uC4F0\uAE30",
    "\uC801\uC5B4"
];
const directDocumentWorkTerms = [
    "\uC694\uC57D",
    "\uBD84\uC11D",
    "\uBC88\uC5ED",
    "\uAC80\uD1A0",
    "\uB9AC\uBDF0",
    "\uAC10\uC218",
    "\uC218\uC815",
    "\uCCA8\uC0AD",
    "\uC815\uB9AC"
];
const productSurfaceTerms = [
    "\uC0DD\uC131\uAE30",
    "\uC0DD\uC131 \uB3C4\uAD6C",
    "\uC790\uB3D9 \uC0DD\uC131",
    "\uC790\uB3D9 \uC0DD\uC131 \uB3C4\uAD6C",
    "\uC790\uB3D9\uD654",
    "\uC790\uB3D9\uD654 \uB3C4\uAD6C",
    "\uB3C4\uAD6C",
    "\uD234",
    "\uD15C\uD50C\uB9BF",
    "\uD15C\uD50C\uB9BF \uC0DD\uC131\uAE30",
    "\uD30C\uC774\uD504\uB77C\uC778",
    "\uBCC0\uD658\uAE30",
    "\uAD00\uB9AC\uD234",
    "\uD3EC\uD138",
    "\uC0AC\uC774\uD2B8",
    "\uC2DC\uC2A4\uD15C"
];
export const detectKoreanAmbiguousDocumentRequest = (value) => {
    const normalized = value.normalize("NFKC").toLowerCase();
    if (!hasHangul(normalized)) {
        return undefined;
    }
    const matchedDocumentTerms = includesAny(normalized, documentTerms);
    if (matchedDocumentTerms.length === 0) {
        return undefined;
    }
    if (includesAny(normalized, directDocumentWorkTerms).length > 0) {
        return undefined;
    }
    if (includesAny(normalized, productSurfaceTerms).length > 0) {
        return undefined;
    }
    const matchedCreationTerms = includesAny(normalized, directCreationTerms);
    if (matchedCreationTerms.length === 0) {
        return undefined;
    }
    return {
        reason: "ambiguous_document_request",
        matched_document_terms: matchedDocumentTerms,
        matched_creation_terms: matchedCreationTerms,
        questions: [
            "\uC774 \uC694\uCCAD\uC740 \uBB38\uC11C\uB97C \uC9C1\uC811 \uC791\uC131\uD558\uB77C\uB294 \uB73B\uC778\uAC00\uC694, \uC544\uB2C8\uBA74 \uBB38\uC11C \uC0DD\uC131 \uB3C4\uAD6C\uB098 \uC790\uB3D9\uD654\uB97C \uB9CC\uB4E4\uB77C\uB294 \uB73B\uC778\uAC00\uC694?",
            "\uB3C4\uAD6C\uB97C \uB9CC\uB4DC\uB294 \uAC83\uC774\uB77C\uBA74 \uC608\uC0C1 \uC785\uB825, \uCD9C\uB825 \uD615\uC2DD, \uC2E4\uD328 \uCC98\uB9AC \uAE30\uC900\uC744 \uC801\uC5B4\uC918. \uBB38\uC11C \uC791\uC131\uC774\uB77C\uBA74 \uD3EC\uD568\uD560 \uB0B4\uC6A9\uACFC \uB3C5\uC790\uB97C \uC801\uC5B4\uC918."
        ]
    };
};
//# sourceMappingURL=korean-document-ambiguity.js.map