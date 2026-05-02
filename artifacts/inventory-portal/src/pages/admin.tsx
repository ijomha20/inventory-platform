/**
 * Admin Page (route: /admin)
 *
 * Owner-only user management panel. Tabs: Users (add/remove/role-change) and
 * Audit Log (read-only history). All mutations are guarded by requireOwner on
 * the server — any non-owner who reaches this URL will receive 403 from the API.
 */
import { useEffect, useState } from "react";
import {
  useGetAccessList,
  useAddAccessEntry,
  useRemoveAccessEntry,
  useUpdateAccessRole,
  useGetAuditLog,
  getGetAccessListQueryKey,
  getGetAuditLogQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Trash2, Plus, Shield, Mail, Calendar, User as UserIcon,
  Loader2, ClipboardList, Eye, UserCheck, ChevronDown,
} from "lucide-react";
import { FullScreenSpinner } from "@/components/ui/spinner";
import { useLocation } from "wouter";

type Tab = "users" | "audit" | "operations";

const ROLE_LABELS: Record<string, string> = {
  viewer: "Viewer",
  guest:  "Guest",
  owner:  "Owner",
};

const ROLE_COLORS: Record<string, string> = {
  viewer: "bg-blue-50 text-blue-700 border-blue-200",
  guest:  "bg-gray-50 text-gray-600 border-gray-200",
  owner:  "bg-purple-50 text-purple-700 border-purple-200",
};

