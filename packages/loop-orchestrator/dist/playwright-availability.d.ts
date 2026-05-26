export type PlaywrightImportProbeResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare const probePlaywrightCoreImport: () => Promise<PlaywrightImportProbeResult>;
export declare const assertPlaywrightCoreImportAvailable: () => Promise<void>;
//# sourceMappingURL=playwright-availability.d.ts.map