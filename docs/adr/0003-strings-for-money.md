# ADR 0003: Price Fields Stored as Strings

## Status
Accepted

## Context
Price values originate from an Apps Script CSV feed and pass through Typesense search documents. Both sources deliver prices as strings. Converting to numbers at the ingestion boundary risks floating-point precision loss and complicates round-tripping through JSON.

## Decision
Store all price-related fields (`price`, `onlinePrice`, `matrixPrice`, `cost`, `bbAvgWholesale`) as strings in `InventoryItem`. The lender calculator parses them to numbers internally where arithmetic is needed.

## Consequences
- No silent precision loss during ingestion or caching
- Display formatting is the frontend's responsibility
- The lender calculator must handle parse failures gracefully (it already does)
- Comparing prices requires parsing — cannot use direct numeric comparisons on cached data
