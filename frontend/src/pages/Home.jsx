import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Image, FileText, Film, Cloud, Users, HardDrive, ArrowRight, ArrowLeftRight } from "lucide-react";
import { StorageCard } from "@/components/StorageCard";
import { FolderIcon } from "@/components/Brand";
import { FileThumb } from "@/components/FileThumb";
import { UploadButton } from "@/components/UploadButton";
import { PreviewDialog } from "@/components/FileDialogs";
import { api, fmtBytes, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const GLYPH = { photos: Image, documents: FileText, videos: Film, google: Cloud, family: Users, harddisk: HardDrive };
const SUB = { photos: "items", documents: "files", videos: "videos", google: "imported files", family: "shared storage", harddisk: "device storage" };

const FolderCard = ({ f, i }) => {
  const G = GLYPH[f.system_key];
  return (
    <Link to={`/files/${f.folder_id}`} data-testid={`home-folder-${f.system_key}`} style={{ animationDelay: `${i * 60}ms` }}
      className="kn-rise kn-card rounded-2xl bg-[#FEF9E7] border border-[#F3E2B4] p-5 flex flex-col gap-4 min-h-[150px]">
      <FolderIcon className="w-16 h-14">{G && <G className="w-5 h-5" strokeWidth={2.4} />}</FolderIcon>
      <div>
        <p className="font-display font-bold text-[17px] leading-tight">{f.name}</p>
        <p className="text-sm text-[#5F6368] mt-0.5">{f.system_key === "harddisk" && !f.count ? "Pair a device soon" : `${f.count.toLocaleString("en-IN")} ${SUB[f.system_key]}`}</p>
      </div>
    </Link>
  );
};

export default function HomePage() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [preview, setPreview] = useState(null);
  const load = useCallback(() => api.get("/home").then(({ data }) => setD(data)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1F94C8]">KuvaNest</p>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mt-1" data-testid="home-greeting">Namaste, {user?.name?.split(" ")[0]}</h1>
        </div>
        <UploadButton auto onDone={load} testId="home-upload-btn" label="Upload files" />
      </div>

      <StorageCard s={d?.storage} />

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold">My Folders</h2>
          <Link to="/files" className="text-sm font-semibold text-[#156E96] hover:underline" data-testid="home-view-all-folders">View all</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {(d?.folders || []).map((f, i) => <FolderCard key={f.folder_id} f={f} i={i} />)}
        </div>
      </section>

      <Link to="/transfer" data-testid="home-move-from-google" className="kn-card flex items-center gap-4 rounded-2xl border border-gray-200 p-5 hover:border-[#1F94C8]">
        <div className="w-12 h-12 rounded-xl bg-[#E8F4FA] flex items-center justify-center"><ArrowLeftRight className="w-6 h-6 text-[#1F94C8]" /></div>
        <div className="flex-1">
          <p className="font-display font-bold">Move from Google, iCloud or Dropbox</p>
          <p className="text-sm text-[#5F6368]">Import your files and photos. Your originals stay untouched.</p>
        </div>
        <ArrowRight className="w-5 h-5 text-[#5F6368]" />
      </Link>

      {!!d?.recent_photos?.length && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-bold">Recent photos</h2>
            <Link to="/photos" className="text-sm font-semibold text-[#156E96] hover:underline">See all</Link>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4">
            {d.recent_photos.map((p) => (
              <button key={p.file_id} onClick={() => setPreview(p)} data-testid={`home-recent-photo-${p.file_id}`}
                className="shrink-0 w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden kn-card"><FileThumb file={p} /></button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display text-lg font-bold mb-4">Recent files</h2>
        {d?.recent_files?.length ? (
          <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100">
            {d.recent_files.map((f) => (
              <button key={f.file_id} onClick={() => setPreview(f)} data-testid={`home-recent-file-${f.file_id}`}
                className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-[#F7F7F7] first:rounded-t-2xl last:rounded-b-2xl">
                <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0"><FileThumb file={f} iconSize="w-5 h-5" /></div>
                <div className="min-w-0 flex-1"><p className="font-medium truncate">{f.name}</p><p className="text-xs text-[#5F6368]">{fmtBytes(f.size)} · {fmtDate(f.created_at)}</p></div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-[#F7F7F7] p-8 text-center text-[#5F6368]" data-testid="home-empty-state">Your nest is empty. Upload photos or documents to get started.</div>
        )}
      </section>
      <PreviewDialog file={preview} onOpenChange={() => setPreview(null)} />
    </div>
  );
}
