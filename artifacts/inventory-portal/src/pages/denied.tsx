import { ShieldAlert } from "lucide-react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

export default function AccessDenied() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-5">
          <ShieldAlert className="w-6 h-6 text-red-500" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-sm text-gray-500 mb-5">
          You don't have permission to view this portal. Contact the owner to request access.
        </p>

        {user && (
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 text-left">
            <p className="text-xs text-gray-400 mb-0.5">Signed in as</p>
            <p className="text-sm font-medium text-gray-800">{user.email}</p>
          </div>
        )}

        <a
          href="/api/auth/logout"
          className="w-full inline-flex items-center justify-center px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          Sign out and try another account
        </a>
      </div>
    </div>
  );
}
