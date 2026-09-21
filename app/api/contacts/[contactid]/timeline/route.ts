import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseContactId } from "@/lib/contacts";
import { parsePagination } from "@/utils/parsePagination";

type ContactContext = { params: Promise<{ contactid: string }> };

export async function GET(request: NextRequest, context: ContactContext) {
  const contactId = parseContactId((await context.params).contactid);
  if (!contactId) {
    return NextResponse.json(
      { error: "contactId must be a valid UUID" },
      { status: 400 },
    );
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  try {
    const contactResult = await pool.query(
      "SELECT contact_id FROM contacts WHERE contact_id = $1 AND archived_at IS NULL",
      [contactId],
    );
    if (contactResult.rowCount === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total
       FROM contact_timeline_events
       WHERE contact_id = $1`,
      [contactId],
    );
    const result = await pool.query(
      `SELECT
         event_id,
         contact_id,
         event_type,
         title,
         description,
         metadata,
         occurred_at,
         created_by,
         created_at
       FROM contact_timeline_events
       WHERE contact_id = $1
       ORDER BY occurred_at DESC, event_id DESC
       LIMIT $2 OFFSET $3`,
      [contactId, pagination.limit, pagination.offset],
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      events: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve contact timeline", error);
    return NextResponse.json(
      { error: "Unable to retrieve contact timeline" },
      { status: 500 },
    );
  }
}
