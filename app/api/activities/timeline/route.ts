import { NextRequest } from "next/server";
import { listActivities } from "@/lib/activityQueries";

export async function GET(request: NextRequest) {
  return listActivities(request, true);
}
