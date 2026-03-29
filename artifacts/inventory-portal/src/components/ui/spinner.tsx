import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2>) {
  return (
    <Loader2 className={cn("animate-spin text-primary", className)} {...props} />
  );
}

export function FullScreenSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="h-10 w-10" />
        <p className="text-sm text-muted-foreground font-medium animate-pulse">Loading workspace...</p>
      </div>
    </div>
  );
}
