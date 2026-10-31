export const ATTENTION_ELIGIBLE_LEAD_STATUSES = [
  "active",
  "nurture",
  "qualified",
] as const;

export type LeadAttentionBucket = "today" | "upcoming" | "later";

export function getLeadAttentionBucket(
  dueAt: string | Date,
  now: Date,
  timezone: string,
): LeadAttentionBucket {
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "later";

  const localDay = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
    );
  };
  const dayDifference = (localDay(due) - localDay(now)) / 86_400_000;
  if (dayDifference <= 0) return "today";
  return dayDifference <= 2 ? "upcoming" : "later";
}

export function followUpDigestEventKey(localDate: string) {
  return `follow-up-digest:${localDate}`;
}
