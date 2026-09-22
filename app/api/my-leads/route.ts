import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) {
    return authentication.response;
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const status = request.nextUrl.searchParams.get("status");
  const statuses = [
    "active",
    "qualified",
    "closed",
    "nurture",
    "duplicate",
    "invalid",
  ];
  if (status && !statuses.includes(status)) {
    return NextResponse.json({ error: "Invalid lead status" }, { status: 400 });
  }
  const values: unknown[] = [authentication.auth.user.user_id];
  const filters = ["l.current_owner_user_id=$1"];
  if (status) {
    values.push(status);
    filters.push(`l.status=$${values.length}`);
  }
  const listValues = [...values, pagination.limit, pagination.offset];
  try {
    const result = await pool.query(
      `SELECT l.*, c.first_name, c.last_name, c.email, c.phone_number,
              s.stage_key, s.stage_name
       FROM leads l JOIN contacts c ON c.contact_id=l.contact_id
       LEFT JOIN project_lead_stages s ON s.stage_id=l.stage_id
       WHERE ${filters.join(" AND ")}
       ORDER BY l.updated_at DESC, l.lead_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    return NextResponse.json({ leads: result.rows });
  } catch (error) {
    console.error("Failed to retrieve owned leads", error);
    return NextResponse.json(
      { error: "Unable to retrieve owned leads" },
      { status: 500 },
    );
  }
}
