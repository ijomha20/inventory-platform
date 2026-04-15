type CalcPayload = {
  lenderCode: string;
  programId: string;
  tierName: string;
  approvedRate: number;
  downPayment?: number;
  tradeValue?: number;
  tradeLien?: number;
  taxRate?: number;
  adminFee?: number;
};

type Scenario = {
  name: string;
  payload: CalcPayload;
  assert: (data: any) => string[];
};

const BASE_URL = process.env["LENDER_SMOKE_BASE_URL"];
const COOKIE = process.env["LENDER_SMOKE_COOKIE"];

function fail(msg: string): never {
  throw new Error(msg);
}

function ensure(cond: unknown, message: string, errors: string[]) {
  if (!cond) errors.push(message);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) fail(`Set ${name}`);
  return v;
}

function lenderScenario(
  lenderCode: string,
  defaultRate: number,
  checks: (data: any, errors: string[]) => void,
): Scenario {
  return {
    name: `${lenderCode} smoke`,
    payload: {
      lenderCode,
      programId: required(`LENDER_${lenderCode}_PROGRAM_ID`),
      tierName: required(`LENDER_${lenderCode}_TIER_NAME`),
      approvedRate: Number(process.env[`LENDER_${lenderCode}_APPROVED_RATE`] ?? defaultRate),
      taxRate: 5,
    },
    assert: (data) => {
      const errors: string[] = [];
      ensure(typeof data?.calculatorVersion === "string", "Missing calculatorVersion fingerprint", errors);
      ensure(typeof data?.gitSha === "string", "Missing gitSha fingerprint", errors);
      ensure(Array.isArray(data?.results), "Missing results array", errors);
      const maxAdminFee = data?.programLimits?.maxAdminFee ?? 0;
      if (maxAdminFee > 0 && Array.isArray(data?.results) && data.results.length > 0) {
        const hasAdminUsage = data.results.some((r: any) => Number(r?.adminFeeUsed ?? 0) > 0);
        ensure(hasAdminUsage, "Expected admin fee usage when admin cap exists (admin priority)", errors);
      }
      checks(data, errors);
      return errors;
    },
  };
}

const scenarios: Scenario[] = [
  lenderScenario("SAN", 13.49, (data, errors) => {
    ensure(data?.programLimits?.noOnlineStrategy === "maximizeFromAllIn", "Expected noOnlineStrategy=maximizeFromAllIn", errors);
    ensure(data?.programLimits?.capModelResolved === "allInOnly", "Expected capModelResolved=allInOnly", errors);
  }),
  lenderScenario("ACC", 11.99, (data, errors) => {
    ensure(data?.programLimits?.gapAllowed !== false, "ACC GAP should not be hard-disabled", errors);
  }),
  lenderScenario("iAF", 12.99, (data, errors) => {
    ensure(data?.programLimits?.capModelResolved === "allInOnly", "Expected iAF to resolve allInOnly", errors);
  }),
  lenderScenario("QLI", 12.99, (data, errors) => {
    ensure(data?.programLimits?.noOnlineStrategy !== "pacFallback", "Quantifi should not fall back to PAC when sell caps exist", errors);
  }),
];

async function run() {
  if (!BASE_URL) fail("Set LENDER_SMOKE_BASE_URL");
  if (!COOKIE) fail("Set LENDER_SMOKE_COOKIE (session cookie)");

  for (const scenario of scenarios) {
    const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/api/lender-calculate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": COOKIE,
      },
      body: JSON.stringify(scenario.payload),
    });

    if (!res.ok) {
      fail(`[${scenario.name}] HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const errors = scenario.assert(data);
    if (errors.length > 0) {
      fail(`[${scenario.name}] ${errors.join("; ")}`);
    }
    console.log(`PASS: ${scenario.name}`);
  }
}

run().catch((err) => {
  console.error("Lender smoke failed:", err);
  process.exit(1);
});
