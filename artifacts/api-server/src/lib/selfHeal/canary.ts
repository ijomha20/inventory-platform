import { recordIncident, setSelfHealFlag } from "../incidentService.js";
import { validateInvariant } from "../codeRepair/invariants.js";
import { logger } from "../logger.js";
import type { PlatformSubsystem } from "../platformError.js";

export async function runCanaryForPatch(input: {
  patchId: string;
  subsystem: PlatformSubsystem;
  sampleField?: string;
  sampleValues?: unknown[];
}) {
  await setSelfHealFlag({
    patchId: input.patchId,
    subsystem: input.subsystem,
    flagState: "canary",
  });

  const values = input.sampleValues ?? [];
  if (input.sampleField && values.length > 0) {
    const invalid = values.filter((value) => !validateInvariant(input.sampleField!, value));
    if (invalid.length > 0) {
      await setSelfHealFlag({
        patchId: input.patchId,
        subsystem: input.subsystem,
        flagState: "rolled_back",
        rollbackReason: `Semantic validation failed for ${input.sampleField}`,
      });
      await recordIncident({
        subsystem: "selfHeal",
        reason: "AUTOMERGE_ROLLBACK",
        recoverability: "needsCodeRepair",
        message: `Canary semantic validation failed for patch ${input.patchId}`,
        payload: { sampleField: input.sampleField, invalidCount: invalid.length },
      });
      return { promoted: false, reason: "semantic_validation_failed" };
    }
  }

  await setSelfHealFlag({
    patchId: input.patchId,
    subsystem: input.subsystem,
    flagState: "promoted",
  });
  logger.info({ patchId: input.patchId, subsystem: input.subsystem }, "Canary: patch promoted");
  return { promoted: true };
}

