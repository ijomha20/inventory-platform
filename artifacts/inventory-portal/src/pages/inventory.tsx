import { useState, useCallback, useEffect, useRef } from "react";
import { useGetInventory, useGetCacheStatus } from "@workspace/api-client-react";
import { Search, ExternalLink, FileText, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown, Copy, Check, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

type SortKey = "location" | "vehicle" | "vin" | "price" | "km";
type SortDir = "asc" | "desc";

function formatPrice(raw: string | undefined): string {
  if (!raw || raw === "NOT FOUND") return "—";
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n === 0) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30 inline ml-1" />;
  return dir === "asc"
    ? <ChevronUp className="w-3.5 h-3.5 text-blue-600 inline ml-1" />
    : <ChevronDown className="w-3.5 h-3.5 text-blue-600 inline ml-1" />;
}

function CopyVin({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(vin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [vin]);
  return (
    <button onClick={handleCopy} title="Click to copy VIN"
      className="group flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 transition-colors">
      <span className="font-mono">{vin}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 shrink-0 transition-opacity" />}
    </button>
  );
}

export default function Inventory() {
  const [search, setSearch]   = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("vehicle");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [, setLocation]       = useLocation();

  // Track the server's last-updated timestamp so we know when to refetch
  const lastKnownUpdate = useRef<string | null>(null);

  const { data: inventory, isLoading, error, refetch: refetchInventory } = useGetInventory({
    query: { retry: false },
  });

  // Poll cache-status every 60 seconds — auto-refetch inventory if data changed
  const { data: cacheStatus } = useGetCacheStatus({
    query: {
      refetchInterval: 60_000,
      retry: false,
    },
  });

  useEffect(() => {
    if (!cacheStatus?.lastUpdated) return;
    if (lastKnownUpdate.current === null) {
      // First status read — just record it
      lastKnownUpdate.current = cacheStatus.lastUpdated;
      return;
    }
    if (cacheStatus.lastUpdated !== lastKnownUpdate.current) {
      // Server has fresher data — silently refetch in the background
      lastKnownUpdate.current = cacheStatus.lastUpdated;
      refetchInventory();
    }
  }, [cacheStatus?.lastUpdated, refetchInventory]);

  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401) { setLocation("/login"); return null; }
    if (status === 403) { setLocation("/denied"); return null; }
    return (
      <div className="p-8 text-center rounded-lg border border-red-200 bg-red-50 mt-10 max-w-xl mx-auto">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
        <h2 className="text-base font-semibold text-gray-900 mb-1">Error loading inventory</h2>
        <p className="text-sm text-gray-500">Please refresh the page or contact support.</p>
      </div>
    );
  }

  if (isLoading) return <FullScreenSpinner />;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Deduplicate by VIN — keep the entry with the lower price
  const parseNumericPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || Infinity;
  type Item = NonNullable<typeof inventory>[number];
  const dedupedMap = new Map<string, Item>();
  for (const item of (inventory ?? [])) {
    const existing = dedupedMap.get(item.vin);
    if (!existing || parseNumericPrice(item.price) < parseNumericPrice(existing.price)) {
      dedupedMap.set(item.vin, item);
    }
  }
  const deduped = Array.from(dedupedMap.values());

  const filtered = deduped.filter((item) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      item.vehicle.toLowerCase().includes(term) ||
      item.vin.toLowerCase().includes(term) ||
      item.location.toLowerCase().includes(term)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] ?? "").toLowerCase();
    const bv = (b[sortKey] ?? "").toLowerCase();
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Vehicle Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {sorted.length} {sorted.length === 1 ? "vehicle" : "vehicles"}
            {search ? ` matching "${search}"` : ""}
          </p>
          {/* Last updated indicator */}
          {cacheStatus?.lastUpdated && (
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              {cacheStatus.isRefreshing
                ? <><RefreshCw className="w-3 h-3 animate-spin" /> Updating…</>
                : <>Updated {timeAgo(cacheStatus.lastUpdated)}</>}
            </p>
          )}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
            placeholder="Search vehicle, VIN, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {sorted.length > 0 ? (
        <div className="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">

          {/* Header row */}
          <div className="flex items-center gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            {[
              { key: "location" as SortKey, label: "Location",     cls: "w-36 shrink-0" },
              { key: "vehicle"  as SortKey, label: "Vehicle",      cls: "flex-1 min-w-0" },
              { key: "vin"      as SortKey, label: "VIN",          cls: "w-44 shrink-0" },
              { key: "price"    as SortKey, label: "Your Cost",    cls: "w-28 shrink-0" },
              { key: "km"       as SortKey, label: "KM",           cls: "w-24 shrink-0" },
            ].map((col) => (
              <div key={col.label} className={col.cls}>
                <button onClick={() => handleSort(col.key)}
                  className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                  {col.label}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </button>
              </div>
            ))}
            <div className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Online Price</div>
            <div className="w-20 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Carfax</div>
            <div className="w-20 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Listing</div>
          </div>

          {/* Data rows */}
          <div>
            {sorted.map((item, i) => (
              <div
                key={`${item.vin}-${i}`}
                className={`flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors ${i < sorted.length - 1 ? "border-b border-gray-100" : ""}`}
              >
                {/* Location */}
                <div className="w-36 shrink-0 text-sm text-gray-700 truncate">{item.location || "—"}</div>

                {/* Vehicle */}
                <div className="flex-1 min-w-0 text-sm text-gray-700 font-medium truncate">{item.vehicle}</div>

                {/* VIN */}
                <div className="w-44 shrink-0"><CopyVin vin={item.vin} /></div>

                {/* Your Cost */}
                <div className="w-28 shrink-0 text-sm text-gray-700">{formatPrice(item.price)}</div>

                {/* KM */}
                <div className="w-24 shrink-0 text-sm text-gray-700">
                  {item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : "—"}
                </div>

                {/* Online Price — comes directly from the sheet, no extra API call */}
                <div className="w-32 shrink-0 text-sm text-gray-700">
                  {formatPrice(item.onlinePrice)}
                </div>

                {/* Carfax */}
                <div className="w-20 shrink-0 flex justify-center">
                  {item.carfax && item.carfax !== "NOT FOUND" ? (
                    <a href={item.carfax} target="_blank" rel="noopener noreferrer" title="View Carfax"
                      className="inline-flex items-center px-2 py-1 rounded text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                      <FileText className="w-4 h-4" />
                    </a>
                  ) : <span className="text-gray-300 text-sm">—</span>}
                </div>

                {/* Listing */}
                <div className="w-20 shrink-0 flex justify-center">
                  {item.website && item.website !== "NOT FOUND" ? (
                    <a href={item.website} target="_blank" rel="noopener noreferrer" title="View Listing"
                      className="inline-flex items-center px-2 py-1 rounded text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition-colors">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  ) : <span className="text-gray-300 text-sm">—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-lg border border-gray-200 bg-white">
          <Search className="w-8 h-8 text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-700 mb-1">No vehicles found</p>
          <p className="text-sm text-gray-400">
            {search ? `No results for "${search}"` : "No vehicles in inventory yet."}
          </p>
          {search && (
            <button onClick={() => setSearch("")}
              className="mt-4 px-4 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              Clear search
            </button>
          )}
        </div>
      )}
    </div>
  );
}
