import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";

export const fetchInvoiceUrl = async (id) => {
  const { data } = await api.get(`/billing/invoices/${id}/pdf`, { responseType: "blob" });
  return URL.createObjectURL(data);
};

export const downloadInvoice = async (id, name = "invoice") => {
  const url = await fetchInvoiceUrl(id);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
};

export default function Invoice() {
  const { paymentId } = useParams();
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetchInvoiceUrl(paymentId).then(setUrl).catch((e) => setErr(errMsg(e))); }, [paymentId]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/plans" className="inline-flex items-center gap-1 text-sm font-semibold text-[#156E96]" data-testid="invoice-back-link"><ChevronLeft className="w-4 h-4" />Plans & Billing</Link>
        {url && <Button asChild className="rounded-xl h-11 font-semibold" data-testid="invoice-download-btn"><a href={url} download={`KuvaNest-invoice-${paymentId}.pdf`}><Download className="w-4 h-4" />Download PDF</a></Button>}
      </div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">GST invoice</h1>
      {err ? <div className="rounded-2xl bg-red-50 text-[#D93025] p-6" data-testid="invoice-error">{err}</div>
        : url ? <iframe title="Invoice" src={url} className="w-full h-[75vh] rounded-2xl border" data-testid="invoice-frame" />
        : <div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#1F94C8]" /></div>}
    </div>
  );
}
