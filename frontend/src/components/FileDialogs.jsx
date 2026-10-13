import { useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errMsg, fileUrl, downloadFile, fmtBytes, fmtDate } from "@/lib/api";
import { canPreviewImage } from "@/components/FileThumb";

export const NameDialog = ({ open, onOpenChange, title, initial = "", onSubmit, cta = "Save" }) => {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl" data-testid="name-dialog">
        <DialogHeader><DialogTitle className="font-display">{title}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); v.trim() && onSubmit(v.trim()); }} className="space-y-4">
          <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="h-12 rounded-xl" data-testid="name-dialog-input" />
          <DialogFooter><Button type="submit" className="rounded-xl h-11 px-6 font-semibold" data-testid="name-dialog-submit">{cta}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const MoveDialog = ({ open, onOpenChange, title, onSubmit, excludeId }) => {
  const [list, setList] = useState([]);
  const [sel, setSel] = useState("__root");
  useEffect(() => {
    if (open) api.get("/folders/all").then(({ data }) => setList(data.filter((f) => f.folder_id !== excludeId)));
  }, [open, excludeId]);
  const opts = [{ folder_id: "__root", path: "My KuvaNest (top level)" }, ...list];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl" data-testid="move-dialog">
        <DialogHeader><DialogTitle className="font-display">{title}</DialogTitle><DialogDescription>Choose a destination folder</DialogDescription></DialogHeader>
        <div className="max-h-72 overflow-y-auto space-y-1 -mx-1 px-1">
          {opts.map((f) => (
            <button key={f.folder_id} onClick={() => setSel(f.folder_id)} data-testid={`move-option-${f.folder_id}`}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-colors ${sel === f.folder_id ? "bg-[#FFF7E6] text-[#9A6A00] font-semibold" : "hover:bg-[#F7F7F7]"}`}>
              {f.path}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button className="rounded-xl h-11 px-6 font-semibold" data-testid="move-dialog-submit" onClick={() => onSubmit(sel === "__root" ? null : sel)}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const ShareDialog = ({ file, onOpenChange }) => {
  const [link, setLink] = useState("");
  const [days, setDays] = useState(7);
  useEffect(() => { setLink(""); }, [file]);
  const create = async () => {
    try {
      const { data } = await api.post(`/files/${file.file_id}/share`, { days });
      setLink(`${window.location.origin}/s/${data.token}`);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open={!!file} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl" data-testid="share-dialog">
        <DialogHeader><DialogTitle className="font-display">Share “{file?.name}”</DialogTitle>
          <DialogDescription>Anyone with the link can view and download this file until it expires.</DialogDescription></DialogHeader>
        <div className="flex gap-2">
          {[1, 7, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} data-testid={`share-days-${d}`}
              className={`px-4 py-2 rounded-full text-sm font-medium border ${days === d ? "bg-[#FFF7E6] border-[#E5AA16] text-[#9A6A00]" : "border-gray-200"}`}>{d} day{d > 1 ? "s" : ""}</button>
          ))}
        </div>
        {link ? (
          <div className="flex gap-2">
            <Input readOnly value={link} className="h-11 rounded-xl" data-testid="share-link-input" />
            <Button variant="outline" className="rounded-xl h-11" data-testid="share-copy-btn"
              onClick={() => { navigator.clipboard?.writeText(link); toast.success("Link copied"); }}><Copy className="w-4 h-4" /></Button>
          </div>
        ) : (
          <Button onClick={create} className="rounded-xl h-11 font-semibold" data-testid="share-create-btn">Create secure link</Button>
        )}
      </DialogContent>
    </Dialog>
  );
};

export const FilePreview = ({ file, src }) => {
  const url = src || fileUrl(file.file_id);
  if (canPreviewImage(file)) return <img src={url} alt={file.name} className="max-h-[70vh] mx-auto rounded-xl object-contain" />;
  if (file.kind === "video") return <video src={url} controls className="max-h-[70vh] w-full rounded-xl bg-black" />;
  if (file.kind === "audio") return <audio src={url} controls className="w-full" />;
  if (file.mime === "application/pdf" || file.mime?.startsWith("text/"))
    return <iframe title={file.name} src={url} className="w-full h-[70vh] rounded-xl border" />;
  return <div className="py-16 text-center text-[#5F6368]">Preview isn't available for this file type. Download it to open.</div>;
};

export const PreviewDialog = ({ file, onOpenChange }) => (
  <Dialog open={!!file} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-4xl rounded-2xl" data-testid="preview-dialog">
      {file && <>
        <DialogHeader>
          <DialogTitle className="font-display truncate pr-8">{file.name}</DialogTitle>
          <DialogDescription>{fmtBytes(file.size)} · {fmtDate(file.created_at)}</DialogDescription>
        </DialogHeader>
        <FilePreview file={file} />
        <DialogFooter>
          <Button className="rounded-xl h-11 font-semibold" onClick={() => downloadFile(file.file_id)} data-testid="preview-download-btn">
            <Download className="w-4 h-4" /> Download
          </Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>
);
