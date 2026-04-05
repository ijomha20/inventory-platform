<RangeInputs label="Year" minVal={filters.yearMin} maxVal={filters.yearMax}
                minPlaceholder={String(dataYearMin)} maxPlaceholder={String(dataYearMax)}
                onMinChange={setFilter("yearMin")} onMaxChange={setFilter("yearMax")} />
              <RangeInputs label="Max KM" minVal="" maxVal={filters.kmMax}
                minPlaceholder="0" maxPlaceholder={Math.round(dataKmMax / 1000) * 1000 + ""}
                onMinChange={() => {}} onMaxChange={setFilter("kmMax")} />
              {showPacCost && (
                <RangeInputs label="PAC Cost" minVal={filters.priceMin} maxVal={filters.priceMax}
                  minPlaceholder="0" maxPlaceholder={Math.round(dataPriceMax / 1000) * 1000 + ""}
                  onMinChange={setFilter("priceMin")} onMaxChange={setFilter("priceMax")} prefix="$" />
              )}
            </div>
            {hasFilters && (
              <button onClick={clearFilters}
                className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors">
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <FilterChip key={chip.label} label={chip.label} onRemove={chip.clear} />
            ))}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      {isMobile ? (
        sorted.length === 0 ? emptyState : (
          <div className="space-y-3">
            {sorted.map((item, i) => (
              <VehicleCard key={`${item.vin}-${i}`} item={item} showPacCost={showPacCost} showOwnerCols={showOwnerCols} />
            ))}
          </div>
        )
      ) : (
        /* Desktop table */
        sorted.length === 0 ? emptyState : (
          <div className="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
            {/* Header row */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              {[
                { key: "location" as SortKey, label: "Location", cls: "w-24 shrink-0" },
                { key: "vehicle"  as SortKey, label: "Vehicle",  cls: "flex-1 min-w-0" },
                { key: "vin"      as SortKey, label: "VIN",      cls: "w-40 shrink-0" },
                { key: "km"       as SortKey, label: "KM",       cls: "w-24 shrink-0" },
              ].map((col) => (
                <div key={col.label} className={col.cls}>
                  <button onClick={() => handleSort(col.key)}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    {col.label}<SortIcon active={sortKey === col.key} dir={sortDir} />
                  </button>
                </div>
              ))}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Matrix Price</div>}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Cost</div>}
              {showPacCost   && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">PAC Cost</div>}
              <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Online Price</div>
              <div className="w-8  shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">CFX</div>
              <div className="w-8  shrink-0" />
              <div className="w-8  shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Link</div>
            </div>
            {/* Data rows */}
            <div>
              {sorted.map((item, i) => (
                <div key={`${item.vin}-${i}`}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i < sorted.length - 1 ? "border-b border-gray-100" : ""}`}>
                  <div className="w-24 shrink-0 text-sm text-gray-700 truncate font-medium">{item.location || "—"}</div>
                  <div className="flex-1 min-w-0 text-sm text-gray-900 font-medium truncate">{item.vehicle}</div>
                  <div className="w-40 shrink-0"><CopyVin vin={item.vin} /></div>
                  <div className="w-24 shrink-0 text-sm text-gray-600">
                    {item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : "—"}
                  </div>
                  {showOwnerCols && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.matrixPrice ?? "")}</div>}
                  {showOwnerCols && <div className="w-24 shrink-0 text-sm font-medium text-red-700">{formatPrice(item.cost ?? "")}</div>}
                  {showPacCost   && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.price)}</div>}
                  <div className="w-28 shrink-0 text-sm text-gray-700">{formatPrice(item.onlinePrice)}</div>
                  <div className="w-8 shrink-0 flex justify-center">
                    {item.carfax && item.carfax !== "NOT FOUND"
                      ? <a href={item.carfax} target="_blank" rel="noopener noreferrer"
                          className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
                          <FileText className="w-4 h-4" />
                        </a>
                      : <span className="text-gray-200 text-sm">—</span>}
                  </div>
                  <div className="w-8 shrink-0 flex justify-center"><PhotoThumb vin={item.vin} /></div>
                  <div className="w-8 shrink-0 flex justify-center">
                    {item.website && item.website !== "NOT FOUND"
                      ? <a href={item.website} target="_blank" rel="noopener noreferrer"
                          className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="View Listing">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      : <span className="text-gray-200 text-sm">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
```

---

## 10. Key Configuration Reference

### Environment Variables (Replit Secrets)

| Variable                 | Used By           | Description |
|--------------------------|-------------------|-------------|
| `SESSION_SECRET`         | API Server        | Express session signing key |
| `GOOGLE_CLIENT_ID`       | API Server        | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET`   | API Server        | Google OAuth client secret |
| `OWNER_EMAIL`            | API Server        | Email address of the portal owner (bypasses access check) |
| `INVENTORY_DATA_URL`     | API Server        | Apps Script web app URL + `?action=inventory` |
| `REFRESH_SECRET`         | API Server        | Shared secret for `/api/refresh` webhook |
| `CARFAX_EMAIL`           | Carfax Worker     | Dealer portal login email |
| `CARFAX_PASSWORD`        | Carfax Worker     | Dealer portal login password |
| `CARFAX_ENABLED`         | Carfax Worker     | Set to `"true"` to activate nightly runs |
| `APPS_SCRIPT_WEB_APP_URL`| Carfax Worker     | Apps Script web app URL (no `?action=`) |

### Apps Script Settings Tab

| Setting                   | Description |
|---------------------------|-------------|
| `SOURCE_SHEET_URL`        | Full URL of the shared Matrix spreadsheet |
| `SOURCE_TAB_NAME`         | Tab name inside the shared spreadsheet (default: `Sheet1`) |
| `NOTIFICATION_EMAILS`     | Comma-separated emails for change notifications and alerts |
| `CHECK_INTERVAL_HOURS`    | How often auto-sync runs (default: `1`) |
| `REPLIT_REFRESH_URL`      | `https://<domain>/api/refresh` |
| `REPLIT_REFRESH_SECRET`   | Must match `REFRESH_SECRET` in Replit |

### Spreadsheet Column Layout ("My List" tab)

| Col | Index | Field         | Notes |
|-----|-------|---------------|-------|
| A   | 0     | Location      | e.g. `MM` |
| B   | 1     | VIN           | |
| C   | 2     | Year/Make     | |
| D   | 3     | Model         | |
| E   | 4     | Mileage       | |
| F   | 5     | Price         | Matrix list price → `matrixPrice` (owner-only) |
| G   | 6     | Your Cost     | **User-managed, never overwritten** → `cost` (owner-only) |
| H   | 7     | Notes/Your Cost | PAC selling price → `price`; must be filled for row to appear in portal |
| I   | 8     | Price Changed | Auto-written timestamp |
| J   | 9     | Carfax        | Populated by Replit Carfax worker |
| K   | 10    | Website       | Inventory URL from Typesense |
| L   | 11    | Online Price  | Current retail price from Typesense |

### Typesense Collections

| Site     | Collection ID                        | Preferred? |
|----------|--------------------------------------|------------|
| Parkdale | `37042ac7ece3a217b1a41d6f54ba6855`   | Yes (checked first) |
| Matrix   | `cebacbca97920d818d57c6f0526d7413`   | Fallback |

### Access Control

- **Owner bypass:** `IJOMHA20@GMAIL.COM` — always has full access, no DB entry needed.
- **Invite others:** `/admin` page → add email + role (`viewer` or `guest`).
- **Sandra:** `sandra@driveurdream.ca` — needs to be added via `/admin`.

### Carfax Worker Notes

- Session cookies stored at `.carfax-session.json` (27 cookies, **not encrypted** — do not modify).
- Nightly schedule: **2:15am**. Startup catch-up runs 30s after server start if already past 2:15am.
- Browser launch timeout: **90s** (increased from 30s). Up to **3 retry attempts** with 10s/20s back-off.
- Alerts on failure sent via Apps Script `notify` action → email to `NOTIFICATION_EMAILS`.

---

*End of document — all 9 source files captured.*
