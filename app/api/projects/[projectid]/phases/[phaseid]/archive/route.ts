import {NextRequest,NextResponse} from "next/server";
import pool from "@/lib/db";
import { parseRegionId } from "@/lib/regions";

type PhaseContext = {
    params : Promise <{
      projectid : string,
      phaseid : string
    }>
}

export async function PATCH(request: NextRequest, params: PhaseContext) {
  const { projectid, phaseid } = await params.params;

  const phaseId = parseRegionId(phaseid);
  const projectId = parseRegionId(projectid);

  if (phaseId === null || projectId === null) {
    return NextResponse.json(
      { error: "projectid and phaseid must be a positive integer" },
      { status: 400 },
    );
  }

  try {

    // Archive the phase by setting is_active to false
    const result = await pool.query(
      "UPDATE phases SET is_active = false WHERE phase_id = $1 AND project_id = $2 RETURNING *",
      [phaseId, projectId],
    ); 

    // Check if any rows were affected (i.e., if the phase was found and archived)
    if (result.rows.length === 0) {
      return NextResponse.json(
        { message: "No phase exists with the specified projectid and phaseid" },
        { status: 404 },
      );
    }
    
    // Return the archived phase details

    return NextResponse.json(
      { message: "Phase successfully ", phase: result.rows[0] },
      { status: 200 },
    );
  } catch (error: unknown) {
    
    console.error("Failed to archive the phase", error);
    return NextResponse.json(
      { error: "Unable to archive the phase" },
      { status: 500 },
    );
  }
}