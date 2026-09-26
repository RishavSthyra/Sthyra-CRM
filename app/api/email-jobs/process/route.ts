import { NextRequest, NextResponse } from "next/server";
import { processEmailDeliveryJob } from "@/lib/email/deliveryJobs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = [];
  for (let index = 0; index < 10; index += 1) {
    const result = await processEmailDeliveryJob();
    if (!result) break;
    results.push(result);
  }
  return NextResponse.json({ processed: results.length, results });
}
