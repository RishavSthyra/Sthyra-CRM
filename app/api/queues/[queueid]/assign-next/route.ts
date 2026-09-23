import { NextRequest } from "next/server";
import { handleQueueAssignment } from "@/lib/queueActions";
type Context = { params: Promise<{ queueid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return handleQueueAssignment(request, (await context.params).queueid, true);
}
