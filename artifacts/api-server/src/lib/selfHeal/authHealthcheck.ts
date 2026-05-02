import { recordIncident } from "../incidentService.js";
import { logger } from "../logger.js";
import { env } from "../env.js";

let lastAuthHealthcheckAt = 0;

export async function runSelfHealAuthHealthcheck(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastAuthHealthcheckAt < 24 * 60 * 60 * 1000) return;
  lastAuthHealthcheckAt = now;

  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) {
    await recordIncident({
      subsystem: "selfHeal",
      reason: "PERMISSION_DENIED",
      recoverability: "permanent",
      message: "Self-heal auth healthcheck: missing GITHUB_TOKEN/GH_TOKEN",
      payload: { check: "github-token" },
    });
    return;
  }

  try {
    const resp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!resp.ok) {
      await recordIncident({
        subsystem: "selfHeal",
        reason: "PERMISSION_DENIED",
        recoverability: "permanent",
        message: `Self-heal auth healthcheck failed with status ${resp.status}`,
        payload: { check: "github-user" },
      });
      return;
    }
    logger.info({ checkedAt: new Date().toISOString() }, "Self-heal auth healthcheck: GitHub credentials OK");
  } catch (err) {
    await recordIncident({
      subsystem: "selfHeal",
      reason: "NETWORK_TIMEOUT",
      recoverability: "transient",
      message: "Self-heal auth healthcheck network error",
      payload: { details: String(err) },
    });
  }
}

