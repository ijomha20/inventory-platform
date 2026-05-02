export interface SelfHealCommitTrailer {
  incident: number;
  template: string;
  subsystem: string;
  canarySoakMin: number;
  canaryErrorRateDelta: string;
  syntheticProbes: string;
}

export function formatSelfHealTrailer(trailer: SelfHealCommitTrailer): string {
  return [
    "[self-heal-automerge]",
    `incident: ${trailer.incident}`,
    `template: ${trailer.template}`,
    `subsystem: ${trailer.subsystem}`,
    `canary-soak-min: ${trailer.canarySoakMin}`,
    `canary-error-rate-delta: ${trailer.canaryErrorRateDelta}`,
    `synthetic-probes: ${trailer.syntheticProbes}`,
  ].join("\n");
}

