export * from "./generated/api";
// Re-export individual types from ./generated/types.
// We cannot use `export * from "./generated/types"` because TypeScript flags
// ambiguous names that exist in both api.ts (as Zod schema consts) and types/
// (as TypeScript interfaces): LenderCalculateResponse, RunCarfaxTestBody.
// Those two are intentionally omitted here — consumers can use
// `z.infer<typeof LenderCalculateResponse>` from the Zod schema instead.
export type {
  AccessEntry,
  AddAccessRequest,
  AuditLogEntry,
  AuthDebugCallback200,
  AuthGoogleCallbackParams,
  CacheStatus,
  DebugCounts,
  ErrorResponse,
  GetCarfaxBatchStatus200,
  GetLenderDebug200,
  GetLenderDebug200LendersItem,
  GetVehicleImagesParams,
  HealthStatus,
  InventoryItem,
  InventoryItemBbValues,
  KmRange,
  LenderCalcResultItem,
  LenderCalculateRequest,
  LenderProgram,
  LenderProgramGuide,
  LenderProgramsResponse,
  LenderProgramTier,
  LenderStatus,
  PriceLookup200,
  PriceLookupParams,
  ProgramLimits,
  RunCarfaxTest200,
  RunCarfaxTest200Results,
  SuccessMessageResponse,
  SuccessResponse,
  UpdateAccessRoleRequest,
  User,
  VehicleConditionMatrixEntry,
  VehicleImages,
  VehicleTermMatrixData,
  VehicleTermMatrixEntry,
} from "./generated/types";
