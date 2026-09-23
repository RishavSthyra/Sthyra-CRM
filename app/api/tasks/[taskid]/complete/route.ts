import { NextRequest } from "next/server";
import { changeTaskState } from "@/lib/taskActions";
type Context = { params: Promise<{ taskid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return changeTaskState(request, (await context.params).taskid, "complete");
}
