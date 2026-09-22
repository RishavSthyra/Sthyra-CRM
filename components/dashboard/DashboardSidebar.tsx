"use client";

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
  preferences:
    "https://www.figma.com/api/mcp/asset/7d88936b-1213-4985-8f66-19df13e87427/d5fba.svg",
};

const primaryItems = [
  ["Dashboard", icons.dashboard],
  ["Leads", icons.leads],
  ["Activity", icons.activity],
  ["Calendar", icons.calendar],
  ["Inventory", icons.inventory],
];
const secondaryItems = [
  ["Transfers", icons.transfers],
  ["Team Members", icons.team],
];

function NavItem({
  active = false,
  icon,
  label,
}: {
  active?: boolean;
  icon: string;
  label: string;
}) {
  return (
    <button
      className={`dashboard-nav-item ${active ? "is-active" : ""}`}
      title={label}
      type="button"
    >
      <img alt="" height={20} src={icon} width={20} />
      <span>{label}</span>
    </button>
  );
}

export function DashboardSidebar({
  activeLabel = "Dashboard",
}: {
  activeLabel?: string;
}) {
  return (
    <aside className="dashboard-sidebar">
      <div className="dashboard-sidebar-top">
        <div className="dashboard-sidebar-brand">
          <img alt="Sthyra CRM" height={30} src={icons.logo} width={30} />
          <button
            aria-label="Notifications"
            className="dashboard-sidebar-toggle dashboard-notification"
            type="button"
          >
            <img alt="" height={24} src={icons.bell} width={24} />
          </button>
        </div>
        <div className="dashboard-welcome">
          <span>Welcome!</span>
          <strong>John Doe</strong>
        </div>
      </div>
      <div className="dashboard-sidebar-bottom">
        <nav aria-label="Workspace navigation">
          {primaryItems.map(([label, icon]) => (
            <NavItem
              active={label === activeLabel}
              icon={icon}
              key={label}
              label={label}
            />
          ))}
          <div className="dashboard-sidebar-divider" />
          {secondaryItems.map(([label, icon]) => (
            <NavItem icon={icon} key={label} label={label} />
          ))}
        </nav>
        <div className="dashboard-preferences">
          <NavItem icon={icons.preferences} label="Preferences" />
        </div>
      </div>
    </aside>
  );
}
