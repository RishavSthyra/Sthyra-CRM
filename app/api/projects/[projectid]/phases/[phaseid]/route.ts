import { NextRequest ,NextResponse } from "next/server";

import pool from "@/lib/db";
import { parseRegionId } from "@/lib/regions";
import { ValidatePhasesPayload } from "@/lib/phases";
import { PHASE_COLUMNS } from "@/lib/phases";
import { serializePhase } from "@/lib/phases";


type PhaseContext = {
    params : Promise <{
      projectid : string,
      phaseid : string
    }>
}

export async function GET(request : NextRequest,params : PhaseContext) {
    try {

        const {projectid,phaseid} = await params.params;

        const phaseId = parseRegionId(phaseid);
        const projectId = parseRegionId(projectid)

        if (projectId === null || phaseId === null) {
        return NextResponse.json(
            { error: "projectid and phaseid must be a positive integer" },
            { status: 400 }
        );
        }
        
        const result = await pool.query("SELECT * FROM phases WHERE phase_id=$1 AND project_id=$2",[phaseId,projectId])

        if (result.rows.length === 0) {
            return NextResponse.json({message : "No phase exists the one you mentioned",phase : phaseid},{status : 404})
        }

        return NextResponse.json({message : "Successfully found the phase",phase : result.rows[0]},{status : 200})


    } catch (error : unknown) {
         console.error("Failed to list the phase", error);
    return NextResponse.json(
      { error: "Unable to retrieve the phase" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, params: PhaseContext,
) {
  const { projectid , phaseid } = await params.params;

  const phaseId = parseRegionId(phaseid);
  const projectId = parseRegionId(projectid);

  if (projectId === null) {
    return NextResponse.json(
      { error: "projectid must be a positive integer" },
      { status: 400 },
    );
  }


  if (phaseId === null) {
    return NextResponse.json(
      { error: "phaseid must be a positive integer" },
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

  const validatedData = ValidatePhasesPayload(body, {
    isPartial: true,
  });

  if (!validatedData.ok) {
    return NextResponse.json(
      {
        message: "The data validation failed",
        errors: validatedData.errors,
      },
      { status: 422 },
    );
  }

  const phase = validatedData.data;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingProject = await client.query(
      `SELECT project_id FROM projects WHERE project_id = $1
      FOR UPDATE`,[projectId]
    )

    if (existingProject.rowCount === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 },
      );
    }

const existingPhase = await client.query(
  `SELECT *
   FROM phases
   WHERE phase_id = $1
     AND project_id = $2
   FOR UPDATE`,
  [phaseId, projectId],
);

    if (existingPhase.rowCount === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Phase not found" },
        { status: 404 },
      );
    }

    if (phase.completed_units !== undefined && phase.total_units!== undefined && phase.total_units!== null) {
        if (phase.completed_units > phase.total_units) {
           await client.query("ROLLBACK");
         return NextResponse.json({message : `completed units cant be more than total flats. Current completed units is ${phase.completed_units}
          and total units is ${phase.total_units}. Fix it`}, { status: 422 })
     }
    }
    else if (phase.completed_units !== undefined) {
      // const total_units = await client.query("SELECT total_units FROM phases WHERE phase_id=$1",[phaseId])
      if (phase.completed_units > existingPhase.rows[0].total_units) {
        await client.query("ROLLBACK");
        return NextResponse.json({message : `completed units cant be more than total flats. Current completed units is ${phase.completed_units}
          and total units is ${existingPhase.rows[0].total_units}. Fix it`}, { status: 422 })
      }
    }else if (phase.total_units !== undefined && phase.total_units !== null){
      if (existingPhase.rows[0].completed_units > phase.total_units) {
        await client.query("ROLLBACK");
         return NextResponse.json({message : `completed units cant be more than total flats. Current completed units is ${existingPhase.rows[0].completed_units }
          and total units is ${phase.total_units}. Fix it`}, { status: 422 })
      }
    }

    const updates: { column: string; value: unknown }[] = [];

    const mutableFields = [
      "phase_code",
      "phase_name",
      "phase_number",
      "phase_status",
      "total_units",
      "completed_units",
      "total_acres",
      "start_date",
      "expected_completion_date",
      "actual_completion_date",
      "description",
      "is_active",
    ] as const;

    for (const field of mutableFields) {
      if (phase[field] !== undefined) {
        updates.push({
          column: field,
          value: phase[field],
        });
      }
    }

    if (updates.length === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "No fields were provided for update" },
        { status: 400 },
      );
    }

    const values = updates.map((update) => update.value);

    const assignments = updates.map(
      (update, index) =>
        `${update.column} = $${index + 1}`,
    );

    values.push(phaseId);

    await client.query(
      `UPDATE phases
       SET ${assignments.join(", ")},
           updated_at = CURRENT_TIMESTAMP
       WHERE phase_id = $${values.length}`,
      values,
    );

    const result = await client.query(
      `SELECT ${PHASE_COLUMNS}
       FROM phases p
       WHERE p.phase_id = $1`,
      [phaseId],
    );

    await client.query("COMMIT");

    return NextResponse.json(
      {
        message: "Phase updated successfully",
        phase: serializePhase(result.rows[0]),
      },
      { status: 200 },
    );

  } catch (error: unknown) {
    await client.query("ROLLBACK");

    console.error("Failed to update phase", error);

    return NextResponse.json(
      { error: "Unable to update phase" },
      { status: 500 },
    );

  } finally {
    client.release();
  }
}

