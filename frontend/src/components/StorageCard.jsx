import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { fmtBytes } from "@/lib/api";

const SEG = [
  { k: "image", label: "Photos", c: "#E5AA16" },
  { k: "video", label: "Videos", c: "#C98F0A" },
  { k: "document", label: "Docs", c: "#1A73E8" },
  { k: "archive", label: "Archives", c: "#1E8E3E" },
  { k: "other", label: "Other", c: "#9AA0A6" },
];

export const StorageCard = ({ s }) => {
  if (!s) return <div className="h-48 rounded-2xl bg-[#F7F7F7] animate-pulse" />;
  const pct = s.quota ? Math.min(100, (s.used / s.quota) * 100) : 0;
  const part = (k) => (s.breakdown?.[k]?.bytes || 0) + (k === "other" ? s.breakdown?.audio?.bytes || 0 : 0);
  return (
    <div className="rounded-2xl bg-[#202124] text-white p-6 sm:p-7 relative overflow-hidden" data-testid="storage-card">
      <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-[#E5AA16]/20 blur-2xl" />
      <div className="flex items-start justify-between gap-4 relative">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F4C84D]">Your personal storage · {s.plan?.name}</p>
          <p className="font-display text-4xl sm:text-5xl font-extrabold mt-3" data-testid="storage-used">{fmtBytes(s.used)}</p>
          <p className="text-white/70 mt-1" data-testid="storage-quota">of {fmtBytes(s.quota)} used</p>
        </div>
        <Link to="/plans" data-testid="storage-upgrade-button"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[#E5AA16] text-[#202124] font-semibold px-5 py-2.5 hover:bg-[#F4C84D] transition-colors">
          Upgrade <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="relative mt-6 h-3 rounded-full bg-white/10 overflow-hidden flex" aria-label={`${pct.toFixed(1)}% used`}>
        {SEG.map(({ k, c }) => (
          <div key={k} style={{ width: `${s.quota ? (part(k) / s.quota) * 100 : 0}%`, background: c, minWidth: part(k) ? 3 : 0 }} />
        ))}
      </div>
      <div className="relative mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="font-semibold text-[#F4C84D]" data-testid="storage-available">{fmtBytes(s.available)} available</span>
        {SEG.filter(({ k }) => part(k) > 0).map(({ k, label, c }) => (
          <span key={k} className="flex items-center gap-1.5 text-white/75"><i className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{label} {fmtBytes(part(k))}</span>
        ))}
      </div>
    </div>
  );
};
