import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/authorization";

export async function POST(request: NextRequest) {
  const scope = await requireSuperAdmin(request);
  if (!scope.ok) return scope.response;

  return NextResponse.json(
    {
      error:
        "Permissions cannot be deactivated because the permissions table has no active-state column",
    },
    { status: 409 },
  );
}
