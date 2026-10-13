import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";

export async function uploadFiles(files, { folderId, auto, onProgress } = {}) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append("files", f));
  if (folderId) fd.append("folder_id", folderId);
  if (auto) fd.append("auto", "true");
  try {
    const { data } = await api.post("/files/upload", fd, {
      onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
    });
    const up = data.results.filter((r) => r.status === "uploaded").length;
    const dup = data.results.length - up;
    toast.success(`${up} file${up === 1 ? "" : "s"} uploaded${dup ? ` · ${dup} duplicate${dup === 1 ? "" : "s"} skipped` : ""}`);
    return data;
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}

export const UploadButton = ({ folderId, auto, onDone, label = "Upload", testId = "upload-btn", variant }) => {
  const ref = useRef();
  const [pct, setPct] = useState(null);
  const onPick = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    setPct(0);
    await uploadFiles(files, { folderId, auto, onProgress: setPct });
    setPct(null);
    e.target.value = "";
    onDone?.();
  };
  return (
    <>
      <input ref={ref} type="file" multiple hidden onChange={onPick} data-testid={`${testId}-input`} />
      <Button data-testid={testId} variant={variant} disabled={pct !== null} onClick={() => ref.current.click()}
        className="rounded-xl h-11 px-5 font-semibold">
        {pct !== null ? <><Loader2 className="w-4 h-4 animate-spin" /> {pct}%</> : <><Upload className="w-4 h-4" /> {label}</>}
      </Button>
    </>
  );
};
