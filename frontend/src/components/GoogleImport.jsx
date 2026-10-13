import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HardDrive, Image as ImageIcon, Link2, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";

const loadScript = (src) => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const s = document.createElement("script");
  s.src = src; s.onload = resolve; s.onerror = reject;
  document.body.appendChild(s);
});

async function openDrivePicker() {
  const { data: c } = await api.get("/google/picker-config");
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((r) => window.gapi.load("picker", r));
  const g = window.google.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.DOCS).setIncludeFolders(false).setSelectFolderEnabled(false);
    new g.PickerBuilder().setDeveloperKey(c.api_key).setAppId(c.app_id).setOAuthToken(c.access_token)
      .enableFeature(g.Feature.MULTISELECT_ENABLED).addView(view)
      .setCallback((d) => {
        if (d.action === g.Action.PICKED) resolve(d.docs.map((x) => x.id));
        if (d.action === g.Action.CANCEL) resolve([]);
      }).build().setVisible(true);
  });
}

export const GoogleImportCard = ({ onJob }) => {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState("");
  const [session, setSession] = useState(null);
  const [params, setParams] = useSearchParams();
  const poll = useRef();

  useEffect(() => {
    api.get("/google/status").then(({ data }) => setSt(data));
    const g = params.get("google");
    if (g) {
      ({ connected: () => toast.success("Google account connected"), denied: () => toast.error("Google access was not granted"), error: () => toast.error("Could not connect Google. Try again.") })[g]?.();
      setParams({}, { replace: true });
    }
    return () => clearInterval(poll.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    try { const { data } = await api.post("/google/oauth/start", { origin_url: window.location.origin }); window.location.href = data.url; }
    catch (e) { toast.error(errMsg(e)); }
  };
  const drive = async () => {
    setBusy("drive");
    try {
      const ids = await openDrivePicker();
      if (ids.length) { const { data } = await api.post("/google/drive/import", { file_ids: ids }); toast.success(`${ids.length} Drive file(s) moving to KuvaNest`); onJob(data); }
    } catch (e) { toast.error(e.response ? errMsg(e) : "Could not open Google Drive picker"); }
    setBusy("");
  };
  const checkPhotos = async (sid) => {
    const { data } = await api.post(`/google/photos/${sid}/import`);
    if (!data.ready) return false;
    clearInterval(poll.current); setSession(null); setBusy("");
    if (data.job) { toast.success(`${data.job.total_files} photo(s) moving to KuvaNest`); onJob(data.job); } else toast("No photos were selected");
    return true;
  };
  const photos = async () => {
    setBusy("photos");
    try {
      const { data } = await api.post("/google/photos/session");
      setSession(data.session_id);
      window.open(data.picker_uri, "kn-google-photos", "width=1000,height=760");
      poll.current = setInterval(() => checkPhotos(data.session_id).catch(() => {}), 4000);
    } catch (e) { toast.error(errMsg(e)); setBusy(""); }
  };

  if (!st) return null;
  const Row = ({ icon: I, title, sub, action }) => (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#F7F7F7] px-4 py-3">
      <I className="w-5 h-5 text-[#1F94C8]" /><div className="flex-1 min-w-[150px]"><p className="text-sm font-semibold">{title}</p><p className="text-xs text-[#5F6368]">{sub}</p></div>{action}
    </div>
  );
  return (
    <div className="rounded-2xl border border-gray-200 p-6 space-y-3" data-testid="google-import-card">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display font-bold">One-tap import from Google</p>
        {st.connected && <button className="text-xs text-[#5F6368] underline" data-testid="google-disconnect-btn" onClick={() => api.post("/google/disconnect").then(() => setSt({ ...st, connected: false }))}>Disconnect</button>}
      </div>
      <p className="text-sm text-[#5F6368]">Pick files and albums. KuvaNest copies them in the background; originals stay in Google.</p>
      {!st.configured ? (
        <div className="flex items-center gap-2 rounded-xl bg-[#F7F7F7] px-4 py-3 text-sm text-[#5F6368]" data-testid="google-import-not-configured"><Lock className="w-4 h-4" />Not set up yet — the admin needs to add Google API keys.</div>
      ) : !st.connected ? (
        <Button onClick={connect} className="w-full h-11 rounded-xl font-semibold" data-testid="google-connect-btn"><Link2 className="w-4 h-4" />Connect Google account</Button>
      ) : <>
        <Row icon={HardDrive} title="Google Drive" sub="Docs export as Word/Excel/PowerPoint"
          action={<Button size="sm" className="rounded-lg" disabled={!!busy} onClick={drive} data-testid="google-drive-pick-btn">{busy === "drive" && <Loader2 className="w-4 h-4 animate-spin" />}Choose files</Button>} />
        <Row icon={ImageIcon} title="Google Photos" sub={session ? "Finish selecting in the Google window…" : "Original quality photos & videos"}
          action={<Button size="sm" className="rounded-lg" disabled={!!busy} onClick={photos} data-testid="google-photos-pick-btn">{busy === "photos" && <Loader2 className="w-4 h-4 animate-spin" />}Choose photos</Button>} />
      </>}
    </div>
  );
};
