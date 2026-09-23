import { NextRequest } from "next/server";
import { setSlaRuleActive } from "@/lib/slaRuleActions";
type Context = { params: Promise<{ slaruleid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return setSlaRuleActive(request, (await context.params).slaruleid, false);
}
