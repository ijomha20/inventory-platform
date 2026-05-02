import test from "node:test";
import assert from "node:assert/strict";
import { staleButServing } from "../../../artifacts/api-server/src/lib/selfHeal/staleButServing.js";
import { withRetry } from "../../../artifacts/api-server/src/lib/selfHeal/withRetry.js";

test("staleButServing returns cached value during outage", async () => {
  await staleButServing({
    key: "chaos-cache",
    fetchFn: async () => ({ value: 123 }),
  });

  const result = await staleButServing({
    key: "chaos-cache",
    fetchFn: async () => {
      throw new Error("upstream down");
    },
  });

  assert.equal(result.stale, true);
  assert.deepEqual(result.value, { value: 123 });
});

test("withRetry survives temporary outage", async () => {
  let attempts = 0;
  const value = await withRetry(
    { retries: 3, baseDelayMs: 1, jitterMs: 0 },
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary outage");
      return "healthy";
    },
  );
  assert.equal(value, "healthy");
  assert.equal(attempts, 3);
});

