import { NextResponse } from "next/server";
import { adminPool } from "@/lib/db";

export async function GET() {
  try {
    const result = await adminPool.query("SELECT 1 AS ready");
    if (result.rows[0]?.ready === 1) {
      return NextResponse.json({ status: "ready" });
    }
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  } catch (error) {
    console.error("Database readiness check failed", error);
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
