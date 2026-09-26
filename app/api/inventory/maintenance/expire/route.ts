import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  expireStaleInventoryHolds,
  expireStaleInventoryReservations,
} from "@/lib/inventoryActions";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = await pool.connect();
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
