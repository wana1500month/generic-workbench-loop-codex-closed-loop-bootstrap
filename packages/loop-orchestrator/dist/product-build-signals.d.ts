export interface ProductBuildDetection {
    is_product_build: boolean;
    strength: "strong" | "weak" | "rejected";
    matched_nouns: string[];
    matched_verbs: string[];
    rejected_by: string[];
}
export declare const hasExplicitProductBuildPhrase: (value: string) => boolean;
export declare const detectProductBuildIntent: (value: string) => ProductBuildDetection;
//# sourceMappingURL=product-build-signals.d.ts.map