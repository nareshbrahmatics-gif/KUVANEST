export const FolderIcon = ({ className = "w-14 h-12", children }) => (
  <div className={`relative ${className}`}>
    <svg viewBox="0 0 64 52" className="w-full h-full drop-shadow-sm" aria-hidden="true">
      <path d="M4 9a6 6 0 0 1 6-6h13.8a6 6 0 0 1 4.4 1.9L32 9h22a6 6 0 0 1 6 6v3H4z" fill="#C98F0A" />
      <rect x="2" y="13" width="60" height="37" rx="7" fill="#E5AA16" />
      <rect x="2" y="13" width="60" height="9" rx="5" fill="#F4C84D" opacity=".55" />
    </svg>
    {children && <div className="absolute inset-0 top-[30%] flex items-center justify-center text-white/95">{children}</div>}
  </div>
);

export const Logo = ({ compact = false, light = false }) => (
  <div className="flex items-center gap-2.5" data-testid="kuvanest-logo">
    <div className="w-10 h-10 rounded-xl bg-[#1F94C8] flex items-center justify-center shadow-[0_6px_16px_-6px_rgba(31,148,200,.7)]">
      <img src="/brand/kuvanest-mark.png" alt="" className="w-6 h-6 object-contain" />
    </div>
    {!compact && <span className={`font-display font-extrabold text-xl tracking-[0.18em] ${light ? "text-white" : "text-[#1F94C8]"}`}>KUVANEST</span>}
  </div>
);
