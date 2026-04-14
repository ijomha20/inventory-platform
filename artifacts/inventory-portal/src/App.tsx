import React from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe } from "@workspace/api-client-react";

import { Layout } from "@/components/layout";
import { FullScreenSpinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import AccessDenied from "@/pages/denied";
import Inventory from "@/pages/inventory";
import Admin from "@/pages/admin";
import LenderCalculator from "@/pages/lender-calculator";

const queryClient = new QueryClient();

// Auth Guard component to protect routes
function RequireAuth({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { isLoading, error } = useGetMe({ query: { retry: false } });

  React.useEffect(() => {
    if (!error) return;
    const status = (error as any)?.response?.status;
    if (status === 401) setLocation("/login");
    else if (status === 403) setLocation("/denied");
  }, [error, setLocation]);

  if (isLoading) return <FullScreenSpinner />;
  if (error)     return null;

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/denied" component={AccessDenied} />
      
      {/* Protected Routes */}
      <Route path="/">
        <RequireAuth>
          <Layout>
            <Inventory />
          </Layout>
        </RequireAuth>
      </Route>
      
      <Route path="/admin">
        <RequireAuth>
          <Layout>
            <Admin />
          </Layout>
        </RequireAuth>
      </Route>

      <Route path="/calculator">
        <RequireAuth>
          <Layout>
            <LenderCalculator />
          </Layout>
        </RequireAuth>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
