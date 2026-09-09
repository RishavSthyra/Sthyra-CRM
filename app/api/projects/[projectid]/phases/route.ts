import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseProjectId } from "@/utils/parsetId";
import { PHASE_COLUMNS, serializePhase } from "@/lib/phases";

type PhaseContext = {
  params: Promise<{ projectid: string }>;
};

export async function GET(
  _request: NextRequest,
  context: PhaseContext,
) {
  const { projectid } = await context.params;

  const projectId = parseProjectId(projectid);

  if (projectId === null) {
    return NextResponse.json(
      { error: "projectid must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const result = await pool.query(
      `SELECT ${PHASE_COLUMNS}
       FROM phases p
       WHERE p.project_id = $1
       ORDER BY p.phase_number ASC`,
      [projectId],
    )

    //My logic is phase 1 should be there by default okay like
    // a project should be at some phase 
    // so i am making greater than 1

    return NextResponse.json(
      {
        message: "Phases retrieved successfully",
        phases: result.rows.map(serializePhase),
      },

      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("Failed to retrieve phases", error);

    return NextResponse.json(
      { error: "Unable to retrieve phases" },
      { status: 500 },
    );
  }
}


export async function POST(request: NextRequest) {
    try {
      const body = await request.json();

    } catch (error : unknown) {
        
    }
}