import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, Download, Share2, Trash2, Play, X, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileThumb } from "@/components/FileThumb";
import { FilePreview, ShareDialog } from "@/components/FileDialogs";
import { UploadButton } from "@/components/UploadButton";
import { api, errMsg, downloadFile } from "@/lib/api";

const TABS = [["all", "All"], ["albums", "Smart Albums"], ["image", "Photos"], ["video", "Videos"], ["favorites", "Favourites"]];

const dayLabel = (s) => {
  const d = new Date(s), t = new Date();
  const diff = Math.floor((new Date(t.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

const Btn = ({ on, label, children, testId }) => (
  <button onClick={on} aria-label={label} data-testid={testId} className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">{children}</button>
);

const AlbumGrid = ({ albums, onOpen }) => {
  if (!albums) return null;
  if (!albums.length) return <div className="rounded-2xl bg-[#FEF9E7] p-12 text-center text-[#5F6368]" data-testid="albums-empty-state">Albums appear automatically once you add photos.</div>;
  const Section = ({ type, title }) => {
    const list = albums.filter((a) => a.type === type);
    return !!list.length && (
      <section>
        <h2 className="font-display font-bold text-lg mb-3">{title}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {list.map((a) => (
            <button key={a.album_id} onClick={() => onOpen(a)} data-testid={`album-card-${a.album_id}`} className="kn-card text-left rounded-2xl overflow-hidden border border-gray-100 bg-white">
              <div className="aspect-[4/3] relative"><FileThumb file={a.cover} />{type === "trip" && <MapPin className="absolute top-2 left-2 w-5 h-5 text-white drop-shadow" />}</div>
              <div className="p-3"><p className="font-semibold truncate">{a.title}</p><p className="text-xs text-[#5F6368]">{a.subtitle ? `${a.subtitle} · ` : ""}{a.count} items</p></div>
            </button>
          ))}
        </div>
      </section>
    );
  };
  return <div className="space-y-8"><Section type="trip" title="Trips" /><Section type="month" title="By month" /></div>;
};

export default function Photos() {
  const [tab, setTab] = useState("all");
  const [items, setItems] = useState(null);
  const [idx, setIdx] = useState(-1);
  const [share, setShare] = useState(null);
  const [albums, setAlbums] = useState(null);
  const [album, setAlbum] = useState(null);
  const load = useCallback(async () => {
    if (tab !== "albums") return setItems((await api.get("/photos", { params: { kind: tab } })).data);
    if (album) return setItems((await api.get(`/albums/${album.album_id}`)).data.files);
    setItems(null);
    setAlbums((await api.get("/albums")).data);
  }, [tab, album]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const g = [];
    (items || []).forEach((p, i) => {
      const l = dayLabel(p.taken_at || p.created_at);
      if (!g.length || g[g.length - 1].label !== l) g.push({ label: l, items: [] });
      g[g.length - 1].items.push({ ...p, i });
    });
    return g;
  }, [items]);

  const cur = items?.[idx];
  const fav = async () => {
    await api.patch(`/files/${cur.file_id}`, { favorite: !cur.favorite });
    setItems(items.map((x) => (x.file_id === cur.file_id ? { ...x, favorite: !x.favorite } : x)));
  };
  const del = async () => {
    try {
      await api.delete(`/files/${cur.file_id}`);
      toast.success("Moved to Recycle Bin");
      setItems(items.filter((x) => x.file_id !== cur.file_id));
      setIdx(-1);
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">My Photos</h1>
        <UploadButton auto onDone={load} testId="photos-upload-btn" label="Add photos" />
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {TABS.map(([v, l]) => (
          <button key={v} onClick={() => { setTab(v); setAlbum(null); }} data-testid={`photos-tab-${v}`}
            className={`px-5 h-10 rounded-full text-sm font-semibold shrink-0 ${tab === v ? "bg-[#1F94C8] text-white" : "bg-[#F7F7F7] text-[#5F6368]"}`}>{l}</button>
        ))}
      </div>
      {tab === "albums" && !album && <AlbumGrid albums={albums} onOpen={setAlbum} />}
      {album && <div className="flex items-center gap-3"><button onClick={() => setAlbum(null)} data-testid="album-back-btn" className="w-10 h-10 rounded-xl bg-[#F7F7F7] flex items-center justify-center" aria-label="Back to albums"><ChevronLeft className="w-5 h-5" /></button>
        <div><p className="font-display font-bold text-xl" data-testid="album-title">{album.title}</p><p className="text-sm text-[#5F6368]">{album.subtitle || `${album.count} items`}</p></div></div>}
      {items && !items.length && <div className="rounded-2xl bg-[#FEF9E7] p-12 text-center text-[#5F6368]" data-testid="photos-empty-state">No photos here yet. Add photos or import them from Google Takeout or iCloud.</div>}
      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="font-display font-bold text-base mb-3 text-[#5F6368]">{g.label}</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5 sm:gap-2">
            {g.items.map((p) => (
              <button key={p.file_id} onClick={() => setIdx(p.i)} data-testid={`photo-item-${p.file_id}`}
                className="relative aspect-square overflow-hidden rounded-lg sm:rounded-xl group">
                <FileThumb file={p} className="w-full h-full transition-transform duration-300 group-hover:scale-105" />
                {p.kind === "video" && <Play className="absolute bottom-2 left-2 w-5 h-5 text-white fill-white drop-shadow" />}
                {p.favorite && <Heart className="absolute top-2 right-2 w-4 h-4 text-white fill-[#E5AA16] drop-shadow" />}
              </button>
            ))}
          </div>
        </section>
      ))}

      <Dialog open={!!cur} onOpenChange={() => setIdx(-1)}>
        <DialogContent className="max-w-5xl bg-[#121316] border-0 rounded-2xl p-4 sm:p-6 [&>button]:hidden" data-testid="photo-lightbox">
          {cur && <>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-white/90 text-sm font-medium truncate">{cur.name}</DialogTitle>
              <div className="flex gap-2">
                <Btn on={fav} label="Favourite" testId="lightbox-favorite-btn"><Heart className={`w-5 h-5 ${cur.favorite ? "fill-[#E5AA16] text-[#E5AA16]" : ""}`} /></Btn>
                <Btn on={() => downloadFile(cur.file_id)} label="Download" testId="lightbox-download-btn"><Download className="w-5 h-5" /></Btn>
                <Btn on={() => setShare(cur)} label="Share" testId="lightbox-share-btn"><Share2 className="w-5 h-5" /></Btn>
                <Btn on={del} label="Delete" testId="lightbox-delete-btn"><Trash2 className="w-5 h-5" /></Btn>
                <Btn on={() => setIdx(-1)} label="Close" testId="lightbox-close-btn"><X className="w-5 h-5" /></Btn>
              </div>
            </div>
            <div className="relative flex items-center justify-center min-h-[50vh]">
              <FilePreview file={cur} />
              {idx > 0 && <button onClick={() => setIdx(idx - 1)} data-testid="lightbox-prev-btn" aria-label="Previous" className="absolute left-0 w-11 h-11 rounded-full bg-white/15 text-white flex items-center justify-center"><ChevronLeft /></button>}
              {idx < items.length - 1 && <button onClick={() => setIdx(idx + 1)} data-testid="lightbox-next-btn" aria-label="Next" className="absolute right-0 w-11 h-11 rounded-full bg-white/15 text-white flex items-center justify-center"><ChevronRight /></button>}
            </div>
          </>}
        </DialogContent>
      </Dialog>
      <ShareDialog file={share} onOpenChange={() => setShare(null)} />
    </div>
  );
}
