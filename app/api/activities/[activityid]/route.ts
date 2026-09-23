import { NextRequest } from "next/server";
import { getActivity } from "@/lib/activityQueries";

type Context = { params: Promise<{ activityid: string }> };

export async function GET(request: NextRequest, context: Context) {
  return getActivity(request, (await context.params).activityid);
}
