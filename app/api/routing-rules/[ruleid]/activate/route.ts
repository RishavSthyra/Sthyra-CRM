import { NextRequest } from "next/server";
import { setRoutingRuleActive } from "@/lib/routingRuleActions";
type Context = { params: Promise<{ ruleid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return setRoutingRuleActive(request, (await context.params).ruleid, true);
}
