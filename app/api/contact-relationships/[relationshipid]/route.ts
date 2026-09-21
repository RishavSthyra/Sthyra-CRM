import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  parseRelationshipId,
  RELATIONSHIP_COLUMNS,
  RelationshipField,
  validateRelationshipPayload,
} from "@/lib/contactRelationships";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

type RelationshipContext = { params: Promise<{ relationshipid: string }> };

export async function GET(_request: NextRequest, context: RelationshipContext) {
  const relationshipId = parseRelationshipId(
    (await context.params).relationshipid,
  );
  if (!relationshipId) {
    return NextResponse.json(
      { error: "relationshipId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT ${RELATIONSHIP_COLUMNS}
       FROM contact_relationships
       WHERE relationship_id = $1`,
      [relationshipId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Relationship not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ relationship: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve contact relationship", error);
    return NextResponse.json(
      { error: "Unable to retrieve relationship" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RelationshipContext,
) {
  const relationshipId = parseRelationshipId(
    (await context.params).relationshipid,
  );
  if (!relationshipId) {
    return NextResponse.json(
      { error: "relationshipId must be a valid UUID" },
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
  const validation = validateRelationshipPayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const fields: RelationshipField[] = [
    "contact_id",
    "related_contact_id",
    "relationship_type",
    "notes",
  ];
  const updates = fields
    .filter((field) => validation.data[field] !== undefined)
    .map((field) => ({ field, value: validation.data[field] }));
  const values = updates.map(({ value }) => value);
  const assignments = updates.map(
    ({ field }, index) => `${field} = $${index + 1}`,
  );
  values.push(relationshipId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query(
      "SELECT * FROM contact_relationships WHERE relationship_id = $1 FOR UPDATE",
      [relationshipId],
    );
    if (existingResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Relationship not found" },
        { status: 404 },
      );
    }
    const existing = existingResult.rows[0];
    const nextContactId = validation.data.contact_id ?? existing.contact_id;
    const nextRelatedId =
      validation.data.related_contact_id ?? existing.related_contact_id;
    if (nextContactId === nextRelatedId) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "A contact cannot be related to itself" },
        { status: 422 },
      );
    }
    if (validation.data.contact_id || validation.data.related_contact_id) {
      const contacts = await client.query(
        `SELECT contact_id FROM contacts
         WHERE contact_id = ANY($1::uuid[])
           AND archived_at IS NULL
           AND merged_into_contact_id IS NULL`,
        [[nextContactId, nextRelatedId]],
      );
      if (contacts.rowCount !== 2) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Both contacts must exist and be active" },
          { status: 422 },
        );
      }
    }
    const result = await client.query(
      `UPDATE contact_relationships
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE relationship_id = $${values.length}
       RETURNING ${RELATIONSHIP_COLUMNS}`,
      values,
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Relationship updated",
      relationship: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "Relationship already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to update contact relationship", error);
    return NextResponse.json(
      { error: "Unable to update relationship" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RelationshipContext,
) {
  const relationshipId = parseRelationshipId(
    (await context.params).relationshipid,
  );
  if (!relationshipId) {
    return NextResponse.json(
      { error: "relationshipId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      "DELETE FROM contact_relationships WHERE relationship_id = $1 RETURNING relationship_id",
      [relationshipId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Relationship not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ message: "Relationship deleted" });
  } catch (error) {
    console.error("Failed to delete contact relationship", error);
    return NextResponse.json(
      { error: "Unable to delete relationship" },
      { status: 500 },
    );
  }
}
