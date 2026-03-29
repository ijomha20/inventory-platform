import { useState, useCallback } from "react";
import { useGetInventory } from "@workspace/api-client-react";
import { Search, ExternalLink, FileText, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown, Copy, Check } from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

type SortKey = "location" | "vehicle" | "vin" | "price";
type SortDir = "asc" | "desc";

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
    <button
      onClick={handleCopy}
      title="Click to copy VIN"
      className="group flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 transition-colors"
    >
      <span className="font-mono">{vin}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 shrink-0 transition-opacity" />}
    </button>
  );
}

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("vehicle");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [, setLocation] = useLocation();

  const { data: inventory, isLoading, error } = useGetInventory({
    query: { retry: false },
  });

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

  const filtered = (inventory ?? []).filter((item) => {
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

  const cols: { key: SortKey | null; label: string; className: string }[] = [
    { key: "location", label: "Location",  className: "w-36 shrink-0" },
    { key: "vehicle",  label: "Vehicle",   className: "flex-1 min-w-0" },
    { key: "vin",      label: "VIN",       className: "w-44 shrink-0" },
    { key: "price",    label: "Price",     className: "w-28 shrink-0" },
    { key: null,       label: "Carfax",    className: "w-20 shrink-0 text-center" },
    { key: null,       label: "Listing",   className: "w-20 shrink-0 text-center" },
  ];

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
            {cols.map((col) => (
              <div key={col.label} className={col.className}>
                {col.key ? (
                  <button
                    onClick={() => handleSort(col.key!)}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors"
                  >
                    {col.label}
                    <SortIcon active={sortKey === col.key} dir={sortDir} />
                  </button>
                ) : (
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{col.label}</span>
                )}
              </div>
            ))}
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

                {/* Price */}
                <div className="w-28 shrink-0 text-sm text-gray-700">{item.price || "—"}</div>

                {/* Carfax */}
                <div className="w-20 shrink-0 flex justify-center">
                  {item.carfax && item.carfax !== "NOT FOUND" ? (
                    <a href={item.carfax} target="_blank" rel="noopener noreferrer" title="View Carfax"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                      <FileText className="w-4 h-4" />
                    </a>
                  ) : <span className="text-gray-300 text-sm">—</span>}
                </div>

                {/* Listing */}
                <div className="w-20 shrink-0 flex justify-center">
                  {item.website && item.website !== "NOT FOUND" ? (
                    <a href={item.website} target="_blank" rel="noopener noreferrer" title="View Listing"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition-colors">
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
