import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Brand";
import { FilePreview } from "@/components/FileDialogs";
import { API, api, errMsg, fmtBytes, fmtDate } from "@/lib/api";

export default function SharePage() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.get(`/share/${token}`).then(({ data }) => setD(data)).catch((e) => setErr(errMsg(e))); }, [token]);
  const src = `${API}/share/${token}/content`;
  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-100"><Link to="/"><Logo /></Link>
        <Link to="/login" className="text-sm font-semibold text-[#9A6A00]">Get your own nest</Link></header>
      <main className="max-w-4xl mx-auto p-6">
        {err && <div className="rounded-2xl bg-white p-12 text-center text-[#5F6368]" data-testid="share-error">{err}</div>}
        {d && <div className="rounded-2xl bg-white p-6 space-y-5" data-testid="share-page">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="font-display text-2xl font-extrabold">{d.file.name}</h1><p className="text-sm text-[#5F6368]">Shared by {d.owner} · {fmtBytes(d.file.size)} · link expires {fmtDate(d.expires_at)}</p></div>
            <Button asChild className="rounded-xl h-11 font-semibold" data-testid="share-download-btn"><a href={`${src}?download=1`}><Download className="w-4 h-4" />Download</a></Button>
          </div>
          <FilePreview file={d.file} src={src} />
        </div>}
      </main>
    </div>
  );
}
