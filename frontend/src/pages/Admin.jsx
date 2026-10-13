import { useEffect, useState } from "react";
import { Users, CreditCard, IndianRupee, HardDrive, ArrowLeftRight, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, errMsg, fmtBytes, fmtDate, inr } from "@/lib/api";

const Stat = ({ icon: I, label, value, testId }) => (
  <div className="rounded-2xl border border-gray-100 p-5" data-testid={testId}>
    <I className="w-5 h-5 text-[#1F94C8]" /><p className="font-display text-2xl font-extrabold mt-3">{value}</p><p className="text-sm text-[#5F6368]">{label}</p>
  </div>
);

const Table = ({ head, rows, testId }) => (
  <div className="overflow-x-auto rounded-2xl border border-gray-100" data-testid={testId}>
    <table className="w-full text-sm"><thead className="bg-[#F7F7F7] text-left text-[#5F6368]"><tr>{head.map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-gray-100">{r.map((c, j) => <td key={j} className="px-4 py-3 whitespace-nowrap">{c}</td>)}</tr>)}</tbody></table>
  </div>
);

const PlanEditor = ({ p, onSaved }) => {
  const [v, setV] = useState({ price: p.price, storage_gb: p.storage_gb, active: p.active });
  const save = async (patch = v) => { try { await api.put(`/admin/plans/${p.plan_id}`, patch); toast.success(`${p.name} updated`); onSaved(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-[1fr_120px_120px_auto_auto] items-center gap-3 rounded-xl border border-gray-100 p-4" data-testid={`admin-plan-${p.plan_id}`}>
      <p className="font-semibold col-span-2 sm:col-span-1">{p.name}</p>
      <label className="text-xs text-[#5F6368]">₹/mo<Input type="number" value={v.price} onChange={(e) => setV({ ...v, price: Number(e.target.value) })} className="h-10 rounded-lg mt-1" data-testid={`admin-plan-price-${p.plan_id}`} /></label>
      <label className="text-xs text-[#5F6368]">GB<Input type="number" value={v.storage_gb} onChange={(e) => setV({ ...v, storage_gb: Number(e.target.value) })} className="h-10 rounded-lg mt-1" data-testid={`admin-plan-storage-${p.plan_id}`} /></label>
      <label className="flex items-center gap-2 text-sm"><Switch checked={v.active} onCheckedChange={(a) => setV({ ...v, active: a })} data-testid={`admin-plan-active-${p.plan_id}`} />Active</label>
      <Button size="sm" className="rounded-lg" onClick={() => save()} data-testid={`admin-plan-save-${p.plan_id}`}>Save</Button>
    </div>
  );
};

export default function Admin() {
  const [s, setS] = useState(null);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState([]);
  const [plans, setPlans] = useState({ plans: [] });
  const [pays, setPays] = useState([]);
  const [logs, setLogs] = useState([]);
  const [gst, setGst] = useState(18);

  const loadPlans = () => api.get("/admin/plans").then(({ data }) => { setPlans(data); setGst(data.gst_percent); });
  const loadUsers = () => api.get("/admin/users", { params: { q } }).then(({ data }) => setUsers(data));
  useEffect(() => {
    api.get("/admin/stats").then(({ data }) => setS(data));
    api.get("/admin/migrations").then(({ data }) => setJobs(data));
    api.get("/admin/payments").then(({ data }) => setPays(data));
    api.get("/admin/audit").then(({ data }) => setLogs(data));
    loadPlans();
  }, []);
  useEffect(() => { const t = setTimeout(loadUsers, 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchUser = async (id, body) => { try { await api.patch(`/admin/users/${id}`, body); toast.success("User updated"); loadUsers(); } catch (e) { toast.error(errMsg(e)); } };
  const saveGst = async () => { try { await api.put("/admin/gst", { gst_percent: Number(gst) }); toast.success("GST updated"); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">Admin</h1>
      {s && <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat icon={Users} label="Registered users" value={s.users} testId="admin-stat-users" />
        <Stat icon={CreditCard} label="Active subscriptions" value={s.active_subscriptions} testId="admin-stat-subs" />
        <Stat icon={IndianRupee} label="Monthly recurring revenue" value={inr(s.mrr)} testId="admin-stat-mrr" />
        <Stat icon={HardDrive} label={`Storage · ${s.files} files`} value={fmtBytes(s.storage_bytes)} testId="admin-stat-storage" />
        <Stat icon={s.migrations_failed ? AlertTriangle : ArrowLeftRight} label={`Migrations running · ${s.migrations_failed} failed`} value={s.migrations_running} testId="admin-stat-migrations" />
      </div>}
      <Tabs defaultValue="users">
        <TabsList className="h-11 rounded-xl bg-[#F7F7F7] p-1 flex-wrap h-auto">
          {["users", "migrations", "plans", "payments", "audit"].map((t) => <TabsTrigger key={t} value={t} className="rounded-lg h-9 capitalize" data-testid={`admin-tab-${t}`}>{t}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="users" className="space-y-4 mt-5">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users by name or email" className="h-11 rounded-xl max-w-md" data-testid="admin-users-search" />
          <Table testId="admin-users-table" head={["Name", "Email", "Type", "Plan", "Used", "Role", "Status", ""]} rows={users.map((u) => [u.name, u.email, u.account_type, u.plan_id, fmtBytes(u.used), u.role, u.status,
            u.role === "admin" ? "" : <Button size="sm" variant="outline" className="rounded-lg" data-testid={`admin-toggle-status-${u.user_id}`} onClick={() => patchUser(u.user_id, { status: u.status === "active" ? "suspended" : "active" })}>{u.status === "active" ? "Suspend" : "Activate"}</Button>])} />
        </TabsContent>
        <TabsContent value="migrations" className="mt-5">
          <Table testId="admin-migrations-table" head={["User", "Source", "Archive", "Status", "Files", "Imported", "Failed", "Created"]} rows={jobs.map((j) => [j.email, j.source_label, j.archive_name, j.status, j.total_files, j.imported, j.failed, fmtDate(j.created_at)])} />
        </TabsContent>
        <TabsContent value="plans" className="space-y-3 mt-5">
          <div className="flex items-end gap-3 rounded-xl bg-[#E8F4FA] p-4"><label className="text-sm font-semibold">GST %<Input type="number" value={gst} onChange={(e) => setGst(e.target.value)} className="h-10 w-28 rounded-lg mt-1 bg-white" data-testid="admin-gst-input" /></label><Button onClick={saveGst} className="rounded-lg" data-testid="admin-gst-save">Save GST</Button></div>
          {plans.plans.map((p) => <PlanEditor key={p.plan_id} p={p} onSaved={loadPlans} />)}
        </TabsContent>
        <TabsContent value="payments" className="mt-5">
          <Table testId="admin-payments-table" head={["Invoice", "User", "Plan", "Total", "Method", "Provider", "Date"]} rows={pays.map((p) => [p.invoice_no, p.user_id, p.plan_name, inr(p.total), p.method, p.provider, fmtDate(p.created_at)])} />
        </TabsContent>
        <TabsContent value="audit" className="mt-5">
          <Table testId="admin-audit-table" head={["When", "User", "Action", "Detail"]} rows={logs.map((l) => [new Date(l.created_at).toLocaleString("en-IN"), l.user_id, l.action, JSON.stringify(l.detail).slice(0, 80)])} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
