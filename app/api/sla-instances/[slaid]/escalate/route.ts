import { NextRequest } from "next/server";
import { changeSlaInstanceState } from "@/lib/slaInstanceActions";

type Context = { params: Promise<{ slaid: string }> };

export async function POST(request: NextRequest, context: Context) {
  return changeSlaInstanceState(
    request,
    (await context.params).slaid,
    "escalated",
  );
}
