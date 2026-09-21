import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { LEAVE_COLUMNS, parseLeaveId } from "@/lib/leaves";
import { parseUserId } from "@/lib/users";

type LeaveContext = {
  params: Promise<{ userid: string; leaveid: string }>;
};

export async function POST(_request: Request, context: LeaveContext) {
  const { userid, leaveid } = await context.params;
  const userId = parseUserId(userid);
  const leaveId = parseLeaveId(leaveid);
  if (userId === null || leaveId === null) {
    return NextResponse.json(
      { error: "userid and leaveid must be valid UUIDs" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query(
      `SELECT ${LEAVE_COLUMNS}
       FROM user_leaves
       WHERE leave_id = $1 AND user_id = $2
       FOR UPDATE`,
      [leaveId, userId],
    );
    if (existingResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Leave request not found" },
        { status: 404 },
      );
    }
    if (existingResult.rows[0].status === "cancelled") {
      await client.query("COMMIT");
      return NextResponse.json({
        message: "Leave request already cancelled",
        leave: existingResult.rows[0],
      });
    }
    if (existingResult.rows[0].status === "rejected") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "A rejected leave request cannot be cancelled" },
        { status: 409 },
      );
    }

    const result = await client.query(
      `UPDATE user_leaves
       SET status = 'cancelled',
           cancelled_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE leave_id = $1 AND user_id = $2
       RETURNING ${LEAVE_COLUMNS}`,
      [leaveId, userId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Leave request cancelled",
      leave: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to cancel leave", error);
    return NextResponse.json(
      { error: "Unable to cancel leave" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
