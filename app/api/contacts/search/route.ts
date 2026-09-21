import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { CONTACT_COLUMNS } from "@/lib/contacts";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "q must contain at least 2 characters" },
      { status: 400 },
    );
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  const pattern = `%${query}%`;
  const matchingClause = `
    c.archived_at IS NULL
    AND (
      CONCAT_WS(' ', c.first_name, c.last_name) ILIKE $1
      OR c.email ILIKE $1
      OR c.phone_number ILIKE $1
      OR c.alternate_phone_number ILIKE $1
      OR c.company_works_at ILIKE $1
      OR EXISTS (
        SELECT 1
        FROM contact_aliases ca
        WHERE ca.contact_id = c.contact_id
          AND ca.alias_value ILIKE $1
      )
    )`;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total
       FROM contacts c
       WHERE ${matchingClause}`,
      [pattern],
    );
    const result = await pool.query(
      `SELECT ${CONTACT_COLUMNS}
       FROM contacts c
       WHERE ${matchingClause}
       ORDER BY c.first_name ASC, c.last_name ASC NULLS LAST, c.contact_id ASC
       LIMIT $2 OFFSET $3`,
      [pattern, pagination.limit, pagination.offset],
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      contacts: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to search contacts", error);
    return NextResponse.json(
      { error: "Unable to search contacts" },
      { status: 500 },
    );
  }
}
