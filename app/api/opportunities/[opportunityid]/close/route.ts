import { NextRequest } from "next/server";
import { closeOpportunity } from "@/lib/opportunityActions";
type Context = { params: Promise<{ opportunityid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return closeOpportunity(request, (await context.params).opportunityid);
}
