import { NextRequest } from "next/server"; import { performCallAction } from "@/lib/callActions";
type Context = { params: Promise<{ callid: string }> };
export async function POST(request: NextRequest, context: Context) { return performCallAction(request, (await context.params).callid, "mute"); }
