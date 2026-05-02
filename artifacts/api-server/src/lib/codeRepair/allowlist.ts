export const TIER_A_ALLOWLIST = {
  "artifacts/api-server/src/lib/typesense.ts": [
    "probeFieldCandidates",
    "probeSelectorCandidates",
    "imageDelimiterList",
  ],
  "artifacts/api-server/src/lib/inventoryCache.ts": [
    "inventoryFeedColumnAliasMap",
  ],
  "artifacts/api-server/src/lib/blackBookWorker.ts": [
    "AUTH0_EMAIL_SELECTORS",
    "AUTH0_PASS_SELECTORS",
  ],
  "artifacts/api-server/src/lib/carfaxWorker.ts": [
    "VIN_SEARCH_SELECTORS",
    "REPORT_LINK_SELECTORS",
    "GLOBAL_ARCHIVE_SELECTORS",
    "AUTH0_EMAIL_SELECTORS",
    "AUTH0_PASSWORD_SELECTORS",
  ],
  "artifacts/api-server/src/lib/lenderAuth.ts": [
    "AUTH0_EMAIL_SELECTORS",
    "AUTH0_PASSWORD_SELECTORS",
  ],
} as const;

export const REFUSED_DANGEROUS_CORE_PREFIXES = [
  "artifacts/api-server/src/lib/lenderCalcEngine.ts",
  "artifacts/api-server/src/lib/auth.ts",
  "artifacts/api-server/src/lib/roleFilter.ts",
  "artifacts/api-server/src/lib/env.ts",
  "lib/db/src/schema/",
  "artifacts/api-server/src/routes/lender/",
  "lib/api-spec/",
];

export function isTierAPath(filePath: string): boolean {
  return Object.hasOwn(TIER_A_ALLOWLIST, filePath);
}

export function isDangerousCorePath(filePath: string): boolean {
  return REFUSED_DANGEROUS_CORE_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

