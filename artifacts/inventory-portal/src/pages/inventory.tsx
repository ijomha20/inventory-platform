import { useState, useCallback, useEffect, useRef } from "react";
import {
  useGetInventory,
  useGetCacheStatus,
  useGetVehicleImages,
  useGetMe,
} from "@workspace/api-client-react";
import {
  Search, ExternalLink, FileText, AlertCircle, ChevronUp, ChevronDown,
  ChevronsUpDown, Copy, Check, RefreshCw, Camera, X, ChevronLeft,
  ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

type SortKey = "location" | "vehicle" | "vin" | "price" | "km";
type SortDir = "asc" | "desc";

interface Filters {
  yearMin:   string;
  yearMax:   string;
  kmMax:     string;
  priceMin:  string;
  priceMax:  string;
}

const EMPTY_FILTERS: Filters = { yearMin: "", yearMax: "", kmMax: "", priceMin: "", priceMax: "" };

function parseNum(s: string): number {
  return parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
}

function extractYear(vehicle: string): number {
  const y = parseInt(vehicle.trim().split(/\s+/)[0] ?? "0", 10);
  return y > 1900 && y < 2100 ? y : 0;
}

function formatPrice(raw: string | undefined): string {
  if (!raw || raw === "NOT FOUND") return "—";
  const n = parseNum(raw);
  if (!n) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30 inline ml-1" />;
  return dir === "asc"
    ? <ChevronUp   className="w-3.5 h-3.5 text-blue-600 inline ml-1" />
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
      <span className="font-mono text-xs">{vin}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy  className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 shrink-0 transition-opacity" />}
    </button>
  );
}

