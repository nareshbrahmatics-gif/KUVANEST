import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, HardDrive, Receipt, CalendarClock, ArrowLeftRight, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, fmtDate } from "@/lib/api";

const ICON = { storage: HardDrive, payment: Receipt, renewal: CalendarClock, import: ArrowLeftRight, family: Users };

export const NotificationBell = ({ testId = "notification-bell" }) => {
  const [d, setD] = useState({ items: [], unread: 0 });
  const nav = useNavigate();
  const load = useCallback(() => api.get("/notifications").then(({ data }) => setD(data)).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const onOpen = (o) => { if (o && d.unread) api.post("/notifications/read-all").then(() => setD((x) => ({ ...x, unread: 0 }))); if (o) load(); };

  return (
    <Popover onOpenChange={onOpen}>
      <PopoverTrigger asChild>
        <button aria-label="Notifications" data-testid={testId} className="relative w-11 h-11 rounded-xl flex items-center justify-center text-[#5F6368] hover:bg-[#F7F7F7]">
          <Bell className="w-5 h-5" />
          {d.unread > 0 && <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D93025] text-white text-[10px] font-bold flex items-center justify-center" data-testid={`${testId}-count`}>{d.unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0 rounded-2xl bg-white" data-testid="notification-panel">
        <p className="px-4 py-3 font-display font-bold border-b border-gray-100">Notifications</p>
        <div className="max-h-96 overflow-y-auto">
          {!d.items.length && <p className="p-6 text-center text-sm text-[#5F6368]">You're all caught up.</p>}
          {d.items.map((n) => {
            const I = ICON[n.type] || Bell;
            return (
              <button key={n.notification_id} onClick={() => n.link && nav(n.link)} data-testid={`notification-${n.notification_id}`}
                className={`w-full text-left flex gap-3 px-4 py-3 border-b border-gray-50 hover:bg-[#F7F7F7] ${n.read ? "" : "bg-[#E8F4FA]/50"}`}>
                <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${n.type === "storage" ? "bg-red-50 text-[#D93025]" : "bg-[#E8F4FA] text-[#1F94C8]"}`}><I className="w-4 h-4" /></span>
                <span className="min-w-0"><span className="block text-sm font-semibold">{n.title}</span><span className="block text-xs text-[#5F6368]">{n.body}</span><span className="block text-[11px] text-[#80868B] mt-0.5">{fmtDate(n.created_at)}</span></span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
