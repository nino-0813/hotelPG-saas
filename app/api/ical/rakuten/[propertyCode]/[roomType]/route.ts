import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ propertyCode: string; roomType: string }> },
) {
  // Minimal response to confirm routing works and avoid 404s.
  // (Token check + DB-backed ICS generation will be re-applied after verification.)
  await params;
  return new NextResponse(
    `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Test Booking
DTSTART:20260510
DTEND:20260512
END:VEVENT
END:VCALENDAR`,
    {
      headers: {
        "Content-Type": "text/calendar",
      },
    },
  );
}

