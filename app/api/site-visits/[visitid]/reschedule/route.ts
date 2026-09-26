import { NextRequest } from "next/server"; import { rescheduleSiteVisit } from "@/lib/siteVisitActions";
type Context = { params: Promise<{ visitid: string }> };
export async function POST(request: NextRequest, context: Context) { return rescheduleSiteVisit(request, (await context.params).visitid); }
