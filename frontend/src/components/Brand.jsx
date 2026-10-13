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

export const Logo = ({ compact = false }) => (
  <div className="flex items-center gap-2.5" data-testid="kuvanest-logo">
    <div className="w-9 h-9 rounded-xl bg-[#E5AA16] flex items-center justify-center shadow-[0_6px_16px_-6px_rgba(201,143,10,.7)]">
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
        <path d="M3 13c2.5 5 15.5 5 18 0" stroke="#202124" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <circle cx="12" cy="9" r="3.4" fill="#fff" />
      </svg>
    </div>
    {!compact && <span className="font-display font-extrabold text-xl tracking-tight text-[#202124]">KuvaNest</span>}
  </div>
);
