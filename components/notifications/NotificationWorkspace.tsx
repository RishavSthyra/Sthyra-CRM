"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  CheckCheck,
  CircleAlert,
  RefreshCw,
  Settings2,
  UserRoundCheck,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type Notification = {
  notification_id: string;
  category: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "error";
  action_url: string | null;
  is_read: boolean;
  created_at: string;
};

type NotificationPreferences = {
  in_app_enabled: boolean;
  email_enabled: boolean;
  lead_assignment_enabled: boolean;
  appointment_enabled: boolean;
  site_visit_enabled: boolean;
  quotation_enabled: boolean;
  booking_enabled: boolean;
  transfer_enabled: boolean;
  follow_up_enabled: boolean;
};

const preferenceFields: Array<{
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}> = [
  {
    key: "lead_assignment_enabled",
    label: "Assignments",
    description: "Lead and opportunity ownership changes",
  },
  {
    key: "appointment_enabled",
    label: "Appointments",
    description: "Meeting updates and reminders",
  },
  {
    key: "site_visit_enabled",
    label: "Site visits",
    description: "Visit schedule and lifecycle changes",
  },
  {
    key: "follow_up_enabled",
    label: "Follow-ups",
    description: "Overdue next actions",
  },
  {
    key: "quotation_enabled",
    label: "Quotations",
    description: "Quotation creation and status changes",
  },
  {
    key: "booking_enabled",
    label: "Bookings",
    description: "Reservations, booking and payment updates",
  },
  {
    key: "transfer_enabled",
    label: "Transfers",
    description: "Ownership handoffs and decisions",
  },
];

const filters = [
  "all",
  "assignment",
  "appointment",
  "site_visit",
  "follow_up",
  "quotation",
  "booking",
  "transfer",
];