function RoleSelector({ email, currentRole, onUpdate }: {
  email: string;
  currentRole: string;
  onUpdate: (role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = ["viewer", "guest"];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${ROLE_COLORS[currentRole] ?? ROLE_COLORS.viewer}`}>
        {ROLE_LABELS[currentRole] ?? currentRole}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-20 w-28 bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden">
            {options.map((role) => (
              <button key={role}
                onClick={() => { setOpen(false); if (role !== currentRole) onUpdate(role); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors font-medium ${role === currentRole ? "text-blue-600 bg-blue-50" : "text-gray-700"}`}>
                {ROLE_LABELS[role]}
                {role === "viewer" && <p className="text-gray-400 font-normal text-xs">Full access</p>}
                {role === "guest"  && <p className="text-gray-400 font-normal text-xs">Price hidden</p>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  add:         "Added",
  remove:      "Removed",
  role_change: "Role changed",
};

const ACTION_COLORS: Record<string, string> = {
  add:         "bg-green-100 text-green-700",
  remove:      "bg-red-100 text-red-700",
  role_change: "bg-blue-100 text-blue-700",
};

export default function Admin() {
  const queryClient    = useQueryClient();
  const [, setLocation] = useLocation();
  const [newEmail, setNewEmail] = useState("");
  const [newRole,  setNewRole]  = useState<"viewer" | "guest">("viewer");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [opsData, setOpsData] = useState<any>(null);
  const [opsError, setOpsError] = useState<string>("");

  const { data: accessList, isLoading, error } = useGetAccessList({
    query: { queryKey: getGetAccessListQueryKey(), retry: false },
  });
  const { data: auditLog,   isLoading: auditLoading } = useGetAuditLog({
    query: {
      queryKey: getGetAuditLogQueryKey(),
      enabled: activeTab === "audit",
      retry: false,
    },
  });

  const addMutation        = useAddAccessEntry();
  const removeMutation     = useRemoveAccessEntry();
  const updateRoleMutation = useUpdateAccessRole();

  if (error) {
    const status = (error as any)?.status;
    if (status === 401 || status === 403) { setLocation("/"); return null; }
  }

  if (isLoading) return <FullScreenSpinner />;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetAccessListQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAuditLogQueryKey() });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.includes("@")) { setErrorMsg("Please enter a valid email address."); return; }
    setErrorMsg("");
    addMutation.mutate(
      { data: { email: newEmail.toLowerCase().trim(), role: newRole } },
      { onSuccess: () => { setNewEmail(""); invalidateAll(); }, onError: (err: any) => setErrorMsg(err.data?.error || "Failed to add user.") }
    );
  };

  const handleRemove = (email: string) => {
    if (!confirm(`Remove access for ${email}?`)) return;
    removeMutation.mutate({ email }, { onSuccess: invalidateAll });
  };

  const handleRoleChange = (email: string, role: string) => {
    updateRoleMutation.mutate(
      { email, data: { role } },
      { onSuccess: invalidateAll }
    );
  };

  useEffect(() => {
    if (activeTab !== "operations") return;
    let cancelled = false;
    async function loadOps() {
      setOpsError("");
      try {
        // Raw fetch: /ops endpoints are operational diagnostics and are not part of the generated OpenAPI hooks.
        const [functionStatus, incidents, deps] = await Promise.all([
          fetch("/api/ops/function-status", { credentials: "include", cache: "no-store" }).then((r) => r.json()),
          fetch("/api/ops/incidents?limit=20", { credentials: "include", cache: "no-store" }).then((r) => r.json()),
          fetch("/api/ops/dependencies", { credentials: "include", cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!cancelled) setOpsData({ functionStatus, incidents, deps });
      } catch (err) {
        if (!cancelled) setOpsError(String(err));
      }
    }
    loadOps();
    return () => { cancelled = true; };
  }, [activeTab]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      <div>
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-600" />
          Access Management
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Control which Google accounts can view the inventory portal.</p>
      </div>

      {/* Add user form */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Grant Access</h2>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Enter Google email address"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
              disabled={addMutation.isPending}
            />
          </div>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "viewer" | "guest")}
            className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
            disabled={addMutation.isPending}>
            <option value="viewer">Viewer — full access</option>
            <option value="guest">Guest — price hidden</option>
          </select>
          <button type="submit"
            disabled={addMutation.isPending || !newEmail}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add User
          </button>
        </form>
        {errorMsg && <p className="text-red-500 text-xs mt-2 font-medium">{errorMsg}</p>}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          {([
            { id: "users" as Tab, label: "Users",     icon: <UserCheck className="w-4 h-4" /> },
            { id: "audit" as Tab, label: "Audit Log",  icon: <ClipboardList className="w-4 h-4" /> },
            { id: "operations" as Tab, label: "Operations", icon: <Shield className="w-4 h-4" /> },
          ] as const).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Users tab */}
        {activeTab === "users" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Added</th>
                  <th className="px-5 py-3">Added By</th>
                  <th className="px-5 py-3 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accessList?.map((entry) => (
                  <tr key={entry.email} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                          {entry.email.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-800">{entry.email}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <RoleSelector
                        email={entry.email}
                        currentRole={entry.role}
                        onUpdate={(role) => handleRoleChange(entry.email, role)}
                      />
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(entry.addedAt), "MMM d, yyyy")}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <UserIcon className="w-3.5 h-3.5" />
                        {entry.addedBy}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleRemove(entry.email)}
                        disabled={removeMutation.isPending && (removeMutation.variables as any)?.email === entry.email}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center"
                        title="Remove Access">
                        {removeMutation.isPending && (removeMutation.variables as any)?.email === entry.email
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
                {(!accessList || accessList.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                      No approved users yet. Add one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Audit log tab */}
        {activeTab === "audit" && (
          <div className="overflow-x-auto">
            {auditLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3">When</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Change</th>
                    <th className="px-5 py-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLog?.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {format(new Date(entry.timestamp), "MMM d, yyyy HH:mm")}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[entry.action] ?? "bg-gray-100 text-gray-600"}`}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-800 text-xs">{entry.targetEmail}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {entry.action === "role_change"
                          ? <span>{ROLE_LABELS[entry.roleFrom ?? ""] ?? entry.roleFrom} &rarr; {ROLE_LABELS[entry.roleTo ?? ""] ?? entry.roleTo}</span>
                          : entry.action === "add" && entry.roleTo
                            ? <span>as {ROLE_LABELS[entry.roleTo] ?? entry.roleTo}</span>
                            : "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{entry.changedBy}</td>
                    </tr>
                  ))}
                  {(!auditLog || auditLog.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                        No audit log entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "operations" && (
          <div className="p-5 space-y-4">
            {opsError && <div className="text-xs text-red-600">{opsError}</div>}
            {!opsData && !opsError && <div className="text-xs text-gray-500">Loading operations data...</div>}
            {opsData && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="border rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-700">Gate Health</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Last check: {opsData?.deps?.checkedAt ? format(new Date(opsData.deps.checkedAt), "MMM d, yyyy HH:mm") : "N/A"}
                    </p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-700">Quarterly DR drill</p>
                    <p className="text-xs text-gray-500 mt-1">Run `pnpm --filter @workspace/scripts dr-drill` and acknowledge.</p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-700">Allow-list audit</p>
                    <p className="text-xs text-gray-500 mt-1">Audit due every 90 days.</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Recent incidents</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-3 py-2">When</th>
                          <th className="px-3 py-2">Subsystem</th>
                          <th className="px-3 py-2">Reason</th>
                          <th className="px-3 py-2">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(opsData?.incidents?.incidents ?? []).map((row: any) => (
                          <tr key={row.id}>
                            <td className="px-3 py-2">{row.createdAt ? format(new Date(row.createdAt), "MMM d HH:mm") : "—"}</td>
                            <td className="px-3 py-2">{row.subsystem}</td>
                            <td className="px-3 py-2">{row.reason}</td>
                            <td className="px-3 py-2 text-gray-600">{row.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Role legend */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Role Permissions</p>
        <div className="grid grid-cols-2 gap-1.5 text-xs text-blue-800">
          <div><span className="font-medium">Viewer</span> — sees all data including Your Cost</div>
          <div><span className="font-medium">Guest</span> — sees vehicle info but Your Cost is hidden</div>
        </div>
      </div>

    </div>
  );
}
