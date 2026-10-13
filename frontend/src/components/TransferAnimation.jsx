import { motion } from "framer-motion";
import { FileText, Image as ImageIcon, Film, Cloud } from "lucide-react";
import { FolderIcon } from "@/components/Brand";

const FLYERS = [FileText, ImageIcon, Film, ImageIcon, FileText];

export const TransferAnimation = ({ from = "Google", label, pct }) => (
  <div className="rounded-2xl bg-[#E8F4FA] border border-[#BFE0F1] p-5 sm:p-6 overflow-hidden" data-testid="transfer-animation">
    <div className="relative h-28 flex items-center justify-between px-2 sm:px-8">
      <div className="flex flex-col items-center gap-2 z-10">
        <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2, repeat: Infinity }}
          className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center"><Cloud className="w-8 h-8 text-[#1F94C8]" /></motion.div>
        <span className="text-xs font-semibold text-[#156E96]">{from}</span>
      </div>
      <div className="absolute left-24 right-24 sm:left-32 sm:right-32 top-1/2 -translate-y-6 border-t-2 border-dashed border-[#9CD3EE]" />
      {FLYERS.map((I, i) => (
        <motion.div key={i} className="absolute w-8 h-8 -ml-4 -mt-4 rounded-lg bg-white shadow flex items-center justify-center"
          initial={{ left: "20%", top: "40%", opacity: 0 }}
          animate={{ left: ["20%", "50%", "80%"], top: ["40%", "8%", "40%"], opacity: [0, 1, 0], scale: [0.6, 1, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.48, ease: "easeInOut" }}>
          <I className="w-4 h-4 text-[#1F94C8]" />
        </motion.div>
      ))}
      <div className="flex flex-col items-center gap-2 z-10">
        <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 1.2, repeat: Infinity }}><FolderIcon className="w-16 h-14" /></motion.div>
        <span className="text-xs font-semibold text-[#9A6A00]">KuvaNest</span>
      </div>
    </div>
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="font-semibold text-[#156E96]" data-testid="transfer-animation-label">{label}</span>
      {pct != null && <span className="font-bold text-[#202124]">{pct}%</span>}
    </div>
    {pct != null && <div className="mt-2 h-2 rounded-full bg-white overflow-hidden"><motion.div className="h-full bg-[#1F94C8]" animate={{ width: `${pct}%` }} /></div>}
  </div>
);
