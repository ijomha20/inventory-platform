# Inventory Platform — Complete source (part 2 of 10)

Generated: 2026-05-02T06:08:07 UTC

Machine-generated split of `downloads/inventory-platform-complete-source.md`. Each file in the bundle starts with a `### \`path\`` heading followed by a fenced code block — this split only cuts **between** those blocks so fences stay intact.

- **Single-file bundle:** run `pnpm --filter @workspace/scripts export:complete-md`
- **Parts:** `inventory-platform-complete-source-part-NN-of-10.md` (this is part 2)
- **Replication:** Part 1 begins with the original preamble (quickstart + included roots + TOC). Other parts continue body content only.

---

### `lib/api-spec/openapi.yaml` (1248 lines)

```yaml
openapi: 3.1.0
info:
  # Do not change the title, if the title changes, the import paths will be broken
  title: Api
  version: 0.1.0
  description: API specification
servers:
  - url: /api
    description: Base API path
tags:
  - name: health
    description: Health operations
  - name: auth
    description: Authentication
  - name: inventory
    description: Inventory data
  - name: access
    description: Access list management
  - name: audit
    description: Audit log
  - name: lender
    description: Inventory Selector (lender program calculator)
  - name: carfax
    description: Carfax VHR management
paths:
  /healthz:
    get:
      operationId: healthCheck
      tags: [health]
      summary: Health check
      responses:
        "200":
          description: Healthy
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthStatus"

  /auth/google:
    get:
      operationId: authGoogle
      tags: [auth]
      summary: Kick off Google OAuth login flow (redirects to Google)
      responses:
        "302":
          description: Redirects to Google OAuth consent screen

  /auth/google/callback:
    get:
      operationId: authGoogleCallback
      tags: [auth]
      summary: Google OAuth callback (redirects to app)
      parameters:
        - name: code
          in: query
          schema:
            type: string
        - name: state
          in: query
          schema:
            type: string
      responses:
        "302":
          description: Redirects to app root on success or /?auth_error=1 on failure

  /auth/logout:
    get:
      operationId: authLogout
      tags: [auth]
      summary: Destroy session and redirect to app root
      responses:
        "302":
          description: Redirects to /

  /auth/debug-callback:
    get:
      operationId: authDebugCallback
      tags: [auth]
      summary: Debug endpoint showing the computed OAuth callback URL
      responses:
        "200":
          description: Callback URL info
          content:
            application/json:
              schema:
                type: object
                properties:
                  callbackURL:
                    type: string
                  REPLIT_DOMAINS:
                    type: string
                required:
                  - callbackURL
                  - REPLIT_DOMAINS

  /me:
    get:
      operationId: getMe
      tags: [auth]
      summary: Get current authenticated user
      responses:
        "200":
          description: Current user
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /inventory:
    get:
      operationId: getInventory
      tags: [inventory]
      summary: Get all inventory items
      responses:
        "200":
          description: List of inventory items
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/InventoryItem"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Access denied
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /cache-status:
    get:
      operationId: getCacheStatus
      tags: [inventory]
      summary: Get the timestamp of the last inventory cache refresh
      responses:
        "200":
          description: Cache status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CacheStatus"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /refresh:
    post:
      operationId: refreshCache
      tags: [inventory]
      summary: Webhook from Apps Script to trigger an immediate cache refresh (secret header auth)
      parameters:
        - name: x-refresh-secret
          in: header
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Refresh triggered
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessMessageResponse"
        "401":
          description: Unauthorized — invalid or missing secret
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /refresh-blackbook:
    post:
      operationId: refreshBlackBook
      tags: [inventory]
      summary: Trigger manual Black Book refresh (owner only)
      responses:
        "200":
          description: Refresh started or already running
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessMessageResponse"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /vehicle-images:
    get:
      operationId: getVehicleImages
      tags: [inventory]
      summary: Get photo gallery URLs for a vehicle by VIN
      parameters:
        - name: vin
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Vehicle image URLs
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/VehicleImages"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /access:
    get:
      operationId: getAccessList
      tags: [access]
      summary: Get list of approved emails (owner only)
      responses:
        "200":
          description: Approved emails
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/AccessEntry"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
    post:
      operationId: addAccessEntry
      tags: [access]
      summary: Add an email to the access list (owner only)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/AddAccessRequest"
      responses:
        "200":
          description: Entry added
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AccessEntry"
        "400":
          description: Bad request
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /access/{email}:
    patch:
      operationId: updateAccessRole
      tags: [access]
      summary: Update a user's role (owner only)
      parameters:
        - name: email
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/UpdateAccessRoleRequest"
      responses:
        "200":
          description: Entry updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AccessEntry"
        "400":
          description: Bad request
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "404":
          description: User not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
    delete:
      operationId: removeAccessEntry
      tags: [access]
      summary: Remove an email from the access list (owner only)
      parameters:
        - name: email
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Entry removed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /lender-programs:
    get:
      operationId: getLenderPrograms
      tags: [lender]
      summary: Get cached lender program matrices (owner or viewer)
      responses:
        "200":
          description: Lender programs
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LenderProgramsResponse"
        "403":
          description: Owner or Viewer only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /lender-status:
    get:
      operationId: getLenderStatus
      tags: [lender]
      summary: Get lender sync status (owner or viewer)
      responses:
        "200":
          description: Sync status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LenderStatus"
        "403":
          description: Owner or Viewer only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /refresh-lender:
    post:
      operationId: refreshLender
      tags: [lender]
      summary: Trigger manual lender sync (owner only)
      responses:
        "200":
          description: Sync triggered
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /lender-calculate:
    post:
      operationId: lenderCalculate
      tags: [lender]
      summary: Calculate inventory affordability by lender/tier (owner or viewer)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/LenderCalculateRequest"
      responses:
        "200":
          description: Filtered results
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LenderCalculateResponse"
        "400":
          description: Bad request
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Owner or Viewer only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "404":
          description: Lender, program, or tier not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /lender-debug:
    get:
      operationId: getLenderDebug
      tags: [lender]
      summary: Diagnostic dump of cached lender program metadata (owner only)
      responses:
        "200":
          description: Debug lender summary
          content:
            application/json:
              schema:
                type: object
                properties:
                  updatedAt:
                    type: string
                    nullable: true
                  lenders:
                    type: array
                    items:
                      type: object
                  calculatorVersion:
                    type: string
                  gitSha:
                    type: string
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /audit-log:
    get:
      operationId: getAuditLog
      tags: [audit]
      summary: Get audit log of access changes (owner only)
      responses:
        "200":
          description: Audit log entries
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/AuditLogEntry"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /carfax/batch-status:
    get:
      operationId: getCarfaxBatchStatus
      tags: [carfax]
      summary: Get current Carfax batch worker status (owner only)
      responses:
        "200":
          description: Batch status
          content:
            application/json:
              schema:
                type: object
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /carfax/run-batch:
    post:
      operationId: runCarfaxBatch
      tags: [carfax]
      summary: Trigger a manual Carfax batch run (owner only)
      responses:
        "200":
          description: Batch started
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessMessageResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "409":
          description: Batch already running
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /carfax/test:
    post:
      operationId: runCarfaxTest
      tags: [carfax]
      summary: Run a targeted Carfax lookup for up to 10 VINs (owner only)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                vins:
                  type: array
                  items:
                    type: string
              required:
                - vins
      responses:
        "200":
          description: Test results
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
                  results:
                    type: object
                required:
                  - ok
                  - results
        "400":
          description: Bad request
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Owner only
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /price-lookup:
    get:
      operationId: priceLookup
      tags: [inventory]
      summary: Resolve a dealer listing URL to a live price via Typesense
      parameters:
        - name: url
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Resolved price (null if not found)
          content:
            application/json:
              schema:
                type: object
                properties:
                  price:
                    type: string
                    nullable: true
                required:
                  - price
        "400":
          description: Invalid URL
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "401":
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

components:
  schemas:
    HealthStatus:
      type: object
      properties:
        status:
          type: string
      required:
        - status

    User:
      type: object
      properties:
        email:
          type: string
        name:
          type: string
        picture:
          type: string
        isOwner:
          type: boolean
        role:
          type: string
      required:
        - email
        - name
        - isOwner
        - role

    InventoryItem:
      type: object
      properties:
        location:
          type: string
        vehicle:
          type: string
        vin:
          type: string
        price:
          type: string
        km:
          type: string
        carfax:
          type: string
        website:
          type: string
        onlinePrice:
          type: string
        matrixPrice:
          type: string
          nullable: true
        cost:
          type: string
          nullable: true
        bbAvgWholesale:
          type: string
          nullable: true
        hasPhotos:
          type: boolean
        bbValues:
          type: object
          nullable: true
          properties:
            xclean:
              type: number
            clean:
              type: number
            avg:
              type: number
            rough:
              type: number
          required:
            - xclean
            - clean
            - avg
            - rough
      required:
        - location
        - vehicle
        - vin
        - price

    CacheStatus:
      type: object
      properties:
        lastUpdated:
          type: string
          nullable: true
        isRefreshing:
          type: boolean
        count:
          type: integer
        bbRunning:
          type: boolean
        bbLastRun:
          type: string
          nullable: true
        bbCount:
          type: integer
          nullable: true
      required:
        - isRefreshing
        - count
        - bbRunning

    VehicleImages:
      type: object
      properties:
        vin:
          type: string
        urls:
          type: array
          items:
            type: string
        websiteUrl:
          type: string
          nullable: true
      required:
        - vin
        - urls

    AccessEntry:
      type: object
      properties:
        email:
          type: string
        addedAt:
          type: string
        addedBy:
          type: string
        role:
          type: string
      required:
        - email
        - addedAt
        - addedBy
        - role

    AddAccessRequest:
      type: object
      properties:
        email:
          type: string
        role:
          type: string
      required:
        - email

    UpdateAccessRoleRequest:
      type: object
      properties:
        role:
          type: string
      required:
        - role

    AuditLogEntry:
      type: object
      properties:
        id:
          type: integer
        action:
          type: string
        targetEmail:
          type: string
        changedBy:
          type: string
        roleFrom:
          type: string
          nullable: true
        roleTo:
          type: string
          nullable: true
        timestamp:
          type: string
      required:
        - id
        - action
        - targetEmail
        - changedBy
        - timestamp

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
      required:
        - error

    SuccessResponse:
      type: object
      properties:
        ok:
          type: boolean
      required:
        - ok

    SuccessMessageResponse:
      type: object
      properties:
        ok:
          type: boolean
        message:
          type: string
      required:
        - ok

    LenderProgramTier:
      type: object
      properties:
        tierName:
          type: string
        minRate:
          type: number
        maxRate:
          type: number
        maxPayment:
          type: number
        maxAdvanceLTV:
          type: number
        maxAftermarketLTV:
          type: number
        maxAllInLTV:
          type: number
        creditorFee:
          type: number
        dealerReserve:
          type: number
      required:
        - tierName
        - minRate
        - maxRate
        - maxPayment
        - maxAdvanceLTV
        - maxAftermarketLTV
        - maxAllInLTV
        - creditorFee
        - dealerReserve

    VehicleTermMatrixData:
      type: object
      properties:
        term:
          type: integer
        kmFrom:
          type: integer
        kmTo:
          type: integer
      required: [term, kmFrom, kmTo]

    VehicleTermMatrixEntry:
      type: object
      properties:
        year:
          type: integer
        data:
          type: array
          items:
            $ref: "#/components/schemas/VehicleTermMatrixData"
      required: [year, data]

    KmRange:
      type: object
      properties:
        kmFrom:
          type: integer
        kmTo:
          type: integer
      required: [kmFrom, kmTo]

    VehicleConditionMatrixEntry:
      type: object
      properties:
        year:
          type: integer
        extraClean:
          $ref: "#/components/schemas/KmRange"
        clean:
          $ref: "#/components/schemas/KmRange"
        average:
          $ref: "#/components/schemas/KmRange"
        rough:
          $ref: "#/components/schemas/KmRange"
      required: [year, extraClean, clean, average, rough]

    LenderProgramGuide:
      type: object
      properties:
        programId:
          type: string
        programTitle:
          type: string
        programType:
          type: string
        tiers:
          type: array
          items:
            $ref: "#/components/schemas/LenderProgramTier"
        vehicleTermMatrix:
          type: array
          items:
            $ref: "#/components/schemas/VehicleTermMatrixEntry"
        vehicleConditionMatrix:
          type: array
          items:
            $ref: "#/components/schemas/VehicleConditionMatrixEntry"
        maxTerm:
          type: integer
        maxWarrantyPrice:
          type: number
          nullable: true
        maxGapPrice:
          type: number
          nullable: true
        maxAdminFee:
          type: number
          nullable: true
      required:
        - programId
        - programTitle
        - programType
        - tiers
        - vehicleTermMatrix
        - vehicleConditionMatrix

    LenderProgram:
      type: object
      properties:
        lenderCode:
          type: string
        lenderName:
          type: string
        creditorId:
          type: string
        programs:
          type: array
          items:
            $ref: "#/components/schemas/LenderProgramGuide"
      required:
        - lenderCode
        - lenderName
        - creditorId
        - programs

    LenderProgramsResponse:
      type: object
      properties:
        programs:
          type: array
          items:
            $ref: "#/components/schemas/LenderProgram"
        updatedAt:
          type: string
          nullable: true
        role:
          type: string
      required:
        - programs

    LenderStatus:
      type: object
      properties:
        running:
          type: boolean
        startedAt:
          type: string
          nullable: true
        lastRun:
          type: string
          nullable: true
        lenderCount:
          type: integer
        error:
          type: string
          nullable: true
        programsAge:
          type: string
          nullable: true
      required:
        - running
        - lenderCount

    LenderCalculateRequest:
      type: object
      properties:
        lenderCode:
          type: string
        programId:
          type: string
        tierName:
          type: string
        approvedRate:
          type: number
        maxPaymentOverride:
          type: number
        downPayment:
          type: number
        tradeValue:
          type: number
        tradeLien:
          type: number
        taxRate:
          type: number
        adminFee:
          type: number
        termStretchMonths:
          type: integer
      required:
        - lenderCode
        - programId
        - tierName
        - approvedRate

    LenderCalcResultItem:
      type: object
      properties:
        vin:
          type: string
        vehicle:
          type: string
        location:
          type: string
        term:
          type: integer
        matrixTerm:
          type: integer
        termStretchApplied:
          type: integer
        termStretched:
          type: boolean
        termStretchCappedReason:
          type: string
          nullable: true
        conditionUsed:
          type: string
        bbWholesale:
          type: number
        pacCost:
          type: number
        pacCostSource:
          type: string
        onlinePrice:
          type: number
          nullable: true
        sellingPrice:
          type: number
        sellingPriceCappedByOnline:
          type: boolean
        bindingSellingConstraint:
          type: string
        requiredDownPayment:
          type: number
        adminFeeUsed:
          type: number
        warrantyPrice:
          type: number
        warrantyCost:
          type: number
        gapPrice:
          type: number
        gapCost:
          type: number
        totalFinanced:
          type: number
        monthlyPayment:
          type: number
        frontEndGross:
          type: number
        nonCancelableGross:
          type: number
        cancelableBackendGross:
          type: number
        totalGross:
          type: number
        allocationOrderApplied:
          type: array
          items:
            type: string
        hasPhotos:
          type: boolean
        website:
          type: string
      required:
        - vin
        - vehicle
        - location
        - term
        - matrixTerm
        - termStretchApplied
        - termStretched
        - conditionUsed
        - bbWholesale
        - pacCost
        - pacCostSource
        - sellingPrice
        - sellingPriceCappedByOnline
        - bindingSellingConstraint
        - adminFeeUsed
        - warrantyPrice
        - warrantyCost
        - gapPrice
        - gapCost
        - totalFinanced
        - monthlyPayment
        - frontEndGross
        - nonCancelableGross
        - cancelableBackendGross
        - totalGross
        - allocationOrderApplied
        - hasPhotos
        - website

    DebugCounts:
      type: object
      properties:
        total:
          type: integer
        noYear:
          type: integer
        noKm:
          type: integer
        noTerm:
          type: integer
        noCondition:
          type: integer
        noBB:
          type: integer
        noBBVal:
          type: integer
        noPacPrice:
          type: integer
        passed:
          type: integer

    ProgramLimits:
      type: object
      properties:
        maxWarrantyPrice:
          type: number
          nullable: true
        maxGapPrice:
          type: number
          nullable: true
        maxAdminFee:
          type: number
          nullable: true
        maxGapMarkup:
          type: number
        gapAllowed:
          type: boolean
        allInOnly:
          type: boolean
        hasAdvanceCap:
          type: boolean
        hasAftermarketCap:
          type: boolean
        aftermarketBudgetIsDynamic:
          type: boolean
        aftermarketBase:
          type: string
        adminFeeInclusion:
          type: string
        capModelResolved:
          type: string
        capProfileKey:
          type: string
        noOnlineStrategy:
          type: string
      required:
        - gapAllowed
        - allInOnly
        - hasAdvanceCap
        - hasAftermarketCap
        - aftermarketBudgetIsDynamic
        - aftermarketBase
        - adminFeeInclusion
        - capModelResolved
        - capProfileKey
        - noOnlineStrategy

    LenderCalculateResponse:
      type: object
      properties:
        lender:
          type: string
        program:
          type: string
        tier:
          type: string
        termStretchMonths:
          type: integer
        calculatorVersion:
          type: string
        gitSha:
          type: string
        tierConfig:
          $ref: "#/components/schemas/LenderProgramTier"
        programLimits:
          $ref: "#/components/schemas/ProgramLimits"
        pacCostSource:
          type: string
        debugCounts:
          $ref: "#/components/schemas/DebugCounts"
        resultCount:
          type: integer
        results:
          type: array
          items:
            $ref: "#/components/schemas/LenderCalcResultItem"
      required:
        - lender
        - program
        - tier
        - termStretchMonths
        - calculatorVersion
        - gitSha
        - tierConfig
        - pacCostSource
        - programLimits
        - debugCounts
        - resultCount
        - results

```

