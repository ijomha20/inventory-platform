import { execSync } from "node:child_process";
import { env } from "./env.js";

const CALCULATOR_VERSION = "calculator-cap-profile-v2";

function readGitSha(): string {
  const sha = env.GIT_SHA || env.REPL_GIT_COMMIT || env.VERCEL_GIT_COMMIT_SHA;
  if (sha && sha !== "unknown") {
    return sha;
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
    /* git not available */
  }

  return "unknown";
}

export function getRuntimeFingerprint() {
  return {
    calculatorVersion: CALCULATOR_VERSION,
    gitSha: readGitSha(),
  };
}
