import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errMsg, inr } from "@/lib/api";

export const UpiQr = ({ plan, onPaid }) => {
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState("");
  const [left, setLeft] = useState(0);
  const timer = useRef();

  const create = async () => {
    setErr(""); setQr(null);
    try { const { data } = await api.post("/billing/upi-qr", { plan_id: plan.plan_id }); setQr(data); }
    catch (e) { setErr(errMsg(e)); }
  };
  useEffect(() => { create(); }, [plan.plan_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!qr) return;
    const tick = async () => {
      const secs = qr.close_by - Math.floor(Date.now() / 1000);
      setLeft(secs);
      if (secs <= 0) return clearInterval(timer.current);
      try {
        const { data } = await api.get(`/billing/upi-qr/${qr.qr_id}`);
        if (data.status === "paid") { clearInterval(timer.current); onPaid(); }
      } catch { /* keep polling */ }
    };
    tick();
    timer.current = setInterval(tick, 3000);
    return () => clearInterval(timer.current);
  }, [qr]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="rounded-xl bg-red-50 text-[#D93025] p-4 text-sm" data-testid="upi-qr-error">{err}</div>;
  if (!qr) return <div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#1F94C8]" /></div>;
  const expired = left <= 0;
  return (
    <div className="flex flex-col items-center gap-3" data-testid="upi-qr">
      <div className="relative rounded-2xl border border-gray-200 p-3 bg-white">
        <img src={qr.image_url} alt="UPI QR code" className={`w-56 h-56 object-contain ${expired ? "opacity-20" : ""}`} data-testid="upi-qr-image" />
        {expired && <Button onClick={create} className="absolute inset-0 m-auto w-max h-10 rounded-xl" data-testid="upi-qr-refresh"><RefreshCw className="w-4 h-4" />New QR</Button>}
      </div>
      <p className="font-display font-bold text-lg" data-testid="upi-qr-amount">{inr(qr.amount)}</p>
      <p className="text-sm text-[#5F6368] text-center">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM).<br />
        {expired ? "This QR has expired." : <>Waiting for payment · expires in <b data-testid="upi-qr-timer">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b></>}</p>
      {!expired && <p className="flex items-center gap-1.5 text-xs text-[#1E8E3E]"><Loader2 className="w-3.5 h-3.5 animate-spin" />Your plan switches on automatically once paid</p>}
      <p className="flex items-center gap-1.5 text-xs text-[#80868B]"><ShieldCheck className="w-3.5 h-3.5" />One-time QR for this exact amount, by Razorpay</p>
    </div>
  );
};
