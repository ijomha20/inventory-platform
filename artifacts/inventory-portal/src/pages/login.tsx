import { Car, Lock } from "lucide-react";
import { motion } from "framer-motion";

export default function Login() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        <div className="glass-panel p-8 md:p-10 rounded-3xl relative overflow-hidden">
          {/* Decorative gradients */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-accent/20 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center shadow-xl shadow-primary/25 mb-6">
              <Car className="w-8 h-8 text-white" />
            </div>
            
            <h1 className="text-3xl font-display font-bold text-foreground mb-2">Welcome Back</h1>
            <p className="text-muted-foreground mb-8">
              Sign in to access the secure inventory portal. Access is restricted to authorized personnel only.
            </p>

            <a 
              href="/api/auth/google"
              className="group relative inline-flex items-center justify-center w-full px-8 py-4 font-semibold text-white transition-all duration-200 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 hover:shadow-lg hover:-translate-y-0.5 overflow-hidden"
            >
              <div className="absolute inset-0 w-full h-full -ml-full bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:animate-shimmer" />
              <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </a>

            <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Lock className="w-3 h-3" />
              <span>Secure authentication via Google</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
