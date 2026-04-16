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

/**
 * Resolves the LTV cap profile for a lender tier into a 3-bit key and boolean flags.
 *
 * The key encodes which caps are active: bit 2 = advance, bit 1 = aftermarket, bit 0 = allIn.
 * Example: "101" means advance cap + allIn cap are active, aftermarket is not.
 *
 * Special rule: when capModelResolved is "allInOnly", the aftermarket cap is suppressed
 * even if a numeric value exists in the tier — this prevents double-constraining products
 * when the lender uses a single all-in bucket for everything.
 *
 * The `allInOnly` flag is true when neither advance nor aftermarket caps are active
 * and only the all-in cap governs the deal (common for Santander, iAF).
 *
 * @param input - Tier LTV percentages + capModelResolved classification
 * @returns CapProfile with boolean flags and a CapProfileKey ("000" through "111")
 */
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

/**
 * Determines the maximized selling price when a vehicle has no online listing price.
 *
 * Strategy is determined by the cap profile key (see NO_ONLINE_STRATEGY_BY_PROFILE):
 * - "pacFallback" (000, 010): no LTV caps → sell at PAC cost
 * - "maximizeFromAdvance" (100, 110): ceiling = maxAdvance + downPayment + netTrade
 * - "maximizeFromAllIn" (001, 011): ceiling = maxAllInPreTax - creditorFee + downPayment + netTrade
 * - "maximizeFromAdvanceAndAllIn" (101, 111): tighter of the two above
 *
 * If the computed ceiling is below PAC cost, the vehicle is flagged with a
 * rejection reason ("ltvAdvance" or "ltvAllIn") — the caller decides whether
 * to skip it or show required down payment.
 *
 * @param ctx - PAC cost, down payment, net trade, creditor fee, max ceilings, and cap profile
 * @returns { price, source ("maximized" | "pac"), rejection?, strategy }
 */
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
