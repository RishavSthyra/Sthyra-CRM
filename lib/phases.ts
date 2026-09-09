
import { isObject } from "@/utils/isObject";
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

    const allowedFields = new Set(PHASE_FIELDS);
    // we need to check if the body is having the allowed fields only

    const unknownFields = Object.keys(body).filter(
     (field) => !allowedFields.has(field));

    


}