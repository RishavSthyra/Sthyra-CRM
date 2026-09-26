import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { parsePagination } from "@/utils/parsePagination";

type Context = { params: Promise<{ opportunityid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const access = await requireOpportunity(request, (await context.params).opportunityid);
  if (!access.ok) return access.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  try {
    const result = await pool.query(
      `SELECT oh.*,
        CASE WHEN from_user.user_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
          'user_id', from_user.user_id, 'first_name', from_user.first_name,
          'last_name', from_user.last_name, 'email', from_user.email
        ) END AS from_owner,
        CASE WHEN to_user.user_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
          'user_id', to_user.user_id, 'first_name', to_user.first_name,
          'last_name', to_user.last_name, 'email', to_user.email
        ) END AS to_owner,
        CASE WHEN from_team.team_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
          'team_id', from_team.team_id, 'team_name', from_team.name
        ) END AS from_team,
        CASE WHEN to_team.team_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
          'team_id', to_team.team_id, 'team_name', to_team.name
        ) END AS to_team,
        COUNT(*) OVER()::integer AS total
       FROM opportunity_ownership_history oh
       LEFT JOIN users from_user ON from_user.user_id=oh.from_owner_user_id
       LEFT JOIN users to_user ON to_user.user_id=oh.to_owner_user_id
       LEFT JOIN teams from_team ON from_team.team_id=oh.from_team_id
       LEFT JOIN teams to_team ON to_team.team_id=oh.to_team_id
       WHERE oh.opportunity_id=$1
       ORDER BY oh.created_at DESC, oh.ownership_history_id DESC
       LIMIT $2 OFFSET $3`,
      [access.opportunityId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    return NextResponse.json({
      ownership_history: result.rows.map((row) => {
        const history = { ...row };
        delete history.total;
        return history;
      }),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve opportunity ownership history", error);
    return NextResponse.json({ error: "Unable to retrieve opportunity ownership history" }, { status: 500 });
  }
}
