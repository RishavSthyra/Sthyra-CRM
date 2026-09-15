import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Permissions cannot be deactivated because the permissions table has no active-state column",
    },
    { status: 409 },
  );
}
