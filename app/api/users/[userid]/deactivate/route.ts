import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUserId, USER_COLUMNS } from "@/lib/users";

type UserContext = {
  params: Promise<{ userid: string }>;
};

export async function POST(_request: Request, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json(
      { error: "userid must be a valid UUID" },
      { status: 400 },
    );
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND deleted_at IS NULL
       RETURNING ${USER_COLUMNS}`,
      [userId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "User deactivated", user: result.rows[0] });
  } catch (error) {
    console.error("Failed to deactivate user", error);
    return NextResponse.json(
      { error: "Unable to deactivate user" },
      { status: 500 },
    );
  }
}
