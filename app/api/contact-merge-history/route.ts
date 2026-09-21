import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseContactId } from "@/lib/contacts";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const values: unknown[] = [];
  const filters = ["1 = 1"];
  const contactValue = request.nextUrl.searchParams.get("contact_id");
  if (contactValue !== null) {
    const contactId = parseContactId(contactValue);
    if (!contactId) {
      return NextResponse.json(
        { error: "contact_id must be a valid UUID" },
        { status: 400 },
      );
    }
    values.push(contactId);
    filters.push(
      `(survivor_contact_id = $${values.length} OR duplicate_contact_id = $${values.length})`,
    );
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status !== null) {
    if (status !== "merged" && status !== "unmerged") {
      return NextResponse.json(
        { error: "status must be merged or unmerged" },
        { status: 400 },
      );
    }
    filters.push(
      status === "merged" ? "unmerged_at IS NULL" : "unmerged_at IS NOT NULL",
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM contact_merge_history ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT
         merge_id,
         survivor_contact_id,
         duplicate_contact_id,
         applied_fields,
         merged_by,
         merged_at,
         unmerged_by,
         unmerged_at,
         unmerge_notes,
         CASE WHEN unmerged_at IS NULL THEN 'merged' ELSE 'unmerged' END AS status
       FROM contact_merge_history
       ${where}
       ORDER BY merged_at DESC, merge_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      merges: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list contact merge history", error);
    return NextResponse.json(
      { error: "Unable to retrieve contact merge history" },
      { status: 500 },
    );
  }
}
