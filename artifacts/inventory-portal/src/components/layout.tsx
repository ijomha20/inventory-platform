import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Car, LogOut, Settings, Calculator } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user } = useGetMe({ query: { retry: false } });

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-40 w-full bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">

            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <Car className="w-4 h-4 text-white" />
              </div>
              <Link href="/" className="font-semibold text-gray-900 hover:text-blue-600 transition-colors text-base">
                Inventory Portal
              </Link>
            </div>

            {user && (
              <div className="flex items-center gap-3">
                {(user.isOwner || user.role === "viewer") && (
                  <Link
                    href="/calculator"
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
                  >
                    <Calculator className="w-4 h-4" />
                    <span className="hidden sm:inline">Inventory Selector</span>
                  </Link>
                )}
                {user.isOwner && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
                  >
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline">Manage Access</span>
                  </Link>
                )}

                <div className="h-5 w-px bg-gray-200 hidden sm:block" />

                <div className="flex items-center gap-2.5">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-sm font-medium text-gray-800 leading-none">{user.name}</span>
                    <span className="text-xs text-gray-400 mt-0.5">{user.email}</span>
                  </div>
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-600">{user.name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <a
                    href="/api/auth/logout"
                    title="Sign Out"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
