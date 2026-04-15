export interface GoldenCapFixture {
  lender: string;
  tierName: string;
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  capModelResolved: "allInOnly" | "split" | "backendOnly" | "unknown";
  expectedProfileKey: string;
  expectedNoOnlineStrategy: string;
}

export const GOLDEN_CAP_FIXTURES: GoldenCapFixture[] = [
  {
    lender: "ACC",
    tierName: "Tier 1",
    maxAdvanceLTV: 140,
    maxAftermarketLTV: 25,
    maxAllInLTV: 175,
    capModelResolved: "split",
    expectedProfileKey: "111",
    expectedNoOnlineStrategy: "maximizeFromAdvanceAndAllIn",
  },
  {
    lender: "SAN",
    tierName: "7",
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 30,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
    expectedProfileKey: "001",
    expectedNoOnlineStrategy: "maximizeFromAllIn",
  },
  {
    lender: "iAF",
    tierName: "sample",
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 0,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
    expectedProfileKey: "001",
    expectedNoOnlineStrategy: "maximizeFromAllIn",
  },
  {
    lender: "QLI",
    tierName: "sample",
    maxAdvanceLTV: 140,
    maxAftermarketLTV: 40,
    maxAllInLTV: 0,
    capModelResolved: "split",
    expectedProfileKey: "110",
    expectedNoOnlineStrategy: "maximizeFromAdvance",
  },
];
