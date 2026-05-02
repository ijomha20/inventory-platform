import { sendOpsAlert } from "../emailService.js";
import { recordIncident, setSelfHealFlag } from "../incidentService.js";
import type { PlatformSubsystem } from "../platformError.js";

export async function rollbackPatch(input: {
  patchId: string;
  subsystem: PlatformSubsystem;
  reason: string;
  prUrl?: string | null;
  conflict?: boolean;
}) {
  await setSelfHealFlag({
    patchId: input.patchId,
    subsystem: input.subsystem,
    flagState: "rolled_back",
    rollbackReason: input.reason,
    prUrl: input.prUrl ?? null,
  });

  const reasonCode = input.conflict ? "AUTOMERGE_ROLLBACK_CONFLICT" : "AUTOMERGE_ROLLBACK";
  await recordIncident({
    subsystem: "selfHeal",
    reason: reasonCode,
    recoverability: input.conflict ? "needsCodeRepair" : "transient",
    message: `Rollback ${input.conflict ? "conflict" : "executed"} for patch ${input.patchId}`,
    payload: { subsystem: input.subsystem, reason: input.reason, prUrl: input.prUrl ?? null },
  });

  if (input.conflict) {
    await sendOpsAlert(
      "critical",
      "Self-heal rollback PR unresolved",
      `<p>Patch <strong>${input.patchId}</strong> hit rollback conflict.</p><p>Subsystem: ${input.subsystem}</p><p>Reason: ${input.reason}</p><p>PR: ${input.prUrl ?? "n/a"}</p>`,
    );
  }
}

