import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Monitor, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errMsg, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const Row = ({ label, value, testId }) => (
  <div className="flex justify-between gap-4 py-3 border-b border-gray-100 last:border-0"><span className="text-[#5F6368]">{label}</span><span className="font-medium text-right capitalize-first" data-testid={testId}>{value}</span></div>
);

export default function Account() {
  const { user, logout, setUser } = useAuth();
  const nav = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [del, setDel] = useState(false);
  const [confirm, setConfirm] = useState("");
  const load = useCallback(() => api.get("/auth/sessions").then(({ data }) => setSessions(data)), []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => { await api.delete(`/auth/sessions/${id}`); toast.success("Session signed out"); load(); };
  const doLogout = async () => { await logout(); nav("/"); };
  const doDelete = async () => {
    try { await api.post("/auth/delete-account", { confirm }); setUser(null); toast.success("Your account was deleted"); nav("/"); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[#1F94C8] text-white flex items-center justify-center font-display text-2xl font-extrabold overflow-hidden">
          {user?.picture ? <img src={user.picture} alt="" className="w-full h-full object-cover" /> : user?.name?.[0]}
        </div>
        <div><h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight" data-testid="account-name">{user?.name}</h1><p className="text-[#5F6368]" data-testid="account-email">{user?.email}</p></div>
      </div>
      <section className="rounded-2xl border border-gray-100 p-5">
        <h2 className="font-display font-bold mb-2">Profile</h2>
        <Row label="Account type" value={user?.account_type === "business" ? "Business" : "Individual"} testId="account-type" />
        <Row label="Plan" value={user?.plan_id} testId="account-plan" />
        <Row label="Member since" value={fmtDate(user?.created_at)} />
        <Row label="Role" value={user?.role} />
      </section>
      <section className="rounded-2xl border border-gray-100 p-5">
        <h2 className="font-display font-bold mb-3">Signed-in devices</h2>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.session_id} className="flex items-center gap-3 rounded-xl bg-[#F7F7F7] px-4 py-3" data-testid={`session-${s.session_id}`}>
              <Monitor className="w-5 h-5 text-[#5F6368] shrink-0" />
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{s.user_agent || "Unknown device"}</p><p className="text-xs text-[#5F6368]">{s.method === "google" ? "Google" : "Email"} · {fmtDate(s.created_at)}{s.current ? " · this device" : ""}</p></div>
              {!s.current && <Button size="sm" variant="outline" className="rounded-lg" onClick={() => revoke(s.session_id)} data-testid={`revoke-session-${s.session_id}`}>Sign out</Button>}
            </div>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap gap-3">
        <Button onClick={doLogout} variant="outline" className="rounded-xl h-11" data-testid="logout-btn"><LogOut className="w-4 h-4" />Log out</Button>
        {user?.role !== "admin" && <Button onClick={() => setDel(true)} variant="ghost" className="rounded-xl h-11 text-[#D93025]" data-testid="delete-account-btn"><Trash2 className="w-4 h-4" />Delete account</Button>}
      </div>
      <Dialog open={del} onOpenChange={setDel}>
        <DialogContent className="rounded-2xl" data-testid="delete-account-dialog">
          <DialogHeader><DialogTitle>Delete your KuvaNest account?</DialogTitle><DialogDescription>All your files, photos and imports will be permanently removed. Type DELETE to confirm.</DialogDescription></DialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" className="h-11 rounded-xl" data-testid="delete-account-confirm-input" />
          <DialogFooter><Button disabled={confirm !== "DELETE"} onClick={doDelete} className="rounded-xl bg-[#D93025] text-white hover:bg-[#b3261e]" data-testid="delete-account-confirm-btn">Delete forever</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
