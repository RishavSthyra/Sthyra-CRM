import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { parseUuid } from "@/lib/operations";
import { generateQuotationPdf } from "@/lib/quotationPdf";
import { getQuotationDetail } from "@/lib/quotations";

type Context = {
  params: Promise<{ opportunityid: string; quotationid: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const params = await context.params;
  const access = await requireOpportunity(request, params.opportunityid);
  if (!access.ok) return access.response;
  const quotationId = parseUuid(params.quotationid);
  if (!quotationId)
    return NextResponse.json(
      { error: "quotationId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const quotation = await getQuotationDetail(
      pool,
      quotationId,
      access.opportunityId,
    );
    if (!quotation)
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );
    const pdf = await generateQuotationPdf(quotation);
    const inline = request.nextUrl.searchParams.get("download") !== "1";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${String(quotation.quotation_number)}-V${String(quotation.version)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to generate quotation PDF", error);
    return NextResponse.json(
      { error: "Unable to generate quotation PDF" },
      { status: 500 },
    );
  }
}
