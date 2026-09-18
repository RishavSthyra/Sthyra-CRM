import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseId } from "@/utils/parsetId";
import { PHASE_COLUMNS, serializePhase, ValidatePhasesPayload } from "@/lib/phases";
import { getProjectDatabaseErrorCode } from "@/lib/projects";
import { Pool } from "pg";

type PhaseContext = {
  params: Promise<{ projectid: string }>;
};

export async function GET(
  _request: NextRequest,
  context: PhaseContext,
) {

  try {
      const { projectid } = await context.params;

  const projectId = parseId(projectid);

  const projectExists = await pool.query("SELECT * FROM projects WHERE project_id = $1",[projectId])

    if (projectExists.rowCount === 0) {
        return NextResponse.json({message :"Project doesnt exists",project : projectExists.rows
        },{status : 404})
    }

  if (projectId === null) {
    return NextResponse.json(
      { error: "projectid must be a positive integer" },
      { status: 400 },
    );
  }
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


export async function POST(request: NextRequest, params : PhaseContext) {
    

    let body : unknown
    try {
    body = await request.json();

    // If we reach here, the body was valid JSON
    
    console.log(body);

    } catch (error: unknown) {

    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

    const validatedData = ValidatePhasesPayload(body, {isPartial : false} )

    if (!validatedData.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validatedData.errors },
      { status: 422 },
    );
  }

  const phaseData = validatedData.data;

  try {

    const {projectid} = await params.params

    // we are checking if the completed flats are less than total flats 
    // or not. I know its random but its necessary.

    // WE NEED TO GET THE PROJECT ID FROM ANOTHER COMMAND

    const project = await pool.query("SELECT * FROM projects WHERE project_id=$1",[projectid])

    if (project.rowCount === 0) {
        return NextResponse.json({message : "Project doesnt exist",project : project.rows},{status : 404})
    }

    const insertResult = await pool.query(`INSERT INTO phases 
        (project_id,
         phase_code,
         phase_name,
         phase_number,
         phase_status,
         total_units,
         completed_units,
         total_acres,
         start_date,
         expected_completion_date,
         actual_completion_date,
         description,
         is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING phase_id `,
        [
            project.rows[0].project_id,
            phaseData.phase_code,
            phaseData.phase_name,
            phaseData.phase_number,
            phaseData.phase_status,
            phaseData.total_units,
            phaseData.completed_units,
            phaseData.total_acres,
            phaseData.start_date,
            phaseData.expected_completion_date,
            phaseData.actual_completion_date,
            phaseData.description,
            phaseData.is_active
        ],);

    const result = await pool.query(
  `SELECT ${PHASE_COLUMNS}
   FROM phases p
   WHERE p.phase_id = $1`,
  [insertResult.rows[0].phase_id],
);
    
return NextResponse.json({
    messsage : "Phase Added", phase : serializePhase(result.rows[0])
}, {status : 201})

  } catch (error) {
    
    const code = getProjectDatabaseErrorCode(error);
  
      if (code === "23505") {
        return NextResponse.json(
          { error: "This phase_code already exists for the company" },
          { status: 409 },
        );
      }
  
      if (code === "23514") {
        return NextResponse.json(
          { error: "Phase data violates a database constraint" },
          { status: 422 },
        );
      }
  
      console.error("Failed to create phase", error);
      return NextResponse.json(
        { error: "Unable to create phase" },
        { status: 500 },
      );
  }
}