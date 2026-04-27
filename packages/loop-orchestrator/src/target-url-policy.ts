const truthyEnvValues = new Set(["1", "true", "yes", "on"]);

const normalizeHostname = (hostname: string): string =>
  hostname.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();

const envFlagEnabled = (name: string): boolean =>
  truthyEnvValues.has((process.env[name] ?? "").trim().toLowerCase());

const allowNonlocalTargetUrls = (): boolean =>
  envFlagEnabled("HARNESS_ALLOW_NONLOCAL_TARGET_URLS") ||
  envFlagEnabled("HARNESS_ALLOW_NONLOCAL_TARGET_MANIFEST_URLS");

const parseIpv4 = (hostname: string): number[] | undefined => {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return undefined;
  }
  const parsed = parts.map((part) => Number(part));
  return parsed.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parsed
    : undefined;
};

const isLoopbackHost = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  const ipv4 = parseIpv4(normalized);
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    Boolean(ipv4 && ipv4[0] === 127)
  );
};

const isBlockedPrivateOrMetadataHost = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  if (
    normalized === "metadata.google.internal" ||
    normalized === "169.254.169.254" ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (!ipv4) {
    return false;
  }

  const [a, b] = ipv4;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

export interface TargetUrlPolicyResult {
  ok: boolean;
  url?: string;
  reason?: string;
}

export const validateTargetUrlPolicy = (value: string): TargetUrlPolicyResult => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "URL is not parseable." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only http and https URLs are allowed." };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isLoopbackHost(hostname)) {
    return { ok: true, url: parsed.toString() };
  }

  if (!allowNonlocalTargetUrls()) {
    return {
      ok: false,
      reason:
        "Only localhost and loopback target URLs are allowed by default. Set HARNESS_ALLOW_NONLOCAL_TARGET_URLS=1 to opt into nonlocal targets."
    };
  }

  if (isBlockedPrivateOrMetadataHost(hostname)) {
    return {
      ok: false,
      reason: "Private, link-local, loopback, broadcast, and metadata target hosts are not allowed."
    };
  }

  return { ok: true, url: parsed.toString() };
};

export const assertAllowedTargetUrl = (value: string, context: string): string => {
  const policy = validateTargetUrlPolicy(value);
  if (!policy.ok || !policy.url) {
    throw new Error(`${context} rejected target URL '${value}': ${policy.reason ?? "URL is not allowed."}`);
  }
  return policy.url;
};
