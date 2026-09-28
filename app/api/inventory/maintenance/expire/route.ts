import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import { hasValidBearerSecret } from "@/lib/integrationAuth";
import {
  expireStaleInventoryHolds,
  expireStaleInventoryReservations,
} from "@/lib/inventoryActions";
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Inventory maintenance is not configured" },
      { status: 503 },
    );
  }
  if (!hasValidBearerSecret(request, secret))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const expiredHolds = await expireStaleInventoryHolds(client);
    const expiredReservations = await expireStaleInventoryReservations(client);
    await client.query("COMMIT");
    return NextResponse.json({
      expired_holds: expiredHolds,
      expired_reservations: expiredReservations,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to expire inventory records", error);
    return NextResponse.json(
      { error: "Unable to expire inventory records" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
