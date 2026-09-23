import { NextRequest } from "next/server";
import { handleAssignmentAction } from "@/lib/assignmentActions";
type Context = { params: Promise<{ assignmentid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return handleAssignmentAction(
    request,
    (await context.params).assignmentid,
    "accept",
  );
}
