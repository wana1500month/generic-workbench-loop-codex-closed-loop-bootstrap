export interface KoreanAmbiguousDocumentRequest {
    reason: "ambiguous_document_request";
    matched_document_terms: string[];
    matched_creation_terms: string[];
    questions: string[];
}
export declare const detectKoreanAmbiguousDocumentRequest: (value: string) => KoreanAmbiguousDocumentRequest | undefined;
//# sourceMappingURL=korean-document-ambiguity.d.ts.map