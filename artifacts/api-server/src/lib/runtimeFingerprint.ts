const CALCULATOR_VERSION = "calculator-cap-profile-v2";

function readGitSha(): string {
  return (
    process.env["GIT_SHA"]
    ?? process.env["REPL_GIT_COMMIT"]
    ?? process.env["VERCEL_GIT_COMMIT_SHA"]
    ?? "unknown"
  );
}

export function getRuntimeFingerprint() {
  return {
    calculatorVersion: CALCULATOR_VERSION,
    gitSha: readGitSha(),
  };
}