### `lib/api-spec/orval.config.ts` (73 lines)

```typescript
import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});

```

### `lib/api-spec/package.json` (12 lines)

```json
{
  "name": "@workspace/api-spec",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "codegen": "orval --config ./orval.config.ts"
  },
  "devDependencies": {
    "orval": "^8.5.2"
  }
}

```

---

<a id="codegen"></a>
## 5. Generated clients & Zod (Orval output)

*49 file(s).*

### `lib/api-client-react/package.json` (16 lines)

```json
{
  "name": "@workspace/api-client-react",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@tanstack/react-query": "catalog:"
  },
  "peerDependencies": {
    "react": ">=18"
  }
}

```

### `lib/api-client-react/src/custom-fetch.ts` (369 lines)

```typescript
export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const response = await fetch(input, { ...init, method, headers });

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}

```

### `lib/api-client-react/src/generated/api.schemas.ts` (303 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
export interface HealthStatus {
  status: string;
}

export interface User {
  email: string;
  name: string;
  picture?: string;
  isOwner: boolean;
  role: string;
}

export type InventoryItemBbValues = {
  xclean: number;
  clean: number;
  avg: number;
  rough: number;
} | null;

export interface InventoryItem {
  location: string;
  vehicle: string;
  vin: string;
  price: string;
  km?: string;
  carfax?: string;
  website?: string;
  onlinePrice?: string;
  matrixPrice?: string | null;
  cost?: string | null;
  bbAvgWholesale?: string | null;
  hasPhotos?: boolean;
  bbValues?: InventoryItemBbValues;
}

