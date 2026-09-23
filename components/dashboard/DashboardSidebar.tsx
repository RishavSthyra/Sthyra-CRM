"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const icons = {
  logo: "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/6517c.svg",
  bell: "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/a3f57.svg",
  dashboard:
    "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/59e8e.svg",
  leads:
    "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/8e64f.svg",
  activity:
    "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/1b83e.svg",
  calendar:
    "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/886a2.svg",
  inventory:
    "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/cae45.svg",
  transfers:
    "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/fb3bd.svg",
  team: "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/47a06.svg",
  settings:
    "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/d5fba.svg",
};

const primaryItems = [
  { href: "/dashboard", icon: icons.dashboard, label: "Dashboard" },
  { href: "/leads", icon: icons.leads, label: "Leads" },
  { href: "/activity", icon: icons.activity, label: "Activity" },
  { href: "/calendar", icon: icons.calendar, label: "Calendar" },
  { href: "/inventory", icon: icons.inventory, label: "Inventory" },
];
const secondaryItems = [
  { href: "/transfers", icon: icons.transfers, label: "Transfers" },
  { href: "/team-members", icon: icons.team, label: "Team Members" },
];

function NavItem({
  active = false,
  href,
  icon,
  label,
}: {
  active?: boolean;
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`flex h-11 w-full items-center gap-2.5 rounded-xl border-0 px-3 text-left text-[#f5f5f5] no-underline transition-colors hover:bg-[#2c2c2c] max-[900px]:justify-center max-[900px]:px-0 ${
        active ? "bg-[#2c2c2c]" : "bg-transparent"
      }`}
      href={href}
      title={label}
    >
      <img
        alt=""
        className="size-5 shrink-0 object-contain"
        height={20}
        src={icon}
        width={20}
      />
      <span className="whitespace-nowrap text-sm opacity-0 transition-opacity duration-100 group-hover/sidebar:opacity-100 max-[900px]:hidden">
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
    <aside className="peer group/sidebar fixed inset-y-3 left-3 z-50 flex w-[76px] flex-col overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#111] transition-[width] duration-200 hover:w-[226px] max-[900px]:w-[226px] max-[560px]:inset-x-2 max-[560px]:top-2 max-[560px]:bottom-auto max-[560px]:h-16 max-[560px]:w-auto max-[560px]:hover:w-auto">
      <div className="basis-24 border-b border-[#2c2c2c] p-4 transition-[flex-basis] duration-200 group-hover/sidebar:basis-[164px] max-[560px]:basis-16 max-[560px]:border-0 max-[560px]:px-4 max-[560px]:py-3 max-[560px]:group-hover/sidebar:basis-16">
        <div className="flex flex-col items-start justify-start gap-4 group-hover/sidebar:flex-row group-hover/sidebar:items-center group-hover/sidebar:justify-between max-[900px]:flex-col max-[560px]:flex-row">
          <Link aria-label="Dashboard" href="/dashboard">
            <img alt="Sthyra CRM" height={30} src={icons.logo} width={30} />
          </Link>
          <Link
            aria-label="Notifications"
            className="hidden size-9 items-center justify-center rounded-xl border border-[#3b3b3b] bg-[#2c2c2c] group-hover/sidebar:flex max-[560px]:group-hover/sidebar:hidden"
            href="/notifications"
          >
            <img
              alt=""
              className="size-5"
              height={24}
              src={icons.bell}
              width={24}
            />
          </Link>
        </div>
        <div className="mt-9 flex flex-col gap-1 opacity-0 transition-opacity duration-100 group-hover/sidebar:opacity-100 max-[900px]:hidden">
          <span className="text-xs">Welcome!</span>
          <strong className="font-[var(--font-bricolage)] text-2xl">
            John Doe
          </strong>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-between p-4 max-[560px]:hidden">
        <nav
          aria-label="Workspace navigation"
          className="flex min-h-0 flex-col gap-2.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
          <div className="my-1.5 border-t border-[#2c2c2c]" />
          {secondaryItems.map((item) => (
            <NavItem
              active={isActive(item.href)}
              href={item.href}
              icon={item.icon}
              key={item.href}
              label={item.label}
            />
          ))}
        </nav>
        <div className="border-t border-[#2c2c2c] pt-2">
          <NavItem
            active={isActive("/settings") || isActive("/preferences")}
            href="/settings"
            icon={icons.settings}
            label="Settings"
          />
        </div>
      </div>
    </aside>
  );
}
