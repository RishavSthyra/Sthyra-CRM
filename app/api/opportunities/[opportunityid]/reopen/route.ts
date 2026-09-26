import { NextRequest } from "next/server";
import { reopenOpportunity } from "@/lib/opportunityActions";
type Context = { params: Promise<{ opportunityid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return reopenOpportunity(request, (await context.params).opportunityid);
}
