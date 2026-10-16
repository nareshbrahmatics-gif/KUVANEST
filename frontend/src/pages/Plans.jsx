import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, AlertTriangle, QrCode, CreditCard } from "lucide-react";
import { UpiQr } from "@/components/UpiQr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errMsg, fmtDate, inr } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const gb = (g) => (g >= 1024 ? `${g / 1024} TB` : `${g} GB`);

export const PlanCard = ({ p, current, onPick, cta = "Choose plan" }) => (
  <div className={`kn-card rounded-2xl border p-6 flex flex-col ${p.plan_id === "family" ? "border-[#1F94C8] bg-[#E8F4FA]" : "border-gray-200 bg-white"}`} data-testid={`plan-card-${p.plan_id}`}>
    <div className="flex items-center justify-between"><p className="font-display font-bold text-lg">{p.name}</p>{p.plan_id === "family" && <span className="text-[10px] font-bold uppercase tracking-widest bg-[#1F94C8] text-white px-2 py-1 rounded-full">Popular</span>}</div>
    <p className="mt-3"><span className="font-display text-4xl font-extrabold">{inr(p.price)}</span><span className="text-[#5F6368]">/mo</span></p>
    <p className="font-semibold text-[#156E96] mt-1">{gb(p.storage_gb)}{p.members > 1 ? ` · ${p.members} members` : ""}</p>
    <ul className="mt-5 space-y-2 text-sm flex-1">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-[#1E8E3E] shrink-0 mt-0.5" />{f}</li>)}</ul>
    {onPick && <Button disabled={current} onClick={() => onPick(p)} data-testid={`plan-select-${p.plan_id}`} variant={current ? "outline" : "default"} className="mt-6 h-11 rounded-xl font-semibold">{current ? "Current plan" : cta}</Button>}
  </div>
);

const loadRazorpay = () => new Promise((resolve) => {
  if (window.Razorpay) return resolve(true);
  const sc = document.createElement("script");
  sc.src = "https://checkout.razorpay.com/v1/checkout.js";
  sc.onload = () => resolve(true);
  sc.onerror = () => resolve(false);
  document.body.appendChild(sc);
});

export default function Plans() {
  const { refresh } = useAuth();
  const [plans, setPlans] = useState([]);
  const [b, setB] = useState(null);
  const [aud, setAud] = useState("individual");
  const [pick, setPick] = useState(null);
  const [method, setMethod] = useState("upi");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [p, bl] = await Promise.all([api.get("/plans"), api.get("/billing")]);
    setPlans(p.data); setB(bl.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const done = async () => { toast.success(`You're now on ${pick.name}`); setPick(null); await load(); refresh(); };
  const payRazorpay = async () => {
    const ok = await loadRazorpay();
    if (!ok) throw new Error("Could not load Razorpay. Check your connection.");
    const { data: o } = await api.post("/billing/order", { plan_id: pick.plan_id });
    await new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency, name: "KuvaNest",
        description: `${o.plan_name} plan (monthly)`, image: `${window.location.origin}/favicon.png`,
        prefill: { name: o.name, email: o.email }, theme: { color: "#1F94C8" },
        handler: (res) => api.post("/billing/verify", res).then(resolve).catch(reject),
        modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rzp.on("payment.failed", (r) => reject(new Error(r.error?.description || "Payment failed")));
      rzp.open();
    });
  };
  const pay = async () => {
    setBusy(true);
    try {
      if (live && pick.price > 0) await payRazorpay();
      else await api.post("/billing/subscribe", { plan_id: pick.plan_id, method });
      await done();
    } catch (e) { toast.error(e.response ? errMsg(e) : e.message); } finally { setBusy(false); }
  };
  const cancel = async () => { try { await api.post("/billing/cancel"); toast.success("Auto-renewal cancelled"); load(); } catch (e) { toast.error(errMsg(e)); } };
  const live = b?.payment_mode === "razorpay";
  const tax = pick ? Math.round(pick.price * (b?.gst_percent || 0)) / 100 : 0;
  const shown = plans.filter((p) => (aud === "business" ? p.audience === "business" : p.audience !== "business" && p.price > 0));

  return (
    <div className="space-y-10">
      {b && !live && <div className="rounded-xl bg-[#E8F4FA] border border-[#BFE0F1] px-4 py-3 text-sm flex items-center gap-2" data-testid="mock-payment-banner"><AlertTriangle className="w-4 h-4 text-[#1F94C8]" />Test mode: Razorpay keys are not added yet, so payments are simulated (MOCKED). No money is charged.</div>}
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">Plans & Billing</h1>
        {b && <div className="mt-5 rounded-2xl bg-[#202124] text-white p-6 flex flex-wrap items-center justify-between gap-4" data-testid="current-plan-card">
          <div><p className="text-xs uppercase tracking-[0.2em] text-[#7CCBEF] font-bold">Current plan</p><p className="font-display text-2xl font-extrabold mt-1">{b.plan.name} · {gb(b.plan.storage_gb)}</p>
            <p className="text-white/70 text-sm">{b.plan.price ? `${inr(b.plan.price)}/mo · ${b.cancel_at_period_end ? "ends" : "renews"} ${fmtDate(b.renewal_date)}` : "Free forever"}</p></div>
          {b.plan.price > 0 && !b.cancel_at_period_end && <Button variant="outline" onClick={cancel} className="rounded-xl bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white" data-testid="cancel-renewal-btn">Cancel renewal</Button>}
        </div>}
      </div>
      <div>
        <div className="inline-flex rounded-xl bg-[#F7F7F7] p-1 mb-5">
          {[["individual", "Individuals & Families"], ["business", "Business"]].map(([v, l]) => (
            <button key={v} onClick={() => setAud(v)} data-testid={`plans-audience-${v}`} className={`px-4 h-10 rounded-lg text-sm font-semibold ${aud === v ? "bg-white shadow-sm" : "text-[#5F6368]"}`}>{l}</button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{shown.map((p) => <PlanCard key={p.plan_id} p={p} current={b?.plan.plan_id === p.plan_id} onPick={setPick} cta={b && p.price > b.plan.price ? "Upgrade" : "Switch"} />)}</div>
        <p className="text-xs text-[#5F6368] mt-3">Prices exclude {b?.gst_percent ?? 18}% GST.</p>
      </div>
      <section>
        <h2 className="font-display text-lg font-bold mb-4">Invoice history</h2>
        {b?.invoices.length ? <div className="overflow-x-auto rounded-2xl border border-gray-100"><table className="w-full text-sm" data-testid="invoice-table">
          <thead className="bg-[#F7F7F7] text-left text-[#5F6368]"><tr>{["Invoice", "Date", "Plan", "Amount", "GST", "Total", "Status"].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{b.invoices.map((i) => <tr key={i.payment_id} className="border-t border-gray-100"><td className="px-4 py-3 font-mono text-xs">{i.invoice_no}</td><td className="px-4 py-3">{fmtDate(i.created_at)}</td><td className="px-4 py-3">{i.plan_name}</td><td className="px-4 py-3">{inr(i.amount)}</td><td className="px-4 py-3">{inr(i.gst)}</td><td className="px-4 py-3 font-semibold">{inr(i.total)}</td><td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${i.status === "paid" ? "bg-green-50 text-[#1E8E3E]" : "bg-red-50 text-[#D93025]"}`}>{i.status}{i.provider === "mock" ? " (mock)" : ""}</span></td></tr>)}</tbody>
        </table></div> : <div className="rounded-2xl bg-[#F7F7F7] p-8 text-center text-[#5F6368]">No invoices yet.</div>}
      </section>

      <Dialog open={!!pick} onOpenChange={() => setPick(null)}>
        <DialogContent className="rounded-2xl" data-testid="checkout-dialog">
          {pick && <>
            <DialogHeader><DialogTitle className="font-display">Subscribe to {pick.name}</DialogTitle><DialogDescription>{live ? "Secure payment by Razorpay — scan a UPI QR, or pay with a UPI app, card or NetBanking." : "MOCKED checkout — no real payment is taken. UPI QR appears once Razorpay is connected."}</DialogDescription></DialogHeader>
            {live && <div className="grid grid-cols-2 gap-2">{[["qr", "Scan UPI QR", QrCode], ["checkout", "UPI app / Card", CreditCard]].map(([v, l, I]) => (
              <button key={v} onClick={() => setMethod(v)} data-testid={`checkout-mode-${v}`} className={`h-11 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2 ${(method === "checkout" ? "checkout" : "qr") === v ? "border-[#1F94C8] bg-[#E8F4FA]" : "border-gray-200"}`}><I className="w-4 h-4" />{l}</button>))}</div>}
            {live && method !== "checkout" && <UpiQr plan={pick} onPaid={done} />}
            {!live && <div className="grid grid-cols-3 gap-2">{[["upi", "UPI"], ["card", "Card"], ["netbanking", "NetBanking"]].map(([v, l]) => (
              <button key={v} onClick={() => setMethod(v)} data-testid={`checkout-method-${v}`} className={`h-11 rounded-xl text-sm font-semibold border ${method === v ? "border-[#1F94C8] bg-[#E8F4FA]" : "border-gray-200"}`}>{l}</button>))}</div>}
            <div className="rounded-xl bg-[#F7F7F7] p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span>{pick.name} plan (monthly)</span><span>{inr(pick.price)}</span></div>
              <div className="flex justify-between text-[#5F6368]"><span>GST ({b?.gst_percent}%)</span><span>{inr(tax)}</span></div>
              <div className="flex justify-between font-bold pt-2 border-t border-gray-200"><span>Total</span><span data-testid="checkout-total">{inr(pick.price + tax)}</span></div>
            </div>
            {!(live && method !== "checkout") && <DialogFooter><Button onClick={pay} disabled={busy} className="h-12 rounded-xl w-full font-semibold" data-testid="checkout-pay-btn">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Pay {inr(pick.price + tax)}</Button></DialogFooter>}
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
