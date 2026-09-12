"use client";

import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff } from "lucide-react";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/components/ui/cn";

interface Notification {
  id: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

export function NotificationWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch notifications on mount
  useEffect(() => {
    async function fetchNotifs() {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const json = await res.json();
          setNotifications(json.notifications || []);
        }
      } catch (err) {
        console.error("Failed to fetch notifications", err);
      }
    }
    fetchNotifs();
    // Poll every 30s
    const interval = setInterval(fetchNotifs, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKey);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const handleClear = async () => {
    try {
      const res = await fetch("/api/notifications/clear", { method: "POST" });
      if (res.ok) {
        setNotifications([]);
      }
    } catch (err) {
      console.error("Clear failed", err);
    }
  };

  const count = notifications.length;

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "relative grid h-9 w-9 place-items-center rounded-full border border-border bg-surface text-fg-muted transition-colors",
          "hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isOpen && "bg-surface-2 text-fg",
        )}
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="absolute right-0 top-[calc(100%+8px)] z-[1000] flex w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-border bg-surface shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-3">
              <h3 className="font-display text-sm font-semibold text-fg">Notifications</h3>
              {count > 0 && (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">{count} recent</span>
              )}
            </div>

            <div className="max-h-80 flex-1 overflow-y-auto">
              {count === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <BellOff className="h-8 w-8 text-fg-subtle" aria-hidden="true" />
                  <p className="text-sm text-fg-muted">No notifications yet</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {notifications.map((notification) => (
                    <li
                      key={notification.id}
                      className={cn("px-4 py-3", !notification.read && "bg-primary-soft/40")}
                    >
                      <p className={cn("text-sm text-fg", notification.read ? "font-medium" : "font-semibold")}>
                        {notification.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{notification.message}</p>
                      <p className="mt-1 text-[11px] text-fg-subtle">
                        {new Date(notification.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {count > 0 && (
              <div className="border-t border-border px-4 py-2.5">
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs font-semibold text-fg-muted transition-colors hover:text-danger"
                >
                  Clear all
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
