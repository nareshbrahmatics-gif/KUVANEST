import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Cloud, Apple, Package, CloudCog, Server, Upload, Pause, Play, X, RotateCw, FolderOpen, ShieldCheck, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, errMsg, fmtBytes, fmtDate } from "@/lib/api";

const SOURCES = [
  { id: "google_takeout", name: "Google Takeout", icon: Cloud, steps: ["Open takeout.google.com", "Select Drive and/or Google Photos", "Choose .zip, export, and download the archive", "Upload the ZIP here"] },
  { id: "icloud", name: "iCloud", icon: Apple, steps: ["Visit privacy.apple.com and sign in", "Request a copy of your data (iCloud Photos / Drive)", "Download the ZIP parts Apple emails you", "Upload each ZIP here"] },
  { id: "dropbox", name: "Dropbox", icon: Package, steps: ["Open dropbox.com", "Select a folder and choose Download (zips it)", "Upload the ZIP here"] },
  { id: "onedrive", name: "OneDrive", icon: CloudCog, steps: ["Open onedrive.live.com", "Select files/folders and click Download (zip)", "Upload the ZIP here"] },
  { id: "azure", name: "Azure Blob", icon: Server, steps: ["Export your container with AzCopy or Storage Explorer", "Compress the export into a .zip", "Upload the ZIP here"] },
];
const CONNECTORS = ["Google Drive Picker", "Google Photos Picker", "Dropbox API", "Microsoft OneDrive (Graph)", "Gmail attachments"];
const CHUNK = 5 * 1024 * 1024;
const ACTIVE = ["queued", "running", "paused"];

async function uploadArchive(file, onProgress) {
  const { data: up } = await api.post("/uploads/init", { filename: file.name, size: file.size });
  let offset = 0;
  while (offset < file.size) {
    for (let tries = 0; ; tries++) {
      try {
        const { data } = await api.put(`/uploads/${up.upload_id}/chunk?offset=${offset}`, file.slice(offset, offset + CHUNK), { headers: { "Content-Type": "application/octet-stream" } });
        offset = data.received;
        break;
      } catch (e) {
        if (e?.response?.status === 409) { offset = (await api.get(`/uploads/${up.upload_id}`)).data.received; break; }
        if (tries >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1000 * (tries + 1)));
      }
    }
    onProgress(Math.round((offset / file.size) * 100));
  }
  return up.upload_id;
}

const STATUS = { queued: "bg-gray-100 text-[#5F6368]", running: "bg-[#FFF7E6] text-[#9A6A00]", paused: "bg-blue-50 text-[#1A73E8]", completed: "bg-green-50 text-[#1E8E3E]", failed: "bg-red-50 text-[#D93025]", cancelled: "bg-gray-100 text-[#5F6368]" };

