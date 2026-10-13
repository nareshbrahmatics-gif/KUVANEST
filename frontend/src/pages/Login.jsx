import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Logo, FolderIcon } from "@/components/Brand";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const googleLogin = () => {
  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
  const redirectUrl = window.location.origin + "/home";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
};

const Field = ({ id, label, ...p }) => (
  <div className="space-y-2">
    <Label htmlFor={id} className="text-sm font-semibold">{label}</Label>
    <Input id={id} className="h-12 rounded-xl" data-testid={`${id}-input`} {...p} />
  </div>
);

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "", name: "", account_type: "individual" });
  const [busy, setBusy] = useState(false);
  const { setUser } = useAuth();
  const nav = useNavigate();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (mode) => async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = mode === "login" ? { email: form.email, password: form.password } : form;
      const { data } = await api.post(`/auth/${mode}`, body);
      setUser(data.user);
      nav("/home");
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };

  const GoogleBtn = () => (
    <Button type="button" variant="outline" onClick={googleLogin} data-testid="google-signin-btn"
      className="w-full h-12 rounded-xl font-semibold border-gray-200 hover:bg-[#F7F7F7]">
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#202124" strokeWidth="2" /><path d="M12 8v8M8 12h8" stroke="#E5AA16" strokeWidth="2.4" strokeLinecap="round" /></svg>
      Continue with Google
    </Button>
  );
  const Submit = ({ children, id }) => (
    <Button type="submit" disabled={busy} data-testid={id} className="w-full h-12 rounded-xl font-semibold text-base">
      {busy && <Loader2 className="w-4 h-4 animate-spin" />} {children}
    </Button>
  );

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-white">
      <div className="hidden lg:flex flex-col justify-between bg-[#FEF9E7] p-12 relative overflow-hidden">
        <Link to="/"><Logo /></Link>
        <div className="grid grid-cols-3 gap-5 max-w-md">
          {["My Photos", "My Documents", "My Videos", "Google Backup", "Family Files", "My Hard Disk"].map((n, i) => (
            <div key={n} className="kn-rise" style={{ animationDelay: `${i * 70}ms` }}>
              <FolderIcon className="w-20 h-16" /><p className="text-sm font-semibold mt-2">{n}</p>
            </div>
          ))}
        </div>
        <p className="font-display text-3xl font-extrabold leading-tight max-w-md">Your Files. Your Photos.<br />Your Storage. One Simple Nest.</p>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <Link to="/" className="lg:hidden inline-block mb-8"><Logo /></Link>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">Welcome to your nest</h1>
          <p className="text-[#5F6368] mt-2 mb-8">Sign in to see your files and photos. We never ask for your Google password.</p>
          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-2 w-full h-12 rounded-xl bg-[#F7F7F7] p-1">
              <TabsTrigger value="login" className="rounded-lg h-10" data-testid="tab-login">Sign in</TabsTrigger>
              <TabsTrigger value="register" className="rounded-lg h-10" data-testid="tab-register">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <form onSubmit={submit("login")} className="space-y-4 mt-6">
                <Field id="login-email" label="Email" type="email" required value={form.email} onChange={set("email")} />
                <Field id="login-password" label="Password" type="password" required value={form.password} onChange={set("password")} />
                <Submit id="login-submit-btn">Sign in</Submit>
              </form>
            </TabsContent>
            <TabsContent value="register">
              <form onSubmit={submit("register")} className="space-y-4 mt-6">
                <Field id="register-name" label="Full name" required value={form.name} onChange={set("name")} />
                <Field id="register-email" label="Email" type="email" required value={form.email} onChange={set("email")} />
                <Field id="register-password" label="Password (min 8 characters)" type="password" minLength={8} required value={form.password} onChange={set("password")} />
                <div className="grid grid-cols-2 gap-2">
                  {[["individual", "For me & family"], ["business", "For my business"]].map(([v, l]) => (
                    <button type="button" key={v} onClick={() => setForm({ ...form, account_type: v })} data-testid={`account-type-${v}`}
                      className={`h-12 rounded-xl text-sm font-semibold border transition-colors ${form.account_type === v ? "border-[#E5AA16] bg-[#FFF7E6] text-[#9A6A00]" : "border-gray-200"}`}>{l}</button>
                  ))}
                </div>
                <Submit id="register-submit-btn">Create my KuvaNest</Submit>
              </form>
            </TabsContent>
          </Tabs>
          <div className="flex items-center gap-3 my-6 text-xs text-[#80868B]"><span className="h-px flex-1 bg-gray-200" />OR<span className="h-px flex-1 bg-gray-200" /></div>
          <GoogleBtn />
          <p className="flex items-center gap-2 text-xs text-[#5F6368] mt-6"><ShieldCheck className="w-4 h-4 text-[#1E8E3E]" />Google sign-in only shares your name and email. Drive or Photos access is never requested at login.</p>
        </div>
      </div>
    </div>
  );
}
