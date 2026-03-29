import { useState } from "react";
import { useGetInventory } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, MapPin, ExternalLink, FileText, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();

  const { data: inventory, isLoading, error } = useGetInventory({
    query: { retry: false },
  });

  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401) { setLocation("/login"); return null; }
    if (status === 403) { setLocation("/denied"); return null; }
    return (
      <div className="p-8 text-center text-destructive glass-panel rounded-2xl mt-10 max-w-2xl mx-auto">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-80" />
        <h2 className="text-xl font-bold mb-2">Error loading inventory</h2>
        <p className="text-sm opacity-80">Please try refreshing the page or contact support.</p>
      </div>
    );
  }

  if (isLoading) return <FullScreenSpinner />;

  const filteredInventory = inventory?.filter((item) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      item.vehicle.toLowerCase().includes(term) ||
      item.vin.toLowerCase().includes(term) ||
      item.location.toLowerCase().includes(term)
    );
  }) ?? [];

  return (
    <div className="space-y-6">

      {/* Header & Search */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-end">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
            Vehicle Inventory
          </h1>
          <p className="text-muted-foreground mt-1">
            {filteredInventory.length} {filteredInventory.length === 1 ? "vehicle" : "vehicles"}
          </p>
        </div>

        <div className="w-full lg:w-[360px] relative group">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <input
            type="text"
            className="w-full pl-10 pr-4 py-2.5 bg-card/50 border border-white/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            placeholder="Search by vehicle, VIN, or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      {filteredInventory.length > 0 ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[140px_1fr_180px_110px_80px_80px] gap-4 px-5 py-3 border-b border-white/10 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Location</span>
            <span>Vehicle</span>
            <span>VIN</span>
            <span>Price</span>
            <span className="text-center">Carfax</span>
            <span className="text-center">Listing</span>
          </div>

          {/* Rows */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.03 } } }}
          >
            <AnimatePresence mode="popLayout">
              {filteredInventory.map((item, i) => (
                <motion.div
                  key={item.vin}
                  layout
                  variants={{ hidden: { opacity: 0, x: -10 }, visible: { opacity: 1, x: 0 } }}
                  className={`grid grid-cols-[140px_1fr_180px_110px_80px_80px] gap-4 px-5 py-3.5 items-center hover:bg-white/5 transition-colors ${i !== filteredInventory.length - 1 ? "border-b border-white/5" : ""}`}
                >
                  {/* Location */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="w-3 h-3 shrink-0 opacity-60" />
                    <span className="truncate">{item.location}</span>
                  </div>

                  {/* Vehicle */}
                  <div className="font-medium text-sm text-foreground leading-snug">
                    {item.vehicle}
                  </div>

                  {/* VIN */}
                  <div className="font-mono text-xs text-muted-foreground truncate">
                    {item.vin}
                  </div>

                  {/* Price */}
                  <div className="text-sm font-bold text-emerald-400">
                    {item.price}
                  </div>

                  {/* Carfax */}
                  <div className="flex justify-center">
                    {item.carfax && item.carfax !== "NOT FOUND" ? (
                      <a
                        href={item.carfax}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View Carfax Report"
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <FileText className="w-4 h-4" />
                      </a>
                    ) : (
                      <span className="text-white/15 text-xs">—</span>
                    )}
                  </div>

                  {/* Website */}
                  <div className="flex justify-center">
                    {item.website && item.website !== "NOT FOUND" ? (
                      <a
                        href={item.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View Listing"
                        className="p-1.5 rounded-lg bg-primary/20 hover:bg-primary/40 text-primary transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    ) : (
                      <span className="text-white/15 text-xs">—</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl"
        >
          <Search className="w-10 h-10 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-bold text-foreground mb-1">No vehicles found</h3>
          <p className="text-muted-foreground text-sm max-w-sm">
            {search ? `No results for "${search}". Try different search terms.` : "No vehicles in inventory yet."}
          </p>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="mt-5 px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium transition-colors"
            >
              Clear Search
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}
