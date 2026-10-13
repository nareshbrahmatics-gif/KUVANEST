import { FileText, FileArchive, Film, Music, File, Image as ImageIcon } from "lucide-react";
import { fileUrl } from "@/lib/api";

const ICONS = { document: FileText, archive: FileArchive, video: Film, audio: Music, image: ImageIcon, other: File };
const TINT = { document: "#1A73E8", archive: "#1E8E3E", video: "#C98F0A", audio: "#D93025", image: "#E5AA16", other: "#5F6368" };

export const canPreviewImage = (f) => f.kind === "image" && !/image\/hei[cf]/.test(f.mime);

export const FileThumb = ({ file, className = "w-full h-full", iconSize = "w-8 h-8" }) => {
  if (canPreviewImage(file)) {
    return <img src={fileUrl(file.file_id)} alt={file.name} loading="lazy" className={`${className} object-cover`} />;
  }
  const Icon = ICONS[file.kind] || File;
  return (
    <div className={`${className} flex items-center justify-center bg-[#F7F7F7]`}>
      <Icon className={iconSize} style={{ color: TINT[file.kind] || TINT.other }} />
    </div>
  );
};
