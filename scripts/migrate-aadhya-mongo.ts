import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, PoolClient } from "pg";
import {
  buildMigrationPlan,
  embeddedRows,
  isoTime,
  JsonObject,
  LeadGroup,
  LegacyConversation,
  LegacyNotification,
  MigrationPlan,
  normalizeEmail,
  unwrapExtendedJson,
} from "./lib/aadhya-migration-model";

type Options = {
  archive: string;
  company: string;
  project: string;
  mongoUri: string;
  sourceDatabase: string;
  commit: boolean;
};

type Target = { companyId: number; projectId: number; initialStageId: string };

const SOURCE_SYSTEM = "aadhya-mongodb";

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  let commit = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--commit") {
      commit = true;
      continue;
    }
    if (!argument.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }
  const archive = values.get("--archive");
  if (!archive) {
    throw new Error(
      "Usage: tsx scripts/migrate-aadhya-mongo.ts --archive <path> [--commit]",
    );
  }
  return {
    archive: resolve(archive),
    company: values.get("--company") ?? "Abhigna Constructions",
    project: values.get("--project") ?? "Aadhya Serene",
    mongoUri: values.get("--mongo-uri") ?? "mongodb://127.0.0.1:27017",
    sourceDatabase: values.get("--source-database") ?? "AadhyaSerene",
    commit,
  };
}

