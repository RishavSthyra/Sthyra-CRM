import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  LeadConfigurationWrite,
  validateLeadConfiguration,
} from "@/lib/projectLeadConfiguration";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type Context = { params: Promise<{ projectid: string }> };
const COLUMNS = `
  project_id, default_source_id, default_campaign_id, auto_assignment_enabled,
  assignment_strategy, duplicate_check_enabled, duplicate_window_days,
  response_sla_minutes, created_at, updated_at
`;

export async function GET(_request: NextRequest, context: Context) {
  const projectId = parsePositiveInteger((await context.params).projectid);
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
      { status: 400 },
    );
  }
  try {
    const project = await pool.query(
      "SELECT project_id FROM projects WHERE project_id=$1",
      [projectId],
    );
    if (!project.rowCount) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM project_lead_configurations WHERE project_id=$1`,
      [projectId],
    );
    return NextResponse.json({
      configuration: result.rows[0] ?? {
        project_id: projectId,
        default_source_id: null,
        default_campaign_id: null,
        auto_assignment_enabled: false,
        assignment_strategy: "manual",
        duplicate_check_enabled: true,
        duplicate_window_days: 90,
        response_sla_minutes: 30,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve project lead configuration", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead configuration" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const projectId = parsePositiveInteger((await context.params).projectid);
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
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
  const validation = validateLeadConfiguration(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const project = await client.query(
      "SELECT project_id FROM projects WHERE project_id=$1 FOR UPDATE",
      [projectId],
    );
    if (!project.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    await client.query(
      "INSERT INTO project_lead_configurations (project_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [projectId],
    );
    const existing = (
      await client.query(
        `SELECT ${COLUMNS} FROM project_lead_configurations WHERE project_id=$1 FOR UPDATE`,
        [projectId],
      )
    ).rows[0];
    const nextSource =
      validation.data.default_source_id === undefined
        ? existing.default_source_id
        : validation.data.default_source_id;
    const nextCampaign =
      validation.data.default_campaign_id === undefined
        ? existing.default_campaign_id
        : validation.data.default_campaign_id;
    if (nextSource) {
      const source = await client.query(
        "SELECT source_id FROM lead_sources WHERE source_id=$1 AND is_active=TRUE",
        [nextSource],
      );
      if (!source.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Active default lead source not found" },
          { status: 422 },
        );
      }
    }
    if (nextCampaign) {
      const campaign = await client.query(
        "SELECT source_id FROM campaigns WHERE campaign_id=$1 AND is_active=TRUE",
        [nextCampaign],
      );
      if (!campaign.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Active default campaign not found" },
          { status: 422 },
        );
      }
      if (
        nextSource &&
        campaign.rows[0].source_id &&
        campaign.rows[0].source_id !== nextSource
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error:
              "Default campaign does not belong to the default lead source",
          },
          { status: 422 },
        );
      }
    }
    const fields: (keyof LeadConfigurationWrite)[] = [
      "default_source_id",
      "default_campaign_id",
      "auto_assignment_enabled",
      "assignment_strategy",
      "duplicate_check_enabled",
      "duplicate_window_days",
      "response_sla_minutes",
    ];
    const updates = fields.filter(
      (field) => validation.data[field] !== undefined,
    );
    const values = updates.map((field) => validation.data[field]);
    const assignments = updates.map((field, index) => `${field}=$${index + 1}`);
    values.push(projectId);
    const result = await client.query(
      `UPDATE project_lead_configurations SET ${assignments.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE project_id=$${values.length} RETURNING ${COLUMNS}`,
      values,
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Lead configuration updated",
      configuration: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to update project lead configuration", error);
    return NextResponse.json(
      { error: "Unable to update lead configuration" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
