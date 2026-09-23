import { NextRequest } from "next/server";
import { reassignTask } from "@/lib/taskActions";
type Context = { params: Promise<{ taskid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return reassignTask(request, (await context.params).taskid);
}