const JobCard = ({ j, onAction }) => {
  const pct = j.total_files ? Math.round((j.processed / j.total_files) * 100) : 0;
  const [open, setOpen] = useState(false);
  const A = ({ a, icon: I, label }) => <Button size="sm" variant="outline" className="rounded-lg h-9" onClick={() => onAction(j.job_id, a)} data-testid={`job-${a}-btn-${j.job_id}`}><I className="w-3.5 h-3.5" />{label}</Button>;
  return (
    <div className="rounded-2xl border border-gray-100 p-5 space-y-4" data-testid={`migration-job-${j.job_id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display font-bold truncate">{j.source_label} · {j.archive_name}</p>
          <p className="text-xs text-[#5F6368]">{fmtBytes(j.archive_size)} archive · started {fmtDate(j.created_at)}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${STATUS[j.status]}`} data-testid={`job-status-${j.job_id}`}>{j.status}</span>
      </div>
      <div><Progress value={pct} className="h-2.5 bg-[#F7F7F7]" /><p className="text-xs text-[#5F6368] mt-2" data-testid={`job-progress-${j.job_id}`}>{pct}% · {j.processed}/{j.total_files} files · {fmtBytes(j.bytes_done)} of {fmtBytes(j.bytes_total)}</p></div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        {[["Imported", j.imported, "#1E8E3E"], ["Duplicates", j.duplicates, "#9A6A00"], ["Failed", j.failed, "#D93025"]].map(([l, v, c]) => (
          <div key={l} className="rounded-xl bg-[#F7F7F7] py-2"><p className="font-bold" style={{ color: c }}>{v}</p><p className="text-xs text-[#5F6368]">{l}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {["running", "queued"].includes(j.status) && <A a="pause" icon={Pause} label="Pause" />}
        {j.status === "paused" && <A a="resume" icon={Play} label="Resume" />}
        {ACTIVE.includes(j.status) && <A a="cancel" icon={X} label="Cancel" />}
        {["failed", "cancelled", "completed"].includes(j.status) && <A a="retry" icon={RotateCw} label="Retry" />}
        {j.dest_folder_id && <Link to={`/files/${j.dest_folder_id}`} data-testid={`job-open-folder-${j.job_id}`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium bg-[#FFF7E6] text-[#9A6A00]"><FolderOpen className="w-3.5 h-3.5" />Open folder</Link>}
        {!!j.errors?.length && <button onClick={() => setOpen(!open)} className="text-sm font-medium text-[#D93025] px-2" data-testid={`job-errors-toggle-${j.job_id}`}>{open ? "Hide" : "View"} report ({j.errors.length})</button>}
      </div>
      {open && <ul className="text-xs space-y-1 max-h-48 overflow-y-auto bg-[#F7F7F7] rounded-xl p-3">{j.errors.map((e, i) => <li key={i}><b>{e.file}</b> — {e.error}</li>)}</ul>}
    </div>
  );
};

export default function Transfer() {
  const [src, setSrc] = useState(SOURCES[0]);
  const [jobs, setJobs] = useState([]);
  const [pct, setPct] = useState(null);
  const ref = useRef();
  const load = useCallback(() => api.get("/migrations").then(({ data }) => setJobs(data)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!jobs.some((j) => ACTIVE.includes(j.status))) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [jobs, load]);

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPct(0);
    try {
      const uid = await uploadArchive(f, setPct);
      await api.post("/migrations", { source: src.id, upload_id: uid });
      toast.success("Import started. You can leave this page — it keeps running.");
      load();
    } catch (err) { toast.error(errMsg(err)); } finally { setPct(null); }
  };
  const onAction = async (id, a) => { try { await api.post(`/migrations/${id}/${a}`); load(); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">Move to KuvaNest</h1>
        <p className="text-[#5F6368] mt-2 max-w-2xl">Bring your files and photos from Google, iCloud, Dropbox, OneDrive or Azure. Your original files are never deleted or changed.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {SOURCES.map((s) => (
          <button key={s.id} onClick={() => setSrc(s)} data-testid={`transfer-source-${s.id}`}
            className={`kn-card rounded-2xl border p-4 text-left ${src.id === s.id ? "border-[#E5AA16] bg-[#FFF7E6]" : "border-gray-200"}`}>
            <s.icon className="w-6 h-6 text-[#C98F0A]" /><p className="font-semibold mt-3 text-sm">{s.name}</p><p className="text-xs text-[#5F6368]">ZIP archive</p>
          </button>
        ))}
      </div>
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
        <div className="rounded-2xl bg-[#202124] text-white p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F4C84D]">Import from {src.name}</p>
          <ol className="mt-5 space-y-3">
            {src.steps.map((s, i) => <li key={s} className="flex gap-3"><span className="w-7 h-7 rounded-full bg-[#E5AA16] text-[#202124] font-bold text-sm flex items-center justify-center shrink-0">{i + 1}</span><span className="text-white/85 pt-0.5">{s}</span></li>)}
          </ol>
          <input ref={ref} type="file" accept=".zip" hidden onChange={onPick} data-testid="transfer-archive-input" />
          <Button onClick={() => ref.current.click()} disabled={pct !== null} data-testid="transfer-upload-archive-btn" className="mt-7 h-12 rounded-xl px-6 font-semibold">
            {pct !== null ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading {pct}%</> : <><Upload className="w-4 h-4" /> Upload {src.name} ZIP</>}
          </Button>
          <p className="text-xs text-white/60 mt-3 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />Resumable upload · safe extraction · duplicate & checksum checks</p>
        </div>
        <div className="rounded-2xl border border-gray-200 p-6">
          <p className="font-display font-bold">Direct connections</p>
          <p className="text-sm text-[#5F6368] mt-1">One-tap connectors need provider approval and will arrive in a later release.</p>
          <ul className="mt-4 space-y-2">
            {CONNECTORS.map((c) => <li key={c} className="flex items-center justify-between rounded-xl bg-[#F7F7F7] px-4 py-3 text-sm"><span className="flex items-center gap-2"><Lock className="w-4 h-4 text-[#80868B]" />{c}</span><span className="text-xs font-semibold text-[#80868B]">Coming soon</span></li>)}
          </ul>
        </div>
      </div>
      <section>
        <h2 className="font-display text-lg font-bold mb-4">Your imports</h2>
        {jobs.length ? <div className="grid md:grid-cols-2 gap-4">{jobs.map((j) => <JobCard key={j.job_id} j={j} onAction={onAction} />)}</div>
          : <div className="rounded-2xl bg-[#F7F7F7] p-8 text-center text-[#5F6368]" data-testid="transfer-empty-state">No imports yet.</div>}
      </section>
    </div>
  );
}
