import { NextRequest } from "next/server";
import { setTransferTemplateActive } from "@/lib/transferTemplateActions";
type Context = { params: Promise<{ templateid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return setTransferTemplateActive(request, (await context.params).templateid, true);
}
