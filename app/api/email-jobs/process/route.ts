import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import { processEmailDeliveryJob } from "@/lib/email/deliveryJobs";
import { hasValidBearerSecret } from "@/lib/integrationAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Email jobs are not configured" },
      { status: 503 },
    );
  }
  if (!hasValidBearerSecret(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = [];
  for (let index = 0; index < 10; index += 1) {
    const result = await processEmailDeliveryJob(undefined, adminPool);
    if (!result) break;
    results.push(result);
  }
  return NextResponse.json({ processed: results.length, results });
}