export interface CacheStatus {
  lastUpdated?: string | null;
  isRefreshing: boolean;
  count: number;
  bbRunning: boolean;
  bbLastRun?: string | null;
  bbCount?: number | null;
}

export interface VehicleImages {
  vin: string;
  urls: string[];
  websiteUrl?: string | null;
}

export interface AccessEntry {
  email: string;
  addedAt: string;
  addedBy: string;
  role: string;
}

export interface AddAccessRequest {
  email: string;
  role?: string;
}

export interface UpdateAccessRoleRequest {
  role: string;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  targetEmail: string;
  changedBy: string;
  roleFrom?: string | null;
  roleTo?: string | null;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
}

export interface SuccessResponse {
  ok: boolean;
}

export interface SuccessMessageResponse {
  ok: boolean;
  message?: string;
}

export interface LenderProgramTier {
  tierName: string;
  minRate: number;
  maxRate: number;
  maxPayment: number;
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  creditorFee: number;
  dealerReserve: number;
}

export interface VehicleTermMatrixData {
  term: number;
  kmFrom: number;
  kmTo: number;
}

export interface VehicleTermMatrixEntry {
  year: number;
  data: VehicleTermMatrixData[];
}

export interface KmRange {
  kmFrom: number;
  kmTo: number;
}

export interface VehicleConditionMatrixEntry {
  year: number;
  extraClean: KmRange;
  clean: KmRange;
  average: KmRange;
  rough: KmRange;
}

export interface LenderProgramGuide {
  programId: string;
  programTitle: string;
  programType: string;
  tiers: LenderProgramTier[];
  vehicleTermMatrix: VehicleTermMatrixEntry[];
  vehicleConditionMatrix: VehicleConditionMatrixEntry[];
  maxTerm?: number;
  maxWarrantyPrice?: number | null;
  maxGapPrice?: number | null;
  maxAdminFee?: number | null;
}

export interface LenderProgram {
  lenderCode: string;
  lenderName: string;
  creditorId: string;
  programs: LenderProgramGuide[];
}

export interface LenderProgramsResponse {
  programs: LenderProgram[];
  updatedAt?: string | null;
  role?: string;
}

export interface LenderStatus {
  running: boolean;
  startedAt?: string | null;
  lastRun?: string | null;
  lenderCount: number;
  error?: string | null;
  programsAge?: string | null;
}

export interface LenderCalculateRequest {
  lenderCode: string;
  programId: string;
  tierName: string;
  approvedRate: number;
  maxPaymentOverride?: number;
  downPayment?: number;
  tradeValue?: number;
  tradeLien?: number;
  taxRate?: number;
  adminFee?: number;
  termStretchMonths?: number;
}

export interface LenderCalcResultItem {
  vin: string;
  vehicle: string;
  location: string;
  term: number;
  matrixTerm: number;
  termStretchApplied: number;
  termStretched: boolean;
  termStretchCappedReason?: string | null;
  conditionUsed: string;
  bbWholesale: number;
  pacCost: number;
  pacCostSource: string;
  onlinePrice?: number | null;
  sellingPrice: number;
  sellingPriceCappedByOnline: boolean;
  bindingSellingConstraint: string;
  requiredDownPayment?: number;
  adminFeeUsed: number;
  warrantyPrice: number;
  warrantyCost: number;
  gapPrice: number;
  gapCost: number;
  totalFinanced: number;
  monthlyPayment: number;
  frontEndGross: number;
  nonCancelableGross: number;
  cancelableBackendGross: number;
  totalGross: number;
  allocationOrderApplied: string[];
  hasPhotos: boolean;
  website: string;
}

export interface DebugCounts {
  total?: number;
  noYear?: number;
  noKm?: number;
  noTerm?: number;
  noCondition?: number;
  noBB?: number;
  noBBVal?: number;
  noPacPrice?: number;
  passed?: number;
}

export interface ProgramLimits {
  maxWarrantyPrice?: number | null;
  maxGapPrice?: number | null;
  maxAdminFee?: number | null;
  maxGapMarkup?: number;
  gapAllowed: boolean;
  allInOnly: boolean;
  hasAdvanceCap: boolean;
  hasAftermarketCap: boolean;
  aftermarketBudgetIsDynamic: boolean;
  aftermarketBase: string;
  adminFeeInclusion: string;
  capModelResolved: string;
  capProfileKey: string;
  noOnlineStrategy: string;
}

export interface LenderCalculateResponse {
  lender: string;
  program: string;
  tier: string;
  termStretchMonths: number;
  calculatorVersion: string;
  gitSha: string;
  tierConfig: LenderProgramTier;
  programLimits: ProgramLimits;
  pacCostSource: string;
  debugCounts: DebugCounts;
  resultCount: number;
  results: LenderCalcResultItem[];
}

export type AuthGoogleCallbackParams = {
  code?: string;
  state?: string;
};

export type AuthDebugCallback200 = {
  callbackURL: string;
  REPLIT_DOMAINS: string;
};

export type GetVehicleImagesParams = {
  vin: string;
};

export type GetLenderDebug200LendersItem = { [key: string]: unknown };

export type GetLenderDebug200 = {
  updatedAt?: string | null;
  lenders?: GetLenderDebug200LendersItem[];
  calculatorVersion?: string;
  gitSha?: string;
};

export type GetCarfaxBatchStatus200 = { [key: string]: unknown };

export type RunCarfaxTestBody = {
  vins: string[];
};

export type RunCarfaxTest200Results = { [key: string]: unknown };

export type RunCarfaxTest200 = {
  ok: boolean;
  results: RunCarfaxTest200Results;
};

export type PriceLookupParams = {
  url: string;
};

export type PriceLookup200 = {
  price: string | null;
};

```

### `lib/api-client-react/src/generated/api.ts` (2055 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MutationFunction,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";

import type {
  AccessEntry,
  AddAccessRequest,
  AuditLogEntry,
  AuthDebugCallback200,
  AuthGoogleCallbackParams,
  CacheStatus,
  ErrorResponse,
  GetCarfaxBatchStatus200,
  GetLenderDebug200,
  GetVehicleImagesParams,
  HealthStatus,
  InventoryItem,
  LenderCalculateRequest,
  LenderCalculateResponse,
  LenderProgramsResponse,
  LenderStatus,
  PriceLookup200,
  PriceLookupParams,
  RunCarfaxTest200,
  RunCarfaxTestBody,
  SuccessMessageResponse,
  SuccessResponse,
  UpdateAccessRoleRequest,
  User,
  VehicleImages,
} from "./api.schemas";

import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";

type AwaitedInput<T> = PromiseLike<T> | T;

type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;

type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

/**
 * @summary Health check
 */
export const getHealthCheckUrl = () => {
  return `/api/healthz`;
};

export const healthCheck = async (
  options?: RequestInit,
): Promise<HealthStatus> => {
  return customFetch<HealthStatus>(getHealthCheckUrl(), {
    ...options,
    method: "GET",
  });
};

export const getHealthCheckQueryKey = () => {
  return [`/api/healthz`] as const;
};

export const getHealthCheckQueryOptions = <
  TData = Awaited<ReturnType<typeof healthCheck>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getHealthCheckQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof healthCheck>>> = ({
    signal,
  }) => healthCheck({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type HealthCheckQueryResult = NonNullable<
  Awaited<ReturnType<typeof healthCheck>>
>;
export type HealthCheckQueryError = ErrorType<unknown>;

/**
 * @summary Health check
 */

export function useHealthCheck<
  TData = Awaited<ReturnType<typeof healthCheck>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getHealthCheckQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Kick off Google OAuth login flow (redirects to Google)
 */
export const getAuthGoogleUrl = () => {
  return `/api/auth/google`;
};

export const authGoogle = async (options?: RequestInit): Promise<unknown> => {
  return customFetch<unknown>(getAuthGoogleUrl(), {
    ...options,
    method: "GET",
  });
};

export const getAuthGoogleQueryKey = () => {
  return [`/api/auth/google`] as const;
};

export const getAuthGoogleQueryOptions = <
  TData = Awaited<ReturnType<typeof authGoogle>>,
  TError = ErrorType<void>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof authGoogle>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getAuthGoogleQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof authGoogle>>> = ({
    signal,
  }) => authGoogle({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof authGoogle>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type AuthGoogleQueryResult = NonNullable<
  Awaited<ReturnType<typeof authGoogle>>
>;
export type AuthGoogleQueryError = ErrorType<void>;

/**
 * @summary Kick off Google OAuth login flow (redirects to Google)
 */

export function useAuthGoogle<
  TData = Awaited<ReturnType<typeof authGoogle>>,
  TError = ErrorType<void>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof authGoogle>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getAuthGoogleQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Google OAuth callback (redirects to app)
 */
export const getAuthGoogleCallbackUrl = (params?: AuthGoogleCallbackParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/auth/google/callback?${stringifiedParams}`
    : `/api/auth/google/callback`;
};

