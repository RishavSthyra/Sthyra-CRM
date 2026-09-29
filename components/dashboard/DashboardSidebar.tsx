"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  ArrowRightLeft,
  Bell,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ClipboardCheck,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Megaphone,
  Settings,
  Target,
  UserRoundPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

const primaryItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/leads", icon: UserRoundPlus, label: "Leads" },
  { href: "/opportunities", icon: Target, label: "Opportunities" },
  { href: "/activity", icon: ChartNoAxesColumnIncreasing, label: "Activity" },
  { href: "/calendar", icon: CalendarDays, label: "Calendar" },
  { href: "/inventory", icon: ClipboardCheck, label: "Inventory" },
  { href: "/marketing", icon: Megaphone, label: "Marketing" },
];
const secondaryItems = [
  { href: "/transfers", icon: ArrowRightLeft, label: "Transfers" },
  { href: "/team-members", icon: UsersRound, label: "Team Members" },
];

function NavItem({
  active = false,
  href,
  icon: Icon,
  label,
  badge,
}: {
  active?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`group/item flex w-full flex-col items-center justify-start gap-1 rounded-lg px-0.5 py-1 text-center text-[#aeb4b1] no-underline transition-colors hover:text-white ${
        active ? "text-white" : ""
      }`}
      href={href}
      title={label}
    >
      <span
        className={`relative flex size-8 items-center justify-center rounded-lg transition-colors group-hover/item:bg-white/[0.07] ${
          active ? "bg-white/[0.12]" : "bg-transparent"
        }`}
      >
        <Icon aria-hidden className="size-[15px]" strokeWidth={1.8} />
        {Boolean(badge) && (
          <span className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-[#55d6b2] px-1 text-[8px] leading-4 font-bold text-[#07100d]">
            {badge && badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span className="max-w-full text-[9px] leading-[11px] font-medium whitespace-normal">
        {label}
      </span>
    </Link>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await fetchWithSession(
        "/api/notifications/unread-count",
        {
          cache: "no-store",
        },
      );
      if (!response.ok) return;
      const body = (await response.json()) as { unread_count?: number };
      setUnreadCount(Number(body.unread_count ?? 0));
    } catch {
      // Navigation remains usable when the count endpoint is unavailable.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadUnreadCount(), 0);
    const interval = window.setInterval(() => void loadUnreadCount(), 30_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadUnreadCount();
    };
    window.addEventListener("notifications:changed", loadUnreadCount);
    window.addEventListener("focus", loadUnreadCount);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("notifications:changed", loadUnreadCount);
      window.removeEventListener("focus", loadUnreadCount);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadUnreadCount]);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await getApiError(response));
      router.replace("/login");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to log out");
      setLoggingOut(false);
    }
  }

  return (
    <aside className="fixed inset-y-3 left-3 z-50 flex w-[68px] flex-col overflow-hidden rounded-[19px] border border-white/[0.11] bg-[#0d100f] shadow-[0_20px_55px_rgba(0,0,0,0.4)] max-[560px]:inset-y-2 max-[560px]:left-2">
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-white/[0.09]">
        <Link
          aria-label="Dashboard"
          className="flex size-9 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
          href="/dashboard"
        >
          <Image
            alt=""
            className="size-7 object-contain"
            height={28}
            priority
            src="/sthyra-logo.png"
            width={28}
          />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <nav
          aria-label="Workspace navigation"
          className="flex flex-col items-center gap-0.5"
        >
          {primaryItems.map((item) => (
            <NavItem
              active={isActive(item.href)}
              href={item.href}
              icon={item.icon}
              key={item.href}
              label={item.label}
            />
          ))}
          <div className="my-1.5 h-px w-8 bg-white/[0.12]" />
          {secondaryItems.map((item) => (
            <NavItem
              active={isActive(item.href)}
              href={item.href}
              icon={item.icon}
              key={item.href}
              label={item.label}
            />
          ))}
          <NavItem
            active={isActive("/notifications")}
            badge={unreadCount}
            href="/notifications"
            icon={Bell}
            label="Notifications"
          />
          <div className="my-1.5 h-px w-8 bg-white/[0.12]" />
          <NavItem
            active={isActive("/settings") || isActive("/preferences")}
            href="/settings"
            icon={Settings}
            label="Settings"
          />
        </nav>
      </div>
      <div className="shrink-0 border-t border-white/[0.09] px-1.5 py-2">
        <button
          aria-label="Log out"
          className="group/item flex w-full flex-col items-center justify-start gap-1 rounded-lg px-0.5 py-1 text-center text-[#aeb4b1] transition-colors hover:text-[#ff8e88] disabled:cursor-wait disabled:opacity-60"
          disabled={loggingOut}
          onClick={() => void logout()}
          title="Log out"
          type="button"
        >
          <span className="flex size-8 items-center justify-center rounded-lg transition-colors group-hover/item:bg-[#ff5d55]/10">
            {loggingOut ? (
              <LoaderCircle
                aria-hidden
                className="size-[15px] animate-spin"
                strokeWidth={1.8}
              />
            ) : (
              <LogOut aria-hidden className="size-[15px]" strokeWidth={1.8} />
            )}
          </span>
          <span className="text-[9px] leading-[11px] font-medium">Log out</span>
        </button>
      </div>
    </aside>
  );
}
