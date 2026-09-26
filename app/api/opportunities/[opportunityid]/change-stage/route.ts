import { NextRequest } from "next/server";
import { changeOpportunityStage } from "@/lib/opportunityActions";
type Context = { params: Promise<{ opportunityid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return changeOpportunityStage(request, (await context.params).opportunityid);
}
