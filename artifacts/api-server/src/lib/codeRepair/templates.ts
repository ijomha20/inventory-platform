export type RepairTemplate = "addFieldCandidate" | "addSelector" | "addColumnAlias";

export interface RepairRequest {
  template: RepairTemplate;
  filePath: string;
  targetSymbol: string;
  candidate: string;
}

export interface RepairPatchResult {
  title: string;
  body: string;
  isTierA: boolean;
  isRefused: boolean;
  reason?: string;
}

