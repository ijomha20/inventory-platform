/**
 * Typed failure model for cross-subsystem observability and self-healing.
 */
export type PlatformSubsystem =
  | "blackBook"
  | "carfax"
  | "lender"
  | "inventoryFeed"
  | "typesense"
  | "oauth"
  | "appsScriptFeed"
  | "selfHeal"
  | "ops";

export type PlatformReason =
  | "AUTH_REJECTED"
  | "AUTH_EXPIRED"
  | "SELECTOR_MISS"
  | "SCHEMA_DRIFT"
  | "MISSING_FIELD"
  | "RATE_LIMITED"
  | "NETWORK_TIMEOUT"
  | "CAPTCHA"
  | "STALE_FEED"
  | "EMPTY_RESPONSE"
  | "PERMISSION_DENIED"
  | "PATCH_REFUSED_DANGEROUS_CORE"
  | "SELF_HEAL_RATE_LIMITED"
  | "AUTOMERGE_ROLLBACK"
  | "AUTOMERGE_ROLLBACK_CONFLICT"
  | "INCIDENT_LOG_PRUNED"
  | "UNKNOWN";

export type PlatformRecoverability = "transient" | "needsReauth" | "needsCodeRepair" | "permanent";

export interface PlatformErrorInput {
  subsystem: PlatformSubsystem;
  reason: PlatformReason;
  recoverability: PlatformRecoverability;
  message: string;
  payload?: Record<string, unknown> | null;
  cause?: unknown;
}

export class PlatformError extends Error {
  readonly subsystem: PlatformSubsystem;
  readonly reason: PlatformReason;
  readonly recoverability: PlatformRecoverability;
  readonly payload: Record<string, unknown> | null;
  readonly cause?: unknown;

  constructor(input: PlatformErrorInput) {
    super(input.message);
    this.name = "PlatformError";
    this.subsystem = input.subsystem;
    this.reason = input.reason;
    this.recoverability = input.recoverability;
    this.payload = input.payload ?? null;
    this.cause = input.cause;
  }
}

export function isPlatformError(value: unknown): value is PlatformError {
  return value instanceof PlatformError;
}

