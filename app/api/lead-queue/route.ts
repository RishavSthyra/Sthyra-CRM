import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const values: unknown[] = [];
  const filters = [
    "l.current_owner_user_id IS NULL",
    "l.status IN ('active','qualified')",
  ];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue !== null) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId) {
      return NextResponse.json(
        { error: "project_id must be a positive integer" },
        { status: 400 },
      );
    }
    values.push(projectId);
    filters.push(`l.project_id=$${values.length}`);
  }

  try {
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT l.*, c.first_name, c.last_name, c.email, c.phone_number,
              s.stage_key, s.stage_name
       FROM leads l JOIN contacts c ON c.contact_id=l.contact_id
       LEFT JOIN project_lead_stages s ON s.stage_id=l.stage_id
       WHERE ${filters.join(" AND ")}
       ORDER BY l.received_at ASC, l.lead_id ASC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    return NextResponse.json({
      leads: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        returned: result.rows.length,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve lead queue", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead queue" },
      { status: 500 },
    );
  }
}