// Photo gallery modal
function PhotoGallery({ vin, onClose }: { vin: string; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const { data, isLoading } = useGetVehicleImages({ vin });
  const urls = data?.urls ?? [];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")      onClose();
      if (e.key === "ArrowRight")  setIdx((i) => Math.min(i + 1, urls.length - 1));
      if (e.key === "ArrowLeft")   setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [urls.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-4xl w-full bg-white rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 bg-white/90 rounded-full shadow hover:bg-gray-100">
          <X className="w-5 h-5 text-gray-700" />
        </button>
        {isLoading ? (
          <div className="flex items-center justify-center h-64"><RefreshCw className="w-8 h-8 text-gray-400 animate-spin" /></div>
        ) : urls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Camera className="w-10 h-10 mb-2" /><p className="text-sm">No photos available</p>
          </div>
        ) : (
          <>
            <div className="relative bg-black flex items-center justify-center" style={{ height: "420px" }}>
              <img src={urls[idx]} alt={`Photo ${idx + 1}`} className="max-h-full max-w-full object-contain" />
              {urls.length > 1 && (
                <>
                  <button onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx === 0}
                    className="absolute left-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </button>
                  <button onClick={() => setIdx((i) => Math.min(i + 1, urls.length - 1))} disabled={idx === urls.length - 1}
                    className="absolute right-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </button>
                </>
              )}
            </div>
            {urls.length > 1 && (
              <div className="flex gap-1.5 p-3 overflow-x-auto bg-gray-50">
                {urls.map((url, i) => (
                  <button key={i} onClick={() => setIdx(i)}
                    className={`shrink-0 w-16 h-12 rounded overflow-hidden border-2 transition-colors ${i === idx ? "border-blue-500" : "border-transparent hover:border-gray-300"}`}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="px-4 py-2 text-center text-xs text-gray-400 border-t">
              {idx + 1} / {urls.length} photos — VIN: {vin}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PhotoThumb({ vin, hasPhotos }: { vin: string; hasPhotos?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title={hasPhotos ? "View photos" : "No photos available"}
        className={`p-1.5 rounded transition-colors ${
          hasPhotos
            ? "text-blue-500 hover:text-blue-700 hover:bg-blue-50"
            : "text-gray-300 cursor-default"
        }`}>
        <Camera className="w-4 h-4" />
      </button>
      {open && <PhotoGallery vin={vin} onClose={() => setOpen(false)} />}
    </>
  );
}

function BbExpandedRow({ bbValues }: { bbValues?: { xclean: number; clean: number; avg: number; rough: number } }) {
  if (!bbValues || (!bbValues.xclean && !bbValues.clean && !bbValues.avg && !bbValues.rough)) return null;
  const fmt = (v: number) => v ? `$${v.toLocaleString("en-US")}` : "—";
  const grades = [
    { label: "X-Clean", value: bbValues.xclean, color: "text-emerald-700" },
    { label: "Clean", value: bbValues.clean, color: "text-blue-700" },
    { label: "Average", value: bbValues.avg, color: "text-purple-700" },
    { label: "Rough", value: bbValues.rough, color: "text-orange-700" },
  ];
  return (
    <div className="bg-purple-50 border-b border-purple-100 px-4 py-2.5 flex items-center gap-8 animate-in slide-in-from-top-1 duration-150">
      <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide shrink-0">CBB Wholesale</span>
      <div className="flex items-center gap-6">
        {grades.map((g) => (
          <div key={g.label} className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">{g.label}</span>
            <span className={`text-sm font-semibold ${g.color}`}>{fmt(g.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BbCardDetail({
  bbValues,
  bbAvgWholesale,
}: {
  bbValues?: { xclean: number; clean: number; avg: number; rough: number };
  bbAvgWholesale?: string;
}) {
  const hasGrades = bbValues && (bbValues.xclean || bbValues.clean || bbValues.avg || bbValues.rough);
  const hasAdj    = !!bbAvgWholesale && bbAvgWholesale !== "NOT FOUND";
  if (!hasGrades && !hasAdj) return null;

  const fmt = (v: number) => v ? `$${v.toLocaleString("en-US")}` : "—";

  return (
    <div className="mt-2 rounded-lg border border-purple-200 overflow-hidden text-xs">
      {/* Header */}
      <div className="bg-purple-100 px-3 py-1.5">
        <span className="font-semibold text-purple-800 text-[11px] uppercase tracking-wide">CBB Wholesale</span>
      </div>

      {/* 2-column grade grid: left = X-Clean / Clean, right = Average / Rough */}
      {hasGrades && (
        <div className="grid grid-cols-2 divide-x divide-purple-100 bg-white">
          {/* Left column */}
          <div className="divide-y divide-purple-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">X-Clean</span>
              <span className="font-semibold text-emerald-700">{fmt(bbValues!.xclean)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Clean</span>
              <span className="font-semibold text-blue-700">{fmt(bbValues!.clean)}</span>
            </div>
          </div>
          {/* Right column */}
          <div className="divide-y divide-purple-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Average</span>
              <span className="font-semibold text-purple-700">{fmt(bbValues!.avg)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Rough</span>
              <span className="font-semibold text-orange-700">{fmt(bbValues!.rough)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Full-width KM-adjusted bar */}
      {hasAdj && (
        <div className="flex items-center justify-between px-3 py-2 bg-purple-700">
          <span className="text-purple-200 font-medium">KM Adjusted</span>
          <span className="font-bold text-white">{formatPrice(bbAvgWholesale)}</span>
        </div>
      )}
    </div>
  );
}

function VehicleCard({ item, showPacCost, showOwnerCols, showBb }: { item: any; showPacCost: boolean; showOwnerCols: boolean; showBb: boolean }) {
  const kmDisplay = item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : null;
  const hasBb = showBb && (item.bbAvgWholesale || item.bbValues);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header: location + icons */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{item.location}</span>
        <div className="flex items-center gap-2">
          <PhotoThumb vin={item.vin} hasPhotos={!!item.hasPhotos} />
          {item.carfax && item.carfax !== "NOT FOUND" && (
            <a href={item.carfax} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
              <FileText className="w-4 h-4" />
            </a>
          )}
          {item.website && item.website !== "NOT FOUND" && (
            <a href={item.website} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="Listing">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {/* Line 1: vehicle name */}
        <p className="font-semibold text-gray-900 text-sm leading-snug">{item.vehicle}</p>

        {/* Line 2: VIN  •  KM */}
        <div className="flex items-center gap-2">
          <CopyVin vin={item.vin} />
          {kmDisplay && (
            <>
              <span className="text-gray-300 text-xs">•</span>
              <span className="text-xs text-gray-500 font-medium">{kmDisplay}</span>
            </>
          )}
        </div>

        {/* Owner-only row: Matrix Price + Cost */}
        {showOwnerCols && (
          <div className="flex gap-4 text-xs">
            <div>
              <p className="text-gray-400 mb-0.5">Matrix Price</p>
              <p className="font-medium text-gray-700">{formatPrice(item.matrixPrice)}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Cost</p>
              <p className="font-semibold text-red-700">{formatPrice(item.cost)}</p>
            </div>
          </div>
        )}

        {/* Line 3: PAC Cost + Online Price (always shown; PAC Cost hidden for guests/customer view) */}
        <div className="flex gap-4 text-xs">
          {showPacCost && (
            <div>
              <p className="text-gray-400 mb-0.5">PAC Cost</p>
              <p className="font-semibold text-gray-900">{formatPrice(item.price)}</p>
            </div>
          )}
          <div>
            <p className="text-gray-400 mb-0.5">Online Price</p>
            <p className="font-medium text-gray-700">{formatPrice(item.onlinePrice)}</p>
          </div>
        </div>

        {/* CBB Wholesale box */}
        {hasBb && (
          <BbCardDetail bbValues={item.bbValues} bbAvgWholesale={item.bbAvgWholesale} />
        )}
      </div>
    </div>
  );
}

// ─── Range input pair ────────────────────────────────────────────────────────
function RangeInputs({
  label, minVal, maxVal, minPlaceholder, maxPlaceholder,
  onMinChange, onMaxChange, prefix = "",
}: {
  label: string; minVal: string; maxVal: string;
  minPlaceholder: string; maxPlaceholder: string;
  onMinChange: (v: string) => void; onMaxChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={minVal} onChange={(e) => onMinChange(e.target.value)}
            placeholder={minPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
        <span className="text-gray-300 text-sm">—</span>
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={maxVal} onChange={(e) => onMaxChange(e.target.value)}
            placeholder={maxPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
      </div>
    </div>
  );
}

// ─── Active filter chip ──────────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-200">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 transition-colors"><X className="w-3 h-3" /></button>
    </span>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function Inventory() {
  const [search,      setSearch]      = useState("");
  const [sortKey,     setSortKey]     = useState<SortKey>("vehicle");
  const [sortDir,     setSortDir]     = useState<SortDir>("asc");
  const [showFilters, setShowFilters] = useState(false);
  const [filters,     setFilters]     = useState<Filters>(EMPTY_FILTERS);
  const [, setLocation]               = useLocation();
  const lastKnownUpdate               = useRef<string | null>(null);

  const { data: me } = useGetMe({ query: { retry: false } });
  const isGuest = me?.role === "guest";
  const isOwner = me?.isOwner === true;

  type ViewMode = "owner" | "user" | "customer";
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("viewMode");
    if (saved === "owner" || saved === "user" || saved === "customer") return saved;
    return "user";
  });
  useEffect(() => {
    const saved = localStorage.getItem("viewMode");
    if (isOwner && !saved) setViewMode("owner");
  }, [isOwner]);
  useEffect(() => { localStorage.setItem("viewMode", viewMode); }, [viewMode]);
  const showOwnerCols = isOwner && viewMode === "owner";
  const showPacCost   = !isGuest && viewMode !== "customer";
  const showBb        = viewMode !== "customer";

  const [expandedBbVin, setExpandedBbVin] = useState<string | null>(null);
  const [bbClicked, setBbClicked] = useState(false);
  const bbCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: inventory, isLoading, error, refetch: refetchInventory } = useGetInventory({ query: { retry: false } });

  const { data: cacheStatus } = useGetCacheStatus({ query: { refetchInterval: 60_000, retry: false } });

  const bbRunning = (cacheStatus as any)?.bbRunning === true || bbClicked;

  const triggerBbRefresh = useCallback(async () => {
    if (bbRunning) return;
    setBbClicked(true);
    if (bbCooldownRef.current) clearTimeout(bbCooldownRef.current);
    bbCooldownRef.current = setTimeout(() => setBbClicked(false), 90_000);
    try {
      const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      await fetch(`${base}/api/refresh-blackbook`, { method: "POST", credentials: "include" });
    } catch (_) {}
  }, [bbRunning]);

  useEffect(() => {
    if (!cacheStatus?.lastUpdated) return;
    if (lastKnownUpdate.current === null) { lastKnownUpdate.current = cacheStatus.lastUpdated; return; }
    if (cacheStatus.lastUpdated !== lastKnownUpdate.current) {
      lastKnownUpdate.current = cacheStatus.lastUpdated;
      refetchInventory();
    }
  }, [cacheStatus?.lastUpdated, refetchInventory]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter = (key: keyof Filters) => (val: string) =>
    setFilters((f) => ({ ...f, [key]: val }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasFilters = Object.values(filters).some(Boolean);

  // Deduplicate by VIN — keep lowest price
  const parseNumericPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || Infinity;
  type Item = NonNullable<typeof inventory>[number];
  const dedupedMap = new Map<string, Item>();
  for (const item of (inventory ?? [])) {
    const existing = dedupedMap.get(item.vin);
    if (!existing || parseNumericPrice(item.price) < parseNumericPrice(existing.price))
      dedupedMap.set(item.vin, item);
  }
  const deduped = Array.from(dedupedMap.values());

  // Derive year min/max from data for placeholders
  const years = deduped.map((i) => extractYear(i.vehicle)).filter(Boolean);
  const dataYearMin = years.length ? Math.min(...years) : 2000;
  const dataYearMax = years.length ? Math.max(...years) : new Date().getFullYear();
  const kms   = deduped.map((i) => parseNum(i.km)).filter(Boolean);
  const dataKmMax = kms.length ? Math.max(...kms) : 300000;
  const prices = deduped.map((i) => parseNum(i.price)).filter(Boolean);
  const dataPriceMax = prices.length ? Math.max(...prices) : 100000;

  // Apply all filters + search
  const filtered = deduped.filter((item) => {
    // Text search
    if (search) {
      const term = search.toLowerCase();
      if (!item.vehicle.toLowerCase().includes(term) &&
          !item.vin.toLowerCase().includes(term) &&
          !item.location.toLowerCase().includes(term)) return false;
    }
    // Year
    const year = extractYear(item.vehicle);
    if (filters.yearMin && year && year < parseInt(filters.yearMin)) return false;
    if (filters.yearMax && year && year > parseInt(filters.yearMax)) return false;
    // KM
    const km = parseNum(item.km);
    if (filters.kmMax && km && km > parseNum(filters.kmMax)) return false;
    // Price (only for non-guests)
    if (!isGuest) {
      const price = parseNum(item.price);
      if (filters.priceMin && price && price < parseNum(filters.priceMin)) return false;
      if (filters.priceMax && price && price > parseNum(filters.priceMax)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] ?? "").toLowerCase();
    const bv = (b[sortKey] ?? "").toLowerCase();
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Active filter chips
  const activeChips: { label: string; clear: () => void }[] = [
    ...(filters.yearMin || filters.yearMax ? [{
      label: `Year: ${filters.yearMin || dataYearMin}–${filters.yearMax || dataYearMax}`,
      clear: () => setFilters((f) => ({ ...f, yearMin: "", yearMax: "" })),
    }] : []),
    ...(filters.kmMax ? [{
      label: `KM ≤ ${parseInt(filters.kmMax).toLocaleString("en-US")}`,
      clear: () => setFilter("kmMax")(""),
    }] : []),
    ...(!isGuest && (filters.priceMin || filters.priceMax) ? [{
      label: `PAC Cost: $${filters.priceMin || "0"}–$${filters.priceMax || "∞"}`,
      clear: () => setFilters((f) => ({ ...f, priceMin: "", priceMax: "" })),
    }] : []),
  ];

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-20 text-center rounded-lg border border-gray-200 bg-white">
      <Search className="w-8 h-8 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-700 mb-1">No vehicles found</p>
      <p className="text-sm text-gray-400">Try adjusting your search or filters.</p>
      {(search || hasFilters) && (
        <button onClick={() => { setSearch(""); clearFilters(); }}
          className="mt-4 px-4 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          Clear all
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header + search + filter toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Vehicle Inventory</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {sorted.length} {sorted.length === 1 ? "vehicle" : "vehicles"}
              {sorted.length !== deduped.length ? ` of ${deduped.length} total` : ""}
            </p>
            {cacheStatus?.lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                {cacheStatus.isRefreshing
                  ? <><RefreshCw className="w-3 h-3 animate-spin" /> Updating…</>
                  : <>Updated {timeAgo(cacheStatus.lastUpdated)}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input type="text"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                placeholder="Search vehicle, VIN, location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowFilters((s) => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showFilters || hasFilters
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}>
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {hasFilters && <span className="bg-white text-blue-600 text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{activeChips.length}</span>}
            </button>
            {!isGuest && (
              <div className="flex items-center gap-2">
                <div className="flex rounded overflow-hidden border border-gray-200 shrink-0">
                  {isOwner && (
                    <button onClick={() => setViewMode("owner")}
                      className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "owner" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                      Own
                    </button>
                  )}
                  <button onClick={() => setViewMode("user")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "user" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    User
                  </button>
                  <button onClick={() => setViewMode("customer")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "customer" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    Cust
                  </button>
                </div>
                {showOwnerCols && (
                  <button
                    onClick={triggerBbRefresh}
                    disabled={bbRunning}
                    title={bbRunning ? "Book value refresh in progress…" : "Refresh Canadian Black Book values"}
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border transition-colors shrink-0 ${
                      bbRunning
                        ? "bg-purple-50 text-purple-400 border-purple-200 cursor-not-allowed"
                        : "bg-white text-purple-600 border-purple-200 hover:bg-purple-50"
                    }`}>
                    <RefreshCw className={`w-3 h-3 ${bbRunning ? "animate-spin" : ""}`} />
                    Book Avg
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <div className={`grid gap-4 ${isGuest ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
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
              <VehicleCard key={`${item.vin}-${i}`} item={item} showPacCost={showPacCost} showOwnerCols={showOwnerCols} showBb={showBb} />
            ))}
          </div>
        )
      ) : (
        /* Desktop table */
        sorted.length === 0 ? emptyState : (
          <div className="rounded-lg border border-gray-200 overflow-x-auto bg-white shadow-sm">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              {[
                { key: "location" as SortKey, label: "Location",   cls: "w-24 shrink-0" },
                { key: "vehicle"  as SortKey, label: "Vehicle",    cls: "flex-1 min-w-[280px]" },
                { key: "vin"      as SortKey, label: "VIN",        cls: "w-40 shrink-0" },
                { key: "km"       as SortKey, label: "KM",         cls: "w-24 shrink-0" },
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
              {showBb && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-purple-500">Book Avg</div>}
              {showPacCost && (
                <div className="w-24 shrink-0">
                  <button onClick={() => handleSort("price")}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    PAC Cost<SortIcon active={sortKey === "price"} dir={sortDir} />
                  </button>
                </div>
              )}
              <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Online Price</div>
              <div className="w-8 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">CFX</div>
              <div className="w-8 shrink-0" />
              <div className="w-8 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Link</div>
            </div>
            <div>
              {sorted.map((item, i) => (
                <div key={`${item.vin}-${i}`}>
                  <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i < sorted.length - 1 && expandedBbVin !== item.vin ? "border-b border-gray-100" : ""}`}>
                    <div className="w-24 shrink-0 text-sm text-gray-700 truncate font-medium">{item.location || "—"}</div>
                    <div className="flex-1 min-w-[280px] text-sm text-gray-900 font-medium truncate">{item.vehicle}</div>
                    <div className="w-40 shrink-0"><CopyVin vin={item.vin} /></div>
                    <div className="w-24 shrink-0 text-sm text-gray-600">
                      {item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : "—"}
                    </div>
                    {showOwnerCols && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.matrixPrice ?? "")}</div>}
                    {showOwnerCols && <div className="w-24 shrink-0 text-sm font-medium text-red-700">{formatPrice(item.cost ?? "")}</div>}
                    {showBb && (
                      (item as any).bbValues ? (
                        <button className="w-24 shrink-0 text-sm font-medium text-purple-700 cursor-pointer hover:underline text-left"
                          onClick={() => setExpandedBbVin(expandedBbVin === item.vin ? null : item.vin)}>
                          {formatPrice((item as any).bbAvgWholesale ?? "")}
                        </button>
                      ) : (
                        <div className="w-24 shrink-0 text-sm font-medium text-purple-700">
                          {formatPrice((item as any).bbAvgWholesale ?? "")}
                        </div>
                      )
                    )}
                    {showPacCost && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.price)}</div>}
                    <div className="w-28 shrink-0 text-sm text-gray-700">{formatPrice(item.onlinePrice)}</div>
                    <div className="w-8 shrink-0 flex justify-center">
                      {item.carfax && item.carfax !== "NOT FOUND"
                        ? <a href={item.carfax} target="_blank" rel="noopener noreferrer"
                            className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
                            <FileText className="w-4 h-4" />
                          </a>
                        : <span className="text-gray-200 text-sm">—</span>}
                    </div>
                    <div className="w-8 shrink-0 flex justify-center"><PhotoThumb vin={item.vin} hasPhotos={!!item.hasPhotos} /></div>
                    <div className="w-8 shrink-0 flex justify-center">
                      {item.website && item.website !== "NOT FOUND"
                        ? <a href={item.website} target="_blank" rel="noopener noreferrer"
                            className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="View Listing">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        : <span className="text-gray-200 text-sm">—</span>}
                    </div>
                  </div>
                  {expandedBbVin === item.vin && <BbExpandedRow bbValues={(item as any).bbValues} />}
                  {(i < sorted.length - 1 || expandedBbVin === item.vin) && expandedBbVin === item.vin && <div className="border-b border-gray-100" />}
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
