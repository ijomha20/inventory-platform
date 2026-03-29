import { useState, useCallback } from "react";
import { useGetInventory } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, MapPin, ExternalLink, FileText, AlertCircle,
  ChevronUp, ChevronDown, ChevronsUpDown, Copy, Check,
} from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

type SortKey = "location" | "vehicle" | "vin" | "price";
type SortDir = "asc" | "desc";

function SortIcon({ col, active, dir }: { col: string; active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="w-3.5 h-3.5 text-primary" />
    : <ChevronDown className="w-3.5 h-3.5 text-primary" />;
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
      className="group flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      <span>{vin}</span>
      {copied
        ? <Check className="w-3 h-3 text-emerald-400 shrink-0" />
        : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 shrink-0 transition-opacity" />}
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
      <div className="p-8 text-center rounded-xl border border-red-500/20 bg-red-500/5 mt-10 max-w-xl mx-auto">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-400" />
        <h2 className="text-base font-semibold text-foreground mb-1">Error loading inventory</h2>
        <p className="text-sm text-muted-foreground">Please refresh the page or contact support.</p>
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

  const columns: { key: SortKey; label: string; width: string }[] = [
    { key: "location", label: "Location",  width: "w-[130px]" },
    { key: "vehicle",  label: "Vehicle",   width: "flex-1" },
    { key: "vin",      label: "VIN",       width: "w-[175px]" },
    { key: "price",    label: "Price",     width: "w-[100px]" },
  ];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Vehicle Inventory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sorted.length} {sorted.length === 1 ? "vehicle" : "vehicles"}
            {search && ` matching "${search}"`}
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            className="w-full pl-9 pr-4 py-2 text-sm bg-surface border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all"
            placeholder="Search vehicle, VIN, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {sorted.length > 0 ? (
        <div className="rounded-xl border border-border overflow-hidden bg-surface">

          {/* Header row */}
          <div className="flex items-center gap-4 px-4 py-2.5 bg-surface-raised border-b border-border">
            {columns.map(col => (
              <button
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors ${col.width} ${col.key === "vehicle" ? "min-w-0" : "shrink-0"}`}
              >
                {col.label}
                <SortIcon col={col.key} active={sortKey === col.key} dir={sortDir} />
              </button>
            ))}
            {/* Static headers for links */}
            <div className="w-[64px] shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carfax</div>
            <div className="w-[64px] shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Listing</div>
          </div>

          {/* Data rows */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.025 } } }}
          >
            <AnimatePresence mode="popLayout">
              {sorted.map((item, i) => (
                <motion.div
                  key={item.vin}
                  layout
                  variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
                  className={`flex items-center gap-4 px-4 py-3 hover:bg-hover transition-colors ${i < sorted.length - 1 ? "border-b border-border" : ""}`}
                >
                  {/* Location */}
                  <div className="w-[130px] shrink-0 flex items-center gap-1.5 min-w-0">
                    <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground truncate">{item.location || "—"}</span>
                  </div>

                  {/* Vehicle */}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground leading-snug line-clamp-1">{item.vehicle}</span>
                  </div>

                  {/* VIN */}
                  <div className="w-[175px] shrink-0">
                    <CopyVin vin={item.vin} />
                  </div>

                  {/* Price */}
                  <div className="w-[100px] shrink-0">
                    <span className="text-sm font-semibold text-emerald-400">{item.price || "—"}</span>
                  </div>

                  {/* Carfax */}
                  <div className="w-[64px] shrink-0 flex justify-center">
                    {item.carfax && item.carfax !== "NOT FOUND" ? (
                      <a
                        href={item.carfax}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View Carfax Report"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-border transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </a>
                    ) : (
                      <span className="text-border text-sm select-none">—</span>
                    )}
                  </div>

                  {/* Listing */}
                  <div className="w-[64px] shrink-0 flex justify-center">
                    {item.website && item.website !== "NOT FOUND" ? (
                      <a
                        href={item.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View Listing"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-primary hover:text-primary/80 hover:bg-primary/10 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : (
                      <span className="text-border text-sm select-none">—</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-border bg-surface">
          <Search className="w-8 h-8 text-muted-foreground mb-3 opacity-40" />
          <p className="text-sm font-medium text-foreground mb-1">No vehicles found</p>
          <p className="text-sm text-muted-foreground">
            {search ? `No results for "${search}"` : "No vehicles in inventory yet."}
          </p>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="mt-4 px-4 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-border transition-colors"
            >
              Clear search
            </button>
          )}
        </div>
      )}
    </div>
  );
}
