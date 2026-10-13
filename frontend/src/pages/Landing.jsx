import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Smartphone, IndianRupee, Users, Building2, HardDrive, Image, FileText, Film, Cloud } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Logo, FolderIcon } from "@/components/Brand";
import { PlanCard } from "@/pages/Plans";
import { api } from "@/lib/api";

const PhoneMock = () => (
  <div className="relative mx-auto w-[300px] rounded-[2.5rem] bg-[#202124] p-3 shadow-[0_40px_80px_-30px_rgba(32,33,36,.55)] kn-rise">
    <div className="rounded-[2rem] bg-white overflow-hidden">
      <div className="p-5 bg-[#202124] text-white">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#F4C84D] font-bold">Your personal storage</p>
        <p className="font-display text-3xl font-extrabold mt-1">32.5 GB</p>
        <p className="text-xs text-white/70">of 100 GB used · 67.5 GB available</p>
        <div className="h-2 rounded-full bg-white/10 mt-3 overflow-hidden"><div className="h-full w-1/3 bg-[#E5AA16]" /></div>
      </div>
      <div className="p-4 grid grid-cols-2 gap-2.5">
        {[["My Photos", "2,450 items", Image], ["My Documents", "125 files", FileText], ["My Videos", "82 videos", Film], ["Google Backup", "Imported", Cloud]].map(([n, s, G]) => (
          <div key={n} className="rounded-xl bg-[#FEF9E7] border border-[#F3E2B4] p-3"><FolderIcon className="w-10 h-8"><G className="w-3.5 h-3.5" /></FolderIcon><p className="text-xs font-bold mt-2">{n}</p><p className="text-[10px] text-[#5F6368]">{s}</p></div>
        ))}
      </div>
      <div className="grid grid-cols-5 border-t border-gray-100 py-2 text-[9px] text-center font-semibold text-[#5F6368]">{["Home", "Photos", "Files", "Transfer", "Account"].map((t, i) => <span key={t} className={i === 0 ? "text-[#9A6A00]" : ""}>{t}</span>)}</div>
    </div>
  </div>
);

const FAQ = [
  ["Will importing delete my Google or iCloud files?", "No. KuvaNest only copies your files. Your originals stay exactly where they are, and importing does not free up space with your old provider."],
  ["How does migration work?", "Export your data as a ZIP (Google Takeout, Apple privacy portal, Dropbox, OneDrive or Azure) and upload it. We safely extract it, skip duplicates, verify each file and organise everything into folders."],
  ["Is my data private?", "Files are private to your account and served only through authenticated access or links you create. Family members never see your private folders."],
  ["Can my business use KuvaNest?", "Yes. Choose a Business account to get pooled storage, team seats and admin audit logs."],
];

