import { ShieldAlert, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { useGetMe } from "@workspace/api-client-react";

export default function AccessDenied() {
  const { data: user } = useGetMe({ query: { retry: false } });

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-lg text-center"
      >
        <div className="glass-panel p-10 rounded-3xl border-destructive/20 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-destructive/50 to-destructive" />
          
          <div className="w-20 h-20 mx-auto bg-destructive/10 rounded-full flex items-center justify-center mb-6 ring-8 ring-destructive/5">
            <ShieldAlert className="w-10 h-10 text-destructive" />
          </div>
          
          <h1 className="text-3xl font-display font-bold text-foreground mb-4">Access Denied</h1>
          
          <p className="text-muted-foreground text-lg mb-6">
            You do not have permission to view the inventory portal.
          </p>

          {user && (
            <div className="bg-background/50 rounded-xl p-4 mb-8 border border-white/5 inline-block mx-auto">
              <p className="text-sm text-muted-foreground mb-1">Signed in as</p>
              <p className="font-mono font-medium text-foreground">{user.email}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a 
              href="/api/auth/logout"
              className="inline-flex items-center justify-center px-6 py-3 font-semibold text-white bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all"
            >
              Sign out and try another account
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
