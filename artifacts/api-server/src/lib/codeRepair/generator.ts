import { isDangerousCorePath, isTierAPath } from "./allowlist.js";
import type { RepairPatchResult, RepairRequest } from "./templates.js";
import { sendOpsAlert } from "../emailService.js";
import { recordIncident } from "../incidentService.js";
import { env } from "../env.js";

/**
 * Classify a repair request as Tier-A (auto-merge eligible), Tier-2 (draft PR),
 * or refused (dangerous core).
 *
 * Until env.SELF_HEAL_GATE_ACTIVE is true, every result is forced to draft.
 * This is the "graduation" gate: Phase 5a CI gate must be live and verified
 * before any patch can be titled [self-heal-automerge]. See the post-4b
 * advisory and docs/self-heal.md for the activation contract.
 */
export async function evaluateRepairRequest(request: RepairRequest): Promise<RepairPatchResult> {
  if (isDangerousCorePath(request.filePath)) {
    await recordIncident({
      subsystem: "selfHeal",
      reason: "PATCH_REFUSED_DANGEROUS_CORE",
      recoverability: "needsCodeRepair",
      message: `Self-heal patch refused for dangerous-core path ${request.filePath}`,
      payload: { request },
    });
    await sendOpsAlert(
      "critical",
      "Self-heal refused dangerous-core patch",
      `<p>Template: <code>${request.template}</code></p><p>Path: <code>${request.filePath}</code></p><p>Target symbol: <code>${request.targetSymbol}</code></p>`,
    );
    return {
      title: `[self-heal-draft] ${request.template}: refused dangerous core`,
      body: `Patch refused for dangerous-core path: ${request.filePath}`,
      isTierA: false,
      isRefused: true,
      reason: "PATCH_REFUSED_DANGEROUS_CORE",
    };
  }

  const tierAEligible = isTierAPath(request.filePath);
  const gateActive = env.SELF_HEAL_GATE_ACTIVE === true;
  const tierA = tierAEligible && gateActive;
  const prefix = tierA ? "[self-heal-automerge]" : "[self-heal-draft]";
  const gateNote = tierAEligible && !gateActive
    ? "\nForced draft mode: SELF_HEAL_GATE_ACTIVE is not true."
    : "";
  return {
    title: `${prefix} ${request.template}: ${request.targetSymbol}`,
    body: [
      `Template: ${request.template}`,
      `Target file: ${request.filePath}`,
      `Target symbol: ${request.targetSymbol}`,
      `Candidate: ${request.candidate}`,
      `Tier A eligible: ${tierAEligible ? "yes" : "no"}`,
      `Auto-merge enabled: ${tierA ? "yes" : "no"}${gateNote}`,
    ].join("\n"),
    isTierA: tierA,
    isRefused: false,
  };
}
