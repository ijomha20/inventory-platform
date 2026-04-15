export type CapModelResolved = "allInOnly" | "split" | "backendOnly" | "unknown";
export type CapProfileKey = "000" | "001" | "010" | "011" | "100" | "101" | "110" | "111";

export interface CapProfile {
  hasAdvanceCap: boolean;
  hasAftermarketCap: boolean;
  hasAllInCap: boolean;
  allInOnly: boolean;
  key: CapProfileKey;
}

export interface CapProfileInput {
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  capModelResolved?: CapModelResolved;
}

export interface NoOnlineSellContext {
  pacCost: number;
  downPayment: number;
  netTrade: number;
  creditorFee: number;
  maxAdvance: number;
  maxAllInPreTax: number;
  profile: CapProfile;
}

export interface NoOnlineSellResolution {
  price: number;
  source: "maximized" | "pac";
  rejection?: "ltvAdvance" | "ltvAllIn";
  strategy: string;
}

export const NO_ONLINE_STRATEGY_BY_PROFILE: Record<CapProfileKey, string> = {
  "000": "pacFallback",
  "001": "maximizeFromAllIn",
  "010": "pacFallback",
  "011": "maximizeFromAllIn",
  "100": "maximizeFromAdvance",
  "101": "maximizeFromAdvanceAndAllIn",
  "110": "maximizeFromAdvance",
  "111": "maximizeFromAdvanceAndAllIn",
};

export function resolveCapProfile(input: CapProfileInput): CapProfile {
  const hasAdvanceCap = input.maxAdvanceLTV > 0;
  const hasAllInCap = input.maxAllInLTV > 0;
  let hasAftermarketCap = input.maxAftermarketLTV > 0;

  // If formula classification says all-in only, suppress aftermarket split cap even if a numeric tier value exists.
  if (input.capModelResolved === "allInOnly") {
    hasAftermarketCap = false;
  }

  const key = `${hasAdvanceCap ? 1 : 0}${hasAftermarketCap ? 1 : 0}${hasAllInCap ? 1 : 0}` as CapProfileKey;

  return {
    hasAdvanceCap,
    hasAftermarketCap,
    hasAllInCap,
    allInOnly: !hasAdvanceCap && !hasAftermarketCap && hasAllInCap,
    key,
  };
}

export function resolveNoOnlineSellingPrice(ctx: NoOnlineSellContext): NoOnlineSellResolution {
  const strategy = NO_ONLINE_STRATEGY_BY_PROFILE[ctx.profile.key];

  const ceilings: { value: number; reason: "ltvAdvance" | "ltvAllIn" }[] = [];
  if (ctx.profile.hasAdvanceCap) {
    ceilings.push({
      value: Math.round(ctx.maxAdvance + ctx.downPayment + ctx.netTrade),
      reason: "ltvAdvance",
    });
  }
  if (ctx.profile.hasAllInCap) {
    ceilings.push({
      value: Math.round(ctx.maxAllInPreTax - ctx.creditorFee + ctx.downPayment + ctx.netTrade),
      reason: "ltvAllIn",
    });
  }

  if (ceilings.length === 0) {
    return { price: ctx.pacCost, source: "pac", strategy };
  }

  const effective = ceilings.reduce((min, c) => c.value < min.value ? c : min, ceilings[0]);

  if (effective.value < ctx.pacCost) {
    return {
      price: effective.value,
      source: "maximized",
      rejection: effective.reason,
      strategy,
    };
  }

  return {
    price: effective.value,
    source: "maximized",
    strategy,
  };
}
