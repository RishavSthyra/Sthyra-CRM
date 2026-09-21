import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  isLeaveStatus,
  LEAVE_COLUMNS,
  validateLeavePayload,
} from "@/lib/leaves";
import { parseUserId } from "@/lib/users";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type UserContext = {
  params: Promise<{ userid: string }>;
};

export async function GET(request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json(
      { error: "userid must be a valid UUID" },
      { status: 400 },
    );
  }

  const page = parsePositiveInteger(
    request.nextUrl.searchParams.get("page"),
    1,
  );
  const limit = parsePositiveInteger(
    request.nextUrl.searchParams.get("limit"),
    20,
  );
  const status = request.nextUrl.searchParams
    .get("status")
    ?.trim()
    .toLowerCase();
  if (page === null || limit === null || limit > 100) {
    return NextResponse.json(
      {
        error:
          "page and limit must be positive integers; limit cannot exceed 100",
      },
      { status: 400 },
    );
  }
  if (status && !isLeaveStatus(status)) {
    return NextResponse.json(
      { error: "Invalid leave status" },
      { status: 400 },
    );
  }

  try {
    const userResult = await pool.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL",
      [userId],
    );
    if (userResult.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const values: unknown[] = [userId];
    const filters = ["user_id = $1"];
    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM user_leaves ${whereClause}`,
      values,
    );
    const offset = (page - 1) * limit;
    const listValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT ${LEAVE_COLUMNS}
       FROM user_leaves
       ${whereClause}
       ORDER BY start_date DESC, created_at DESC, leave_id ASC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      leaves: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve user leaves", error);
    return NextResponse.json(
      { error: "Unable to retrieve user leaves" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json(
      { error: "userid must be a valid UUID" },
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

  const validation = validateLeavePayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const leave = validation.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL FOR UPDATE",
      [userId],
    );
    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const overlapResult = await client.query(
      `SELECT leave_id
       FROM user_leaves
       WHERE user_id = $1
         AND status IN ('pending', 'approved')
         AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
       LIMIT 1`,
      [userId, leave.start_date, leave.end_date],
    );
    if (overlapResult.rowCount !== 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Leave dates overlap an existing pending or approved leave" },
        { status: 409 },
      );
    }

    const result = await client.query(
      `INSERT INTO user_leaves (
         user_id,
         leave_type,
         start_date,
         end_date,
         reason
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${LEAVE_COLUMNS}`,
      [
        userId,
        leave.leave_type,
        leave.start_date,
        leave.end_date,
        leave.reason ?? null,
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Leave request created", leave: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create leave", error);
    return NextResponse.json(
      { error: "Unable to create leave" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
