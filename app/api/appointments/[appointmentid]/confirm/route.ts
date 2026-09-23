import { NextRequest } from "next/server";
import { changeAppointmentState } from "@/lib/appointmentActions";
type Context = { params: Promise<{ appointmentid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return changeAppointmentState(
    request,
    (await context.params).appointmentid,
    "confirm",
  );
}
