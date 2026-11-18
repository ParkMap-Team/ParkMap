import { NextResponse } from "next/server";
import { parkedSpotInput } from "@/lib/parked-spot";
import { limitedBody, sameOrigin } from "@/lib/route-guard";
import { parkedSpot } from "@/lib/vehicle-session";

// The rider's marked spot (ADR 0021), kept by the LINE settings service under the session's account.
const headers = { "Cache-Control": "private, no-store" };
const failed = () => NextResponse.json({ detail: "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่" }, { status: 502, headers });

export async function GET() {
  const data = await parkedSpot();
  return data ? NextResponse.json(data, { headers }) : failed();
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  let spot: ReturnType<typeof parkedSpotInput>;
  try { spot = parkedSpotInput(JSON.parse(await limitedBody(request))); } catch { return new NextResponse(null, { status: 400 }); }
  if (!spot) return new NextResponse(null, { status: 400 });
  const data = await parkedSpot(spot);
  return data ? NextResponse.json(data, { headers }) : failed();
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const data = await parkedSpot("erase");
  return data ? NextResponse.json(data, { headers }) : failed();
}
