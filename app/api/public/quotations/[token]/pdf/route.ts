import { NextRequest, NextResponse } from "next/server";
import { hashToken } from "@/lib/auth";
import { adminPool } from "@/lib/db";
import { generateQuotationPdf } from "@/lib/quotationPdf";
import { getQuotationDetail } from "@/lib/quotations";
import { enforceRateLimits } from "@/lib/rateLimit";

type Context = { params: Promise<{ token: string }> };

export async function GET(request: NextRequest, context: Context) {
  const token = (await context.params).token.trim();
  if (!token || token.length > 200)
    return NextResponse.json(
      { error: "Invalid quotation link" },
      { status: 400 },
    );
  const rateLimit = await enforceRateLimits(request, [
    { action: "quotation-pdf:ip", limit: 60, windowSeconds: 10 * 60 },
    {
      action: "quotation-pdf:token",
      subject: `quotation:${token}`,
      limit: 30,
      windowSeconds: 10 * 60,
    },
  ]);
  if (rateLimit) return rateLimit;
  try {
    const link = await adminPool.query(
      `SELECT quotation_id FROM quotation_share_links
       WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
      [hashToken(token)],
    );
    if (!link.rowCount)
      return NextResponse.json(
        { error: "This quotation link is invalid or expired" },
        { status: 410 },
      );
    const quotation = await getQuotationDetail(
      adminPool,
      String(link.rows[0].quotation_id),
    );
    if (!quotation)
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );
    const pdf = await generateQuotationPdf(quotation);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${String(quotation.quotation_number)}-V${String(quotation.version)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to generate public quotation PDF", error);
    return NextResponse.json(
      { error: "Unable to generate quotation PDF" },
      { status: 500 },
    );
  }
}
