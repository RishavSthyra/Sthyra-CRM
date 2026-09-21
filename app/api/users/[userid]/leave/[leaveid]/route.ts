import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  LEAVE_COLUMNS,
  LeaveField,
  parseLeaveId,
  validateLeavePayload,
} from "@/lib/leaves";
import { parseUserId } from "@/lib/users";

type LeaveContext = {
  params: Promise<{ userid: string; leaveid: string }>;
};

export async function PATCH(request: NextRequest, context: LeaveContext) {
  const { userid, leaveid } = await context.params;
  const userId = parseUserId(userid);
  const leaveId = parseLeaveId(leaveid);
  if (userId === null || leaveId === null) {
    return NextResponse.json(
      { error: "userid and leaveid must be valid UUIDs" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }

  const validation = validateLeavePayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query(
      `SELECT leave_id, start_date::text AS start_date, end_date::text AS end_date, status
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
    if (existingResult.rows[0].status !== "pending") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Only pending leave requests can be edited" },
        { status: 409 },
      );
    }

    const leave = validation.data;
    const nextStartDate = leave.start_date ?? existingResult.rows[0].start_date;
    const nextEndDate = leave.end_date ?? existingResult.rows[0].end_date;
    if (nextEndDate < nextStartDate) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "end_date cannot be earlier than start_date" },
        { status: 422 },
      );
    }

    const overlapResult = await client.query(
      `SELECT leave_id
       FROM user_leaves
       WHERE user_id = $1
         AND leave_id <> $2
         AND status IN ('pending', 'approved')
         AND daterange(start_date, end_date, '[]') && daterange($3::date, $4::date, '[]')
       LIMIT 1`,
      [userId, leaveId, nextStartDate, nextEndDate],
    );
    if (overlapResult.rowCount !== 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Leave dates overlap an existing pending or approved leave" },
        { status: 409 },
      );
    }

    const mutableFields: LeaveField[] = [
      "leave_type",
      "start_date",
      "end_date",
      "reason",
    ];
    const updates = mutableFields
      .filter((field) => leave[field] !== undefined)
      .map((field) => ({ field, value: leave[field] }));
    const values: unknown[] = updates.map(({ value }) => value);
    const assignments = updates.map(
      ({ field }, index) => `${field} = $${index + 1}`,
    );
    values.push(leaveId, userId);

    const result = await client.query(
      `UPDATE user_leaves
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE leave_id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${LEAVE_COLUMNS}`,
      values,
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Leave request updated",
      leave: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to update leave", error);
    return NextResponse.json(
      { error: "Unable to update leave" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
