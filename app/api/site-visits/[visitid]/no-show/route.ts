import { NextRequest } from "next/server"; import { changeSiteVisitState } from "@/lib/siteVisitActions";
type Context = { params: Promise<{ visitid: string }> };
export async function POST(request: NextRequest, context: Context) { return changeSiteVisitState(request, (await context.params).visitid, "no-show"); }
