import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../../artifacts/api-server/src/lib/selfHeal/withRetry.js";
import { withCircuitBreaker, getCircuitState } from "../../artifacts/api-server/src/lib/selfHeal/circuitBreaker.js";
import { probeField } from "../../artifacts/api-server/src/lib/selfHeal/probeField.js";
import { probeSelector } from "../../artifacts/api-server/src/lib/selfHeal/probeSelector.js";
import { reauthIfNeeded } from "../../artifacts/api-server/src/lib/selfHeal/reauthIfNeeded.js";

test("probeField returns fallback match metadata", () => {
  const result = probeField({ backup_vin: "1HGCM82633A004352" }, ["vin", "backup_vin"]);
  assert.equal(result.matchedCandidate, "backup_vin");
  assert.equal(result.usedFallback, true);
});

test("probeSelector resolves fallback selector", async () => {
  const result = await probeSelector(async (selector) => selector === "#b" ? { ok: true } : null, ["#a", "#b"]);
  assert.equal(result.matchedSelector, "#b");
  assert.equal(result.usedFallback, true);
});

test("withRetry retries until success", async () => {
  let attempts = 0;
  const value = await withRetry({ retries: 2, baseDelayMs: 1, jitterMs: 0 }, async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("boom");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("circuit breaker opens after threshold", async () => {
  const key = "test-breaker";
  await assert.rejects(() => withCircuitBreaker(key, async () => { throw new Error("fail"); }, { threshold: 1, cooldownMs: 1000 }));
  assert.equal(getCircuitState(key), "open");
});

test("reauthIfNeeded runs reauth then retries once", async () => {
  let reauthed = 0;
  let attempts = 0;
  const value = await reauthIfNeeded({
    shouldReauth: (error) => String(error).includes("AUTH_EXPIRED"),
    reauth: async () => { reauthed += 1; },
    run: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("AUTH_EXPIRED");
      return "ok";
    },
  });
  assert.equal(value, "ok");
  assert.equal(reauthed, 1);
});

