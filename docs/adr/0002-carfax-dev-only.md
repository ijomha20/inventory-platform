# ADR 0002: Carfax Worker Disabled in Production

## Status
Accepted

## Context
The Carfax VHR link resolver uses Puppeteer to automate a dealer portal login. Container deployments on Replit start fresh each time with no persistent filesystem, so browser session cookies are lost on every restart.

## Decision
Disable the Carfax worker when `isProduction` is true. VHR links are resolved in development only and persisted to the inventory cache DB, which production reads on startup.

## Consequences
- Production never attempts Carfax browser automation (avoids flaky failures and rate-limit risk)
- New VINs added while running in production won't get Carfax links until a dev-environment run processes them
- The `isProduction` guard lives in `triggerNewVinLookups()` inside `inventoryCache.ts`
