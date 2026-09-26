import { NextRequest } from "next/server";
import { handleTransferAction } from "@/lib/transferActions";
type Context = { params: Promise<{ transferid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return handleTransferAction(request, (await context.params).transferid, "submit");
}
