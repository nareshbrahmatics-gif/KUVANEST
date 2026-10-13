import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import HomePage from "@/pages/Home";
import Files from "@/pages/Files";
import Photos from "@/pages/Photos";
import Transfer from "@/pages/Transfer";
import Bin from "@/pages/Bin";
import Plans from "@/pages/Plans";
import Account from "@/pages/Account";
import Admin from "@/pages/Admin";
import SharePage from "@/pages/SharePage";
import Family from "@/pages/Family";
import FamilyShared from "@/pages/FamilyShared";

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#E5AA16]" /></div>
);

function Protected({ children, admin }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} replace />;
  if (admin && user.role !== "admin") return <Navigate to="/home" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  const { user, loading } = useAuth();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={!loading && user ? <Navigate to={(new URLSearchParams(location.search).get("next") || "/home").replace(/^\/\/+/, "/")} replace /> : <Login />} />
      <Route path="/s/:token" element={<SharePage />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/files" element={<Files />} />
        <Route path="/files/:folderId" element={<Files />} />
        <Route path="/photos" element={<Photos />} />
        <Route path="/transfer" element={<Transfer />} />
        <Route path="/bin" element={<Bin />} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/account" element={<Account />} />
        <Route path="/family" element={<Family />} />
        <Route path="/family/:ownerId" element={<FamilyShared />} />
        <Route path="/family/:ownerId/:folderId" element={<FamilyShared />} />
        <Route path="/admin" element={<Protected admin><Admin /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