export const authGoogleCallback = async (
  params?: AuthGoogleCallbackParams,
  options?: RequestInit,
): Promise<unknown> => {
  return customFetch<unknown>(getAuthGoogleCallbackUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getAuthGoogleCallbackQueryKey = (
  params?: AuthGoogleCallbackParams,
) => {
  return [`/api/auth/google/callback`, ...(params ? [params] : [])] as const;
};

export const getAuthGoogleCallbackQueryOptions = <
  TData = Awaited<ReturnType<typeof authGoogleCallback>>,
  TError = ErrorType<void>,
>(
  params?: AuthGoogleCallbackParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof authGoogleCallback>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getAuthGoogleCallbackQueryKey(params);

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof authGoogleCallback>>
  > = ({ signal }) => authGoogleCallback(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof authGoogleCallback>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type AuthGoogleCallbackQueryResult = NonNullable<
  Awaited<ReturnType<typeof authGoogleCallback>>
>;
export type AuthGoogleCallbackQueryError = ErrorType<void>;

/**
 * @summary Google OAuth callback (redirects to app)
 */

export function useAuthGoogleCallback<
  TData = Awaited<ReturnType<typeof authGoogleCallback>>,
  TError = ErrorType<void>,
>(
  params?: AuthGoogleCallbackParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof authGoogleCallback>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getAuthGoogleCallbackQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Destroy session and redirect to app root
 */
export const getAuthLogoutUrl = () => {
  return `/api/auth/logout`;
};

export const authLogout = async (options?: RequestInit): Promise<unknown> => {
  return customFetch<unknown>(getAuthLogoutUrl(), {
    ...options,
    method: "GET",
  });
};

export const getAuthLogoutQueryKey = () => {
  return [`/api/auth/logout`] as const;
};

export const getAuthLogoutQueryOptions = <
  TData = Awaited<ReturnType<typeof authLogout>>,
  TError = ErrorType<void>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof authLogout>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getAuthLogoutQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof authLogout>>> = ({
    signal,
  }) => authLogout({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof authLogout>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type AuthLogoutQueryResult = NonNullable<
  Awaited<ReturnType<typeof authLogout>>
>;
export type AuthLogoutQueryError = ErrorType<void>;

/**
 * @summary Destroy session and redirect to app root
 */

export function useAuthLogout<
  TData = Awaited<ReturnType<typeof authLogout>>,
  TError = ErrorType<void>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof authLogout>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getAuthLogoutQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Debug endpoint showing the computed OAuth callback URL
 */
export const getAuthDebugCallbackUrl = () => {
  return `/api/auth/debug-callback`;
};

export const authDebugCallback = async (
  options?: RequestInit,
): Promise<AuthDebugCallback200> => {
  return customFetch<AuthDebugCallback200>(getAuthDebugCallbackUrl(), {
    ...options,
    method: "GET",
  });
};

export const getAuthDebugCallbackQueryKey = () => {
  return [`/api/auth/debug-callback`] as const;
};

export const getAuthDebugCallbackQueryOptions = <
  TData = Awaited<ReturnType<typeof authDebugCallback>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof authDebugCallback>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getAuthDebugCallbackQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof authDebugCallback>>
  > = ({ signal }) => authDebugCallback({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof authDebugCallback>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type AuthDebugCallbackQueryResult = NonNullable<
  Awaited<ReturnType<typeof authDebugCallback>>
>;
export type AuthDebugCallbackQueryError = ErrorType<unknown>;

/**
 * @summary Debug endpoint showing the computed OAuth callback URL
 */

export function useAuthDebugCallback<
  TData = Awaited<ReturnType<typeof authDebugCallback>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof authDebugCallback>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getAuthDebugCallbackQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get current authenticated user
 */
export const getGetMeUrl = () => {
  return `/api/me`;
};

export const getMe = async (options?: RequestInit): Promise<User> => {
  return customFetch<User>(getGetMeUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetMeQueryKey = () => {
  return [`/api/me`] as const;
};

export const getGetMeQueryOptions = <
  TData = Awaited<ReturnType<typeof getMe>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetMeQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getMe>>> = ({
    signal,
  }) => getMe({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getMe>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetMeQueryResult = NonNullable<Awaited<ReturnType<typeof getMe>>>;
export type GetMeQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get current authenticated user
 */

export function useGetMe<
  TData = Awaited<ReturnType<typeof getMe>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetMeQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get all inventory items
 */
export const getGetInventoryUrl = () => {
  return `/api/inventory`;
};

export const getInventory = async (
  options?: RequestInit,
): Promise<InventoryItem[]> => {
  return customFetch<InventoryItem[]>(getGetInventoryUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetInventoryQueryKey = () => {
  return [`/api/inventory`] as const;
};

export const getGetInventoryQueryOptions = <
  TData = Awaited<ReturnType<typeof getInventory>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getInventory>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetInventoryQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getInventory>>> = ({
    signal,
  }) => getInventory({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getInventory>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetInventoryQueryResult = NonNullable<
  Awaited<ReturnType<typeof getInventory>>
>;
export type GetInventoryQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get all inventory items
 */

export function useGetInventory<
  TData = Awaited<ReturnType<typeof getInventory>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getInventory>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetInventoryQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get the timestamp of the last inventory cache refresh
 */
export const getGetCacheStatusUrl = () => {
  return `/api/cache-status`;
};

export const getCacheStatus = async (
  options?: RequestInit,
): Promise<CacheStatus> => {
  return customFetch<CacheStatus>(getGetCacheStatusUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetCacheStatusQueryKey = () => {
  return [`/api/cache-status`] as const;
};

export const getGetCacheStatusQueryOptions = <
  TData = Awaited<ReturnType<typeof getCacheStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCacheStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetCacheStatusQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getCacheStatus>>> = ({
    signal,
  }) => getCacheStatus({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getCacheStatus>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetCacheStatusQueryResult = NonNullable<
  Awaited<ReturnType<typeof getCacheStatus>>
>;
export type GetCacheStatusQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get the timestamp of the last inventory cache refresh
 */

export function useGetCacheStatus<
  TData = Awaited<ReturnType<typeof getCacheStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCacheStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetCacheStatusQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Webhook from Apps Script to trigger an immediate cache refresh (secret header auth)
 */
export const getRefreshCacheUrl = () => {
  return `/api/refresh`;
};

export const refreshCache = async (
  options?: RequestInit,
): Promise<SuccessMessageResponse> => {
  return customFetch<SuccessMessageResponse>(getRefreshCacheUrl(), {
    ...options,
    method: "POST",
  });
};

export const getRefreshCacheMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof refreshCache>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof refreshCache>>,
  TError,
  void,
  TContext
> => {
  const mutationKey = ["refreshCache"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof refreshCache>>,
    void
  > = () => {
    return refreshCache(requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RefreshCacheMutationResult = NonNullable<
  Awaited<ReturnType<typeof refreshCache>>
>;

export type RefreshCacheMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Webhook from Apps Script to trigger an immediate cache refresh (secret header auth)
 */
export const useRefreshCache = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof refreshCache>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof refreshCache>>,
  TError,
  void,
  TContext
> => {
  return useMutation(getRefreshCacheMutationOptions(options));
};

/**
 * @summary Trigger manual Black Book refresh (owner only)
 */
export const getRefreshBlackBookUrl = () => {
  return `/api/refresh-blackbook`;
};

export const refreshBlackBook = async (
  options?: RequestInit,
): Promise<SuccessMessageResponse> => {
  return customFetch<SuccessMessageResponse>(getRefreshBlackBookUrl(), {
    ...options,
    method: "POST",
  });
};

export const getRefreshBlackBookMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof refreshBlackBook>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof refreshBlackBook>>,
  TError,
  void,
  TContext
> => {
  const mutationKey = ["refreshBlackBook"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof refreshBlackBook>>,
    void
  > = () => {
    return refreshBlackBook(requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RefreshBlackBookMutationResult = NonNullable<
  Awaited<ReturnType<typeof refreshBlackBook>>
>;

export type RefreshBlackBookMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Trigger manual Black Book refresh (owner only)
 */
export const useRefreshBlackBook = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof refreshBlackBook>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof refreshBlackBook>>,
  TError,
  void,
  TContext
> => {
  return useMutation(getRefreshBlackBookMutationOptions(options));
};

/**
 * @summary Get photo gallery URLs for a vehicle by VIN
 */
export const getGetVehicleImagesUrl = (params: GetVehicleImagesParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/vehicle-images?${stringifiedParams}`
    : `/api/vehicle-images`;
};

export const getVehicleImages = async (
  params: GetVehicleImagesParams,
  options?: RequestInit,
): Promise<VehicleImages> => {
  return customFetch<VehicleImages>(getGetVehicleImagesUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getGetVehicleImagesQueryKey = (
  params?: GetVehicleImagesParams,
) => {
  return [`/api/vehicle-images`, ...(params ? [params] : [])] as const;
};

export const getGetVehicleImagesQueryOptions = <
  TData = Awaited<ReturnType<typeof getVehicleImages>>,
  TError = ErrorType<ErrorResponse>,
>(
  params: GetVehicleImagesParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getVehicleImages>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getGetVehicleImagesQueryKey(params);

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getVehicleImages>>
  > = ({ signal }) => getVehicleImages(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getVehicleImages>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetVehicleImagesQueryResult = NonNullable<
  Awaited<ReturnType<typeof getVehicleImages>>
>;
export type GetVehicleImagesQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get photo gallery URLs for a vehicle by VIN
 */

export function useGetVehicleImages<
  TData = Awaited<ReturnType<typeof getVehicleImages>>,
  TError = ErrorType<ErrorResponse>,
>(
  params: GetVehicleImagesParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getVehicleImages>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetVehicleImagesQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get list of approved emails (owner only)
 */
export const getGetAccessListUrl = () => {
  return `/api/access`;
};

export const getAccessList = async (
  options?: RequestInit,
): Promise<AccessEntry[]> => {
  return customFetch<AccessEntry[]>(getGetAccessListUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetAccessListQueryKey = () => {
  return [`/api/access`] as const;
};

export const getGetAccessListQueryOptions = <
  TData = Awaited<ReturnType<typeof getAccessList>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getAccessList>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetAccessListQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getAccessList>>> = ({
    signal,
  }) => getAccessList({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getAccessList>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetAccessListQueryResult = NonNullable<
  Awaited<ReturnType<typeof getAccessList>>
>;
export type GetAccessListQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get list of approved emails (owner only)
 */

export function useGetAccessList<
  TData = Awaited<ReturnType<typeof getAccessList>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getAccessList>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetAccessListQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Add an email to the access list (owner only)
 */
export const getAddAccessEntryUrl = () => {
  return `/api/access`;
};

export const addAccessEntry = async (
  addAccessRequest: AddAccessRequest,
  options?: RequestInit,
): Promise<AccessEntry> => {
  return customFetch<AccessEntry>(getAddAccessEntryUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(addAccessRequest),
  });
};

export const getAddAccessEntryMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof addAccessEntry>>,
    TError,
    { data: BodyType<AddAccessRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof addAccessEntry>>,
  TError,
  { data: BodyType<AddAccessRequest> },
  TContext
> => {
  const mutationKey = ["addAccessEntry"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof addAccessEntry>>,
    { data: BodyType<AddAccessRequest> }
  > = (props) => {
    const { data } = props ?? {};

    return addAccessEntry(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type AddAccessEntryMutationResult = NonNullable<
  Awaited<ReturnType<typeof addAccessEntry>>
>;
export type AddAccessEntryMutationBody = BodyType<AddAccessRequest>;
export type AddAccessEntryMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Add an email to the access list (owner only)
 */
export const useAddAccessEntry = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof addAccessEntry>>,
    TError,
    { data: BodyType<AddAccessRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof addAccessEntry>>,
  TError,
  { data: BodyType<AddAccessRequest> },
  TContext
> => {
  return useMutation(getAddAccessEntryMutationOptions(options));
};

/**
 * @summary Update a user's role (owner only)
 */
export const getUpdateAccessRoleUrl = (email: string) => {
  return `/api/access/${email}`;
};

export const updateAccessRole = async (
  email: string,
  updateAccessRoleRequest: UpdateAccessRoleRequest,
  options?: RequestInit,
): Promise<AccessEntry> => {
  return customFetch<AccessEntry>(getUpdateAccessRoleUrl(email), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(updateAccessRoleRequest),
  });
};

export const getUpdateAccessRoleMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateAccessRole>>,
    TError,
    { email: string; data: BodyType<UpdateAccessRoleRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateAccessRole>>,
  TError,
  { email: string; data: BodyType<UpdateAccessRoleRequest> },
  TContext
> => {
  const mutationKey = ["updateAccessRole"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateAccessRole>>,
    { email: string; data: BodyType<UpdateAccessRoleRequest> }
  > = (props) => {
    const { email, data } = props ?? {};

    return updateAccessRole(email, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateAccessRoleMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateAccessRole>>
>;
export type UpdateAccessRoleMutationBody = BodyType<UpdateAccessRoleRequest>;
export type UpdateAccessRoleMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Update a user's role (owner only)
 */
export const useUpdateAccessRole = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateAccessRole>>,
    TError,
    { email: string; data: BodyType<UpdateAccessRoleRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateAccessRole>>,
  TError,
  { email: string; data: BodyType<UpdateAccessRoleRequest> },
  TContext
> => {
  return useMutation(getUpdateAccessRoleMutationOptions(options));
};

/**
 * @summary Remove an email from the access list (owner only)
 */
export const getRemoveAccessEntryUrl = (email: string) => {
  return `/api/access/${email}`;
};

export const removeAccessEntry = async (
  email: string,
  options?: RequestInit,
): Promise<SuccessResponse> => {
  return customFetch<SuccessResponse>(getRemoveAccessEntryUrl(email), {
    ...options,
    method: "DELETE",
  });
};

export const getRemoveAccessEntryMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof removeAccessEntry>>,
    TError,
    { email: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof removeAccessEntry>>,
  TError,
  { email: string },
  TContext
> => {
  const mutationKey = ["removeAccessEntry"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof removeAccessEntry>>,
    { email: string }
  > = (props) => {
    const { email } = props ?? {};

    return removeAccessEntry(email, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RemoveAccessEntryMutationResult = NonNullable<
  Awaited<ReturnType<typeof removeAccessEntry>>
>;

export type RemoveAccessEntryMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Remove an email from the access list (owner only)
 */
export const useRemoveAccessEntry = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof removeAccessEntry>>,
    TError,
    { email: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof removeAccessEntry>>,
  TError,
  { email: string },
  TContext
> => {
  return useMutation(getRemoveAccessEntryMutationOptions(options));
};

/**
 * @summary Get cached lender program matrices (owner or viewer)
 */
export const getGetLenderProgramsUrl = () => {
  return `/api/lender-programs`;
};

export const getLenderPrograms = async (
  options?: RequestInit,
): Promise<LenderProgramsResponse> => {
  return customFetch<LenderProgramsResponse>(getGetLenderProgramsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetLenderProgramsQueryKey = () => {
  return [`/api/lender-programs`] as const;
};

export const getGetLenderProgramsQueryOptions = <
  TData = Awaited<ReturnType<typeof getLenderPrograms>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderPrograms>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetLenderProgramsQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getLenderPrograms>>
  > = ({ signal }) => getLenderPrograms({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getLenderPrograms>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetLenderProgramsQueryResult = NonNullable<
  Awaited<ReturnType<typeof getLenderPrograms>>
>;
export type GetLenderProgramsQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get cached lender program matrices (owner or viewer)
 */

export function useGetLenderPrograms<
  TData = Awaited<ReturnType<typeof getLenderPrograms>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderPrograms>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetLenderProgramsQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get lender sync status (owner or viewer)
 */
export const getGetLenderStatusUrl = () => {
  return `/api/lender-status`;
};

export const getLenderStatus = async (
  options?: RequestInit,
): Promise<LenderStatus> => {
  return customFetch<LenderStatus>(getGetLenderStatusUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetLenderStatusQueryKey = () => {
  return [`/api/lender-status`] as const;
};

export const getGetLenderStatusQueryOptions = <
  TData = Awaited<ReturnType<typeof getLenderStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetLenderStatusQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getLenderStatus>>> = ({
    signal,
  }) => getLenderStatus({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getLenderStatus>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetLenderStatusQueryResult = NonNullable<
  Awaited<ReturnType<typeof getLenderStatus>>
>;
export type GetLenderStatusQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get lender sync status (owner or viewer)
 */

export function useGetLenderStatus<
  TData = Awaited<ReturnType<typeof getLenderStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetLenderStatusQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Trigger manual lender sync (owner only)
 */
export const getRefreshLenderUrl = () => {
  return `/api/refresh-lender`;
};

export const refreshLender = async (
  options?: RequestInit,
): Promise<SuccessResponse> => {
  return customFetch<SuccessResponse>(getRefreshLenderUrl(), {
    ...options,
    method: "POST",
  });
};

export const getRefreshLenderMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof refreshLender>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof refreshLender>>,
  TError,
  void,
  TContext
> => {
  const mutationKey = ["refreshLender"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof refreshLender>>,
    void
  > = () => {
    return refreshLender(requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RefreshLenderMutationResult = NonNullable<
  Awaited<ReturnType<typeof refreshLender>>
>;

export type RefreshLenderMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Trigger manual lender sync (owner only)
 */
export const useRefreshLender = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof refreshLender>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof refreshLender>>,
  TError,
  void,
  TContext
> => {
  return useMutation(getRefreshLenderMutationOptions(options));
};

/**
 * @summary Calculate inventory affordability by lender/tier (owner or viewer)
 */
export const getLenderCalculateUrl = () => {
  return `/api/lender-calculate`;
};

export const lenderCalculate = async (
  lenderCalculateRequest: LenderCalculateRequest,
  options?: RequestInit,
): Promise<LenderCalculateResponse> => {
  return customFetch<LenderCalculateResponse>(getLenderCalculateUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(lenderCalculateRequest),
  });
};

export const getLenderCalculateMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof lenderCalculate>>,
    TError,
    { data: BodyType<LenderCalculateRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof lenderCalculate>>,
  TError,
  { data: BodyType<LenderCalculateRequest> },
  TContext
> => {
  const mutationKey = ["lenderCalculate"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof lenderCalculate>>,
    { data: BodyType<LenderCalculateRequest> }
  > = (props) => {
    const { data } = props ?? {};

    return lenderCalculate(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type LenderCalculateMutationResult = NonNullable<
  Awaited<ReturnType<typeof lenderCalculate>>
>;
export type LenderCalculateMutationBody = BodyType<LenderCalculateRequest>;
export type LenderCalculateMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Calculate inventory affordability by lender/tier (owner or viewer)
 */
export const useLenderCalculate = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof lenderCalculate>>,
    TError,
    { data: BodyType<LenderCalculateRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof lenderCalculate>>,
  TError,
  { data: BodyType<LenderCalculateRequest> },
  TContext
> => {
  return useMutation(getLenderCalculateMutationOptions(options));
};

/**
 * @summary Diagnostic dump of cached lender program metadata (owner only)
 */
export const getGetLenderDebugUrl = () => {
  return `/api/lender-debug`;
};

export const getLenderDebug = async (
  options?: RequestInit,
): Promise<GetLenderDebug200> => {
  return customFetch<GetLenderDebug200>(getGetLenderDebugUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetLenderDebugQueryKey = () => {
  return [`/api/lender-debug`] as const;
};

export const getGetLenderDebugQueryOptions = <
  TData = Awaited<ReturnType<typeof getLenderDebug>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderDebug>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetLenderDebugQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getLenderDebug>>> = ({
    signal,
  }) => getLenderDebug({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getLenderDebug>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetLenderDebugQueryResult = NonNullable<
  Awaited<ReturnType<typeof getLenderDebug>>
>;
export type GetLenderDebugQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Diagnostic dump of cached lender program metadata (owner only)
 */

export function useGetLenderDebug<
  TData = Awaited<ReturnType<typeof getLenderDebug>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getLenderDebug>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetLenderDebugQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get audit log of access changes (owner only)
 */
export const getGetAuditLogUrl = () => {
  return `/api/audit-log`;
};

export const getAuditLog = async (
  options?: RequestInit,
): Promise<AuditLogEntry[]> => {
  return customFetch<AuditLogEntry[]>(getGetAuditLogUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetAuditLogQueryKey = () => {
  return [`/api/audit-log`] as const;
};

export const getGetAuditLogQueryOptions = <
  TData = Awaited<ReturnType<typeof getAuditLog>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getAuditLog>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetAuditLogQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getAuditLog>>> = ({
    signal,
  }) => getAuditLog({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getAuditLog>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetAuditLogQueryResult = NonNullable<
  Awaited<ReturnType<typeof getAuditLog>>
>;
export type GetAuditLogQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get audit log of access changes (owner only)
 */

export function useGetAuditLog<
  TData = Awaited<ReturnType<typeof getAuditLog>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getAuditLog>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetAuditLogQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get current Carfax batch worker status (owner only)
 */
export const getGetCarfaxBatchStatusUrl = () => {
  return `/api/carfax/batch-status`;
};

export const getCarfaxBatchStatus = async (
  options?: RequestInit,
): Promise<GetCarfaxBatchStatus200> => {
  return customFetch<GetCarfaxBatchStatus200>(getGetCarfaxBatchStatusUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetCarfaxBatchStatusQueryKey = () => {
  return [`/api/carfax/batch-status`] as const;
};

export const getGetCarfaxBatchStatusQueryOptions = <
  TData = Awaited<ReturnType<typeof getCarfaxBatchStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCarfaxBatchStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetCarfaxBatchStatusQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getCarfaxBatchStatus>>
  > = ({ signal }) => getCarfaxBatchStatus({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getCarfaxBatchStatus>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetCarfaxBatchStatusQueryResult = NonNullable<
  Awaited<ReturnType<typeof getCarfaxBatchStatus>>
>;
export type GetCarfaxBatchStatusQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Get current Carfax batch worker status (owner only)
 */

export function useGetCarfaxBatchStatus<
  TData = Awaited<ReturnType<typeof getCarfaxBatchStatus>>,
  TError = ErrorType<ErrorResponse>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCarfaxBatchStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetCarfaxBatchStatusQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Trigger a manual Carfax batch run (owner only)
 */
export const getRunCarfaxBatchUrl = () => {
  return `/api/carfax/run-batch`;
};

export const runCarfaxBatch = async (
  options?: RequestInit,
): Promise<SuccessMessageResponse> => {
  return customFetch<SuccessMessageResponse>(getRunCarfaxBatchUrl(), {
    ...options,
    method: "POST",
  });
};

export const getRunCarfaxBatchMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof runCarfaxBatch>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof runCarfaxBatch>>,
  TError,
  void,
  TContext
> => {
  const mutationKey = ["runCarfaxBatch"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof runCarfaxBatch>>,
    void
  > = () => {
    return runCarfaxBatch(requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RunCarfaxBatchMutationResult = NonNullable<
  Awaited<ReturnType<typeof runCarfaxBatch>>
>;

export type RunCarfaxBatchMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Trigger a manual Carfax batch run (owner only)
 */
export const useRunCarfaxBatch = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof runCarfaxBatch>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof runCarfaxBatch>>,
  TError,
  void,
  TContext
> => {
  return useMutation(getRunCarfaxBatchMutationOptions(options));
};

/**
 * @summary Run a targeted Carfax lookup for up to 10 VINs (owner only)
 */
export const getRunCarfaxTestUrl = () => {
  return `/api/carfax/test`;
};

export const runCarfaxTest = async (
  runCarfaxTestBody: RunCarfaxTestBody,
  options?: RequestInit,
): Promise<RunCarfaxTest200> => {
  return customFetch<RunCarfaxTest200>(getRunCarfaxTestUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(runCarfaxTestBody),
  });
};

export const getRunCarfaxTestMutationOptions = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof runCarfaxTest>>,
    TError,
    { data: BodyType<RunCarfaxTestBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof runCarfaxTest>>,
  TError,
  { data: BodyType<RunCarfaxTestBody> },
  TContext
> => {
  const mutationKey = ["runCarfaxTest"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof runCarfaxTest>>,
    { data: BodyType<RunCarfaxTestBody> }
  > = (props) => {
    const { data } = props ?? {};

    return runCarfaxTest(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RunCarfaxTestMutationResult = NonNullable<
  Awaited<ReturnType<typeof runCarfaxTest>>
>;
export type RunCarfaxTestMutationBody = BodyType<RunCarfaxTestBody>;
export type RunCarfaxTestMutationError = ErrorType<ErrorResponse>;

/**
 * @summary Run a targeted Carfax lookup for up to 10 VINs (owner only)
 */
export const useRunCarfaxTest = <
  TError = ErrorType<ErrorResponse>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof runCarfaxTest>>,
    TError,
    { data: BodyType<RunCarfaxTestBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof runCarfaxTest>>,
  TError,
  { data: BodyType<RunCarfaxTestBody> },
  TContext
> => {
  return useMutation(getRunCarfaxTestMutationOptions(options));
};

/**
 * @summary Resolve a dealer listing URL to a live price via Typesense
 */
export const getPriceLookupUrl = (params: PriceLookupParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/price-lookup?${stringifiedParams}`
    : `/api/price-lookup`;
};

export const priceLookup = async (
  params: PriceLookupParams,
  options?: RequestInit,
): Promise<PriceLookup200> => {
  return customFetch<PriceLookup200>(getPriceLookupUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getPriceLookupQueryKey = (params?: PriceLookupParams) => {
  return [`/api/price-lookup`, ...(params ? [params] : [])] as const;
};

export const getPriceLookupQueryOptions = <
  TData = Awaited<ReturnType<typeof priceLookup>>,
  TError = ErrorType<ErrorResponse>,
>(
  params: PriceLookupParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof priceLookup>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getPriceLookupQueryKey(params);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof priceLookup>>> = ({
    signal,
  }) => priceLookup(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof priceLookup>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type PriceLookupQueryResult = NonNullable<
  Awaited<ReturnType<typeof priceLookup>>
>;
export type PriceLookupQueryError = ErrorType<ErrorResponse>;

/**
 * @summary Resolve a dealer listing URL to a live price via Typesense
 */

export function usePriceLookup<
  TData = Awaited<ReturnType<typeof priceLookup>>,
  TError = ErrorType<ErrorResponse>,
>(
  params: PriceLookupParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof priceLookup>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getPriceLookupQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

```

### `lib/api-client-react/src/index.ts` (5 lines)

```typescript
export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

```

### `lib/api-client-react/tsconfig.json` (13 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["dom", "es2022"]
  },
  "include": ["src"]
}

```

### `lib/api-zod/package.json` (13 lines)

```json
{
  "name": "@workspace/api-zod",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "catalog:"
  }
}

```

### `lib/api-zod/src/generated/api.ts` (422 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import * as zod from "zod";

/**
 * @summary Health check
 */
export const HealthCheckResponse = zod.object({
  status: zod.string(),
});

/**
 * @summary Google OAuth callback (redirects to app)
 */
export const AuthGoogleCallbackQueryParams = zod.object({
  code: zod.coerce.string().optional(),
  state: zod.coerce.string().optional(),
});

/**
 * @summary Debug endpoint showing the computed OAuth callback URL
 */
export const AuthDebugCallbackResponse = zod.object({
  callbackURL: zod.string(),
  REPLIT_DOMAINS: zod.string(),
});

/**
 * @summary Get current authenticated user
 */
export const GetMeResponse = zod.object({
  email: zod.string(),
  name: zod.string(),
  picture: zod.string().optional(),
  isOwner: zod.boolean(),
  role: zod.string(),
});

/**
 * @summary Get all inventory items
 */
export const GetInventoryResponseItem = zod.object({
  location: zod.string(),
  vehicle: zod.string(),
  vin: zod.string(),
  price: zod.string(),
  km: zod.string().optional(),
  carfax: zod.string().optional(),
  website: zod.string().optional(),
  onlinePrice: zod.string().optional(),
  matrixPrice: zod.string().nullish(),
  cost: zod.string().nullish(),
  bbAvgWholesale: zod.string().nullish(),
  hasPhotos: zod.boolean().optional(),
  bbValues: zod
    .object({
      xclean: zod.number(),
      clean: zod.number(),
      avg: zod.number(),
      rough: zod.number(),
    })
    .nullish(),
});
export const GetInventoryResponse = zod.array(GetInventoryResponseItem);

/**
 * @summary Get the timestamp of the last inventory cache refresh
 */
export const GetCacheStatusResponse = zod.object({
  lastUpdated: zod.string().nullish(),
  isRefreshing: zod.boolean(),
  count: zod.number(),
  bbRunning: zod.boolean(),
  bbLastRun: zod.string().nullish(),
  bbCount: zod.number().nullish(),
});

/**
 * @summary Webhook from Apps Script to trigger an immediate cache refresh (secret header auth)
 */
export const RefreshCacheHeader = zod.object({
  "x-refresh-secret": zod.string(),
});

export const RefreshCacheResponse = zod.object({
  ok: zod.boolean(),
  message: zod.string().optional(),
});

/**
 * @summary Trigger manual Black Book refresh (owner only)
 */
export const RefreshBlackBookResponse = zod.object({
  ok: zod.boolean(),
  message: zod.string().optional(),
});

/**
 * @summary Get photo gallery URLs for a vehicle by VIN
 */
export const GetVehicleImagesQueryParams = zod.object({
  vin: zod.coerce.string(),
});

export const GetVehicleImagesResponse = zod.object({
  vin: zod.string(),
  urls: zod.array(zod.string()),
  websiteUrl: zod.string().nullish(),
});

/**
 * @summary Get list of approved emails (owner only)
 */
export const GetAccessListResponseItem = zod.object({
  email: zod.string(),
  addedAt: zod.string(),
  addedBy: zod.string(),
  role: zod.string(),
});
export const GetAccessListResponse = zod.array(GetAccessListResponseItem);

/**
 * @summary Add an email to the access list (owner only)
 */
export const AddAccessEntryBody = zod.object({
  email: zod.string(),
  role: zod.string().optional(),
});

export const AddAccessEntryResponse = zod.object({
  email: zod.string(),
  addedAt: zod.string(),
  addedBy: zod.string(),
  role: zod.string(),
});

/**
 * @summary Update a user's role (owner only)
 */
export const UpdateAccessRoleParams = zod.object({
  email: zod.coerce.string(),
});

export const UpdateAccessRoleBody = zod.object({
  role: zod.string(),
});

export const UpdateAccessRoleResponse = zod.object({
  email: zod.string(),
  addedAt: zod.string(),
  addedBy: zod.string(),
  role: zod.string(),
});

/**
 * @summary Remove an email from the access list (owner only)
 */
export const RemoveAccessEntryParams = zod.object({
  email: zod.coerce.string(),
});

export const RemoveAccessEntryResponse = zod.object({
  ok: zod.boolean(),
});

/**
 * @summary Get cached lender program matrices (owner or viewer)
 */
export const GetLenderProgramsResponse = zod.object({
  programs: zod.array(
    zod.object({
      lenderCode: zod.string(),
      lenderName: zod.string(),
      creditorId: zod.string(),
      programs: zod.array(
        zod.object({
          programId: zod.string(),
          programTitle: zod.string(),
          programType: zod.string(),
          tiers: zod.array(
            zod.object({
              tierName: zod.string(),
              minRate: zod.number(),
              maxRate: zod.number(),
              maxPayment: zod.number(),
              maxAdvanceLTV: zod.number(),
              maxAftermarketLTV: zod.number(),
              maxAllInLTV: zod.number(),
              creditorFee: zod.number(),
              dealerReserve: zod.number(),
            }),
          ),
          vehicleTermMatrix: zod.array(
            zod.object({
              year: zod.number(),
              data: zod.array(
                zod.object({
                  term: zod.number(),
                  kmFrom: zod.number(),
                  kmTo: zod.number(),
                }),
              ),
            }),
          ),
          vehicleConditionMatrix: zod.array(
            zod.object({
              year: zod.number(),
              extraClean: zod.object({
                kmFrom: zod.number(),
                kmTo: zod.number(),
              }),
              clean: zod.object({
                kmFrom: zod.number(),
                kmTo: zod.number(),
              }),
              average: zod.object({
                kmFrom: zod.number(),
                kmTo: zod.number(),
              }),
              rough: zod.object({
                kmFrom: zod.number(),
                kmTo: zod.number(),
              }),
            }),
          ),
          maxTerm: zod.number().optional(),
          maxWarrantyPrice: zod.number().nullish(),
          maxGapPrice: zod.number().nullish(),
          maxAdminFee: zod.number().nullish(),
        }),
      ),
    }),
  ),
  updatedAt: zod.string().nullish(),
  role: zod.string().optional(),
});

/**
 * @summary Get lender sync status (owner or viewer)
 */
export const GetLenderStatusResponse = zod.object({
  running: zod.boolean(),
  startedAt: zod.string().nullish(),
  lastRun: zod.string().nullish(),
  lenderCount: zod.number(),
  error: zod.string().nullish(),
  programsAge: zod.string().nullish(),
});

/**
 * @summary Trigger manual lender sync (owner only)
 */
export const RefreshLenderResponse = zod.object({
  ok: zod.boolean(),
});

/**
 * @summary Calculate inventory affordability by lender/tier (owner or viewer)
 */
export const LenderCalculateBody = zod.object({
  lenderCode: zod.string(),
  programId: zod.string(),
  tierName: zod.string(),
  approvedRate: zod.number(),
  maxPaymentOverride: zod.number().optional(),
  downPayment: zod.number().optional(),
  tradeValue: zod.number().optional(),
  tradeLien: zod.number().optional(),
  taxRate: zod.number().optional(),
  adminFee: zod.number().optional(),
  termStretchMonths: zod.number().optional(),
});

export const LenderCalculateResponse = zod.object({
  lender: zod.string(),
  program: zod.string(),
  tier: zod.string(),
  termStretchMonths: zod.number(),
  calculatorVersion: zod.string(),
  gitSha: zod.string(),
  tierConfig: zod.object({
    tierName: zod.string(),
    minRate: zod.number(),
    maxRate: zod.number(),
    maxPayment: zod.number(),
    maxAdvanceLTV: zod.number(),
    maxAftermarketLTV: zod.number(),
    maxAllInLTV: zod.number(),
    creditorFee: zod.number(),
    dealerReserve: zod.number(),
  }),
  programLimits: zod.object({
    maxWarrantyPrice: zod.number().nullish(),
    maxGapPrice: zod.number().nullish(),
    maxAdminFee: zod.number().nullish(),
    maxGapMarkup: zod.number().optional(),
    gapAllowed: zod.boolean(),
    allInOnly: zod.boolean(),
    hasAdvanceCap: zod.boolean(),
    hasAftermarketCap: zod.boolean(),
    aftermarketBudgetIsDynamic: zod.boolean(),
    aftermarketBase: zod.string(),
    adminFeeInclusion: zod.string(),
    capModelResolved: zod.string(),
    capProfileKey: zod.string(),
    noOnlineStrategy: zod.string(),
  }),
  pacCostSource: zod.string(),
  debugCounts: zod.object({
    total: zod.number().optional(),
    noYear: zod.number().optional(),
    noKm: zod.number().optional(),
    noTerm: zod.number().optional(),
    noCondition: zod.number().optional(),
    noBB: zod.number().optional(),
    noBBVal: zod.number().optional(),
    noPacPrice: zod.number().optional(),
    passed: zod.number().optional(),
  }),
  resultCount: zod.number(),
  results: zod.array(
    zod.object({
      vin: zod.string(),
      vehicle: zod.string(),
      location: zod.string(),
      term: zod.number(),
      matrixTerm: zod.number(),
      termStretchApplied: zod.number(),
      termStretched: zod.boolean(),
      termStretchCappedReason: zod.string().nullish(),
      conditionUsed: zod.string(),
      bbWholesale: zod.number(),
      pacCost: zod.number(),
      pacCostSource: zod.string(),
      onlinePrice: zod.number().nullish(),
      sellingPrice: zod.number(),
      sellingPriceCappedByOnline: zod.boolean(),
      bindingSellingConstraint: zod.string(),
      requiredDownPayment: zod.number().optional(),
      adminFeeUsed: zod.number(),
      warrantyPrice: zod.number(),
      warrantyCost: zod.number(),
      gapPrice: zod.number(),
      gapCost: zod.number(),
      totalFinanced: zod.number(),
      monthlyPayment: zod.number(),
      frontEndGross: zod.number(),
      nonCancelableGross: zod.number(),
      cancelableBackendGross: zod.number(),
      totalGross: zod.number(),
      allocationOrderApplied: zod.array(zod.string()),
      hasPhotos: zod.boolean(),
      website: zod.string(),
    }),
  ),
});

/**
 * @summary Diagnostic dump of cached lender program metadata (owner only)
 */
export const GetLenderDebugResponse = zod.object({
  updatedAt: zod.string().nullish(),
  lenders: zod.array(zod.object({}).passthrough()).optional(),
  calculatorVersion: zod.string().optional(),
  gitSha: zod.string().optional(),
});

/**
 * @summary Get audit log of access changes (owner only)
 */
export const GetAuditLogResponseItem = zod.object({
  id: zod.number(),
  action: zod.string(),
  targetEmail: zod.string(),
  changedBy: zod.string(),
  roleFrom: zod.string().nullish(),
  roleTo: zod.string().nullish(),
  timestamp: zod.string(),
});
export const GetAuditLogResponse = zod.array(GetAuditLogResponseItem);

/**
 * @summary Get current Carfax batch worker status (owner only)
 */
export const GetCarfaxBatchStatusResponse = zod.object({}).passthrough();

/**
 * @summary Trigger a manual Carfax batch run (owner only)
 */
export const RunCarfaxBatchResponse = zod.object({
  ok: zod.boolean(),
  message: zod.string().optional(),
});

/**
 * @summary Run a targeted Carfax lookup for up to 10 VINs (owner only)
 */
export const RunCarfaxTestBody = zod.object({
  vins: zod.array(zod.string()),
});

export const RunCarfaxTestResponse = zod.object({
  ok: zod.boolean(),
  results: zod.object({}).passthrough(),
});

/**
 * @summary Resolve a dealer listing URL to a live price via Typesense
 */
export const PriceLookupQueryParams = zod.object({
  url: zod.coerce.string(),
});

export const PriceLookupResponse = zod.object({
  price: zod.string().nullable(),
});

```

### `lib/api-zod/src/generated/types/accessEntry.ts` (15 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface AccessEntry {
  email: string;
  addedAt: string;
  addedBy: string;
  role: string;
}

```

### `lib/api-zod/src/generated/types/addAccessRequest.ts` (13 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface AddAccessRequest {
  email: string;
  role?: string;
}

```

### `lib/api-zod/src/generated/types/auditLogEntry.ts` (18 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface AuditLogEntry {
  id: number;
  action: string;
  targetEmail: string;
  changedBy: string;
  roleFrom?: string | null;
  roleTo?: string | null;
  timestamp: string;
}

```

### `lib/api-zod/src/generated/types/authDebugCallback200.ts` (13 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type AuthDebugCallback200 = {
  callbackURL: string;
  REPLIT_DOMAINS: string;
};

```

### `lib/api-zod/src/generated/types/authGoogleCallbackParams.ts` (13 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type AuthGoogleCallbackParams = {
  code?: string;
  state?: string;
};

```

### `lib/api-zod/src/generated/types/cacheStatus.ts` (17 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface CacheStatus {
  lastUpdated?: string | null;
  isRefreshing: boolean;
  count: number;
  bbRunning: boolean;
  bbLastRun?: string | null;
  bbCount?: number | null;
}

```

### `lib/api-zod/src/generated/types/debugCounts.ts` (20 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface DebugCounts {
  total?: number;
  noYear?: number;
  noKm?: number;
  noTerm?: number;
  noCondition?: number;
  noBB?: number;
  noBBVal?: number;
  noPacPrice?: number;
  passed?: number;
}

```

### `lib/api-zod/src/generated/types/errorResponse.ts` (12 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface ErrorResponse {
  error: string;
}

```

### `lib/api-zod/src/generated/types/getCarfaxBatchStatus200.ts` (10 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type GetCarfaxBatchStatus200 = { [key: string]: unknown };

```

### `lib/api-zod/src/generated/types/getLenderDebug200.ts` (16 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { GetLenderDebug200LendersItem } from "./getLenderDebug200LendersItem";

export type GetLenderDebug200 = {
  updatedAt?: string | null;
  lenders?: GetLenderDebug200LendersItem[];
  calculatorVersion?: string;
  gitSha?: string;
};

```

### `lib/api-zod/src/generated/types/getLenderDebug200LendersItem.ts` (10 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type GetLenderDebug200LendersItem = { [key: string]: unknown };

```

### `lib/api-zod/src/generated/types/getVehicleImagesParams.ts` (12 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type GetVehicleImagesParams = {
  vin: string;
};

```

### `lib/api-zod/src/generated/types/healthStatus.ts` (12 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface HealthStatus {
  status: string;
}

```

### `lib/api-zod/src/generated/types/index.ts` (47 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export * from "./accessEntry";
export * from "./addAccessRequest";
export * from "./auditLogEntry";
export * from "./authDebugCallback200";
export * from "./authGoogleCallbackParams";
export * from "./cacheStatus";
export * from "./debugCounts";
export * from "./errorResponse";
export * from "./getCarfaxBatchStatus200";
export * from "./getLenderDebug200";
export * from "./getLenderDebug200LendersItem";
export * from "./getVehicleImagesParams";
export * from "./healthStatus";
export * from "./inventoryItem";
export * from "./inventoryItemBbValues";
export * from "./kmRange";
export * from "./lenderCalcResultItem";
export * from "./lenderCalculateRequest";
export * from "./lenderCalculateResponse";
export * from "./lenderProgram";
export * from "./lenderProgramGuide";
export * from "./lenderProgramsResponse";
export * from "./lenderProgramTier";
export * from "./lenderStatus";
export * from "./priceLookup200";
export * from "./priceLookupParams";
export * from "./programLimits";
export * from "./runCarfaxTest200";
export * from "./runCarfaxTest200Results";
export * from "./runCarfaxTestBody";
export * from "./successMessageResponse";
export * from "./successResponse";
export * from "./updateAccessRoleRequest";
export * from "./user";
export * from "./vehicleConditionMatrixEntry";
export * from "./vehicleImages";
export * from "./vehicleTermMatrixData";
export * from "./vehicleTermMatrixEntry";

```

### `lib/api-zod/src/generated/types/inventoryItem.ts` (25 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { InventoryItemBbValues } from "./inventoryItemBbValues";

export interface InventoryItem {
  location: string;
  vehicle: string;
  vin: string;
  price: string;
  km?: string;
  carfax?: string;
  website?: string;
  onlinePrice?: string;
  matrixPrice?: string | null;
  cost?: string | null;
  bbAvgWholesale?: string | null;
  hasPhotos?: boolean;
  bbValues?: InventoryItemBbValues;
}

```

### `lib/api-zod/src/generated/types/inventoryItemBbValues.ts` (15 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type InventoryItemBbValues = {
  xclean: number;
  clean: number;
  avg: number;
  rough: number;
} | null;

```

### `lib/api-zod/src/generated/types/kmRange.ts` (13 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface KmRange {
  kmFrom: number;
  kmTo: number;
}

```

### `lib/api-zod/src/generated/types/lenderCalcResultItem.ts` (42 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LenderCalcResultItem {
  vin: string;
  vehicle: string;
  location: string;
  term: number;
  matrixTerm: number;
  termStretchApplied: number;
  termStretched: boolean;
  termStretchCappedReason?: string | null;
  conditionUsed: string;
  bbWholesale: number;
  pacCost: number;
  pacCostSource: string;
  onlinePrice?: number | null;
  sellingPrice: number;
  sellingPriceCappedByOnline: boolean;
  bindingSellingConstraint: string;
  requiredDownPayment?: number;
  adminFeeUsed: number;
  warrantyPrice: number;
  warrantyCost: number;
  gapPrice: number;
  gapCost: number;
  totalFinanced: number;
  monthlyPayment: number;
  frontEndGross: number;
  nonCancelableGross: number;
  cancelableBackendGross: number;
  totalGross: number;
  allocationOrderApplied: string[];
  hasPhotos: boolean;
  website: string;
}

```

### `lib/api-zod/src/generated/types/lenderCalculateRequest.ts` (22 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LenderCalculateRequest {
  lenderCode: string;
  programId: string;
  tierName: string;
  approvedRate: number;
  maxPaymentOverride?: number;
  downPayment?: number;
  tradeValue?: number;
  tradeLien?: number;
  taxRate?: number;
  adminFee?: number;
  termStretchMonths?: number;
}

```

### `lib/api-zod/src/generated/types/lenderCalculateResponse.ts` (27 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { DebugCounts } from "./debugCounts";
import type { LenderCalcResultItem } from "./lenderCalcResultItem";
import type { LenderProgramTier } from "./lenderProgramTier";
import type { ProgramLimits } from "./programLimits";

export interface LenderCalculateResponse {
  lender: string;
  program: string;
  tier: string;
  termStretchMonths: number;
  calculatorVersion: string;
  gitSha: string;
  tierConfig: LenderProgramTier;
  programLimits: ProgramLimits;
  pacCostSource: string;
  debugCounts: DebugCounts;
  resultCount: number;
  results: LenderCalcResultItem[];
}

```

### `lib/api-zod/src/generated/types/lenderProgram.ts` (16 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { LenderProgramGuide } from "./lenderProgramGuide";

export interface LenderProgram {
  lenderCode: string;
  lenderName: string;
  creditorId: string;
  programs: LenderProgramGuide[];
}

```

### `lib/api-zod/src/generated/types/lenderProgramGuide.ts` (24 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { LenderProgramTier } from "./lenderProgramTier";
import type { VehicleConditionMatrixEntry } from "./vehicleConditionMatrixEntry";
import type { VehicleTermMatrixEntry } from "./vehicleTermMatrixEntry";

export interface LenderProgramGuide {
  programId: string;
  programTitle: string;
  programType: string;
  tiers: LenderProgramTier[];
  vehicleTermMatrix: VehicleTermMatrixEntry[];
  vehicleConditionMatrix: VehicleConditionMatrixEntry[];
  maxTerm?: number;
  maxWarrantyPrice?: number | null;
  maxGapPrice?: number | null;
  maxAdminFee?: number | null;
}

```

### `lib/api-zod/src/generated/types/lenderProgramsResponse.ts` (15 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { LenderProgram } from "./lenderProgram";

export interface LenderProgramsResponse {
  programs: LenderProgram[];
  updatedAt?: string | null;
  role?: string;
}

```

### `lib/api-zod/src/generated/types/lenderProgramTier.ts` (20 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LenderProgramTier {
  tierName: string;
  minRate: number;
  maxRate: number;
  maxPayment: number;
  maxAdvanceLTV: number;
  maxAftermarketLTV: number;
  maxAllInLTV: number;
  creditorFee: number;
  dealerReserve: number;
}

```

### `lib/api-zod/src/generated/types/lenderStatus.ts` (17 lines)

```typescript
/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LenderStatus {
  running: boolean;
  startedAt?: string | null;
  lastRun?: string | null;
  lenderCount: number;
  error?: string | null;
  programsAge?: string | null;
}

```
