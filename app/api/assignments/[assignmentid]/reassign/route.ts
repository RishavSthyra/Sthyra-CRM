import { NextRequest } from "next/server";
import { handleAssignmentReassign } from "@/lib/assignmentActions";
type Context = { params: Promise<{ assignmentid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return handleAssignmentReassign(request, (await context.params).assignmentid);
}
