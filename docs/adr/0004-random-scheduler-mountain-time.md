# ADR 0004: Random Scheduler Uses Mountain Time Business Hours

## Status
Accepted

## Context
Background workers (Black Book valuations, Carfax VHR resolution, lender program sync) hit third-party services that impose rate limits and are most reliable during business hours. The dealership operates in the Mountain Time zone.

## Decision
Use `randomScheduler.ts` to schedule worker runs at randomized times within Mountain Time business hours (roughly 8 AM–6 PM MT). Randomization avoids thundering-herd patterns against shared upstream APIs.

## Consequences
- Workers only run during dealer operating hours, aligning data freshness with when it's needed
- Off-hours CreditApp and Carfax rate limits are avoided
- If the server restarts outside business hours, workers wait until the next window
- Changing the timezone requires updating `randomScheduler.ts`
