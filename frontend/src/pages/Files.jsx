import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FolderPlus, Search, LayoutGrid, List, MoreVertical, ChevronRight, Star } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FolderIcon } from "@/components/Brand";
import { FileThumb } from "@/components/FileThumb";
import { UploadButton, uploadFiles } from "@/components/UploadButton";
import { NameDialog, MoveDialog, ShareDialog, PreviewDialog } from "@/components/FileDialogs";
import { api, errMsg, fmtBytes, fmtDate, downloadFile } from "@/lib/api";

const KINDS = [["all", "All"], ["image", "Photos"], ["video", "Videos"], ["document", "Documents"], ["archive", "Archives"], ["other", "Other"]];

const ItemMenu = ({ items, testId }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button onClick={(e) => e.stopPropagation()} data-testid={testId} aria-label="More actions"
        className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/5 shrink-0"><MoreVertical className="w-4 h-4" /></button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="bg-white rounded-xl shadow-xl border-gray-100 w-44" onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => it === "-" ? <DropdownMenuSeparator key={i} /> : (
        <DropdownMenuItem key={it.label} onClick={it.on} data-testid={`${testId}-${it.label.toLowerCase().replace(/\s+/g, "-")}`}
          className={`rounded-lg py-2.5 cursor-pointer ${it.danger ? "text-[#D93025]" : ""}`}>{it.label}</DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

export default function Files() {
  const { folderId } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("name-asc");
  const [view, setView] = useState("grid");
  const [dlg, setDlg] = useState({});
  const [drag, setDrag] = useState(false);

  const load = useCallback(async () => {
    const [s, o] = sort.split("-");
    const { data } = await api.get("/browse", { params: { folder_id: folderId, q, kind, sort: s, order: o } });
    setD(data);
  }, [folderId, q, kind, sort]);
  useEffect(() => { const t = setTimeout(() => load().catch((e) => toast.error(errMsg(e))), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const act = async (fn, msg) => { try { await fn(); msg && toast.success(msg); setDlg({}); load(); } catch (e) { toast.error(errMsg(e)); } };
  const close = () => setDlg({});

  const fileItems = (f) => [
    { label: "Open", on: () => setDlg({ preview: f }) },
    { label: "Download", on: () => downloadFile(f.file_id) },
    { label: "Share", on: () => setDlg({ share: f }) },
    { label: f.favorite ? "Unfavourite" : "Favourite", on: () => act(() => api.patch(`/files/${f.file_id}`, { favorite: !f.favorite })) },
    "-",
    { label: "Rename", on: () => setDlg({ rename: f }) },
    { label: "Move", on: () => setDlg({ move: f }) },
    { label: "Copy", on: () => setDlg({ copy: f }) },
    "-",
    { label: "Delete", danger: true, on: () => act(() => api.delete(`/files/${f.file_id}`), "Moved to Recycle Bin") },
  ];
  const folderItems = (f) => f.system_key ? [{ label: "Open", on: () => nav(`/files/${f.folder_id}`) }] : [
    { label: "Open", on: () => nav(`/files/${f.folder_id}`) },
    { label: "Rename", on: () => setDlg({ renameFolder: f }) },
    { label: "Move", on: () => setDlg({ moveFolder: f }) },
    "-",
    { label: "Delete", danger: true, on: () => act(() => api.delete(`/folders/${f.folder_id}`), "Folder moved to Recycle Bin") },
  ];

  const onDrop = async (e) => {
    e.preventDefault(); setDrag(false);
    if (e.dataTransfer.files?.length) { await uploadFiles(e.dataTransfer.files, { folderId }); load(); }
  };
  const empty = d && !d.folders.length && !d.files.length;
  const grid = view === "grid";

  return (
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
      className={`relative min-h-[60vh] rounded-2xl transition-colors ${drag ? "bg-[#E8F4FA] outline-dashed outline-2 outline-[#1F94C8]" : ""}`}>
      <nav className="flex items-center gap-1 text-sm text-[#5F6368] flex-wrap" data-testid="files-breadcrumbs">
        <Link to="/files" className="hover:text-[#202124] font-medium" data-testid="breadcrumb-root">My KuvaNest</Link>
        {d?.breadcrumbs.map((c) => (
          <span key={c.folder_id} className="flex items-center gap-1"><ChevronRight className="w-4 h-4" />
            <Link to={`/files/${c.folder_id}`} className="hover:text-[#202124] font-medium">{c.name}</Link></span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight" data-testid="files-title">{q ? "Search results" : d?.folder?.name || "My Files"}</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl h-11 font-semibold" onClick={() => setDlg({ newFolder: true })} data-testid="files-new-folder-btn">
            <FolderPlus className="w-4 h-4" /> New folder</Button>
          <UploadButton folderId={folderId} onDone={load} testId="files-upload-btn" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[#80868B]" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all your files" className="h-11 rounded-xl pl-11 bg-[#F7F7F7] border-0" data-testid="files-search-input" />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-40 h-11 rounded-xl" data-testid="files-sort-select"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-white">
            {[["name-asc", "Name A–Z"], ["name-desc", "Name Z–A"], ["date-desc", "Newest first"], ["date-asc", "Oldest first"], ["size-desc", "Largest first"], ["size-asc", "Smallest first"]].map(([v, l]) =>
              <SelectItem key={v} value={v} data-testid={`sort-${v}`}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex rounded-xl bg-[#F7F7F7] p-1">
          {[["grid", LayoutGrid], ["list", List]].map(([v, I]) => (
            <button key={v} onClick={() => setView(v)} data-testid={`files-view-${v}`} aria-label={`${v} view`}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${view === v ? "bg-white shadow-sm" : ""}`}><I className="w-4 h-4" /></button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-4 overflow-x-auto no-scrollbar">
        {KINDS.map(([v, l]) => (
          <button key={v} onClick={() => setKind(v)} data-testid={`files-filter-${v}`}
            className={`px-4 h-9 rounded-full text-sm font-medium shrink-0 transition-colors ${kind === v ? "bg-[#202124] text-white" : "bg-[#F7F7F7] text-[#5F6368] hover:text-[#202124]"}`}>{l}</button>
        ))}
      </div>

      {empty && <div className="mt-10 rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center text-[#5F6368]" data-testid="files-empty-state">
        This folder is empty. Drag files here or use Upload.</div>}

      <div className={`mt-6 ${grid ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4" : "flex flex-col divide-y divide-gray-100 rounded-2xl border border-gray-100"}`}>
        {d?.folders.map((f) => (
          <div key={f.folder_id} onClick={() => nav(`/files/${f.folder_id}`)} data-testid={`folder-item-${f.folder_id}`}
            className={grid ? "kn-card cursor-pointer rounded-2xl bg-[#FEF9E7] border border-[#F3E2B4] p-4 flex flex-col gap-3" : "cursor-pointer flex items-center gap-4 px-4 py-3 hover:bg-[#F7F7F7]"}>
            <div className="flex items-start justify-between"><FolderIcon className={grid ? "w-14 h-12" : "w-10 h-8"} />{grid && <ItemMenu items={folderItems(f)} testId={`folder-menu-${f.folder_id}`} />}</div>
            <p className={`font-semibold truncate ${grid ? "" : "flex-1"}`}>{f.name}</p>
            {!grid && <ItemMenu items={folderItems(f)} testId={`folder-menu-${f.folder_id}`} />}
          </div>
        ))}
        {d?.files.map((f) => (
          <div key={f.file_id} onClick={() => setDlg({ preview: f })} data-testid={`file-item-${f.file_id}`}
            className={grid ? "kn-card cursor-pointer rounded-2xl border border-gray-100 overflow-hidden bg-white" : "cursor-pointer flex items-center gap-4 px-4 py-3 hover:bg-[#F7F7F7]"}>
            <div className={grid ? "aspect-[4/3]" : "w-11 h-11 rounded-xl overflow-hidden shrink-0"}><FileThumb file={f} iconSize={grid ? "w-10 h-10" : "w-5 h-5"} /></div>
            <div className={`flex items-center gap-2 ${grid ? "p-3" : "flex-1 min-w-0"}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate text-sm flex items-center gap-1">{f.favorite && <Star className="w-3.5 h-3.5 fill-[#E5AA16] text-[#E5AA16] shrink-0" />}{f.name}</p>
                <p className="text-xs text-[#5F6368]">{fmtBytes(f.size)} · {fmtDate(f.created_at)}</p>
              </div>
              <ItemMenu items={fileItems(f)} testId={`file-menu-${f.file_id}`} />
            </div>
          </div>
        ))}
      </div>

      <NameDialog open={!!dlg.newFolder} onOpenChange={close} title="New folder" cta="Create" initial="" onSubmit={(name) => act(() => api.post("/folders", { name, parent_id: folderId || null }), "Folder created")} />
      <NameDialog open={!!dlg.rename} onOpenChange={close} title="Rename file" initial={dlg.rename?.name} onSubmit={(name) => act(() => api.patch(`/files/${dlg.rename.file_id}`, { name }), "Renamed")} />
      <NameDialog open={!!dlg.renameFolder} onOpenChange={close} title="Rename folder" initial={dlg.renameFolder?.name} onSubmit={(name) => act(() => api.patch(`/folders/${dlg.renameFolder.folder_id}`, { name }), "Renamed")} />
      <MoveDialog open={!!dlg.move} onOpenChange={close} title={`Move “${dlg.move?.name}”`} onSubmit={(fid) => act(() => api.patch(`/files/${dlg.move.file_id}`, { folder_id: fid, move: true }), "Moved")} />
      <MoveDialog open={!!dlg.copy} onOpenChange={close} title={`Copy “${dlg.copy?.name}”`} onSubmit={(fid) => act(() => api.post(`/files/${dlg.copy.file_id}/copy`, { folder_id: fid }), "Copied")} />
      <MoveDialog open={!!dlg.moveFolder} onOpenChange={close} excludeId={dlg.moveFolder?.folder_id} title={`Move “${dlg.moveFolder?.name}”`} onSubmit={(pid) => act(() => api.patch(`/folders/${dlg.moveFolder.folder_id}`, { parent_id: pid, move: true }), "Moved")} />
      <ShareDialog file={dlg.share} onOpenChange={close} />
      <PreviewDialog file={dlg.preview} onOpenChange={close} />
    </div>
  );
}
