import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";
import { vehiclePreference } from "@/lib/vehicle-session";

// The entrance clip the Guard Booth screen plays before it names the model. Range requests pass
// through so the browser can seek and resume the video.

const UNAVAILABLE = { detail: "Entrance clip is unavailable." };
const RANGE = /^bytes=\d*-\d*$/;
const PASSED_HEADERS = ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  if (!(await vehiclePreference())?.model_id) return new Response(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return NextResponse.json(UNAVAILABLE, { status: 404, headers: { "Cache-Control": "no-store" } });
  const range = request.headers.get("Range");
  try {
    const { data, response } = await apiClient().GET("/api/sites/{site_id}/guard-booth-clip", {
      params: { path: { site_id: siteId } },
      headers: range && RANGE.test(range) ? { Range: range } : {},
      parseAs: "stream",
      cache: "no-store",
      signal: request.signal,
    });
    if ((response.status === 200 || response.status === 206) && data) {
      const headers = new Headers({ "Cache-Control": "private, no-store" });
      for (const name of PASSED_HEADERS) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(data, { status: response.status, headers });
    }
    if (response.status === 416) return new Response(null, { status: 416, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(UNAVAILABLE, { status: upstreamFailureStatus(response.status), headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("Entrance clip request failed", error);
    return NextResponse.json(UNAVAILABLE, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
