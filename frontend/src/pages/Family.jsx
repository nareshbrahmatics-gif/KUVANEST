import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { UserPlus, Users, Trash2, Check, X, FolderOpen, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderIcon } from "@/components/Brand";
import { api, errMsg, fmtDate } from "@/lib/api";

const AccessSelect = ({ value, onChange, testId }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="w-32 h-10 rounded-lg" data-testid={testId}><SelectValue /></SelectTrigger>
    <SelectContent className="bg-white"><SelectItem value="editor">Can edit</SelectItem><SelectItem value="viewer">View only</SelectItem></SelectContent>
  </Select>
);

const InviteForm = ({ onDone }) => {
  const [email, setEmail] = useState("");
  const [access, setAccess] = useState("editor");
  const send = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/family/invite", { email, access });
      data.email_sent ? toast.success(`Invitation emailed to ${email}`) : toast.warning(`Invited ${email}, but the email could not be sent. Use Resend later.`);
      setEmail(""); onDone();
    }
    catch (err) { toast.error(errMsg(err)); }
  };
  return (
    <form onSubmit={send} className="flex flex-wrap gap-2">
      <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="family@example.com" className="h-11 rounded-xl flex-1 min-w-[220px]" data-testid="family-invite-email" />
      <AccessSelect value={access} onChange={setAccess} testId="family-invite-access" />
      <Button type="submit" className="h-11 rounded-xl font-semibold" data-testid="family-invite-btn"><UserPlus className="w-4 h-4" />Invite</Button>
    </form>
  );
};

export default function Family() {
  const [d, setD] = useState(null);
  const [params, setParams] = useSearchParams();
  const load = useCallback(() => api.get("/family").then(({ data }) => setD(data)), []);
  useEffect(() => {
    const join = params.get("join");
    if (!join) { load(); return; }
    setParams({}, { replace: true });
    api.post(`/family/invitations/${join}/accept`)
      .then(() => toast.success("You joined the family"))
      .catch(() => toast.error("This invitation is for a different email or was already used"))
      .finally(load);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); load(); } catch (e) { toast.error(errMsg(e)); } };
  if (!d) return null;
  const canInvite = d.seats_total > 0;

  return (
    <div className="space-y-10 max-w-4xl">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">Family Sharing</h1>
        <p className="text-[#5F6368] mt-2">Everyone keeps their own private folders. Only the <b>Family Files</b> folder is shared, and it uses the owner's storage.</p>
      </div>

      {!!d.invitations.length && <section className="space-y-2">
        <h2 className="font-display font-bold text-lg">Invitations for you</h2>
        {d.invitations.map((m) => (
          <div key={m.member_id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#1F94C8] bg-[#E8F4FA] p-4" data-testid={`family-invitation-${m.member_id}`}>
            <Users className="w-5 h-5 text-[#1F94C8]" /><p className="flex-1 min-w-[200px]"><b>{m.owner_name}</b> invited you to their family ({m.access === "editor" ? "can edit" : "view only"})</p>
            <Button size="sm" className="rounded-lg" onClick={() => act(() => api.post(`/family/invitations/${m.member_id}/accept`), "You joined the family")} data-testid={`family-accept-${m.member_id}`}><Check className="w-4 h-4" />Accept</Button>
            <Button size="sm" variant="outline" className="rounded-lg" onClick={() => act(() => api.post(`/family/invitations/${m.member_id}/decline`), "Invitation declined")} data-testid={`family-decline-${m.member_id}`}><X className="w-4 h-4" />Decline</Button>
          </div>
        ))}
      </section>}

      <section className="rounded-2xl border border-gray-100 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4"><FolderIcon className="w-14 h-12"><Users className="w-4 h-4" /></FolderIcon>
            <div><p className="font-display font-bold text-lg">My family</p><p className="text-sm text-[#5F6368]" data-testid="family-seats">{canInvite ? `${d.seats_used} of ${d.seats_total} member seats used · ${d.plan.name} plan` : `${d.plan.name} plan — no member seats`}</p></div></div>
          <Link to={`/files/${d.family_folder_id}`} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-semibold bg-[#FEF9E7] border border-[#F3E2B4]" data-testid="family-open-own-folder"><FolderOpen className="w-4 h-4" />Open Family Files</Link>
        </div>
        {canInvite ? <InviteForm onDone={load} /> : (
          <div className="rounded-xl bg-[#E8F4FA] p-4 text-sm flex flex-wrap items-center justify-between gap-3">Upgrade to Family (5 members) or Business (25 members) to invite people.
            <Link to="/plans" className="font-semibold text-[#156E96]" data-testid="family-upgrade-link">See plans</Link></div>
        )}
        <div className="divide-y divide-gray-100">
          {d.members.map((m) => (
            <div key={m.member_id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`family-member-${m.member_id}`}>
              <div className="w-10 h-10 rounded-full bg-[#1F94C8] text-white flex items-center justify-center font-bold uppercase">{m.email[0]}</div>
              <div className="flex-1 min-w-[180px]"><p className="font-medium">{m.email}</p><p className="text-xs text-[#5F6368] capitalize">{m.status} · invited {fmtDate(m.invited_at)}</p></div>
              {m.status === "pending" && <Button size="sm" variant="outline" className="rounded-lg" data-testid={`family-resend-${m.member_id}`} onClick={() => act(() => api.post(`/family/members/${m.member_id}/resend`), "Invitation email sent again")}><Mail className="w-4 h-4" />Resend</Button>}
              <AccessSelect value={m.access} testId={`family-member-access-${m.member_id}`} onChange={(a) => act(() => api.patch(`/family/members/${m.member_id}`, { access: a }), "Access updated")} />
              <Button size="sm" variant="ghost" className="text-[#D93025] rounded-lg" aria-label="Remove member" data-testid={`family-remove-${m.member_id}`} onClick={() => act(() => api.delete(`/family/members/${m.member_id}`), "Member removed")}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>
      </section>

      {!!d.memberships.length && <section className="space-y-3">
        <h2 className="font-display font-bold text-lg">Families I belong to</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {d.memberships.map((m) => (
            <div key={m.member_id} className="kn-card rounded-2xl bg-[#FEF9E7] border border-[#F3E2B4] p-5 space-y-3" data-testid={`family-membership-${m.member_id}`}>
              <FolderIcon className="w-14 h-12"><Users className="w-4 h-4" /></FolderIcon>
              <div><p className="font-display font-bold">{m.owner_name}'s Family Files</p><p className="text-sm text-[#5F6368]">{m.access === "editor" ? "You can add and remove files" : "View only"}</p></div>
              <div className="flex gap-2">
                <Link to={`/family/${m.owner_id}`} className="inline-flex items-center h-10 px-4 rounded-xl bg-[#1F94C8] text-white text-sm font-semibold" data-testid={`family-open-shared-${m.member_id}`}>Open</Link>
                <Button variant="ghost" className="rounded-xl text-[#D93025]" data-testid={`family-leave-${m.member_id}`} onClick={() => act(() => api.delete(`/family/members/${m.member_id}`), "You left the family")}>Leave</Button>
              </div>
            </div>
          ))}
        </div>
      </section>}
    </div>
  );
}
