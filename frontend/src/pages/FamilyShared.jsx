import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Upload, FolderPlus, Download, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FolderIcon } from "@/components/Brand";
import { FileThumb } from "@/components/FileThumb";
import { FilePreview, NameDialog } from "@/components/FileDialogs";
import { API, api, errMsg, fmtBytes } from "@/lib/api";

export default function FamilyShared() {
  const { ownerId, folderId } = useParams();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [preview, setPreview] = useState(null);
  const ref = useRef();
  const base = `/family/${ownerId}`;
  const src = (f, dl) => `${API}${base}/files/${f.file_id}/content${dl ? "?download=1" : ""}`;
  const load = useCallback(() => api.get(`${base}/browse`, { params: { folder_id: folderId } }).then(({ data }) => setD(data)).catch((e) => toast.error(errMsg(e))), [base, folderId]);
  useEffect(() => { load(); }, [load]);
  const edit = d?.access === "editor";

  const upload = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append("files", f));
    fd.append("folder_id", d.folder.folder_id);
    setBusy(true);
    try { await api.post(`${base}/upload`, fd); toast.success("Uploaded to Family Files"); load(); } catch (err) { toast.error(errMsg(err)); }
    setBusy(false);
    e.target.value = "";
  };
  const del = async (f) => { try { await api.delete(`${base}/files/${f.file_id}`); toast.success("Moved to owner's Recycle Bin"); setPreview(null); load(); } catch (e) { toast.error(errMsg(e)); } };
  const mkdir = async (name) => { try { await api.post(`${base}/folders`, { name, parent_id: d.folder.folder_id }); setNewFolder(false); load(); } catch (e) { toast.error(errMsg(e)); } };
  if (!d) return null;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-[#5F6368] flex-wrap" data-testid="family-shared-breadcrumbs">
        <Link to="/family" className="font-medium hover:text-[#202124]">Family</Link>
        {d.breadcrumbs.map((c, i) => <span key={c.folder_id} className="flex items-center gap-1"><ChevronRight className="w-4 h-4" />
          <Link to={i === 0 ? `/family/${ownerId}` : `/family/${ownerId}/${c.folder_id}`} className="font-medium hover:text-[#202124]">{i === 0 ? `${d.owner_name}'s Family Files` : c.name}</Link></span>)}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold tracking-tight" data-testid="family-shared-title">{d.breadcrumbs.length > 1 ? d.folder.name : `${d.owner_name}'s Family Files`}</h1>
        {edit ? <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl h-11" onClick={() => setNewFolder(true)} data-testid="family-shared-new-folder"><FolderPlus className="w-4 h-4" />New folder</Button>
          <input ref={ref} type="file" multiple hidden onChange={upload} data-testid="family-shared-upload-input" />
          <Button className="rounded-xl h-11 font-semibold" disabled={busy} onClick={() => ref.current.click()} data-testid="family-shared-upload-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Upload</Button>
        </div> : <span className="text-sm px-3 py-1.5 rounded-full bg-[#F7F7F7] text-[#5F6368]" data-testid="family-shared-viewonly">View only</span>}
      </div>
      {!d.folders.length && !d.files.length && <div className="rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center text-[#5F6368]">Nothing shared here yet.</div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {d.folders.map((f) => (
          <Link key={f.folder_id} to={`/family/${ownerId}/${f.folder_id}`} className="kn-card rounded-2xl bg-[#FEF9E7] border border-[#F3E2B4] p-4 space-y-3" data-testid={`family-shared-folder-${f.folder_id}`}>
            <FolderIcon className="w-14 h-12" /><p className="font-semibold truncate">{f.name}</p>
          </Link>
        ))}
        {d.files.map((f) => (
          <button key={f.file_id} onClick={() => setPreview(f)} className="kn-card text-left rounded-2xl border border-gray-100 overflow-hidden" data-testid={`family-shared-file-${f.file_id}`}>
            <div className="aspect-[4/3]"><FileThumb file={f} src={src(f)} /></div>
            <div className="p-3"><p className="text-sm font-medium truncate">{f.name}</p><p className="text-xs text-[#5F6368]">{fmtBytes(f.size)}</p></div>
          </button>
        ))}
      </div>
      <NameDialog open={newFolder} onOpenChange={setNewFolder} title="New shared folder" cta="Create" onSubmit={mkdir} />
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-4xl rounded-2xl" data-testid="family-shared-preview">
          {preview && <>
            <DialogHeader><DialogTitle className="truncate pr-8">{preview.name}</DialogTitle></DialogHeader>
            <FilePreview file={preview} src={src(preview)} />
            <DialogFooter className="gap-2">
              {edit && <Button variant="outline" className="rounded-xl text-[#D93025]" onClick={() => del(preview)} data-testid="family-shared-delete-btn"><Trash2 className="w-4 h-4" />Delete</Button>}
              <Button asChild className="rounded-xl" data-testid="family-shared-download-btn"><a href={src(preview, true)}><Download className="w-4 h-4" />Download</a></Button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
