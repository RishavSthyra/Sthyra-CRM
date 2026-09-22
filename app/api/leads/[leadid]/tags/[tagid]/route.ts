import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseLeadId } from "@/lib/leads";
import { isUuid } from "@/lib/permissions";

type Context = { params: Promise<{ leadid: string; tagid: string }> };

export async function DELETE(_request: NextRequest, context: Context) {
  const parameters = await context.params;
  const leadId = parseLeadId(parameters.leadid);
  const tagId = isUuid(parameters.tagid)
    ? parameters.tagid.toLowerCase()
    : null;
  if (!leadId || !tagId) {
    return NextResponse.json(
      { error: "leadId and tagId must be valid UUIDs" },
      { status: 400 },
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
    const deleted = await client.query(
      "DELETE FROM lead_tags WHERE lead_id=$1 AND tag_id=$2 RETURNING tag_id",
      [leadId, tagId],
    );
    if (!deleted.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Tag is not assigned to this lead" },
        { status: 404 },
      );
    }
    await client.query(
      `INSERT INTO lead_tag_history (lead_id, tag_id, action)
       VALUES ($1,$2,'removed')`,
      [leadId, tagId],
    );
    await client.query("COMMIT");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to remove lead tag", error);
    return NextResponse.json(
      { error: "Unable to remove lead tag" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
