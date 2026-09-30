import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { canAccessProject } from "@/lib/projectAccess";
import { parseCsv, normalizeImportValue } from "@/lib/dataTransfer";
import { createContact, validateContactPayload } from "@/lib/contacts";
import { createLead, validateLeadPayload } from "@/lib/leads";

type InputRow = Record<string, unknown>;

const CONTACT_FIELDS = new Set([
  "first_name", "last_name", "email", "phone_number",
  "alternate_phone_number", "date_of_birth", "is_nri", "country",
  "company_works_at", "is_married", "anniversary_date", "address",
]);
const LEAD_FIELDS = new Set([
  ...CONTACT_FIELDS,
  "project_id", "source_id", "campaign_id", "sub_source", "temperature",
  "customer_type", "preferred_location", "preferred_config", "preferred_facing",
  "preferred_floor", "preferred_view", "budget", "buying_reason",
]);

function optionalString(value: unknown): string | null | undefined {
  const normalized = normalizeImportValue(value);
  return normalized === undefined ? undefined : normalized === null ? null : String(normalized).trim();
}

function optionalBoolean(value: unknown): boolean | undefined {
  const normalized = normalizeImportValue(value);
  if (normalized === undefined) return undefined;
  if (typeof normalized === "boolean") return normalized;
  if (["true", "yes", "1"].includes(String(normalized).toLowerCase())) return true;
  if (["false", "no", "0"].includes(String(normalized).toLowerCase())) return false;
  return normalized as never;
}

function contactPayload(row: InputRow) {
  return {
    first_name: optionalString(row.first_name),
    last_name: optionalString(row.last_name),
    email: optionalString(row.email),
    phone_number: optionalString(row.phone_number),
    alternate_phone_number: optionalString(row.alternate_phone_number),
    date_of_birth: optionalString(row.date_of_birth),
    is_nri: optionalBoolean(row.is_nri),
    country: optionalString(row.country),
    company_works_at: optionalString(row.company_works_at),
    is_married: optionalBoolean(row.is_married),
    anniversary_date: optionalString(row.anniversary_date),
    address: optionalString(row.address),
  };
}

function leadPayload(row: InputRow, contactId: string) {
  const budgetValue = normalizeImportValue(row.budget);
  return {
    contact_id: contactId,
    project_id: Number(row.project_id),
    source_id: optionalString(row.source_id),
    campaign_id: optionalString(row.campaign_id),
    sub_source: optionalString(row.sub_source),
    temperature: optionalString(row.temperature),
    customer_type: optionalString(row.customer_type),
    preferred_location: optionalString(row.preferred_location),
    preferred_config: optionalString(row.preferred_config),
    preferred_facing: optionalString(row.preferred_facing),
    preferred_floor: optionalString(row.preferred_floor),
    preferred_view: optionalString(row.preferred_view),
    budget: budgetValue === undefined ? undefined : Number(budgetValue),
    buying_reason: optionalString(row.buying_reason),
    qualification_data: {},
  };
}

export async function POST(request: NextRequest) {
  const scope = await requirePermission(request, "DATA_IMPORT");
  if (!scope.ok) return scope.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }
  const source = body as Record<string, unknown>;
  const entity = source.entity;
  if (entity !== "contacts" && entity !== "leads") {
    return NextResponse.json({ error: "entity must be contacts or leads" }, { status: 400 });
  }
  const validateOnly = source.validate_only !== false;
  let rows: InputRow[];
  try {
    rows = typeof source.csv === "string"
      ? parseCsv(source.csv)
      : Array.isArray(source.rows)
        ? source.rows.filter((row): row is InputRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
        : [];
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid CSV" }, { status: 422 });
  }
  if (!rows.length || rows.length > 1_000) {
    return NextResponse.json({ error: "Provide between 1 and 1000 import rows" }, { status: 422 });
  }

  const allowed = entity === "contacts" ? CONTACT_FIELDS : LEAD_FIELDS;
  const errors: Array<{ row: number; errors: string[] }> = [];
  const preparedContacts = rows.map((row, index) => {
    const unknown = Object.keys(row).filter((key) => !allowed.has(key));
    const validation = validateContactPayload(contactPayload(row), { partial: false });
    const rowErrors = [
      ...unknown.map((field) => `Unknown column: ${field}`),
      ...(validation.ok ? [] : validation.errors),
    ];
    if (entity === "leads") {
      const projectId = Number(row.project_id);
      if (!Number.isSafeInteger(projectId) || !canAccessProject(scope.context.access, projectId)) {
        rowErrors.push("project_id is missing or inaccessible");
      }
    }
    if (rowErrors.length) errors.push({ row: index + 2, errors: rowErrors });
    return validation.ok ? validation.data : null;
  });
  if (errors.length) {
    return NextResponse.json({ error: "Import validation failed", errors }, { status: 422 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let imported = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const contactData = preparedContacts[index]!;
      if (entity === "contacts") {
        await createContact(client, contactData, scope.context.access.company.company_id);
      } else {
        let contactId: string | undefined;
        if (contactData.email || contactData.phone_number) {
          const existing = await client.query<{ contact_id: string }>(
            `SELECT contact_id FROM contacts
             WHERE company_id = $1 AND archived_at IS NULL
               AND (($2::text IS NOT NULL AND LOWER(email) = LOWER($2))
                 OR ($3::text IS NOT NULL AND phone_number = $3))
             ORDER BY created_at ASC LIMIT 1`,
            [scope.context.access.company.company_id, contactData.email ?? null, contactData.phone_number ?? null],
          );
          contactId = existing.rows[0]?.contact_id;
        }
        if (!contactId) {
          const created = await createContact(client, contactData, scope.context.access.company.company_id);
          contactId = created.contact_id;
        }
        const validation = validateLeadPayload(leadPayload(rows[index], contactId), { partial: false });
        if (!validation.ok) {
          throw new Error(`Row ${index + 2}: ${validation.errors.join(", ")}`);
        }
        await createLead(client, validation.data, scope.context.access.company.company_id);
      }
      imported += 1;
    }
    if (validateOnly) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    return NextResponse.json({
      message: validateOnly ? "Import validation passed" : "Import completed",
      entity,
      rows: imported,
      committed: !validateOnly,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to import data" },
      { status: 422 },
    );
  } finally {
    client.release();
  }
}
