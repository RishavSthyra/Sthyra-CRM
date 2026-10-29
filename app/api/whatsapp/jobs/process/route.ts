import { NextRequest, NextResponse } from "next/server";
import { hasValidBearerSecret } from "@/lib/integrationAuth";
import { processWhatsAppDeliveryJob } from "@/lib/whatsappDelivery";

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "WhatsApp jobs are not configured" }, { status: 503 });
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = [];
  for (let index = 0; index < 25; index += 1) {
    const result = await processWhatsAppDeliveryJob();
    if (!result) break;
    results.push(result);
  }
  return NextResponse.json({ processed: results.length, results });
}
