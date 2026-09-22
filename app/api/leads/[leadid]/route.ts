import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { addOwnershipHistory } from "@/lib/leadHistory";
import { parseLeadId, replaceLeadTags, validateLeadPayload } from "@/lib/leads";

type Context = { params: Promise<{ leadid: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT l.*, TO_JSONB(c) AS contact,
              CASE WHEN s.stage_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
                'stage_id', s.stage_id, 'stage_key', s.stage_key,
                'stage_name', s.stage_name, 'is_terminal', s.is_terminal
              ) END AS stage
       FROM leads l JOIN contacts c ON c.contact_id=l.contact_id
       LEFT JOIN project_lead_stages s ON s.stage_id=l.stage_id
       WHERE l.lead_id=$1`,
      [leadId],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const tags = await pool.query(
      `SELECT t.tag_id, t.tag_name, t.color FROM lead_tags lt
       JOIN tags t ON t.tag_id=lt.tag_id WHERE lt.lead_id=$1 ORDER BY t.tag_name`,
      [leadId],
    );
    const history = await pool.query(
      `SELECT history_id, command, from_status, to_status, from_stage_id,
              to_stage_id, metadata, performed_by, created_at
       FROM lead_state_history WHERE lead_id=$1 ORDER BY created_at DESC, history_id DESC`,
      [leadId],
    );
    return NextResponse.json({
      lead: { ...result.rows[0], tags: tags.rows, history: history.rows },
    });
  } catch (error) {
    console.error("Failed to retrieve lead", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateLeadPayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  if (
    validation.data.contact_id !== undefined ||
    validation.data.project_id !== undefined
  ) {
    return NextResponse.json(
      {
        error:
          "contact_id and project_id cannot be changed after lead creation",
      },
      { status: 422 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM leads WHERE lead_id=$1 FOR UPDATE",
      [leadId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const current = currentResult.rows[0];
    const nextSource =
      validation.data.source_id === undefined
        ? current.source_id
        : validation.data.source_id;
    const nextCampaign =
      validation.data.campaign_id === undefined
        ? current.campaign_id
        : validation.data.campaign_id;
    if (nextSource) {
      const source = await client.query(
        "SELECT source_id FROM lead_sources WHERE source_id=$1 AND is_active=TRUE",
        [nextSource],
      );
      if (!source.rowCount) {
        throw new Error("REFERENCE:Active lead source not found");
      }
    }
    if (nextCampaign) {
      const campaign = await client.query(
        "SELECT source_id FROM campaigns WHERE campaign_id=$1 AND is_active=TRUE",
        [nextCampaign],
      );
      if (!campaign.rowCount) {
        throw new Error("REFERENCE:Active campaign not found");
      }
      if (
        nextSource &&
        campaign.rows[0].source_id &&
        campaign.rows[0].source_id !== nextSource
      ) {
        throw new Error(
          "REFERENCE:Campaign does not belong to the selected source",
        );
      }
    }
    for (const [field, table, activeClause] of [
      [
        "current_owner_user_id",
        "users",
        "is_active=TRUE AND deleted_at IS NULL",
      ],
      ["current_team_id", "teams", "is_active=TRUE"],
    ] as const) {
      const value = validation.data[field];
      if (value) {
        const idColumn =
          field === "current_owner_user_id" ? "user_id" : "team_id";
        const reference = await client.query(
          `SELECT ${idColumn} FROM ${table} WHERE ${idColumn}=$1 AND ${activeClause}`,
          [value],
        );
        if (!reference.rowCount) {
          throw new Error(`REFERENCE:Active ${field} not found`);
        }
      }
    }
    if (validation.data.tag_ids) {
      const tags = await client.query(
        "SELECT tag_id FROM tags WHERE tag_id=ANY($1::uuid[]) AND archived_at IS NULL",
        [validation.data.tag_ids],
      );
      if (tags.rowCount !== validation.data.tag_ids.length) {
        throw new Error("REFERENCE:One or more active tags were not found");
      }
    }
    const mutable = [
      "source_id",
      "campaign_id",
      "sub_source",
      "temperature",
      "customer_type",
      "current_owner_user_id",
      "current_team_id",
      "preferred_location",
      "preferred_config",
      "preferred_facing",
      "preferred_floor",
      "preferred_view",
      "budget",
      "buying_reason",
      "qualification_data",
    ] as const;
    const updates = mutable.filter(
      (field) => validation.data[field] !== undefined,
    );
    let lead = current;
    if (updates.length) {
      const values = updates.map((field) =>
        field === "qualification_data"
          ? JSON.stringify(validation.data[field])
          : validation.data[field],
      );
      const assignments = updates.map(
        (field, index) =>
          `${field}=$${index + 1}${field === "qualification_data" ? "::jsonb" : ""}`,
      );
      values.push(leadId);
      const result = await client.query(
        `UPDATE leads SET ${assignments.join(", ")},
           assigned_at=CASE WHEN current_owner_user_id IS NOT NULL OR current_team_id IS NOT NULL THEN COALESCE(assigned_at,CURRENT_TIMESTAMP) ELSE NULL END,
           updated_at=CURRENT_TIMESTAMP WHERE lead_id=$${values.length} RETURNING *`,
        values,
      );
      lead = result.rows[0];
      await addOwnershipHistory(
        client,
        leadId,
        {
          current_owner_user_id: current.current_owner_user_id,
          current_team_id: current.current_team_id,
        },
        {
          current_owner_user_id: lead.current_owner_user_id,
          current_team_id: lead.current_team_id,
        },
      );
    }
    if (validation.data.tag_ids) {
      await replaceLeadTags(client, leadId, validation.data.tag_ids);
    }
    await client.query("COMMIT");
    return NextResponse.json({ message: "Lead updated", lead });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Error && error.message.startsWith("REFERENCE:")) {
      return NextResponse.json(
        { error: error.message.slice(10) },
        { status: 422 },
      );
    }
    console.error("Failed to update lead", error);
    return NextResponse.json(
      { error: "Unable to update lead" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