export default function Landing() {
  const [plans, setPlans] = useState([]);
  useEffect(() => { api.get("/plans").then(({ data }) => setPlans(data.filter((p) => p.price > 0))); }, []);
  return (
    <div className="bg-white">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-2">
            <a href="#pricing" className="hidden sm:inline px-4 py-2 text-sm font-semibold text-[#5F6368] hover:text-[#202124]">Pricing</a>
            <Link to="/login" className="px-4 py-2 text-sm font-semibold" data-testid="landing-signin-link">Sign in</Link>
            <Link to="/login" className="px-5 py-2.5 rounded-full bg-[#E5AA16] text-sm font-bold hover:bg-[#D4990B] transition-colors" data-testid="landing-get-started-header">Get started</Link>
          </nav>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-5 pt-14 pb-20 grid lg:grid-cols-[1.15fr_1fr] gap-14 items-center">
        <div className="kn-rise">
          <p className="inline-flex items-center gap-2 rounded-full bg-[#FFF7E6] px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-[#9A6A00]">India-first personal cloud</p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05] mt-6">Your Files. Your Photos.<br /><span className="text-[#C98F0A]">Your Storage.</span> One Simple Nest.</h1>
          <p className="text-base md:text-lg text-[#5F6368] mt-6 max-w-xl">Simple yellow folders, automatic photo backup and easy moving from Google, iCloud and Dropbox — at honest Indian prices starting ₹100/month.</p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link to="/login" data-testid="landing-hero-cta" className="inline-flex items-center gap-2 h-12 px-7 rounded-full bg-[#202124] text-white font-semibold hover:bg-black transition-colors">Create my KuvaNest <ArrowRight className="w-4 h-4" /></Link>
            <a href="#pricing" className="inline-flex items-center h-12 px-7 rounded-full border border-gray-200 font-semibold hover:border-[#E5AA16]" data-testid="landing-see-plans">See plans</a>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-8 text-sm text-[#5F6368]">
            {[[IndianRupee, "UPI-ready INR pricing"], [ShieldCheck, "Private by default"], [Smartphone, "Made for your phone"]].map(([I, t]) => <span key={t} className="flex items-center gap-2"><I className="w-4 h-4 text-[#C98F0A]" />{t}</span>)}
          </div>
        </div>
        <PhoneMock />
      </section>

      <section className="bg-[#202124] text-white">
        <div className="max-w-6xl mx-auto px-5 py-14 flex flex-wrap items-center justify-between gap-6">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F4C84D]">Move in, not start over</p><p className="font-display text-2xl sm:text-3xl font-extrabold mt-2">Bring everything from</p></div>
          <div className="flex flex-wrap gap-3">{["Google Takeout", "iCloud", "Dropbox", "OneDrive", "Azure Blob"].map((s) => <span key={s} className="px-5 py-3 rounded-full border border-white/15 font-semibold">{s}</span>)}</div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-20 grid md:grid-cols-3 gap-5">
        {[[FolderIcon, "Big yellow folders", "No confusing menus. Photos, documents and videos each have their own home."], [Users, "Families & teams", "Private folders for everyone, plus shared spaces for the family or your business."], [HardDrive, "Your own hard disk (soon)", "Pair a KuvaNest Box or your own disk for hybrid home + cloud backup."]].map(([I, t, d], i) => (
          <div key={t} className={`rounded-2xl p-7 ${i === 0 ? "bg-[#FEF9E7] md:row-span-2" : "bg-[#F7F7F7]"}`}>
            {i === 0 ? <FolderIcon className="w-16 h-14" /> : <I className="w-7 h-7 text-[#C98F0A]" />}
            <p className="font-display text-xl font-bold mt-5">{t}</p><p className="text-[#5F6368] mt-2">{d}</p>
          </div>
        ))}
        <div className="md:col-span-2 rounded-2xl border border-gray-200 p-7 flex flex-wrap items-center gap-5">
          <Building2 className="w-8 h-8 text-[#C98F0A]" /><div className="flex-1 min-w-[220px]"><p className="font-display text-xl font-bold">Built for individuals and enterprises</p><p className="text-[#5F6368] mt-1">Business accounts get pooled storage, team seats and audit logs.</p></div>
        </div>
      </section>

      <section id="pricing" className="bg-[#F7F7F7]">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">Simple monthly plans</h2>
          <p className="text-[#5F6368] mt-2">Billed in INR. GST extra. Change or cancel anytime.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 mt-10">{plans.map((p) => <PlanCard key={p.plan_id} p={p} />)}</div>
          <Link to="/login" className="inline-flex items-center gap-2 mt-8 h-12 px-7 rounded-full bg-[#E5AA16] font-bold" data-testid="landing-pricing-cta">Start free with 5 GB <ArrowRight className="w-4 h-4" /></Link>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-5 py-20">
        <h2 className="font-display text-3xl font-extrabold tracking-tight mb-6">Questions</h2>
        <Accordion type="single" collapsible>{FAQ.map(([q, a], i) => (
          <AccordionItem key={q} value={`q${i}`}><AccordionTrigger className="text-left font-semibold text-base" data-testid={`faq-${i}`}>{q}</AccordionTrigger><AccordionContent className="text-[#5F6368] text-base">{a}</AccordionContent></AccordionItem>
        ))}</Accordion>
      </section>

      <footer className="border-t border-gray-100"><div className="max-w-6xl mx-auto px-5 py-10 flex flex-wrap items-center justify-between gap-4 text-sm text-[#5F6368]"><Logo /><span>© {new Date().getFullYear()} KuvaNest · www.kuvanest.com</span></div></footer>
    </div>
  );
}
