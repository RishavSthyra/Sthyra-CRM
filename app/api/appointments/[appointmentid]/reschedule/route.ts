import { NextRequest } from "next/server";
import { rescheduleAppointment } from "@/lib/appointmentActions";
type Context = { params: Promise<{ appointmentid: string }> };
export async function POST(request: NextRequest, context: Context) {
  return rescheduleAppointment(request, (await context.params).appointmentid);
}
