import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseContactId } from "@/lib/contacts";
import {
  RELATIONSHIP_COLUMNS,
  validateRelationshipPayload,
} from "@/lib/contactRelationships";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
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
      `(contact_id = $${values.length} OR related_contact_id = $${values.length})`,
    );
  }
  const type = request.nextUrl.searchParams
    .get("relationship_type")
    ?.trim()
    .toLowerCase();
  if (type) {
    values.push(type);
    filters.push(`relationship_type = $${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM contact_relationships ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${RELATIONSHIP_COLUMNS}
       FROM contact_relationships
       ${where}
       ORDER BY created_at DESC, relationship_id ASC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      relationships: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list contact relationships", error);
    return NextResponse.json(
      { error: "Unable to retrieve contact relationships" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateRelationshipPayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const relationship = validation.data;
  try {
    const contacts = await pool.query(
      `SELECT contact_id
       FROM contacts
       WHERE contact_id = ANY($1::uuid[])
         AND archived_at IS NULL
         AND merged_into_contact_id IS NULL`,
      [[relationship.contact_id, relationship.related_contact_id]],
    );
    if (contacts.rowCount !== 2) {
      return NextResponse.json(
        { error: "Both contacts must exist and be active" },
        { status: 422 },
      );
    }
    const result = await pool.query(
      `INSERT INTO contact_relationships (
         contact_id, related_contact_id, relationship_type, notes
       )
       VALUES ($1, $2, $3, $4)
       RETURNING ${RELATIONSHIP_COLUMNS}`,
      [
        relationship.contact_id,
        relationship.related_contact_id,
        relationship.relationship_type,
        relationship.notes ?? null,
      ],
    );
    return NextResponse.json(
      { message: "Contact relationship created", relationship: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "Relationship already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to create contact relationship", error);
    return NextResponse.json(
      { error: "Unable to create contact relationship" },
      { status: 500 },
    );
  }
}
