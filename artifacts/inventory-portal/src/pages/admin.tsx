import { useState } from "react";
import { 
  useGetAccessList, 
  useAddAccessEntry, 
  useRemoveAccessEntry,
  getGetAccessListQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { Trash2, Plus, Shield, Mail, Calendar, User as UserIcon, Loader2 } from "lucide-react";
import { FullScreenSpinner } from "@/components/ui/spinner";
import { useLocation } from "wouter";

export default function Admin() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [newEmail, setNewEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const { data: accessList, isLoading, error } = useGetAccessList({
    query: { retry: false }
  });

  const addMutation = useAddAccessEntry();
  const removeMutation = useRemoveAccessEntry();

  // Protect route
  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401 || status === 403) {
      setLocation("/");
      return null;
    }
  }

  if (isLoading) return <FullScreenSpinner />;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    setErrorMsg("");
    
    addMutation.mutate({ data: { email: newEmail.toLowerCase().trim() } }, {
      onSuccess: () => {
        setNewEmail("");
        queryClient.invalidateQueries({ queryKey: getGetAccessListQueryKey() });
      },
      onError: (err: any) => {
        setErrorMsg(err.response?.data?.error || "Failed to add email.");
      }
    });
  };

  const handleRemove = (email: string) => {
    if (confirm(`Are you sure you want to remove access for ${email}?`)) {
      removeMutation.mutate({ email }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAccessListQueryKey() });
        }
      });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      
      <div>
        <h1 className="text-3xl font-display font-bold flex items-center gap-3">
          <Shield className="w-8 h-8 text-primary" />
          Access Management
        </h1>
        <p className="text-muted-foreground mt-2">
          Control which Google accounts can view the inventory portal.
        </p>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="glass-panel p-6 rounded-2xl"
      >
        <h2 className="text-lg font-semibold mb-4">Grant Access</h2>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Mail className="h-4 w-4 text-muted-foreground" />
            </div>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Enter Google email address"
              className="w-full pl-11 pr-4 py-3 bg-background border-2 border-white/10 rounded-xl focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
              disabled={addMutation.isPending}
            />
          </div>
          <button
            type="submit"
            disabled={addMutation.isPending || !newEmail}
            className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {addMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            Add User
          </button>
        </form>
        {errorMsg && <p className="text-destructive text-sm mt-3 font-medium">{errorMsg}</p>}
      </motion.div>

      <motion.div 
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="glass-panel rounded-2xl overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-white/5 text-muted-foreground uppercase tracking-wider text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">User Email</th>
                <th className="px-6 py-4">Added Date</th>
                <th className="px-6 py-4">Added By</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {accessList?.map((entry) => (
                <tr key={entry.email} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4 font-medium text-foreground flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-xs">
                      {entry.email.charAt(0).toUpperCase()}
                    </div>
                    {entry.email}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5" />
                      {format(new Date(entry.addedAt), "MMM d, yyyy")}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-3.5 h-3.5" />
                      {entry.addedBy}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleRemove(entry.email)}
                      disabled={removeMutation.isPending && removeMutation.variables?.email === entry.email}
                      className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors inline-flex items-center"
                      title="Remove Access"
                    >
                      {removeMutation.isPending && removeMutation.variables?.email === entry.email ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
              {(!accessList || accessList.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                    No approved users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

    </div>
  );
}
