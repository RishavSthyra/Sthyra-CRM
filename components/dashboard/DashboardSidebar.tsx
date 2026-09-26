"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRightLeft,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ClipboardCheck,
  LayoutDashboard,
  Settings,
  UserRoundPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

const primaryItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/leads", icon: UserRoundPlus, label: "Leads" },
  { href: "/activity", icon: ChartNoAxesColumnIncreasing, label: "Activity" },
  { href: "/calendar", icon: CalendarDays, label: "Calendar" },
  { href: "/inventory", icon: ClipboardCheck, label: "Inventory" },
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
}: {
  active?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
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
        className={`flex size-8 items-center justify-center rounded-lg transition-colors group-hover/item:bg-white/[0.07] ${
          active ? "bg-white/[0.12]" : "bg-transparent"
        }`}
      >
        <Icon aria-hidden className="size-[15px]" strokeWidth={1.8} />
      </span>
      <span className="max-w-full text-[9px] leading-[11px] font-medium whitespace-normal">
        {label}
      </span>
    </Link>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
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
          <div className="my-1.5 h-px w-8 bg-white/[0.12]" />
          <NavItem
            active={isActive("/settings") || isActive("/preferences")}
            href="/settings"
            icon={Settings}
            label="Settings"
          />
        </nav>
      </div>
    </aside>
  );
}
