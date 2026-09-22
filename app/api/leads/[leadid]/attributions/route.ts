import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  ATTRIBUTION_COLUMNS,
  leadExists,
  validateAttributionPayload,
} from "@/lib/leadHistory";
import { parseLeadId } from "@/lib/leads";
import { parsePagination } from "@/utils/parsePagination";

type Context = { params: Promise<{ leadid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  try {
    if (!(await leadExists(pool, leadId))) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const count = await pool.query(
      "SELECT COUNT(*)::integer AS total FROM lead_attributions WHERE lead_id=$1",
      [leadId],
    );
    const result = await pool.query(
      `SELECT la.*,
              ls.source_name, ls.code AS source_code,
              c.campaign_name, c.campaign_code
       FROM lead_attributions la
       LEFT JOIN lead_sources ls ON ls.source_id=la.source_id
       LEFT JOIN campaigns c ON c.campaign_id=la.campaign_id
       WHERE la.lead_id=$1
       ORDER BY la.occurred_at DESC, la.attribution_id DESC
       LIMIT $2 OFFSET $3`,
      [leadId, pagination.limit, pagination.offset],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      attributions: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve lead attributions", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead attributions" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: Context) {
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
  const validation = validateAttributionPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await client.query(
      "SELECT 1 FROM leads WHERE lead_id=$1 FOR UPDATE",
      [leadId],
    );
    if (!lead.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    let sourceId = validation.data.source_id;
    if (sourceId) {
      const source = await client.query(
        "SELECT source_id FROM lead_sources WHERE source_id=$1 AND is_active=TRUE",
        [sourceId],
      );
      if (!source.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Active lead source not found" },
          { status: 422 },
        );
      }
    }

    if (validation.data.campaign_id) {
      const campaign = await client.query(
        `SELECT source_id FROM campaigns
         WHERE campaign_id=$1 AND is_active=TRUE`,
        [validation.data.campaign_id],
      );
      if (!campaign.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Active campaign not found" },
          { status: 422 },
        );
      }
      const campaignSourceId = campaign.rows[0].source_id as string | null;
      if (sourceId && campaignSourceId && sourceId !== campaignSourceId) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Campaign does not belong to the selected lead source" },
          { status: 422 },
        );
      }
      sourceId ??= campaignSourceId;
    }

    const result = await client.query(
      `INSERT INTO lead_attributions (
         lead_id, source_id, campaign_id, attribution_type,
         sub_source, occurred_at, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING ${ATTRIBUTION_COLUMNS}`,
      [
        leadId,
        sourceId,
        validation.data.campaign_id,
        validation.data.attribution_type,
        validation.data.sub_source,
        validation.data.occurred_at,
        JSON.stringify(validation.data.metadata),
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Lead attribution created", attribution: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create lead attribution", error);
    return NextResponse.json(
      { error: "Unable to create lead attribution" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
