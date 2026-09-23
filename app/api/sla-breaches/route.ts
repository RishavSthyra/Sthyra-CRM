import { NextRequest } from "next/server";
import { GET as listSlaInstances } from "@/app/api/sla-instances/route";

export async function GET(request: NextRequest) {
  return listSlaInstances(request);
}