function iconFor(category: string) {
  if (category === "assignment") return UserRoundCheck;
  if (["appointment", "site_visit", "follow_up"].includes(category))
    return CalendarClock;
  if (["booking", "quotation", "transfer"].includes(category))
    return CheckCheck;
  return Bell;
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function NotificationWorkspace() {
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);
  const [preferenceBusy, setPreferenceBusy] = useState<string | null>(null);
  const hasSynced = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ limit: "100" });
    if (filter !== "all") query.set("category", filter);
    if (unreadOnly) query.set("unread", "true");
    try {
      if (!hasSynced.current) {
        const syncResponse = await fetchWithSession("/api/notifications/sync", {
          method: "POST",
        });
        if (syncResponse.ok) {
          hasSynced.current = true;
          window.dispatchEvent(new Event("notifications:changed"));
        }
      }
      const response = await fetchWithSession(`/api/notifications?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const body = (await response.json()) as { notifications: Notification[] };
      setItems(body.notifications);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load notifications",
      );
    } finally {
      setLoading(false);
    }
  }, [filter, unreadOnly]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function markRead(notification: Notification) {
    if (notification.is_read) return;
    const response = await fetchWithSession(
      `/api/notifications/${notification.notification_id}/read`,
      { method: "POST" },
    );
    if (response.ok) {
      setItems((current) =>
        current.map((item) =>
          item.notification_id === notification.notification_id
            ? { ...item, is_read: true }
            : item,
        ),
      );
      window.dispatchEvent(new Event("notifications:changed"));
    }
  }

  async function markAllRead() {
    const response = await fetchWithSession("/api/notifications/read-all", {
      method: "POST",
    });
    if (response.ok) {
      setItems((current) =>
        current.map((item) => ({ ...item, is_read: true })),
      );
      window.dispatchEvent(new Event("notifications:changed"));
    }
  }

  async function openPreferences() {
    setPreferencesOpen(true);
    if (preferences) return;
    try {
      const response = await fetchWithSession("/api/notification-preferences", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const body = (await response.json()) as {
        preferences: NotificationPreferences;
      };
      setPreferences(body.preferences);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to load preferences",
      );
    }
  }

  async function updatePreference(
    key: keyof NotificationPreferences,
    value: boolean,
  ) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, [key]: value });
    setPreferenceBusy(key);
    try {
      const response = await fetchWithSession("/api/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const body = (await response.json()) as {
        preferences: NotificationPreferences;
      };
      setPreferences(body.preferences);
      toast.success("Notification preference updated");
    } catch (cause) {
      setPreferences(previous);
      toast.error(
        cause instanceof Error ? cause.message : "Unable to update preference",
      );
    } finally {
      setPreferenceBusy(null);
    }
  }

  return (
    <main className="min-h-dvh bg-[#050706] text-[#edf1ef]">
      <DashboardSidebar />
      <section className="ml-[96px] min-h-dvh pr-8 pb-16 max-[700px]:ml-[84px] max-[700px]:pr-4">
        <header className="flex min-h-40 items-end justify-between gap-8 border-b border-white/[.1] py-8">
          <div>
            <p className="text-[10px] tracking-[.15em] text-[#69726d] uppercase">
              Workspace
            </p>
            <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(34px,4vw,54px)] leading-none">
              Notifications
            </h1>
            <p className="mt-3 text-sm text-[#89928d]">
              Assignments, deadlines and customer milestones that need your
              attention.
            </p>
          </div>
          <div className="flex items-center gap-5">
            <button
              className="flex items-center gap-2 text-xs font-medium text-[#aeb6b2] transition hover:text-white"
              onClick={() => void openPreferences()}
              type="button"
            >
              <Settings2 className="size-4" /> Preferences
            </button>
            <button
              className="flex items-center gap-2 text-xs font-medium text-[#aeb6b2] transition hover:text-white"
              onClick={() => void markAllRead()}
              type="button"
            >
              <CheckCheck className="size-4" />
              Mark all read
            </button>
          </div>
        </header>
        <div className="flex items-center justify-between gap-6 border-b border-white/[.1] py-4 max-[800px]:items-start max-[800px]:flex-col">
          <div className="flex max-w-full gap-5 overflow-x-auto [scrollbar-width:none]">
            {filters.map((item) => (
              <button
                className={`shrink-0 border-b py-2 text-xs capitalize transition ${filter === item ? "border-[#55d6b2] text-white" : "border-transparent text-[#727b76] hover:text-[#c8cfcb]"}`}
                key={item}
                onClick={() => setFilter(item)}
                type="button"
              >
                {item.replaceAll("_", " ")}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-[#8b948f]">
            <input
              checked={unreadOnly}
              className="accent-[#55d6b2]"
              onChange={(event) => setUnreadOnly(event.target.checked)}
              type="checkbox"
            />
            Unread only
          </label>
        </div>
        {error ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
            <CircleAlert className="size-6 text-[#e36d6d]" />
            <p className="mt-4 text-sm">{error}</p>
            <button
              className="mt-4 text-xs font-semibold text-[#55d6b2]"
              onClick={() => void load()}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="flex min-h-[55vh] items-center justify-center">
            <RefreshCw className="size-5 animate-spin text-[#55d6b2]" />
          </div>
        ) : items.length ? (
          <div>
            {items.map((notification) => {
              const Icon = iconFor(notification.category);
              const row = (
                <div
                  className={`grid grid-cols-[40px_minmax(0,1fr)_auto] gap-4 border-b border-white/[.08] py-5 transition hover:bg-white/[.018] ${notification.is_read ? "opacity-60" : ""}`}
                  onClick={() => void markRead(notification)}
                  role="presentation"
                >
                  <span
                    className={`flex size-10 items-center justify-center rounded-full ${notification.severity === "warning" || notification.severity === "error" ? "bg-[#3b211d] text-[#ef8b7b]" : "bg-[#10231e] text-[#55d6b2]"}`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-[#edf1ef]">
                        {notification.title}
                      </h2>
                      {!notification.is_read && (
                        <i className="size-1.5 shrink-0 rounded-full bg-[#55d6b2]" />
                      )}
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-[#8a938e]">
                      {notification.body}
                    </p>
                    <span className="mt-2 inline-block text-[10px] capitalize text-[#5f6863]">
                      {notification.category.replaceAll("_", " ")}
                    </span>
                  </div>
                  <time className="pt-1 text-[10px] text-[#626b66]">
                    {relativeTime(notification.created_at)}
                  </time>
                </div>
              );
              return notification.action_url ? (
                <Link
                  href={notification.action_url}
                  key={notification.notification_id}
                >
                  {row}
                </Link>
              ) : (
                <div key={notification.notification_id}>{row}</div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
            <Bell className="size-7 text-[#59615d]" />
            <h2 className="mt-4 text-sm font-semibold">You’re all caught up</h2>
            <p className="mt-2 text-xs text-[#68706c]">
              No notifications match these filters.
            </p>
          </div>
        )}
      </section>
      {preferencesOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setPreferencesOpen(false)
          }
        >
          <section className="w-full max-w-lg rounded-xl border border-white/[0.12] bg-[#111412] shadow-2xl">
            <header className="flex items-start justify-between border-b border-white/[0.09] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Notification preferences
                </h2>
                <p className="mt-1 text-[11px] text-[#78817c]">
                  Choose which workspace events should reach you.
                </p>
              </div>
              <button
                aria-label="Close preferences"
                className="text-[#858d88]"
                onClick={() => setPreferencesOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </header>
            {!preferences ? (
              <div className="flex h-48 items-center justify-center">
                <RefreshCw className="size-4 animate-spin text-[#55d6b2]" />
              </div>
            ) : (
              <div className="p-5">
                <div className="grid grid-cols-2 gap-3 border-b border-white/[0.08] pb-4">
                  {(["in_app_enabled", "email_enabled"] as const).map((key) => (
                    <label
                      className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.025] px-3 py-3"
                      key={key}
                    >
                      <span className="text-xs text-[#dbe0dd]">
                        {key === "in_app_enabled" ? "In-app" : "Email"}
                      </span>
                      <input
                        checked={preferences[key]}
                        className="accent-[#55d6b2]"
                        disabled={preferenceBusy === key}
                        onChange={(event) =>
                          void updatePreference(key, event.target.checked)
                        }
                        type="checkbox"
                      />
                    </label>
                  ))}
                </div>
                <div className="divide-y divide-white/[0.07]">
                  {preferenceFields.map((field) => (
                    <label
                      className="flex items-center gap-4 py-3"
                      key={field.key}
                    >
                      <span className="min-w-0 flex-1">
                        <strong className="block text-xs font-medium text-[#dbe0dd]">
                          {field.label}
                        </strong>
                        <span className="mt-0.5 block text-[10px] text-[#6f7873]">
                          {field.description}
                        </span>
                      </span>
                      <input
                        checked={Boolean(preferences[field.key])}
                        className="accent-[#55d6b2]"
                        disabled={preferenceBusy === field.key}
                        onChange={(event) =>
                          void updatePreference(field.key, event.target.checked)
                        }
                        type="checkbox"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
