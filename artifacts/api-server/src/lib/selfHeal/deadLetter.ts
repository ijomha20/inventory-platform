import type { PlatformReason, PlatformSubsystem } from "../platformError.js";
import { enqueueDeadLetter } from "../incidentService.js";

export async function deadLetter(subsystem: PlatformSubsystem, reason: PlatformReason, payload: Record<string, unknown>) {
  await enqueueDeadLetter({ subsystem, reason, payload });
}

