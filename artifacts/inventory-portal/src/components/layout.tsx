import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Car, LogOut, ShieldAlert, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user } = useGetMe({
    query: {
      retry: false,
    }
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 w-full glass-panel border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
                <Car className="w-4 h-4 text-white" />
              </div>
              <Link href="/" className="font-display font-bold text-xl text-foreground hover:text-primary transition-colors">
                InventoryPortal
              </Link>
            </div>

            {user && (
              <div className="flex items-center gap-4 md:gap-6">
                
                {user.isOwner && (
                  <Link 
                    href="/admin" 
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
                  >
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline">Manage Access</span>
                  </Link>
                )}

                <div className="h-6 w-px bg-border hidden sm:block" />

                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-sm font-semibold text-foreground leading-none">{user.name}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">{user.email}</span>
                  </div>
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full ring-2 ring-border/50" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center border border-border">
                      <span className="text-xs font-bold">{user.name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  
                  <a 
                    href="/api/auth/logout"
                    className="ml-2 p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </a>
                </div>

              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
