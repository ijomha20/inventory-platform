import { useState, useMemo } from "react";
import { useGetInventory } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, MapPin, ExternalLink, FileText, Car, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  
  const { data: inventory, isLoading, error } = useGetInventory({
    query: {
      retry: false,
    }
  });

  // Handle unauthorized or access denied
  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401) {
      setLocation("/login");
      return null;
    }
    if (status === 403) {
      setLocation("/denied");
      return null;
    }
    return (
      <div className="p-8 text-center text-destructive glass-panel rounded-2xl mt-10 max-w-2xl mx-auto">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-80" />
        <h2 className="text-xl font-bold mb-2">Error loading inventory</h2>
        <p className="text-sm opacity-80">Please try refreshing the page or contact support.</p>
      </div>
    );
  }

  if (isLoading) {
    return <FullScreenSpinner />;
  }

  const filteredInventory = inventory?.filter((item) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      item.vehicle.toLowerCase().includes(term) ||
      item.vin.toLowerCase().includes(term) ||
      item.location.toLowerCase().includes(term)
    );
  }) || [];

  return (
    <div className="space-y-8">
      
      {/* Header & Search */}
      <div className="flex flex-col lg:flex-row gap-6 justify-between items-start lg:items-end">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
            Vehicle Inventory
          </h1>
          <p className="text-muted-foreground mt-2 font-medium">
            {filteredInventory.length} {filteredInventory.length === 1 ? "vehicle" : "vehicles"} available
          </p>
        </div>

        <div className="w-full lg:w-[400px] relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <input
            type="text"
            className="w-full pl-11 pr-4 py-3.5 bg-card/50 border-2 border-white/10 rounded-2xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-300 shadow-inner"
            placeholder="Search by vehicle, VIN, or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Grid */}
      {filteredInventory.length > 0 ? (
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.05 }
            }
          }}
        >
          <AnimatePresence mode="popLayout">
            {filteredInventory.map((item) => (
              <motion.div
                key={item.vin}
                layout
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 }
                }}
                className="group glass-panel rounded-2xl p-6 flex flex-col hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/10 hover:border-primary/30 transition-all duration-300"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5" />
                    {item.location}
                  </div>
                  <div className="px-3 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-sm">
                    {item.price}
                  </div>
                </div>

                <div className="mb-6 flex-1">
                  <h3 className="text-xl font-display font-bold text-foreground leading-tight group-hover:text-primary transition-colors line-clamp-2">
                    {item.vehicle}
                  </h3>
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Car className="w-4 h-4 opacity-50" />
                    <span className="font-mono bg-background/50 px-2 py-0.5 rounded border border-white/5">{item.vin}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-auto pt-4 border-t border-white/5">
                  {item.carfax && item.carfax !== "NOT FOUND" ? (
                    <a
                      href={item.carfax}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-medium text-foreground transition-colors border border-transparent hover:border-white/10"
                    >
                      <FileText className="w-4 h-4" />
                      Carfax
                    </a>
                  ) : (
                    <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-transparent border border-dashed border-white/5 text-sm font-medium text-muted-foreground/50 cursor-not-allowed">
                      <FileText className="w-4 h-4 opacity-50" />
                      No Carfax
                    </div>
                  )}

                  {item.website && item.website !== "NOT FOUND" ? (
                    <a
                      href={item.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-all hover:shadow-lg hover:shadow-primary/25"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Listing
                    </a>
                  ) : (
                    <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-transparent border border-dashed border-white/5 text-sm font-medium text-muted-foreground/50 cursor-not-allowed">
                      <ExternalLink className="w-4 h-4 opacity-50" />
                      No Listing
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-3xl"
        >
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold text-foreground mb-2">No vehicles found</h3>
          <p className="text-muted-foreground max-w-md">
            We couldn't find any vehicles matching "{search}". Try adjusting your search terms.
          </p>
          <button 
            onClick={() => setSearch("")}
            className="mt-6 px-6 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium transition-colors"
          >
            Clear Search
          </button>
        </motion.div>
      )}
    </div>
  );
}
