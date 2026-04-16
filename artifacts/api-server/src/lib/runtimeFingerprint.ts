import { execSync } from "node:child_process";

const CALCULATOR_VERSION = "calculator-cap-profile-v2";

function readGitSha(): string {
  const env =
    process.env["GIT_SHA"]
    ?? process.env["REPL_GIT_COMMIT"]
    ?? process.env["VERCEL_GIT_COMMIT_SHA"];
  if (env && env.trim().length > 0 && env.trim() !== "unknown") {
    return env.trim();
  }

  // Replit / local dev often omit env SHAs; resolve from .git so responses prove which code is running
  try {
    const sha = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2500,
      cwd: process.cwd(),
    }).trim();
    if (sha.length >= 7) return sha;
  } catch {
    // git not installed or not a checkout
  }

  return "unknown";
}

export function getRuntimeFingerprint() {
  return {
    calculatorVersion: CALCULATOR_VERSION,
    gitSha: readGitSha(),
  };
}
