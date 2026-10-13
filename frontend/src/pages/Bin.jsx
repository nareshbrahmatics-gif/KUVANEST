import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { FolderIcon } from "@/components/Brand";
import { FileThumb } from "@/components/FileThumb";
import { api, errMsg, fmtBytes, fmtDate } from "@/lib/api";

export default function Bin() {
  const [d, setD] = useState(null);
  const load = useCallback(() => api.get("/bin").then(({ data }) => setD(data)), []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); load(); } catch (e) { toast.error(errMsg(e)); } };
  const rows = d ? [...d.folders.map((f) => ({ ...f, kind_: "folder", id: f.folder_id })), ...d.files.map((f) => ({ ...f, kind_: "file", id: f.file_id }))] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">Recycle Bin</h1>
          <p className="text-[#5F6368] mt-1" data-testid="bin-retention-note">Items are deleted forever after {d?.retention_days || 30} days.</p>
        </div>
        {!!rows.length && (
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="outline" className="rounded-xl h-11 text-[#D93025]" data-testid="bin-empty-btn"><Trash2 className="w-4 h-4" />Empty bin</Button></AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader><AlertDialogTitle>Empty Recycle Bin?</AlertDialogTitle><AlertDialogDescription>All items will be permanently deleted. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                <AlertDialogAction className="rounded-xl bg-[#D93025] text-white hover:bg-[#b3261e]" data-testid="bin-empty-confirm-btn" onClick={() => act(() => api.delete("/bin"), "Recycle Bin emptied")}>Delete forever</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {d && !rows.length && <div className="rounded-2xl bg-[#F7F7F7] p-12 text-center text-[#5F6368]" data-testid="bin-empty-state">Recycle Bin is empty.</div>}
      <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-4 px-4 py-3" data-testid={`bin-item-${r.id}`}>
            <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 flex items-center justify-center">{r.kind_ === "folder" ? <FolderIcon className="w-10 h-8" /> : <FileThumb file={r} iconSize="w-5 h-5" />}</div>
            <div className="flex-1 min-w-0"><p className="font-medium truncate">{r.name}</p><p className="text-xs text-[#5F6368]">{r.kind_ === "folder" ? "Folder" : fmtBytes(r.size)} · deleted {fmtDate(r.deleted_at)}</p></div>
            <Button size="sm" variant="outline" className="rounded-lg h-9" data-testid={`bin-restore-${r.id}`} onClick={() => act(() => api.post("/bin/restore", { kind: r.kind_, id: r.id }), "Restored")}><RotateCcw className="w-3.5 h-3.5" /><span className="hidden sm:inline">Restore</span></Button>
            <Button size="sm" variant="ghost" className="rounded-lg h-9 text-[#D93025]" data-testid={`bin-delete-${r.id}`} aria-label="Delete forever" onClick={() => act(() => api.delete(`/bin/${r.kind_}/${r.id}`), "Deleted forever")}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