function loadLocalEnvironment(): void {
  if (process.env.DATABASE_URL) return;
  const path = resolve(".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function command(binary: string, args: string[], maxBuffer = 128 * 1024 * 1024) {
  return execFileSync(binary, args, {
    encoding: "utf8",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function exportCollection(
  mongoUri: string,
  database: string,
  collection: string,
): unknown[] {
  const output = command("mongoexport", [
    `--uri=${mongoUri}`,
    `--db=${database}`,
    `--collection=${collection}`,
    "--jsonArray",
    "--jsonFormat=canonical",
  ]);
  return (JSON.parse(output) as unknown[]).map(unwrapExtendedJson);
}

function inspectArchive(options: Options): {
  plan: MigrationPlan;
  webhookEvents: JsonObject[];
} {
  const database = `codex_aadhya_import_${randomBytes(6).toString("hex")}`;
  try {
    command("mongorestore", [
      `--uri=${options.mongoUri}`,
      `--archive=${options.archive}`,
      `--nsFrom=${options.sourceDatabase}.*`,
      `--nsTo=${database}.*`,
      "--noIndexRestore",
    ]);
    const notifications = exportCollection(
      options.mongoUri,
      database,
      "notifications",
    );
    const conversations = exportCollection(
      options.mongoUri,
      database,
      "whatsapp_conversations",
    );
    const webhookEvents = exportCollection(
      options.mongoUri,
      database,
      "daffytel_webhook_events",
    ) as JsonObject[];
    return {
      plan: buildMigrationPlan(notifications, conversations),
      webhookEvents,
    };
  } finally {
    command("mongosh", [
      options.mongoUri,
      "--quiet",
      "--eval",
      `db.getSiblingDB(${JSON.stringify(database)}).dropDatabase()`,
    ]);
  }
}

function archiveSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function dateValue(value: unknown, fallback: string): string {
  const timestamp = isoTime(value);
  return timestamp ? new Date(timestamp).toISOString() : fallback;
}

function text(value: unknown, max: number): string | null {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function sourceType(source: string): string {
  if (["magic_bricks", "99acres", "aurum_analytica"].includes(source)) {
    return "property_portal";
  }
  if (source.includes("whatsapp")) return "whatsapp";
  if (source.includes("partner")) return "channel_partner";
  return "website";
}

function sourceCode(source: string): string {
  return `LEGACY_${source}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

async function resolveTarget(
  client: PoolClient,
  company: string,
  project: string,
): Promise<Target> {
  const result = await client.query(
    `SELECT company.company_id, project.project_id,
            stage.stage_id AS initial_stage_id
       FROM companies company
       JOIN projects project ON project.company_id=company.company_id
       LEFT JOIN LATERAL (
         SELECT stage_id
           FROM project_lead_stages
          WHERE project_id=project.project_id AND is_active AND is_initial
          ORDER BY position LIMIT 1
       ) stage ON TRUE
      WHERE LOWER(company.company_name)=LOWER($1)
        AND LOWER(project.project_name)=LOWER($2)
        AND company.archived_at IS NULL
        AND project.is_active=TRUE`,
    [company, project],
  );
  if (!result.rowCount) {
    throw new Error(
      `Create company "${company}" and project "${project}" before committing this import.`,
    );
  }
  if (!result.rows[0].initial_stage_id) {
    throw new Error(`Project "${project}" does not have an active initial stage.`);
  }
  return {
    companyId: Number(result.rows[0].company_id),
    projectId: Number(result.rows[0].project_id),
    initialStageId: String(result.rows[0].initial_stage_id),
  };
}

async function requireImportSchema(client: PoolClient): Promise<void> {
  const result = await client.query(
    `SELECT TO_REGCLASS('public.legacy_import_runs') AS runs,
            TO_REGCLASS('public.legacy_entity_mappings') AS mappings,
            TO_REGCLASS('public.communication_threads') AS threads,
            TO_REGCLASS('public.communication_messages') AS messages`,
  );
  if (Object.values(result.rows[0]).some((value) => value === null)) {
    throw new Error(
      "Apply database/migrations/20261011_create_communications_and_legacy_imports.sql before committing the import.",
    );
  }
}

async function mapping(
  client: PoolClient,
  companyId: number,
  collection: string,
  sourceId: string,
  targetTable: string,
): Promise<string | null> {
  const result = await client.query(
    `SELECT target_id
       FROM legacy_entity_mappings
      WHERE company_id=$1 AND source_system=$2 AND source_collection=$3
        AND source_id=$4 AND target_table=$5`,
    [companyId, SOURCE_SYSTEM, collection, sourceId, targetTable],
  );
  return result.rowCount ? String(result.rows[0].target_id) : null;
}

async function mapEntity(
  client: PoolClient,
  target: Target,
  runId: string,
  collection: string,
  sourceId: string,
  targetTable: string,
  targetId: string,
  source: unknown,
  metadata: JsonObject = {},
): Promise<void> {
  await client.query(
    `INSERT INTO legacy_entity_mappings (
       company_id,run_id,source_system,source_collection,source_id,
       target_table,target_id,source_checksum,metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (
       company_id,source_system,source_collection,source_id,target_table
     ) DO NOTHING`,
    [
      target.companyId,
      runId,
      SOURCE_SYSTEM,
      collection,
      sourceId,
      targetTable,
      targetId,
      checksum(source),
      JSON.stringify(metadata),
    ],
  );
}

async function ensureSource(
  client: PoolClient,
  companyId: number,
  source: string,
): Promise<string> {
  const code = sourceCode(source || "unknown");
  const existing = await client.query(
    `SELECT source_id FROM lead_sources
      WHERE company_id=$1 AND LOWER(code)=LOWER($2)`,
    [companyId, code],
  );
  if (existing.rowCount) return String(existing.rows[0].source_id);
  const inserted = await client.query(
    `INSERT INTO lead_sources (
       company_id,source_name,source_type,code,is_active
     ) VALUES ($1,$2,$3,$4,TRUE) RETURNING source_id`,
    [companyId, source || "Unknown legacy source", sourceType(source), code],
  );
  return String(inserted.rows[0].source_id);
}

async function ensureContact(
  client: PoolClient,
  target: Target,
  runId: string,
  group: LeadGroup,
): Promise<string> {
  const mapped = await mapping(
    client,
    target.companyId,
    "normalized_phone",
    group.key,
    "contacts",
  );
  if (mapped) return mapped;

  const existing = await client.query(
    `SELECT contact_id FROM contacts
      WHERE company_id=$1 AND archived_at IS NULL
        AND merged_into_contact_id IS NULL
        AND REGEXP_REPLACE(phone_number,'\\D','','g')=
            REGEXP_REPLACE($2,'\\D','','g')
      ORDER BY created_at LIMIT 1`,
    [target.companyId, group.phone],
  );
  let contactId: string;
  if (existing.rowCount) {
    contactId = String(existing.rows[0].contact_id);
  } else {
    const firstSeen = dateValue(
      group.notifications[0].createdAt,
      new Date().toISOString(),
    );
    const inserted = await client.query(
      `INSERT INTO contacts (
         company_id,first_name,last_name,phone_number,email,
         is_nri,is_married,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,FALSE,FALSE,$6,$7)
       RETURNING contact_id`,
      [
        target.companyId,
        group.firstName,
        group.lastName,
        group.phone,
        group.email,
        firstSeen,
        dateValue(group.canonical.updatedAt, firstSeen),
      ],
    );
    contactId = String(inserted.rows[0].contact_id);
  }

  const aliases = new Map<string, { type: string; value: string }>();
  for (const notification of group.notifications) {
    const name = text(notification.name, 500);
    const email = normalizeEmail(notification.email);
    if (name) aliases.set(`name:${name.toLowerCase()}`, { type: "name", value: name });
    if (email) aliases.set(`email:${email}`, { type: "email", value: email });
  }
  for (const alias of aliases.values()) {
    await client.query(
      `INSERT INTO contact_aliases (
         contact_id,alias_type,alias_value,normalized_value,source
       ) VALUES ($1,$2,$3,$4,'legacy_import')
       ON CONFLICT (contact_id,alias_type,normalized_value) DO NOTHING`,
      [contactId, alias.type, alias.value, alias.value.trim().toLowerCase()],
    );
  }
  await mapEntity(
    client,
    target,
    runId,
    "normalized_phone",
    group.key,
    "contacts",
    contactId,
    { phone: group.phone },
  );
  return contactId;
}

async function ensureLead(
  client: PoolClient,
  target: Target,
  runId: string,
  group: LeadGroup,
  contactId: string,
): Promise<string> {
  const mapped = await mapping(
    client,
    target.companyId,
    "lead_group",
    group.key,
    "leads",
  );
  if (mapped) return mapped;

  const existing = await client.query(
    `SELECT lead_id FROM leads
      WHERE company_id=$1 AND project_id=$2 AND contact_id=$3
        AND status NOT IN ('duplicate','invalid')
      ORDER BY created_at LIMIT 1`,
    [target.companyId, target.projectId, contactId],
  );
  let leadId: string;
  if (existing.rowCount) {
    leadId = String(existing.rows[0].lead_id);
  } else {
    const source = String(group.canonical.source ?? "unknown");
    const sourceId = await ensureSource(client, target.companyId, source);
    const firstSeen = dateValue(
      group.notifications[0].createdAt,
      new Date().toISOString(),
    );
    const latestCall = group.calls
      .slice()
      .sort((left, right) => isoTime(left.updatedAt) - isoTime(right.updatedAt))
      .at(-1);
    const inserted = await client.query(
      `INSERT INTO leads (
         company_id,contact_id,project_id,source_id,stage_id,status,
         sub_source,temperature,current_owner_user_id,current_team_id,
         preferred_location,preferred_config,qualification_data,
         received_at,assigned_at,closed_at,created_at,updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,$10,$11::jsonb,
         $12,NULL,$13,$12,$14
       ) RETURNING lead_id`,
      [
        target.companyId,
        contactId,
        target.projectId,
        sourceId,
        target.initialStageId,
        group.status,
        text(source, 150),
        group.temperature,
        text(latestCall?.location, 200),
        text(latestCall?.configuration, 100),
        JSON.stringify({
          legacy_import: {
            source_system: SOURCE_SYSTEM,
            submission_count: group.notifications.length,
            legacy_owner: {
              id: group.canonical.assignedSalesExecutiveId ?? null,
              name: group.canonical.assignedSalesExecutiveName ?? null,
              email: group.canonical.assignedSalesExecutiveEmail ?? null,
            },
            request_type: group.canonical.requestType ?? null,
            preferred_time: group.canonical.preferredTime ?? null,
          },
        }),
        firstSeen,
        group.status === "closed"
          ? dateValue(group.canonical.updatedAt, firstSeen)
          : null,
        dateValue(group.canonical.updatedAt, firstSeen),
      ],
    );
    leadId = String(inserted.rows[0].lead_id);
    await client.query(
      `INSERT INTO lead_state_history (
         lead_id,command,from_status,to_status,from_stage_id,to_stage_id,metadata
       ) VALUES ($1,'legacy_import',NULL,$2,NULL,$3,$4::jsonb)`,
      [
        leadId,
        group.status,
        target.initialStageId,
        JSON.stringify({ source_system: SOURCE_SYSTEM }),
      ],
    );
  }
  await mapEntity(
    client,
    target,
    runId,
    "lead_group",
    group.key,
    "leads",
    leadId,
    { phone: group.phone },
  );
  return leadId;
}

async function importSubmissions(
  client: PoolClient,
  target: Target,
  runId: string,
  group: LeadGroup,
  contactId: string,
  leadId: string,
): Promise<void> {
  const firstId = String(group.notifications[0]._id);
  for (const notification of group.notifications) {
    const sourceId = String(notification._id);
    const idempotencyKey = `${SOURCE_SYSTEM}:notifications:${sourceId}`;
    const receivedAt = dateValue(
      notification.createdAt,
      new Date().toISOString(),
    );
    const intake = await client.query(
      `INSERT INTO lead_intake_events (
         company_id,idempotency_key,payload,status,lead_id,attempt_count,
         received_at,processed_at,created_at,updated_at
       ) VALUES ($1,$2,$3::jsonb,'processed',$4,1,$5,$6,$5,$6)
       ON CONFLICT (company_id,idempotency_key) DO UPDATE
         SET lead_id=EXCLUDED.lead_id
       RETURNING event_id`,
      [
        target.companyId,
        idempotencyKey,
        JSON.stringify(notification),
        leadId,
        receivedAt,
        dateValue(notification.updatedAt, receivedAt),
      ],
    );
    const eventId = String(intake.rows[0].event_id);
    await mapEntity(
      client,
      target,
      runId,
      "notifications",
      sourceId,
      "lead_intake_events",
      eventId,
      notification,
    );
    if (sourceId === firstId) {
      await client.query(
        `UPDATE leads SET intake_event_id=COALESCE(intake_event_id,$1)
          WHERE lead_id=$2`,
        [eventId, leadId],
      );
    }

    const attributionMapped = await mapping(
      client,
      target.companyId,
      "notifications",
      sourceId,
      "lead_attributions",
    );
    if (!attributionMapped) {
      const source = String(notification.source ?? "unknown");
      const leadSourceId = await ensureSource(client, target.companyId, source);
      const position = group.notifications.indexOf(notification);
      const attributionType =
        position === 0
          ? "first_touch"
          : position === group.notifications.length - 1
            ? "last_touch"
            : "assist";
      const inserted = await client.query(
        `INSERT INTO lead_attributions (
           lead_id,source_id,attribution_type,sub_source,occurred_at,metadata
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING attribution_id`,
        [
          leadId,
          leadSourceId,
          attributionType,
          text(source, 150),
          receivedAt,
          JSON.stringify({
            legacy_notification_id: sourceId,
            channel: notification.channel ?? null,
            request_type: notification.requestType ?? null,
            request_label: notification.requestLabel ?? null,
          }),
        ],
      );
      await mapEntity(
        client,
        target,
        runId,
        "notifications",
        sourceId,
        "lead_attributions",
        String(inserted.rows[0].attribution_id),
        notification,
      );
    }
  }
}

function callStatus(value: unknown): string {
  if (value === "answered") return "answered";
  if (["not_answered", "switched_off"].includes(String(value))) {
    return "no_answer";
  }
  if (value === "invalid_number") return "failed";
  return "completed";
}

function callOutcome(value: unknown): string | null {
  if (value === "answered") return "connected";
  if (["not_answered", "switched_off"].includes(String(value))) {
    return "no_answer";
  }
  if (value === "invalid_number") return "wrong_number";
  return null;
}

async function ensureActivity(
  client: PoolClient,
  target: Target,
  runId: string,
  collection: string,
  sourceId: string,
  sourceType: "call" | "note",
  entityId: string,
  leadId: string,
  contactId: string,
  title: string,
  description: string | null,
  occurredAt: string,
  metadata: JsonObject,
): Promise<void> {
  const existing = await mapping(
    client,
    target.companyId,
    collection,
    sourceId,
    "activities",
  );
  if (existing) return;
  const inserted = await client.query(
    `INSERT INTO activities (
       company_id,project_id,lead_id,contact_id,activity_type,source_type,
       source_id,title,description,metadata,occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9::jsonb,$10)
     RETURNING activity_id`,
    [
      target.companyId,
      target.projectId,
      leadId,
      contactId,
      sourceType,
      entityId,
      title.slice(0, 250),
      description,
      JSON.stringify(metadata),
      occurredAt,
    ],
  );
  await mapEntity(
    client,
    target,
    runId,
    collection,
    sourceId,
    "activities",
    String(inserted.rows[0].activity_id),
    metadata,
  );
}

async function importCalls(
  client: PoolClient,
  target: Target,
  runId: string,
  group: LeadGroup,
  contactId: string,
  leadId: string,
): Promise<void> {
  for (const [index, call] of group.calls.entries()) {
    const sourceId = String(
      call._id ?? call.idempotencyKey ?? `${group.key}:${index}`,
    );
    let callId = await mapping(
      client,
      target.companyId,
      "callLogs",
      sourceId,
      "calls",
    );
    const occurredAt = dateValue(
      call.createdAt ?? call.updatedAt,
      dateValue(group.canonical.updatedAt, new Date().toISOString()),
    );
    if (!callId) {
      const inserted = await client.query(
        `INSERT INTO calls (
           company_id,project_id,lead_id,contact_id,direction,status,outcome,
           phone_number,subject,summary,started_at,duration_seconds,
           provider,provider_call_id,provider_metadata,recording_url,
           created_at,updated_at
         ) VALUES (
           $1,$2,$3,$4,'outbound',$5,$6,$7,$8,$9,$10,$11,
           $12,$13,$14::jsonb,$15,$10,$16
         ) RETURNING call_id`,
        [
          target.companyId,
          target.projectId,
          leadId,
          contactId,
          callStatus(call.callStatus),
          callOutcome(call.callOutcome ?? call.callStatus),
          group.phone,
          `Legacy sales call - ${String(call.callStatus ?? "completed")}`,
          text(call.remark, 5000),
          occurredAt,
          typeof call.durationSeconds === "number" ? call.durationSeconds : null,
          text(call.provider, 50) ?? "legacy",
          text(call.providerCallId, 255),
          JSON.stringify(call),
          text(call.recordingUrl, 10000),
          dateValue(call.updatedAt, occurredAt),
        ],
      );
      callId = String(inserted.rows[0].call_id);
      await mapEntity(
        client,
        target,
        runId,
        "callLogs",
        sourceId,
        "calls",
        callId,
        call,
      );
    }
    await ensureActivity(
      client,
      target,
      runId,
      "callLogActivities",
      sourceId,
      "call",
      callId,
      leadId,
      contactId,
      `Legacy sales call: ${String(call.callStatus ?? "completed")}`,
      text(call.remark, 5000),
      occurredAt,
      { legacy_call_id: sourceId },
    );
  }
}

async function importNote(
  client: PoolClient,
  target: Target,
  runId: string,
  collection: string,
  sourceId: string,
  leadId: string,
  contactId: string,
  title: string,
  body: string,
  occurredAt: string,
  raw: JsonObject,
): Promise<void> {
  let noteId = await mapping(
    client,
    target.companyId,
    collection,
    sourceId,
    "notes",
  );
  if (!noteId) {
    const inserted = await client.query(
      `INSERT INTO notes (
         company_id,project_id,lead_id,contact_id,title,body,visibility,
         created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'team',$7,$7) RETURNING note_id`,
      [
        target.companyId,
        target.projectId,
        leadId,
        contactId,
        title.slice(0, 250),
        body,
        occurredAt,
      ],
    );
    noteId = String(inserted.rows[0].note_id);
    await mapEntity(
      client,
      target,
      runId,
      collection,
      sourceId,
      "notes",
      noteId,
      raw,
    );
  }
  await ensureActivity(
    client,
    target,
    runId,
    `${collection}Activities`,
    sourceId,
    "note",
    noteId,
    leadId,
    contactId,
    title,
    body,
    occurredAt,
    { legacy_source: collection, legacy_source_id: sourceId },
  );
}

async function importRemarksAndLifecycle(
  client: PoolClient,
  target: Target,
  runId: string,
  group: LeadGroup,
  contactId: string,
  leadId: string,
): Promise<void> {
  for (const [index, remark] of group.remarks.entries()) {
    const sourceId = String(remark._id ?? `${group.key}:${index}`);
    const body =
      text(remark.text ?? remark.notes, 10000) ?? "Legacy sales remark";
    const occurredAt = dateValue(
      remark.createdAt,
      dateValue(group.canonical.updatedAt, new Date().toISOString()),
    );
    await importNote(
      client,
      target,
      runId,
      "salesRemarks",
      sourceId,
      leadId,
      contactId,
      "Legacy sales remark",
      body,
      occurredAt,
      remark,
    );
  }

  for (const [index, event] of group.lifecycleEvents.entries()) {
    const sourceId = String(event.eventKey ?? event.callId ?? `${group.key}:${index}`);
    const eventType = String(event.type ?? "legacy_event");
    const occurredAt = dateValue(
      event.occurredAt,
      dateValue(group.canonical.updatedAt, new Date().toISOString()),
    );
    if (["dead", "qualified"].includes(eventType)) {
      const historyMapped = await mapping(
        client,
        target.companyId,
        "leadLifecycleEvents",
        sourceId,
        "lead_state_history",
      );
      if (!historyMapped) {
        const inserted = await client.query(
          `INSERT INTO lead_state_history (
             lead_id,command,from_status,to_status,metadata,created_at
           ) VALUES ($1,$2,NULL,$3,$4::jsonb,$5) RETURNING history_id`,
          [
            leadId,
            `legacy_${eventType}`,
            eventType === "dead" ? "closed" : "qualified",
            JSON.stringify(event),
            occurredAt,
          ],
        );
        await mapEntity(
          client,
          target,
          runId,
          "leadLifecycleEvents",
          sourceId,
          "lead_state_history",
          String(inserted.rows[0].history_id),
          event,
        );
      }
      continue;
    }
    await importNote(
      client,
      target,
      runId,
      "leadLifecycleEvents",
      sourceId,
      leadId,
      contactId,
      `Legacy lifecycle: ${eventType.replaceAll("_", " ")}`,
      text(event.note, 10000) ?? eventType.replaceAll("_", " "),
      occurredAt,
      event,
    );
  }

  for (const [index, activity] of group.metadataActivities.entries()) {
    const sourceId = `${group.key}:${activity.occurredAt ?? index}:${activity.type ?? "activity"}`;
    await importNote(
      client,
      target,
      runId,
      "metadataActivities",
      sourceId,
      leadId,
      contactId,
      text(activity.title, 250) ?? "Legacy activity",
      text(activity.detail, 10000) ?? String(activity.status ?? "Recorded"),
      dateValue(
        activity.occurredAt,
        dateValue(group.canonical.updatedAt, new Date().toISOString()),
      ),
      activity,
    );
  }

  const lifecycle = group.canonical.leadLifecycle ?? {};
  if (
    lifecycle.callbackStatus === "pending" &&
    isoTime(lifecycle.callbackDueAt)
  ) {
    await client.query(
      `INSERT INTO lead_next_actions (
         lead_id,action_type,summary,due_at,status,notes
       ) VALUES ($1,'callback','Legacy callback requested',$2,'pending',$3)
       ON CONFLICT (lead_id) DO UPDATE SET
         action_type=EXCLUDED.action_type,
         summary=EXCLUDED.summary,
         due_at=EXCLUDED.due_at,
         status=EXCLUDED.status,
         notes=EXCLUDED.notes,
         updated_at=CURRENT_TIMESTAMP`,
      [
        leadId,
        dateValue(lifecycle.callbackDueAt, new Date().toISOString()),
        "Imported from the Aadhya Serene legacy database",
      ],
    );
  }
}

function conversationStatus(conversation: LegacyConversation): string {
  return conversation.currentState === "COMPLETED" ? "closed" : "active";
}

function messageDirection(value: unknown): string {
  const direction = String(value ?? "").toLowerCase();
  if (["incoming", "inbound"].includes(direction)) return "inbound";
  if (["outgoing", "outbound"].includes(direction)) return "outbound";
  return "system";
}

async function importConversations(
  client: PoolClient,
  target: Target,
  runId: string,
  group: LeadGroup,
  contactId: string,
  leadId: string,
): Promise<void> {
  for (const conversation of group.conversations) {
    const sourceId = String(conversation._id);
    const messages = embeddedRows(conversation.history);
    const times = messages.map((message) => isoTime(message.createdAt)).filter(Boolean);
    const lastMessageAt = times.length
      ? new Date(Math.max(...times)).toISOString()
      : null;
    let threadId = await mapping(
      client,
      target.companyId,
      "whatsapp_conversations",
      sourceId,
      "communication_threads",
    );
    if (!threadId) {
      const metadata: JsonObject = { ...conversation };
      delete metadata.history;
      const inserted = await client.query(
        `INSERT INTO communication_threads (
           company_id,project_id,contact_id,lead_id,channel,
           external_thread_id,status,metadata,last_message_at,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,'whatsapp',$5,$6,$7::jsonb,$8,$9,$10)
         ON CONFLICT (company_id,channel,external_thread_id) DO UPDATE SET
           contact_id=EXCLUDED.contact_id,
           lead_id=EXCLUDED.lead_id,
           status=EXCLUDED.status,
           metadata=EXCLUDED.metadata,
           last_message_at=EXCLUDED.last_message_at,
           updated_at=EXCLUDED.updated_at
         RETURNING thread_id`,
        [
          target.companyId,
          target.projectId,
          contactId,
          leadId,
          sourceId,
          conversationStatus(conversation),
          JSON.stringify(metadata),
          lastMessageAt,
          dateValue(conversation.createdAt, lastMessageAt ?? new Date().toISOString()),
          dateValue(conversation.updatedAt, lastMessageAt ?? new Date().toISOString()),
        ],
      );
      threadId = String(inserted.rows[0].thread_id);
      await mapEntity(
        client,
        target,
        runId,
        "whatsapp_conversations",
        sourceId,
        "communication_threads",
        threadId,
        conversation,
      );
    }
    for (const [index, message] of messages.entries()) {
      const messageId =
        text(message.messageId, 255) ?? `${sourceId}:${index}`;
      await client.query(
        `INSERT INTO communication_messages (
           company_id,project_id,thread_id,external_message_id,direction,
           message_type,body,button_id,occurred_at,raw_payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (company_id,thread_id,external_message_id) DO NOTHING`,
        [
          target.companyId,
          target.projectId,
          threadId,
          messageId,
          messageDirection(message.direction),
          text(message.type, 40) ?? "text",
          text(message.message, 100000),
          text(message.buttonId, 255),
          dateValue(message.createdAt, new Date().toISOString()),
          JSON.stringify(message),
        ],
      );
    }
  }
}

async function importWebhookEvents(
  client: PoolClient,
  target: Target,
  runId: string,
  webhookEvents: JsonObject[],
  notificationToLead: Map<string, string>,
): Promise<void> {
  for (const [index, event] of webhookEvents.entries()) {
    const sourceId = String(event._id ?? event.eventKey ?? index);
    const providerEventId = text(event.eventKey ?? event._id, 255) ?? sourceId;
    const existing = await mapping(
      client,
      target.companyId,
      "daffytel_webhook_events",
      sourceId,
      "telephony_events",
    );
    if (existing) continue;
    const matchedLead = notificationToLead.get(
      String(event.matchedLeadId ?? event.leadId ?? ""),
    );
    const inserted = await client.query(
      `INSERT INTO telephony_events (
         provider,provider_event_id,provider_call_id,call_id,event_type,
         payload,occurred_at,processed_at,processing_error
       ) VALUES ('daffytel',$1,$2,NULL,$3,$4::jsonb,$5,$6,$7)
       ON CONFLICT (provider,provider_event_id) DO UPDATE SET
         payload=EXCLUDED.payload
       RETURNING telephony_event_id`,
      [
        providerEventId,
        text(event.providerCallId, 255),
        text(event.providerStatus ?? event.outcome, 100) ?? "legacy_event",
        JSON.stringify({ ...event, resolved_crm_lead_id: matchedLead ?? null }),
        dateValue(event.createdAt, new Date().toISOString()),
        event.updatedAt ? dateValue(event.updatedAt, new Date().toISOString()) : null,
        text(event.error, 10000),
      ],
    );
    await mapEntity(
      client,
      target,
      runId,
      "daffytel_webhook_events",
      sourceId,
      "telephony_events",
      String(inserted.rows[0].telephony_event_id),
      event,
      { lead_id: matchedLead ?? null },
    );
  }
}

async function importQuarantinedSubmissions(
  client: PoolClient,
  target: Target,
  runId: string,
  notifications: LegacyNotification[],
): Promise<void> {
  for (const notification of notifications) {
    const sourceId = String(notification._id);
    const receivedAt = dateValue(
      notification.createdAt,
      new Date().toISOString(),
    );
    const result = await client.query(
      `INSERT INTO lead_intake_events (
         company_id,idempotency_key,payload,status,lead_id,error_code,
         error_message,attempt_count,received_at,last_attempt_at,
         created_at,updated_at
       ) VALUES (
         $1,$2,$3::jsonb,'quarantined',NULL,'INVALID_CONTACT_IDENTITY',
         'A usable phone number or email was not present',1,$4,$5,$4,$5
       )
       ON CONFLICT (company_id,idempotency_key) DO UPDATE SET
         status='quarantined',
         error_code='INVALID_CONTACT_IDENTITY',
         error_message='A usable phone number or email was not present'
       RETURNING event_id`,
      [
        target.companyId,
        `${SOURCE_SYSTEM}:notifications:${sourceId}`,
        JSON.stringify(notification),
        receivedAt,
        dateValue(notification.updatedAt, receivedAt),
      ],
    );
    await mapEntity(
      client,
      target,
      runId,
      "notifications",
      sourceId,
      "lead_intake_events",
      String(result.rows[0].event_id),
      notification,
      { quarantine_reason: "invalid_contact_identity" },
    );
  }
}

async function commitImport(
  options: Options,
  plan: MigrationPlan,
  webhookEvents: JsonObject[],
  sha256: string,
): Promise<string> {
  loadLocalEnvironment();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for --commit");
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "false"
        ? false
        : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await requireImportSchema(client);
    const target = await resolveTarget(client, options.company, options.project);
    const run = await client.query(
      `INSERT INTO legacy_import_runs (
         company_id,project_id,source_system,source_archive_sha256,status,stats
       ) VALUES ($1,$2,$3,$4,'running',$5::jsonb) RETURNING run_id`,
      [
        target.companyId,
        target.projectId,
        SOURCE_SYSTEM,
        sha256,
        JSON.stringify(plan.stats),
      ],
    );
    const runId = String(run.rows[0].run_id);
    const notificationToLead = new Map<string, string>();
    for (const group of plan.groups) {
      const contactId = await ensureContact(client, target, runId, group);
      const leadId = await ensureLead(
        client,
        target,
        runId,
        group,
        contactId,
      );
      for (const notification of group.notifications) {
        notificationToLead.set(String(notification._id), leadId);
      }
      await importSubmissions(
        client,
        target,
        runId,
        group,
        contactId,
        leadId,
      );
      await importCalls(client, target, runId, group, contactId, leadId);
      await importRemarksAndLifecycle(
        client,
        target,
        runId,
        group,
        contactId,
        leadId,
      );
      await importConversations(
        client,
        target,
        runId,
        group,
        contactId,
        leadId,
      );
    }
    await importQuarantinedSubmissions(
      client,
      target,
      runId,
      plan.quarantined,
    );
    await importWebhookEvents(
      client,
      target,
      runId,
      webhookEvents,
      notificationToLead,
    );
    await client.query(
      `UPDATE legacy_import_runs
          SET status='completed',completed_at=CURRENT_TIMESTAMP,stats=$1::jsonb
        WHERE run_id=$2`,
      [JSON.stringify(plan.stats), runId],
    );
    await client.query("COMMIT");
    return runId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function printReport(
  options: Options,
  plan: MigrationPlan,
  webhookEvents: JsonObject[],
  sha256: string,
): void {
  console.log(
    JSON.stringify(
      {
        mode: options.commit ? "commit" : "dry-run",
        target: { company: options.company, project: options.project },
        archive_sha256: sha256,
        ...plan.stats,
        telephonyWebhookEvents: webhookEvents.length,
        quarantinedSourceIds: plan.quarantined.map((row) => String(row._id)),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.archive)) {
    throw new Error(`Archive not found: ${options.archive}`);
  }
  const sha256 = archiveSha256(options.archive);
  const { plan, webhookEvents } = inspectArchive(options);
  printReport(options, plan, webhookEvents, sha256);
  if (!options.commit) {
    console.log("Dry run complete. No PostgreSQL data was changed.");
    return;
  }
  const runId = await commitImport(options, plan, webhookEvents, sha256);
  console.log(`Import completed successfully. Run ID: ${runId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
