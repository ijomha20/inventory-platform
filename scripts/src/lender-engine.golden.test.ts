import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_ONLINE_STRATEGY_BY_PROFILE,
  resolveCapProfile,
  resolveNoOnlineSellingPrice,
} from "../../artifacts/api-server/src/lib/lenderCalcEngine.js";
import { GOLDEN_CAP_FIXTURES } from "./lender-golden-fixtures.js";

test("golden cap profiles resolve expected strategy", () => {
  for (const fixture of GOLDEN_CAP_FIXTURES) {
    const profile = resolveCapProfile({
      maxAdvanceLTV: fixture.maxAdvanceLTV,
      maxAftermarketLTV: fixture.maxAftermarketLTV,
      maxAllInLTV: fixture.maxAllInLTV,
      capModelResolved: fixture.capModelResolved,
    });

    assert.equal(
      profile.key,
      fixture.expectedProfileKey,
      `${fixture.lender} ${fixture.tierName} cap profile mismatch`,
    );
    assert.equal(
      NO_ONLINE_STRATEGY_BY_PROFILE[profile.key],
      fixture.expectedNoOnlineStrategy,
      `${fixture.lender} ${fixture.tierName} strategy mismatch`,
    );
  }
});

test("PAC floor is enforced when no-online ceilings are below PAC", () => {
  const profile = resolveCapProfile({
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 0,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  const resolution = resolveNoOnlineSellingPrice({
    pacCost: 20000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    maxAdvance: Infinity,
    maxAllInPreTax: 18000,
    profile,
  });
  assert.equal(resolution.rejection, "ltvAllIn");
});

test("no-online sell price is maximized from all-in profile", () => {
  const profile = resolveCapProfile({
    maxAdvanceLTV: 0,
    maxAftermarketLTV: 30,
    maxAllInLTV: 165,
    capModelResolved: "allInOnly",
  });
  const resolution = resolveNoOnlineSellingPrice({
    pacCost: 15000,
    downPayment: 0,
    netTrade: 0,
    creditorFee: 699,
    maxAdvance: Infinity,
    maxAllInPreTax: 25000,
    profile,
  });
  assert.equal(resolution.source, "maximized");
  assert.equal(resolution.price, Math.round(25000 - 699));
});
