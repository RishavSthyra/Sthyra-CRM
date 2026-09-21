
import { isObject } from "@/utils/isObject";
import { validateDate } from "@/utils/validateDate";
import { validatePositiveInteger } from "@/utils/validatePositiveInteger";
import { validatePositiveNumber } from "@/utils/validatePositiveNumber";
import { validateText } from "@/utils/validateText";

export const PHASE_COLUMNS = `
  p.phase_id,
  p.project_id,
  p.phase_code,
  p.phase_name,
  p.phase_number,
  p.phase_status,
  p.total_units,
  p.completed_units,
  p.total_acres,
  p.start_date::text AS start_date,
  p.expected_completion_date::text AS expected_completion_date,
  p.actual_completion_date::text AS actual_completion_date,
  p.description,
  p.is_active,
  p.created_at,
  p.updated_at
`;

export const PHASE_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "on_hold",
] as const;

const PHASE_FIELDS = [
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

export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export type PhaseWrite = Partial<{
  phase_code: string;
  phase_name: string;
  phase_number: number | null;
  phase_status: PhaseStatus;
  total_units: number | null;
  completed_units: number;
  total_acres: number | null;
  start_date: string | null;
  expected_completion_date: string | null;
  actual_completion_date: string | null;
  description: string | null;
  is_active: boolean; 
}>;

type ValidationResult =
  | { ok: true; data: PhaseWrite }
  | { ok: false; errors: string[] };

type PhaseRow = Record<string, unknown> & {
  total_acres?: string | number | null;
};


function numericValue(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function serializePhase(row: PhaseRow): PhaseRow {
  return {
    ...row,
    total_acres: numericValue(row.total_acres),
  };
}


export function ValidatePhasesPayload(
    body : unknown,
   options : {isPartial : boolean}
) : ValidationResult{
  
    // check if the input is object or not

    if (!isObject(body)) {
       return { ok: false, errors: ["Request body must be a JSON object"] };
    }

    const allowedFields = new Set<string>(PHASE_FIELDS);
    
    // we need to check if the body is having the allowed fields only

    const unknownFields = Object.keys(body).filter(
     (field) => !allowedFields.has(field));
   
    // what we are doing above is finding out the unkownFields which are not there in the
    // allowed fields but there in the body

  const errors = unknownFields.map((fields, index) => `unkown field = ${fields}`)

  const data_of_phase: PhaseWrite = {} // creates a empty object for the new verified data to get stored
  

  // checking of each and every fields of phases now

  const phase_code = validateText(body.phase_code, "phase_code", 50, false, errors)
  if (typeof phase_code == "string") {
    data_of_phase.phase_code = phase_code
  }

  const phase_name = validateText(body.phase_name, "phase_name", 200, false, errors)
  if (typeof phase_name == "string") {
    data_of_phase.phase_name = phase_name
  }

  const phase_number = validatePositiveInteger(body.phase_number,"phase_number",errors)
  if (typeof phase_number === "number") {
    data_of_phase.phase_number = phase_number
  }


  const phase_status = validateText(body.phase_status,"phase_status",30,false,errors)
  if (typeof phase_status === "string") {
      if (PHASE_STATUSES.includes(phase_status.toLowerCase() as PhaseStatus)) {
        data_of_phase.phase_status = phase_status as PhaseStatus;
    }
    else { 
        errors.push(
      `phase_status must be one of: ${PHASE_STATUSES.join(", ")}`
    );
    }
  }

  const total_units = validatePositiveInteger(body.total_units,"total_units",errors)

  const completed_units = validatePositiveInteger(body.completed_units,"completed_units",errors,true)

  if (typeof total_units === "number" ) {
    data_of_phase.total_units = total_units;
  }

  if (typeof completed_units === "number") {
    data_of_phase.completed_units = completed_units;
  }

  if (
    typeof total_units === "number" &&
    typeof completed_units === "number" &&
    completed_units > total_units
  ) {
    errors.push("completed_units cannot exceed total_units");
  }

    const total_acres = validatePositiveNumber(
    body.total_acres,
    "total_acres",
    errors,
  );
  
  if (total_acres !== undefined) data_of_phase.total_acres = total_acres;

    const startDate = validateDate(body.start_date, "start_date", errors);
    if (startDate !== undefined) data_of_phase.start_date = startDate;
  
    const completionDate = validateDate(
      body.expected_completion_date,
      "expected_completion_date",
      errors,
    );
    if (completionDate !== undefined) {
      data_of_phase.expected_completion_date = completionDate;
    }

    const actual_completion_date = validateDate(body.actual_completion_date, "actual_completion_date", errors);

    if (actual_completion_date !== undefined) data_of_phase.actual_completion_date = actual_completion_date;
  
    if (
      typeof startDate === "string" &&
      typeof completionDate === "string" &&
      completionDate < startDate
    ) {
      errors.push("expected_completion_date cannot be earlier than start_date");
    }

    const description = validateText(body.description,"description",500,true,errors)
    if( typeof description == "string"){
        data_of_phase.description = description
    }


    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
      errors.push("is_active must be a boolean");
    } else {
      data_of_phase.is_active = body.is_active;
    }
  }

  if (!options.isPartial) {
  if (body.phase_code === undefined) {
    errors.push("phase_code is required");
  }

  if (body.phase_name === undefined) {
    errors.push("phase_name is required");
  }

  if (body.phase_number === undefined) {
    errors.push("phase_number is required");
  }

  if (body.phase_status === undefined) {
    data_of_phase.phase_status = "planned";
  }

  if (body.is_active === undefined) {
    data_of_phase.is_active = true;
  }
} else if (Object.keys(body).length === 0) {
  errors.push("At least one field is required");
}


   return errors.length > 0 ? {ok :false, errors} : {ok : true, data : data_of_phase}


}
