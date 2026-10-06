export type JsonObject = Record<string, unknown>;

export type LegacyNotification = JsonObject & {
  _id: string;
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
  channel?: string;
  requestType?: string;
  requestLabel?: string;
  message?: string;
  preferredTime?: string;
  leadStatus?: string;
  salesLeadStatus?: string;
  assignedSalesExecutiveId?: string;
  assignedSalesExecutiveName?: string;
  assignedSalesExecutiveEmail?: string;
  assignedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  callLogs?: JsonObject[];
  salesRemarks?: JsonObject[];
  leadLifecycle?: JsonObject;
  metadata?: JsonObject;
};

export type LegacyConversation = JsonObject & {
  _id: string;
  enquiryRecordId?: string;
  history?: JsonObject[];
};

export type LeadGroup = {
  key: string;
  phone: string;
  notifications: LegacyNotification[];
  canonical: LegacyNotification;
  firstName: string;
  lastName: string | null;
  email: string | null;
  status: "active" | "qualified" | "closed";
  temperature: "cold" | "warm" | "hot" | null;
  calls: JsonObject[];
  remarks: JsonObject[];
  lifecycleEvents: JsonObject[];
  metadataActivities: JsonObject[];
  conversations: LegacyConversation[];
};

export type MigrationPlan = {
  groups: LeadGroup[];
  quarantined: LegacyNotification[];
  stats: {
    notifications: number;
    validNotifications: number;
    canonicalLeads: number;
    repeatedSubmissions: number;
    quarantined: number;
    calls: number;
    remarks: number;
    lifecycleEvents: number;
    metadataActivities: number;
    conversations: number;
    messages: number;
  };
};

export function unwrapExtendedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrapExtendedJson);
  if (!value || typeof value !== "object") return value;

  const object = value as JsonObject;
  if (typeof object.$oid === "string") return object.$oid;
  if (typeof object.$date === "string") return object.$date;
  if (object.$date && typeof object.$date === "object") {
    const milliseconds = (object.$date as JsonObject).$numberLong;
    if (typeof milliseconds === "string") {
      return new Date(Number(milliseconds)).toISOString();
    }
  }
  for (const numberKey of ["$numberInt", "$numberLong", "$numberDouble"]) {
    if (typeof object[numberKey] === "string") {
      const parsed = Number(object[numberKey]);
      return Number.isFinite(parsed) ? parsed : object[numberKey];
    }
  }

  return Object.fromEntries(
    Object.entries(object).map(([key, nested]) => [
      key,
      unwrapExtendedJson(nested),
    ]),
  );
}

export function normalizeIndianPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

export function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function splitName(value: unknown): {
  firstName: string;
  lastName: string | null;
} {
  const parts = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
  return {
    firstName: parts.shift() || "Unknown",
    lastName: parts.length ? parts.join(" ") : null,
  };
}

