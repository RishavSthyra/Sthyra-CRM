import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid } from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

type Context = {
  params: Promise<{ emailid: string; attachmentid: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const params = await context.params;
  const emailId = parseActivityUuid(params.emailid);
  const attachmentId = parseActivityUuid(params.attachmentid);
  if (!emailId || !attachmentId) {
    return NextResponse.json(
      { error: "Invalid email or attachment ID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT attachment_id, email_id, company_id, project_id, file_name,
        mime_type, size_bytes, content
       FROM email_attachments
       WHERE attachment_id=$1 AND email_id=$2`,
      [attachmentId, emailId],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }
    const attachment = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(attachment.company_id),
        Number(attachment.project_id),
      )
    ) {
      return NextResponse.json(
        { error: "You do not have access to this attachment" },
        { status: 403 },
      );
    }
    const originalName = String(attachment.file_name).replace(/["\r\n]/g, "_");
    const safeName = originalName.replace(/[^\x20-\x7E]/g, "_");
    return new Response(new Uint8Array(attachment.content), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
        "Content-Length": String(attachment.size_bytes),
        "Content-Type": attachment.mime_type || "application/octet-stream",
      },
    });
  } catch (error) {
    console.error("Failed to download email attachment", error);
    return NextResponse.json(
      { error: "Unable to download attachment" },
      { status: 500 },
    );
  }
}
