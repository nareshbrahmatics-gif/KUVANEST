import { NavLink, Outlet, Link } from "react-router-dom";
import { Home, Image, FolderOpen, ArrowLeftRight, UserRound, Trash2, CreditCard, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/Brand";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/photos", label: "Photos", icon: Image },
  { to: "/files", label: "Files", icon: FolderOpen },
  { to: "/transfer", label: "Transfer", icon: ArrowLeftRight },
  { to: "/account", label: "Account", icon: UserRound },
];
const EXTRA = [
  { to: "/family", label: "Family", icon: Users },
  { to: "/bin", label: "Recycle Bin", icon: Trash2 },
  { to: "/plans", label: "Plans & Billing", icon: CreditCard },
];

const SideLink = ({ to, label, icon: Icon }) => (
  <NavLink
    to={to}
    data-testid={`sidebar-nav-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    className={({ isActive }) =>
      `flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-colors ${
        isActive ? "bg-[#E8F4FA] text-[#156E96]" : "text-[#5F6368] hover:bg-[#F7F7F7] hover:text-[#202124]"
      }`
    }
  >
    <Icon className="w-5 h-5" strokeWidth={2} /> {label}
  </NavLink>
);

export default function AppLayout() {
  const { user } = useAuth();
  const links = [...NAV, ...EXTRA, ...(user?.role === "admin" ? [{ to: "/admin", label: "Admin", icon: ShieldCheck }] : [])];
  return (
    <div className="min-h-screen bg-white">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-gray-100 bg-white px-4 py-6 z-40">
        <Link to="/home" className="px-3 mb-8"><Logo /></Link>
        <nav className="flex flex-col gap-1">{links.map((l) => <SideLink key={l.to} {...l} />)}</nav>
        <div className="mt-auto px-3 text-xs text-[#80868B]">Your Files. Your Photos.<br />Your Storage. One Simple Nest.</div>
      </aside>

      <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-16 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <Link to="/home"><Logo /></Link>
        <div className="flex items-center gap-1">
          {EXTRA.concat(user?.role === "admin" ? [{ to: "/admin", label: "Admin", icon: ShieldCheck }] : []).map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} aria-label={label} data-testid={`mobile-header-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-[#5F6368] hover:bg-[#F7F7F7]">
              <Icon className="w-5 h-5" />
            </Link>
          ))}
        </div>
      </header>

      <main className="md:pl-64 pb-28 md:pb-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-6 md:py-10"><Outlet /></div>
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-100 grid grid-cols-5 px-2 pb-[env(safe-area-inset-bottom)]" data-testid="mobile-bottom-nav">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} data-testid={`bottom-nav-${label.toLowerCase()}`}
            className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 my-1.5 rounded-xl text-[11px] font-semibold transition-colors ${isActive ? "bg-[#E8F4FA] text-[#156E96]" : "text-[#5F6368]"}`}>
            <Icon className="w-5 h-5" /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