export function isoTime(value: unknown, fallback = 0): number {
  const parsed = new Date(String(value ?? "")).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is JsonObject =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function dedupeEmbedded(rows: JsonObject[], keys: string[]): JsonObject[] {
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const identity =
      keys
        .map((key) => row[key])
        .find((candidate) =>
          ["string", "number"].includes(typeof candidate),
        ) ?? `${index}:${JSON.stringify(row)}`;
    const key = String(identity);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentStatus(
  notification: LegacyNotification,
): "active" | "qualified" | "closed" {
  if (notification.leadStatus === "dead") return "closed";
  const events = objectArray(notification.leadLifecycle?.events);
  if (events.some((event) => event.type === "qualified")) return "qualified";
  return "active";
}

function currentTemperature(
  notification: LegacyNotification,
): "cold" | "warm" | "hot" | null {
  return ["cold", "warm", "hot"].includes(
    String(notification.salesLeadStatus),
  )
    ? (notification.salesLeadStatus as "cold" | "warm" | "hot")
    : null;
}

export function buildMigrationPlan(
  notificationsInput: unknown[],
  conversationsInput: unknown[],
): MigrationPlan {
  const notifications = notificationsInput.map(
    (row) => unwrapExtendedJson(row) as LegacyNotification,
  );
  const conversations = conversationsInput.map(
    (row) => unwrapExtendedJson(row) as LegacyConversation,
  );
  const grouped = new Map<string, LegacyNotification[]>();
  const quarantined: LegacyNotification[] = [];

  for (const notification of notifications) {
    const phone = normalizeIndianPhone(notification.phone);
    if (!phone) {
      quarantined.push(notification);
      continue;
    }
    const rows = grouped.get(phone) ?? [];
    rows.push(notification);
    grouped.set(phone, rows);
  }

  const notificationGroup = new Map<string, string>();
  for (const [key, rows] of grouped) {
    for (const row of rows) notificationGroup.set(String(row._id), key);
  }
  const conversationsByGroup = new Map<string, LegacyConversation[]>();
  for (const conversation of conversations) {
    const groupKey = notificationGroup.get(String(conversation.enquiryRecordId));
    if (!groupKey) continue;
    const rows = conversationsByGroup.get(groupKey) ?? [];
    rows.push(conversation);
    conversationsByGroup.set(groupKey, rows);
  }

  const groups: LeadGroup[] = [];
  for (const [phone, rows] of grouped) {
    rows.sort(
      (left, right) =>
        isoTime(left.updatedAt ?? left.createdAt) -
        isoTime(right.updatedAt ?? right.createdAt),
    );
    const canonical = rows.at(-1)!;
    const name = splitName(canonical.name);
    const latestEmail = [...rows]
      .reverse()
      .map((row) => normalizeEmail(row.email))
      .find(Boolean);
    const calls = dedupeEmbedded(
      rows.flatMap((row) => objectArray(row.callLogs)),
      ["_id", "idempotencyKey", "providerEventKey"],
    );
    const remarks = dedupeEmbedded(
      rows.flatMap((row) => objectArray(row.salesRemarks)),
      ["_id"],
    );
    const lifecycleEvents = dedupeEmbedded(
      rows.flatMap((row) => objectArray(row.leadLifecycle?.events)),
      ["eventKey", "callId"],
    );
    const metadataActivities = dedupeEmbedded(
      rows.flatMap((row) => objectArray(row.metadata?.activity)),
      ["occurredAt", "title", "detail"],
    );

    groups.push({
      key: phone,
      phone,
      notifications: rows,
      canonical,
      firstName: name.firstName,
      lastName: name.lastName,
      email: latestEmail ?? null,
      status: currentStatus(canonical),
      temperature: currentTemperature(canonical),
      calls,
      remarks,
      lifecycleEvents,
      metadataActivities,
      conversations: conversationsByGroup.get(phone) ?? [],
    });
  }

  groups.sort((left, right) => left.key.localeCompare(right.key));
  const validNotifications = groups.reduce(
    (sum, group) => sum + group.notifications.length,
    0,
  );
  return {
    groups,
    quarantined,
    stats: {
      notifications: notifications.length,
      validNotifications,
      canonicalLeads: groups.length,
      repeatedSubmissions: validNotifications - groups.length,
      quarantined: quarantined.length,
      calls: groups.reduce((sum, group) => sum + group.calls.length, 0),
      remarks: groups.reduce((sum, group) => sum + group.remarks.length, 0),
      lifecycleEvents: groups.reduce(
        (sum, group) => sum + group.lifecycleEvents.length,
        0,
      ),
      metadataActivities: groups.reduce(
        (sum, group) => sum + group.metadataActivities.length,
        0,
      ),
      conversations: groups.reduce(
        (sum, group) => sum + group.conversations.length,
        0,
      ),
      messages: groups.reduce(
        (sum, group) =>
          sum +
          group.conversations.reduce(
            (conversationSum, conversation) =>
              conversationSum + objectArray(conversation.history).length,
            0,
          ),
        0,
      ),
    },
  };
}

export function embeddedRows(value: unknown): JsonObject[] {
  return objectArray(value);
}
